#!/usr/bin/env python3
"""Generate the reference images on a ComfyUI server running Qwen-Image 2.1 (Apache-2.0).

The images in refs/ were made with this script. They are AI-generated targets the world is compared
against, never textures. To make new ones:

  COMFY_URL=http://host:8188 python3 -I tools/refs.py              # every shot of refs/shots.json, 2 pictures each
  COMFY_URL=... python3 -I tools/refs.py --only 03-lotus --count 4 --seed 7
  COMFY_URL=... python3 -I tools/refs.py --spec refs/ink-refs-mo.json --out refs/ink-candidates   # ink targets

COMFY_URL is the server's address. The workflow loads Qwen-Image 2.1 as a GGUF UNet (the ComfyUI-GGUF
custom node) with its text encoder and VAE, through the Qwen-Image 2.1 ComfyUI nodes (QwenImage21Cache,
TextEncodeQwenImage21). The model file names default to the ones below; set QWEN_UNET, QWEN_CLIP and
QWEN_VAE to match the files on your server.

A spec is a JSON file with "style" (appended to every prompt), "width", "height" and "shots" [{id, prompt}].
Pictures land in <out>/<shot>-s<seed>-<n>.png; ones already there are skipped.
"""
import argparse
import json
import os
import pathlib
import sys
import time
import urllib.parse
import urllib.request

URL = os.environ.get("COMFY_URL", "").rstrip("/")
ROOT = pathlib.Path(__file__).resolve().parent.parent
STEPS = 20
UNET = os.environ.get("QWEN_UNET", "qwen-image-2.1-Q6_K.gguf")
CLIP = os.environ.get("QWEN_CLIP", "qwen3vl_8b_int8_convrot.safetensors")
VAE = os.environ.get("QWEN_VAE", "qwen_image_2.1_vae_bf16.safetensors")


def call(path, body=None, timeout=60):
    req = urllib.request.Request(URL + path, method="POST" if body is not None else "GET")
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, data, timeout=timeout) as r:
        raw = r.read()
    return raw if path.startswith("/view") else json.loads(raw)


def workflow(prompt, width, height, seed, count, prefix):
    def node(cls, inputs):
        return {"class_type": cls, "inputs": inputs}

    return {
        "1": node("UnetLoaderGGUF", {"unet_name": UNET}),
        "2": node("CLIPLoader", {"clip_name": CLIP, "type": "qwen_image", "device": "default"}),
        "3": node("VAELoader", {"vae_name": VAE}),
        "4": node("QwenImage21Cache", {"device": "auto", "dtype": "default", "model": ["1", 0]}),
        "12": node("TextEncodeQwenImage21", {"prompt": prompt, "negative_prompt": "", "resolution": 0, "clip": ["2", 0], "vae": ["3", 0]}),
        "13": node("EmptyLatentImage", {"width": width, "height": height, "batch_size": count}),
        "14": node("KSampler", {"seed": seed, "steps": STEPS, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0,
                                "model": ["4", 0], "positive": ["12", 0], "negative": ["12", 1], "latent_image": ["13", 0]}),
        "15": node("VAEDecode", {"samples": ["14", 0], "vae": ["3", 0]}),
        "16": node("SaveImage", {"filename_prefix": prefix, "images": ["15", 0]}),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", help="shot ids")
    ap.add_argument("--count", type=int, default=2)
    ap.add_argument("--seed", type=int, default=1103)  # 《营造法式》成书之年
    ap.add_argument("--spec", default="refs/shots.json")
    ap.add_argument("--out", default="refs/candidates")
    args = ap.parse_args()
    if not URL:
        sys.exit("set COMFY_URL to the ComfyUI server")

    spec = json.loads((ROOT / args.spec).read_text())
    out = ROOT / args.out
    out.mkdir(parents=True, exist_ok=True)
    shots = [s for s in spec["shots"] if not args.only or s["id"] in args.only]

    pending = {}
    for s in shots:
        names = [out / f"{s['id']}-s{args.seed}-{n + 1}.png" for n in range(args.count)]
        if all(p.exists() for p in names):
            print("have", s["id"], flush=True)
            continue
        prompt = s["prompt"] + "\n" + spec["style"]
        wf = workflow(prompt, spec["width"], spec["height"], args.seed, args.count, f"linan/{s['id']}")
        pid = call("/prompt", {"prompt": wf})["prompt_id"]
        pending[pid] = (s["id"], names)
        print("queued", s["id"], pid, flush=True)

    started = time.time()
    while pending:
        time.sleep(20)
        for pid in list(pending):
            hist = call(f"/history/{pid}").get(pid)
            if not hist:
                continue
            shot, names = pending.pop(pid)
            status = hist.get("status", {})
            if status.get("status_str") != "success":
                print("FAILED", shot, json.dumps(status.get("messages", []))[:400], flush=True)
                continue
            imgs = [i for o in hist["outputs"].values() for i in o.get("images", [])]
            for img, dst in zip(imgs, names):
                q = urllib.parse.urlencode({"filename": img["filename"], "subfolder": img.get("subfolder", ""), "type": img.get("type", "output")})
                dst.write_bytes(call("/view?" + q, timeout=120))
            print(f"done {shot} {len(imgs)} pictures at {int(time.time() - started)} s", flush=True)
    print("all done", flush=True)


if __name__ == "__main__":
    sys.exit(main())
