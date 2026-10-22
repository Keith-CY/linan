// The README teaser (media/teaser.gif): a few moments of the tour video cut together with short dissolves, ending in a
// dissolve back to the first frame so the GIF loops without a jump. A GIF pays for every speck and every changed pixel,
// so the frames are scaled, the paper's grain softened a little, and each moment gets its own palette (sunset gold,
// moonlit blue and autumn red do not share one well; one palette per frame would defeat the encoder's reuse of the
// unchanged pixels of the frame before).
//
//   node tools/make-teaser.mjs [--in media/tour.mp4] [--out media/teaser.gif] [--w 960] [--fps 10] [--colors 40]
//                              [--dither none|bayer]
//
// CLIPS are [start, end] seconds of the tour (src/video/sequence.js: the viewpoints start 0, 6.2, 12.0, 17.8, 23.2,
// 29.0, 34.8, 40.6 and 46.4 s into it).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = {};
for (let i = 2; i < process.argv.length; i++) { const k = process.argv[i]; if (k.startsWith('--')) { args[k.slice(2)] = process.argv[i + 1]; i++; } }
const IN = path.resolve(ROOT, args.in || 'media/tour.mp4');
const OUT = path.resolve(ROOT, args.out || 'media/teaser.gif');
const W = Number(args.w || 960), FPS = Number(args.fps || 10), COLORS = Number(args.colors || 40);
const DITHER = args.dither === 'bayer' ? 'bayer:bayer_scale=4' : 'none';
const XF = 0.5;   // dissolve between clips (s)

const CLIPS = [
  [0.0, 2.1],     // 西湖全景, the opening frame first
  [26.0, 28.1],   // 雷峰夕照
  [32.0, 34.1],   // 三潭印月 by moonlight
  [49.6, 51.7],   // 断桥残雪
];

// 1) the cut, at the GIF's size and rate (lossless intermediate)
const tmp = OUT.replace(/\.gif$/, '.src.mkv');
let fc = '';
CLIPS.forEach(([a, b], i) => { fc += `[0:v]trim=${a}:${b},setpts=PTS-STARTPTS,fps=${FPS},scale=${W}:-2:flags=lanczos,format=yuv444p[c${i}];`; });
// the loop: the first frame again, held for the last dissolve
const held = Math.round(XF * FPS) + 1;
fc += `[0:v]trim=end_frame=1,setpts=PTS-STARTPTS,scale=${W}:-2:flags=lanczos,format=yuv444p,loop=loop=${held - 1}:size=1:start=0,setpts=N/(${FPS}*TB),fps=${FPS}[c${CLIPS.length}];`;
let last = '[c0]', t = CLIPS[0][1] - CLIPS[0][0];
const starts = [0];   // where each palette's range begins: each clip, each dissolve
for (let i = 1; i <= CLIPS.length; i++) {
  fc += `${last}[c${i}]xfade=transition=fade:duration=${XF}:offset=${(t - XF).toFixed(3)}[x${i}];`;
  last = `[x${i}]`;
  starts.push(t - XF, t);   // the dissolve gets a palette of its own (two moments' colours in one frame)
  t = t - XF + (i < CLIPS.length ? CLIPS[i][1] - CLIPS[i][0] : XF);
}
// end just before the first frame comes round again (the GIF loops onto it)
fc += `${last}trim=0:${t.toFixed(3)},hqdn3d=4:4:0:0,format=rgb24[v]`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', IN, '-filter_complex', fc, '-map', '[v]', '-c:v', 'ffv1', tmp], { stdio: 'inherit' });

// 2) one palette per clip, the frames of each clip quantised to it, then the GIF
let g = '';
for (let i = 0; i < starts.length - 1; i++) {
  g += `[0:v]trim=${starts[i].toFixed(3)}:${starts[i + 1].toFixed(3)},setpts=PTS-STARTPTS,split[a${i}][b${i}];` +
    `[a${i}]palettegen=max_colors=${COLORS}:stats_mode=full[p${i}];[b${i}][p${i}]paletteuse=dither=${DITHER}:diff_mode=rectangle[q${i}];`;
}
g += `${starts.slice(0, -1).map((_, i) => `[q${i}]`).join('')}concat=n=${starts.length - 1}:v=1:a=0[g]`;
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', tmp, '-filter_complex', g, '-map', '[g]', '-loop', '0', OUT], { stdio: 'inherit' });
fs.rmSync(tmp, { force: true });
console.log(`[teaser] ${path.relative(ROOT, OUT)}: ${t.toFixed(1)} s at ${FPS} fps, ${W} px wide, ${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB`);
