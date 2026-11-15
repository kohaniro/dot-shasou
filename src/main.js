import { W, SY, SH, VY, VH, SUB, RAIL, state } from './state.js';
import { STYLE, clearPal, setTone, P, R } from './palette.js';
import { sky, skyB } from './scenery/sky.js';
import { clouds, far, mid, near, track, plat, truss, xing, closewall, tunnel, layers } from './scenery/index.js';
import { bridgeNear, poleOnBridge } from './scenery/bridge.js';
import { tunnelNear, tunnelCovers, poleInTunnel, tunnelGlass } from './scenery/tunnel.js';
import { drawCrossingNearLamps, crossingClose, poleOnCrossing } from './scenery/crossing.js';
import { wallClose, poleOnWall } from './scenery/closewall.js';
import { drawDoorBackdrop } from './scenery/station.js';
import { stationNear } from './stations.js';
import { interior, drawInterior, drawStraps, drawDoors, doorShift, DOOR_W } from './interior.js';
import { drawPassengers } from './passengers.js';
import { ac, soundOn, click, driveAudio } from './audio.js';
import { featureMix } from './features.js';
import { curve, elev } from './course.js';
import { tones, viewOff } from './layers.js';
import { syncTone, stepTone, resetTone } from './tone.js';
import { drawFall, drawGlassRain } from './weather.js';
import { stepJourney } from './journey.js';
import { setSeed, seedFromHash, setPlaying, initUI } from './ui.js';
import { initDebug } from './debug.js';

const cv = document.getElementById('view');
const cx = cv.getContext('2d');

const speedLabel = document.getElementById('speed-label');
const nextLabel = document.getElementById('next-label');
let speedShown = -1, speedTimer = 0, audioTimer = 0;

function rebuild() { clearPal(); drawInterior(); layers.forEach(l => l.clear()); resetTone(); }

/* 継ぎ目を自車の前台車・後台車、隣の車両の台車が順に踏む。踏む地点（走行距離）を state.hits に積み、
   その地点に届く少し前（HIT_LOOK 秒以内）になってから音と揺れを予約する。速度 0 でも割り算せず、停車後に古い予約が鳴らない */
const HIT_LOOK = 0.1;
function jointPattern(j) {
  const pat = [[0, 1], [21, 0.9], [138, 1], [159, 0.9], [200, 0.35], [221, 0.3]];
  for (const [px, s] of pat) state.hits.push([j + px, s, px === 0 || px === 138]);
}
function scheduleHits() {
  const { hits, dist, speed, t } = state;
  let mix = null; // トンネル・橋の中か（席の位置で1回だけ引く）
  while (hits.length && hits[0][0] <= dist + speed * HIT_LOOK) {
    const [d, s, bob] = hits.shift();
    const dt = d > dist && speed > 0 ? (d - dist) / speed : 0;
    if (bob) state.bobs.push(t + dt);
    // 遅いほど小さく（停車寸前の継ぎ目はかすかに）
    if (soundOn && ac && ac.state === 'running' && state.rate === 1) click(ac.currentTime + 0.02 + dt, s * (0.25 + 0.75 * Math.min(1, speed / 200)), mix || (mix = featureMix(dist + W / 2)));
  }
}

/* カーブと高低差で、窓の外の絵を上下にずらす量（ドット。半ドット刻みに丸めて使う） */
const CANT = 2;      // カーブ: curve = ±1 のとき、空以外の全部を一様に。正（窓がカーブの外側）で景色が下がる
const LEAN = 3;      // つり革の傾き: state.lean = ±1 のとき、輪の位置で
const half = v => Math.round(v * SUB) / SUB;

