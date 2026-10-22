// The watermark: a small red seal (印章) reading 杭 beside "lapla.si", faint, in the bottom-right corner. Drawn in code
// (one SVG, system fonts), the same in the page and in rendered frames.
//
//   mountWatermark(parent)            the page's mark (src/explore/ui.js): above the canvas, under the menu panel,
//                                     pointer-events none; ?wm=0 hides it (development only)
//   watermarkSVG({ night, k })        the mark as an SVG string, k = scale (1 = the page's CSS pixels)
//   stampDataURL(url, { night })      a rendered frame (PNG data URL) with the mark composited, same size and opacity
//                                     relative to the frame as the page's mark in a 900 px high window
//                                     (tools/render.mjs, tools/render-video.mjs; --wm 0 leaves it out)
//
// Day: a vermilion seal with a paper-white 杭, the name in ink, a faint paper halo (legible on dark rocks and trees,
// invisible on paper). Night (the moonlit look): a muted seal, the name in pale paper, a dark halo, a little fainter.

/** geometry in CSS pixels at k = 1: the page's mark in a 900 px high window */
const G = { seal: 18, glyph: 13.5, text: 12, gap: 6, right: 22, bottom: 18, w: 96, pad: 4 };
export const WM_OPACITY = { day: 0.3, night: 0.24 };
const COL = {
  day: { seal: '#a8321f', glyph: '#f4ead8', text: '#1d1b18', halo: '#eee8db', haloA: 0.9 },
  night: { seal: '#8e4436', glyph: '#e6dccb', text: '#e9e2d2', halo: '#10151e', haloA: 0.7 },
};
const SERIF = `'Songti SC', 'STSong', 'Noto Serif CJK SC', 'Source Han Serif SC', 'SimSun', serif`;
const LATIN = `'Iowan Old Style', 'Palatino', 'Georgia', serif`;

/** the seal's outline: a square with slightly worn, uneven edges (fixed points: the same mark every time) */
function sealPath(x, y, s) {
  // [t along the edge, inward offset] per edge, small and irregular like a stamped impression
  const wob = [[0.18, 0.12], [0.43, -0.06], [0.71, 0.16], [0.9, 0.04]];
  const r = s * 0.07;
  const pts = [];
  const edge = (ax, ay, bx, by, nx, ny, w) => {
    for (const [t, o] of w) pts.push([ax + (bx - ax) * t + nx * o, ay + (by - ay) * t + ny * o]);
  };
  pts.push([x + r, y]);
  edge(x, y, x + s, y, 0, 1, wob);
  pts.push([x + s - r, y]); pts.push([x + s, y + r]);
  edge(x + s, y, x + s, y + s, -1, 0, wob.map(([t, o]) => [t, o * 0.8]));
  pts.push([x + s, y + s - r]); pts.push([x + s - r, y + s]);
  edge(x + s, y + s, x, y + s, 0, -1, wob.map(([t, o]) => [t, -o * 0.6 + 0.05]));
  pts.push([x + r, y + s]); pts.push([x, y + s - r]);
  edge(x, y + s, x, y, 1, 0, wob.map(([t, o]) => [1 - t, o]));
  pts.push([x, y + r]);
  return 'M' + pts.map(([a, b]) => `${a.toFixed(2)} ${b.toFixed(2)}`).join('L') + 'Z';
}

/** the mark as SVG (width G.w·k, height (G.seal + 2·pad)·k); the seal sits at the right edge */
export function watermarkSVG({ night = false, k = 1 } = {}) {
  const c = night ? COL.night : COL.day;
  const W = G.w, H = G.seal + G.pad * 2, s = G.seal, x0 = W - G.pad - s, y0 = G.pad;
  const id = night ? 'n' : 'd';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${(W * k).toFixed(2)}" height="${(H * k).toFixed(2)}" viewBox="0 0 ${W} ${H}">` +
    `<defs>` +
    // the halo: the mark's shape grown by a pixel and blurred, under it
    `<filter id="wmh${id}" x="-10%" y="-40%" width="120%" height="180%" color-interpolation-filters="sRGB">` +
    `<feMorphology in="SourceAlpha" operator="dilate" radius="0.8" result="d"/>` +
    `<feGaussianBlur in="d" stdDeviation="1.5" result="b"/>` +
    `<feFlood flood-color="${c.halo}" flood-opacity="${c.haloA}"/><feComposite in2="b" operator="in" result="h"/>` +
    `<feMerge><feMergeNode in="h"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    // the seal's ink: a little uneven, as stamped (a fixed noise seed)
    `<filter id="wms${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n"/>` +
    `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.72" result="m"/>` +
    `<feComposite in="SourceGraphic" in2="m" operator="in"/></filter>` +
    `</defs>` +
    `<g filter="url(#wmh${id})">` +
    `<text x="${(x0 - G.gap).toFixed(2)}" y="${(y0 + s * 0.79).toFixed(2)}" text-anchor="end" font-family="${LATIN}" font-size="${G.text}" letter-spacing="0.7" fill="${c.text}">lapla.si</text>` +
    `<path d="${sealPath(x0, y0, s)}" fill="${c.seal}" filter="url(#wms${id})"/>` +
    `<text x="${(x0 + s / 2).toFixed(2)}" y="${(y0 + s * 0.5).toFixed(2)}" text-anchor="middle" dominant-baseline="central" font-family="${SERIF}" font-size="${G.glyph}" fill="${c.glyph}">杭</text>` +
    `</g></svg>`;
}

