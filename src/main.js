import { W, SY, SH, VY, VH, SUB, RAIL, state } from './state.js';
import { STYLE, palCache, P, R } from './palette.js';
import { sky, buildSky } from './scenery/sky.js';
import { clouds, far, mid, near, track, layers } from './scenery/index.js';
import { interior, drawInterior, drawStraps } from './interior.js';
import { passengers, drawPerson } from './passengers.js';
import { ac, rumbleF, motor, soundOn, click } from './audio.js';
import { setSeed, seedFromHash, setPlaying, initUI } from './ui.js';

const cv = document.getElementById('view');
const cx = cv.getContext('2d');

const speedLabel = document.getElementById('speed-label');
let speedShown = -1, speedTimer = 0;

function rebuild() { palCache.clear(); buildSky(); drawInterior(); layers.forEach(l => l.cache.clear()); }

function jointPattern() {
  // 継ぎ目を自車の前台車・後台車、隣の車両の台車が順に踏む
  const pat = [[0, 1], [21, 0.9], [138, 1], [159, 0.9], [200, 0.35], [221, 0.3]];
  for (const [px, s] of pat) {
    const dt = px / state.speed;
    if (px === 0 || px === 138) state.bobs.push(state.t + dt);
    if (soundOn && ac && ac.state === 'running') click(ac.currentTime + 0.02 + dt, s);
  }
}

/* ---------- frame ---------- */
function update(dt) {
  state.t += dt;
  state.speed = 240 * (0.9 + 0.08 * Math.sin(state.t * 0.07) + 0.03 * Math.sin(state.t * 0.23 + 1));
  state.dist += state.speed * dt;
  while (state.dist >= state.nextJoint) { jointPattern(); state.nextJoint += RAIL; }
  speedTimer -= dt;
  if (speedTimer <= 0) {
    speedTimer = 0.5;
    const kmh = Math.round(state.speed * 0.36);
    if (kmh !== speedShown) { speedShown = kmh; speedLabel.textContent = kmh + ' km/h'; }
    if (ac && rumbleF) { rumbleF.frequency.setTargetAtTime(180 + state.speed, ac.currentTime, 0.3); motor.frequency.setTargetAtTime(state.speed * 0.385, ac.currentTime, 0.3); }
  }
}
function render() {
  const { dist, t, bobs } = state;
  let bob = 0;
  while (bobs.length && bobs[0] + 0.07 < t) bobs.shift();
  for (const b of bobs) if (t >= b && t < b + 0.07) { bob = 1 / SUB; break; }
  const oy = SY + bob;
  cx.setTransform(SUB, 0, 0, SUB, 0, -VY * SUB);
  cx.drawImage(sky, 0, SY);
  clouds.render(cx, dist * clouds.f + t * 1.2, oy);
  far.render(cx, dist * far.f, oy);
  mid.render(cx, dist * mid.f, oy);
  near.render(cx, dist * near.f, oy);
  track.render(cx, dist * track.f, oy);
  // 架線と架線柱（隣の線路）
  const SPAN = 480, wx = Math.floor(dist * 1.2), dr = 96, dro = 48, wy = 13, my0 = 5, sag = 6;
  cx.fillStyle = P('#3d4442');
  cx.fillRect(0, oy + wy, W, 1);
  for (let x = 0; x < W; x++) {
    const p = (((wx + x) % SPAN) + SPAN) % SPAN / SPAN, yy = oy + my0 + Math.round(sag * 4 * p * (1 - p));
    cx.fillRect(x, yy, 1, 1);
    if ((((wx + x) % dr) + dr) % dr === dro) cx.fillRect(x, yy, 1, oy + wy - yy);
  }
  for (let k = Math.floor(wx / SPAN); k * SPAN < wx + W + 20; k++) {
    const sx = k * SPAN - wx;
    R(cx, sx, SY, 4, SH + 2, '#4b5350'); R(cx, sx, SY, 1, SH + 2, '#75807c');
    R(cx, sx - 12, SY + 3, 30, 2, '#4b5350');
  }
  // ガラスの映り込み
  if (STYLE.glass) {
    cx.globalAlpha = 0.08; cx.fillStyle = '#ffffff';
    for (let y = 28; y < 104; y++) {
      const s = (103 - y) >> 1;
      cx.fillRect(70 + s, y, 9, 1); cx.fillRect(86 + s, y, 3, 1);
      cx.fillRect(196 + s, y, 9, 1); cx.fillRect(212 + s, y, 3, 1);
    }
    cx.globalAlpha = 1;
  }
  cx.drawImage(interior, 0, 0);
  if (state.showPass) for (const p of passengers) drawPerson(cx, p, t);
  drawStraps(cx, t, bob ? 0.5 : 0);
}
function frame(now) {
  const dt = Math.min(0.05, (now - state.last) / 1000); state.last = now;
  if (state.playing) { update(dt); render(); }
  requestAnimationFrame(frame);
}

/* ---------- sizing: ドットが均一になるよう、端末ピクセルの整数倍で表示する ---------- */
const stage = document.getElementById('stage');
function fit() {
  // 1ドット(= キャンバスの SUB ピクセル)が端末ピクセルの整数倍になる最大の倍率
  const dpr = window.devicePixelRatio || 1, aw = stage.clientWidth, ah = stage.clientHeight;
  let s = Math.floor(Math.min(aw / W, ah / VH) * dpr) / dpr;
  if (!(s * dpr >= 1)) s = Math.max(0.1, Math.min(aw / W, ah / VH));
  cv.style.width = (W * s) + 'px'; cv.style.height = (VH * s) + 'px';
}
window.addEventListener('resize', fit);
if (window.ResizeObserver) new ResizeObserver(fit).observe(stage);

/* ---------- boot ---------- */
initUI(render, rebuild);
const h0 = seedFromHash();
setSeed(h0 !== null ? h0 : 1000 + Math.floor(Math.random() * 9000));
cv.width = W * SUB; cv.height = VH * SUB; cx.imageSmoothingEnabled = false;
rebuild(); fit();
update(0.016); render();
if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPlaying(false);
requestAnimationFrame(frame);