/* ---------- frame ---------- */
function update(dt) {
  state.t += dt;
  stepJourney(dt);
  while (state.dist >= state.nextJoint) { jointPattern(state.nextJoint); state.nextJoint += RAIL; }
  scheduleHits();
  audioTimer -= dt;
  if (audioTimer <= 0) { audioTimer = 0.1; if (state.rate === 1) driveAudio(); } // 早送り中は音を止めているので動かさない
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
  syncTone(); // 窓の中央の時刻・天気を state に書く。瞬間移動などのときは、ここでトーンを即座に切り替える
  const { dist, t, bobs } = state;
  let bob = 0;
  while (bobs.length && bobs[0] + 0.07 < t) bobs.shift();
  for (const b of bobs) if (t >= b && t < b + 0.07) { bob = 1 / SUB; break; }
  // カーブと高低差は窓の中央の地点の値で決める。レイヤーごとの下げ幅は Layer の drop（高架のとき、遠くの地面ほど少し・近くほど大きく下がる）
  const cv = curve(dist + W / 2), el = elev(dist + W / 2), cant = half(cv * CANT);
  state.curve = cv; state.elev = el;
  const oy = SY + bob + cant;
  // 窓の外の景色はトーン（時間帯・天気の色調）つきで描く。切り替えのクロスフェード中は、いまのトーンの絵の上に次のトーンの絵を toneK の濃さで重ねる
  // （層ごとに重ねるので、不透明なドットはちょうど2つの色の中間になる）。scene(fn) の fn(b) は b = false で今の、true で次のトーンの絵を描く
  const fadeK = state.toneTo ? Math.min(1, state.toneK) : 0;
  const scene = fn => { fn(false); if (fadeK > 0) { cx.globalAlpha = fadeK; fn(true); cx.globalAlpha = 1; } };
  const toned = fn => scene(b => { const prev = setTone(b ? tones.b : tones.a); fn(); setTone(prev); }); // チャンクを通さず直接描く景色用
  const lay = L => scene(b => L.render(cx, viewOff(L), oy + half(L.drop * el), SY, b));
  cx.setTransform(SUB, 0, 0, SUB, 0, -VY * SUB);
  const dark = tunnelCovers(dist); // 画面全体がトンネルの壁に隠れているあいだは、奥の景色を描かない
  if (!dark) {
  scene(b => cx.drawImage(b ? skyB : sky, 0, SY));
  // 雨脚と舞う雪は、層の間に3段で差し込む（奥は細かく、手前は長く速い。トンネルの壁・ホーム・トラスには隠れる）
  const fall = band => { if (state.wx.rain > 0 || state.wx.snow > 0) toned(() => drawFall(cx, band)); };
  lay(clouds);
  lay(far); fall(0); lay(mid); lay(near); fall(1); lay(track);
  // 踏切の赤い灯の点滅（線路際と同じ位置・同じ縦のずれで。画面に踏切があるときだけ）
  // 架線と架線柱（隣の線路）
  toned(() => {
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
    if (poleOnBridge(k * SPAN) || poleInTunnel(k * SPAN) || poleOnCrossing(k * SPAN) || poleOnWall(k * SPAN)) continue; // 橋の上・トンネルの山の中・踏切の道の上・至近の建物の前には柱を立てない
    const py = Math.floor(SY + Math.min(0, cant)), ph = SH + 2 + Math.ceil(Math.abs(cant)); // 柱は窓の上下の端まで届かせる
    R(cx, sx, py, 4, ph, '#4b5350'); R(cx, sx, py, 1, ph, '#75807c');
    R(cx, sx - 12, SY + 3 + cant, 30, 2, '#4b5350');
  }
  });
  fall(2);
  }
  // 駅のホーム（架線より手前）。駅の近くでだけ描く
  if (stationNear(dist + W / 2, 160)) lay(plat);
  // トラス橋の鉄骨（架線より手前）。橋の近くでだけ描く
  if (bridgeNear(dist + W / 2)) lay(truss);
  // 踏切のこちら側の警報機・遮断機（架線より手前）。踏切の近くでだけ描く。灯の点滅は毎フレーム重ねる
  if (crossingClose(dist + W / 2)) { lay(xing); drawCrossingNearLamps(cx, dist, oy, t); }
  // 線路際ぎりぎりのビルの壁（架線より手前なので、壁の前では架線も隠れる）。至近の建物の近くでだけ描く
  if (wallClose(dist + W / 2)) lay(closewall);
  // トンネルの壁と坑門（架線より手前）。トンネルの近くでだけ描く
  if (dark || tunnelNear(dist + W / 2)) lay(tunnel);
  // ガラスの映り込み
  if (STYLE.glass) {
    cx.globalAlpha = 0.08; cx.fillStyle = '#ffffff';
    for (let y = 28; y < 104; y++) {
      const s = (103 - y) >> 1;
      cx.fillRect(70 + s, y, 9, 1); cx.fillRect(86 + s, y, 3, 1);
      cx.fillRect(196 + s, y, 9, 1); cx.fillRect(212 + s, y, 3, 1);
    }
    cx.globalAlpha = 1;
    // トンネルの中と夜: 暗い窓に車内がうっすら映る。夜の度合いはトーンの外光の強さ sun から（切り替えの途中は間を取る）
    const dk = t => t ? 1 - t.sun : 0, nightK = dk(tones.a) + (state.toneTo ? (dk(tones.b) - dk(tones.a)) * fadeK : 0);
    tunnelGlass(cx, dist, nightK * nightK);
  }
  // 雨: 窓ガラスの水滴と流れる筋（ガラスの面。車内と乗客はこの後に重ねるので、窓の開口部の中にだけ見える）
  const dsh = state.phase === 'stop' ? doorShift(state.door) : 0;
  drawGlassRain(cx, dsh > 0);
  // ドア: 開いた分だけ、景色の層の上下にホームの続きを描き足してから扉を重ねる
  if (dsh > 0) toned(() => { drawDoorBackdrop(cx, state.station, 0, dsh); drawDoorBackdrop(cx, state.station, W - dsh, dsh); });
  drawDoors(cx, dsh / DOOR_W);
  cx.drawImage(interior, 0, 0);
  drawPassengers(cx, t);
  drawStraps(cx, t, bob ? 0.5 : 0, state.lean * LEAN);
}
function frame(now) {
  const dt = Math.min(0.05, (now - state.last) / 1000); state.last = now;
  // 早送り（デバッグ用）は dt を大きくせず、同じ dt の update() を rate 回くり返す（停車・発車の判定や継ぎ目の予約を崩さない）
  if (state.playing) { for (let i = 0; i < state.rate; i++) update(dt); stepTone(dt); render(); }
  if (debugTick) debugTick(now);
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
const debugTick = initDebug(render); // URL に ?debug があるときだけ有効（無ければ null）
const h0 = seedFromHash();
setSeed(h0 !== null ? h0 : 1000 + Math.floor(Math.random() * 9000));
cv.width = W * SUB; cv.height = VH * SUB; cx.imageSmoothingEnabled = false;
rebuild(); fit();
update(0.016); render();
if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPlaying(false);
requestAnimationFrame(frame);
