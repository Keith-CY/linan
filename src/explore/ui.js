// The explorable world's interface: loading screen progress (markup in index.html), a title, the places and the
// times of day / seasons, walk / fly, a short help line, the touch stick and the watermark (src/explore/watermark.js).
// Plain DOM, no external assets.
import { mountWatermark } from './watermark.js';

export const PLACES = [
  { id: 1, zh: '西湖全景', en: 'West Lake from Baoshi Hill' },
  { id: 2, zh: '苏堤春晓', en: 'Su Causeway at Dawn' },
  { id: 3, zh: '曲院风荷', en: 'Lotus at Quyuan' },
  { id: 4, zh: '雷峰夕照', en: 'Leifeng Pagoda at Sunset', title: { left: '62%' } },
  { id: 5, zh: '三潭印月', en: 'Three Pools Mirroring the Moon' },
  { id: 6, zh: '南宋皇城', en: 'The Imperial Palace' },
  { id: 7, zh: '临安御街', en: 'The Imperial Way' },
  // the still's sky between the trees and the cliff (the centre is the pavilion and the cliff edge)
  { id: 8, zh: '飞来峰', en: 'Feilai Peak and Lingyin', title: { left: '47%', top: '7%' } },
  { id: 9, zh: '六和塔', en: 'Liuhe Pagoda and the Tide' },
  { id: 10, zh: '断桥残雪', en: 'Broken Bridge in Snow' },
];

/** the looks of src/world/looks.js offered as times and seasons (look id = the shot that defines it) */
export const TIMES = [
  { look: 2, zh: '春晓', en: 'Spring dawn' },
  { look: 3, zh: '夏午', en: 'Summer noon' },
  { look: 4, zh: '夕照', en: 'Sunset' },
  { look: 5, zh: '月夜', en: 'Moonlit night' },
  { look: 8, zh: '秋', en: 'Autumn' },
  { look: 10, zh: '冬雪', en: 'Winter snow' },
];

const STEPS = {
  terrain: ['铺展山水', 'Laying out the hills'], water: ['引湖水', 'Filling the lake'], yingzao: ['依《营造法式》起殿阁', 'Raising the halls'],
  pagodas: ['立塔', 'Raising the pagodas'], karst: ['凿飞来峰', 'Carving Feilai Peak'], rocks: ['置石', 'Setting the stones'],
  bridges: ['架桥', 'Building the bridges'], city: ['筑临安城', 'Building Lin’an'], boats: ['泊舟', 'Mooring the boats'],
  tide: ['钱塘潮', 'The Qiantang tide'], vegetation: ['植柳种荷', 'Planting willows and lotus'], mist: ['起雾', 'Mist on the water'],
  done: ['研墨', 'Grinding the ink'], shaders: ['研墨', 'Grinding the ink'], start: ['展卷', 'Unrolling the scroll'],
};

export function loadingProgress(f, name) {
  const bar = document.getElementById('ld-bar'), st = document.getElementById('ld-step'), pc = document.getElementById('ld-pc');
  if (!bar) return;
  const s = STEPS[name] || STEPS.start;
  bar.style.transform = `scaleX(${Math.max(0.02, Math.min(1, f)).toFixed(3)})`;
  st.innerHTML = `${s[0]}<span>${s[1]}</span>`;
  pc.textContent = Math.round(f * 100) + '%';
}

export function hideLoading() {
  const el = document.getElementById('loading');
  if (!el) return;
  el.classList.add('gone');
  setTimeout(() => el.remove(), 900);
}

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