/** where the mark sits in a frame of w × h pixels (scale with the frame's height; the page's at 900 px) */
export function watermarkBox(w, h) {
  const k = h / 900;
  const bw = G.w * k, bh = (G.seal + G.pad * 2) * k;
  // the page's CSS places the seal's edge G.right / G.bottom from the corner; the SVG has G.pad of margin round it
  return { k, x: w - (G.right - G.pad) * k - bw, y: h - (G.bottom - G.pad) * k - bh, w: bw, h: bh };
}

const imgCache = new Map();
function svgImage(svg) {
  if (imgCache.has(svg)) return imgCache.get(svg);
  const p = new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('watermark: SVG failed to load'));
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  imgCache.set(svg, p);
  return p;
}

/** draw the mark onto a 2D context of a w × h frame */
export async function drawWatermark(ctx, w, h, { night = false } = {}) {
  const b = watermarkBox(w, h);
  const im = await svgImage(watermarkSVG({ night, k: b.k }));
  ctx.save();
  ctx.globalAlpha = night ? WM_OPACITY.night : WM_OPACITY.day;
  ctx.drawImage(im, b.x, b.y, b.w, b.h);
  ctx.restore();
}

/** a frame (PNG data URL) with the mark stamped in → PNG data URL */
export async function stampDataURL(url, { night = false } = {}) {
  const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('watermark: frame failed to load')); i.src = url; });
  const cv = document.createElement('canvas');
  cv.width = im.naturalWidth; cv.height = im.naturalHeight;
  const ctx = cv.getContext('2d', { colorSpace: 'srgb' });
  ctx.drawImage(im, 0, 0);
  await drawWatermark(ctx, cv.width, cv.height, { night });
  return cv.toDataURL('image/png');
}

const CSS = `
.x-wm { position: absolute; z-index: 0; right: calc(max(${G.right}px, env(safe-area-inset-right)) - ${G.pad}px);
        bottom: calc(max(${G.bottom}px, env(safe-area-inset-bottom)) - ${G.pad}px); width: ${G.w}px; height: ${G.seal + G.pad * 2}px;
        pointer-events: none !important; opacity: ${WM_OPACITY.day}; user-select: none; -webkit-user-select: none; }
.x-wm svg { display: block; width: 100%; height: 100%; }
.x-wm .n { display: none; }
.xui.night .x-wm { opacity: ${WM_OPACITY.night}; }
.xui.night .x-wm .n { display: block; }
.xui.night .x-wm .d { display: none; }
/* phones: above the hint bar (bottom centre), and left of the up / down buttons while flying (bottom right) */
.xui.touch .x-wm { right: calc(max(12px, env(safe-area-inset-right)) - ${G.pad}px); bottom: calc(max(18px, env(safe-area-inset-bottom)) + 58px - ${G.pad}px); }
.xui.touch.flying .x-wm { right: calc(max(18px, env(safe-area-inset-right)) + 70px - ${G.pad}px); }
`;

/** the page's mark, the first child of the interface root (so the menu panel and the hint draw over it) */
export function mountWatermark(parent) {
  if (new URLSearchParams(location.search).get('wm') === '0') return null;
  if (!document.getElementById('x-wm-css')) {
    const st = document.createElement('style'); st.id = 'x-wm-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  const el = document.createElement('div');
  el.className = 'x-wm';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = watermarkSVG({ night: false }).replace('<svg ', '<svg class="d" ') + watermarkSVG({ night: true }).replace('<svg ', '<svg class="n" ');
  parent.insertBefore(el, parent.firstChild);
  // a fullscreen element other than the page itself: the mark goes with it
  document.addEventListener('fullscreenchange', () => {
    const fs = document.fullscreenElement;
    const host = fs && fs !== document.documentElement && fs !== document.body && !(fs instanceof HTMLCanvasElement) ? fs : parent;
    if (el.parentNode !== host) host.appendChild(el);
  });
  return el;
}
