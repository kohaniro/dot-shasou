import { W, SY, SH, VY, VH, SUB, RAIL, state } from './state.js';
import { STYLE, palCache, P, R } from './palette.js';
import { sky, buildSky } from './scenery/sky.js';
import { clouds, far, mid, near, track, plat, layers } from './scenery/index.js';
import { drawDoorBackdrop } from './scenery/station.js';
import { stationNear } from './stations.js';
import { interior, drawInterior, drawStraps, drawDoors, doorShift, DOOR_W } from './interior.js';
import { drawPassengers } from './passengers.js';
import { ac, soundOn, click, driveAudio } from './audio.js';
import { stepJourney } from './journey.js';
import { setSeed, seedFromHash, setPlaying, initUI } from './ui.js';

const cv = document.getElementById('view');
const cx = cv.getContext('2d');

const speedLabel = document.getElementById('speed-label');
const nextLabel = document.getElementById('next-label');
let speedShown = -1, speedTimer = 0, audioTimer = 0;

function rebuild() { palCache.clear(); buildSky(); drawInterior(); layers.forEach(l => l.cache.clear()); }

/* 継ぎ目を自車の前台車・後台車、隣の車両の台車が順に踏む。踏む地点（走行距離）を state.hits に積み、
   その地点に届く少し前（HIT_LOOK 秒以内）になってから音と揺れを予約する。速度 0 でも割り算せず、停車後に古い予約が鳴らない */
const HIT_LOOK = 0.1;
function jointPattern(j) {
  const pat = [[0, 1], [21, 0.9], [138, 1], [159, 0.9], [200, 0.35], [221, 0.3]];
  for (const [px, s] of pat) state.hits.push([j + px, s, px === 0 || px === 138]);
}
function scheduleHits() {
  const { hits, dist, speed, t } = state;
  while (hits.length && hits[0][0] <= dist + speed * HIT_LOOK) {
    const [d, s, bob] = hits.shift();
    const dt = d > dist && speed > 0 ? (d - dist) / speed : 0;
    if (bob) state.bobs.push(t + dt);
    // 遅いほど小さく（停車寸前の継ぎ目はかすかに）
    if (soundOn && ac && ac.state === 'running') click(ac.currentTime + 0.02 + dt, s * (0.25 + 0.75 * Math.min(1, speed / 200)));
  }
}

/* ---------- frame ---------- */
function update(dt) {
  state.t += dt;
  stepJourney(dt);
  while (state.dist >= state.nextJoint) { jointPattern(state.nextJoint); state.nextJoint += RAIL; }
  scheduleHits();
  audioTimer -= dt;
  if (audioTimer <= 0) { audioTimer = 0.1; driveAudio(); }
  speedTimer -= dt;
  if (speedTimer <= 0) {
    speedTimer = 0.5;
    const kmh = Math.round(state.speed * 0.36);
    if (kmh !== speedShown) { speedShown = kmh; speedLabel.textContent = kmh + ' km/h'; }
  }
}
/* 「次は ○○」（停車中は駅名だけ）。駅か停車の有無が変わったときだけ書き換える */
let nextShown = '';
function updateNextLabel() {
  const st = state.station; if (!st) return;
  const txt = state.phase === 'stop' ? st.name : '次は ' + st.name;
  if (txt !== nextShown) { nextShown = txt; nextLabel.textContent = txt; nextLabel.title = st.kana; }
}
function render() {
  updateNextLabel();
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
  // 駅のホーム（架線より手前）。駅の近くでだけ描く
  if (stationNear(dist + W / 2, 160)) plat.render(cx, dist * plat.f, oy);
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
  // ドア: 開いた分だけ、景色の層の上下にホームの続きを描き足してから扉を重ねる
  const dsh = state.phase === 'stop' ? doorShift(state.door) : 0;
  if (dsh > 0) { drawDoorBackdrop(cx, state.station, 0, dsh); drawDoorBackdrop(cx, state.station, W - dsh, dsh); }
  drawDoors(cx, dsh / DOOR_W);
  cx.drawImage(interior, 0, 0);
  drawPassengers(cx, t);
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