export class ExploreUI {
  constructor({ onPlace, onTime, onMode }) {
    const root = el('div', 'xui');
    root.innerHTML = `
      <div class="x-title"><b>临安</b><span>Lin’an · Southern Song Hangzhou</span></div>
      <button class="x-menu-btn" aria-label="Places and times">景 <span>Places</span></button>
      <div class="x-panel" hidden>
        <div class="x-sec"><h3>名胜 <span>Places</span></h3><ol class="x-places"></ol></div>
        <div class="x-sec"><h3>时令 <span>Time and season</span></h3><div class="x-times"></div></div>
        <div class="x-sec x-row"><div class="x-modes"><button data-m="walk">步行 <span>Walk</span></button><button data-m="fly">飞行 <span>Fly</span></button></div></div>
        <p class="x-keys"></p>
      </div>
      <div class="x-hint"></div>
      <div class="x-place"></div>
      <div class="x-fly"><button data-l="1" aria-label="Up">升</button><button data-l="-1" aria-label="Down">降</button></div>
      <div class="x-stick"><i></i></div>
      <div class="x-fps" hidden></div>`;
    document.body.appendChild(root);
    this.root = root;
    this.touch = matchMedia('(pointer: coarse)').matches;
    root.classList.toggle('touch', this.touch);
    this.wm = mountWatermark(root);
    const ol = root.querySelector('.x-places');
    for (const p of PLACES) {
      const li = el('li', '', `<button data-p="${p.id}"><em>${p.id % 10}</em>${p.zh}<span>${p.en}</span></button>`);
      ol.appendChild(li);
    }
    const tm = root.querySelector('.x-times');
    for (const t of TIMES) tm.appendChild(el('button', '', `${t.zh}<span>${t.en}</span>`)).dataset.t = t.look;
    root.querySelector('.x-keys').innerHTML = this.touch
      ? '左手推动行走，右手拖动环顾<br><span>Left thumb to walk, drag on the right to look around</span>'
      : 'WASD 行走 · 鼠标环顾 · Shift 跑 · F 飞行 · 1–0 名胜 · T 时令 · M 菜单<br><span>WASD walk · mouse look · Shift run · F fly · 1–0 places · T time · M menu</span>';
    this.panel = root.querySelector('.x-panel');
    this.btn = root.querySelector('.x-menu-btn');
    this.btn.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
    this.panel.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.p) { onPlace(Number(b.dataset.p)); this.toggle(false); }
      else if (b.dataset.t) { onTime(Number(b.dataset.t)); }
      else if (b.dataset.m) { onMode(b.dataset.m); }
    });
    for (const b of root.querySelectorAll('.x-fly button')) {
      const l = Number(b.dataset.l);
      b.addEventListener('touchstart', (e) => { e.preventDefault(); this.lift = l; }, { passive: false });
      b.addEventListener('touchend', () => { this.lift = 0; });
      b.addEventListener('mousedown', () => { this.lift = l; });
      b.addEventListener('mouseup', () => { this.lift = 0; });
    }
    this.lift = 0;
    this.stickEl = root.querySelector('.x-stick');
    this.knobEl = this.stickEl.querySelector('i');
    this.hint = root.querySelector('.x-hint');
    this.placeEl = root.querySelector('.x-place');
    this.fpsEl = root.querySelector('.x-fps');
    this.setLocked(false);
    if (this.touch) setTimeout(() => this.hint.classList.add('fade'), 6000);
  }
  menuOpen() { return !this.panel.hidden; }
  toggle(open = this.panel.hidden) {
    this.panel.hidden = !open;
    this.root.classList.toggle('open', open);
    if (open && document.pointerLockElement) document.exitPointerLock?.();
  }
  setLocked(locked) {
    this.hint.innerHTML = this.touch ? '左侧拖动行走 · 右侧拖动环顾 <span>Drag left to walk · drag right to look</span>' : locked
      ? 'Esc 释放鼠标 <span>Esc to free the mouse</span>'
      : '点击画面以环顾 · WASD 行走 <span>Click to look around · WASD to walk</span>';
  }
  setState({ place, look, mode }) {
    for (const b of this.root.querySelectorAll('[data-p]')) b.classList.toggle('on', Number(b.dataset.p) === place);
    for (const b of this.root.querySelectorAll('[data-t]')) b.classList.toggle('on', Number(b.dataset.t) === look);
    for (const b of this.root.querySelectorAll('[data-m]')) b.classList.toggle('on', b.dataset.m === mode);
    this.root.classList.toggle('flying', mode === 'fly');
    this.root.classList.toggle('night', look === 5);
  }
  /** a place name that fades in and out after a teleport */
  announce(p) {
    if (!p) return;
    this.placeEl.innerHTML = `${p.zh}<span>${p.en}</span>`;
    // a place may set where its title sits (in the sky of its still, clear of the subject); phones keep the default
    const t = !this.touch && p.title ? p.title : {};
    this.placeEl.style.left = t.left || ''; this.placeEl.style.top = t.top || '';
    this.placeEl.classList.remove('show'); void this.placeEl.offsetWidth; this.placeEl.classList.add('show');
  }
}
