import { W, SH, state } from '../state.js';
import { hash32, rng, pick } from '../rng.js';
import { R, RE, shade, tint, mix, toneNow } from '../palette.js';
import { LAMPS } from '../lights.js';
import { distAt } from '../layers.js';
import { wallsIn, wallNear } from '../closewalls.js';

/* ---------- 至近距離の建物（scenery/index.js の closewall、id 10、視差 WALL_F） ----------
   線路際ぎりぎりに建つビルの壁が窓いっぱいに流れる層。位置は closewalls.js の表 { a, b, h, glass, bldgs }（線路際の走行距離）。
   main.js の render() が wallClose のときだけ、踏切の至近の層の後・トンネルの壁の前に描く（架線より手前なので、壁の前では架線も隠れる）。
   x はレイヤー通し座標 wx(d)（pan 0）。絵は棟ごとの計画（hash32(h, 73, 棟の番号) の乱数。チャンクの r は使わない）で、
   位置・模様はすべて通し座標で決めるのでチャンクの境目でつながる。
   縮尺は線路際より大きく、窓の高さ（景色内 y 2〜78）に2〜3階分（階高 30〜40 ドット）が入る。速く流れる（巡航で 1 フレーム 5〜6 ドット）ので、
   1 ドット刻みのくり返し（縦の細い目地・格子）は避け、大きな窓・柱・目地・設備で見せる。縦の模様の間隔は 20 ドット以上（タイルの縦目地だけ 12 だが、ごく薄くまばら）。
   夜の窓の灯りは lit()（hash32(h, …, 窓の番号) としきい値。チャンクの lightSalt は使わないので、チャンクをまたぐ窓も同じに灯る）。 */
export const WALL_F = 1.4;
const REACH = 135;        // 件の端から、この層の絵が窓に入りうる走行距離（窓の半幅 160 / 1.4 ≈ 114 ＋ 角の側面）
const POLE_PAD = 30;      // 架線柱を立てない、件の前後の余白（走行距離）
const GROUND = 82;        // 1階の床（景色内 y。窓の下端 78 より少し下）
const FOOT = 75;          // 基礎の上端
const SIDE = 7;           // 端の側面（影の面）の幅
const wx = d => Math.round((d - W / 2) * WALL_F + W / 2);
const hv = (h, s, k) => hash32(h, s, k) / 4294967296;

/* 窓の中央の走行距離 d の近くに至近の建物があるか（この層を描くかどうか） */
export function wallClose(d) { return !!wallNear(d, REACH); }
/* 架線柱（視差 1.2 の通し座標 x）が至近の建物の範囲（＋余白）に当たるか */
export function poleOnWall(x) { return !!wallNear((x - W / 2) / 1.2 + W / 2, POLE_PAD); }

/* 夜の灯り: 灯っていれば個体差 v（0..1）、消えていれば −1（lights.js の glow と同じ考え方。種は区間の h と窓の番号） */
function lit(h, s, k, p, span = 0.9) {
  const t = toneNow(); if (!t || t.lit <= 0) return -1;
  const q = hash32(h, s, k);
  if ((q & 4095) >= p * 4096) return -1;
  return t.lit > 0.04 + span * ((q >>> 12) & 4095) / 4096 ? (q >>> 24) / 256 : -1;
}

/* ---------- 色 ---------- */
const TILE = ['#c8b49a', '#b39478', '#d7cfbf', '#9c7b63', '#c9c3b2', '#a98b74', '#d2b8a0', '#8f8a80'];
const CONC = ['#a9a8a0', '#9ea19f', '#b4b1a7', '#8f918d'];
const PANEL = ['#c9cdca', '#dcd6c4', '#8d999e', '#6f7c82', '#b9bba9', '#e0e0da'];
const GLASS_C = ['#4f7391', '#5a7f8e', '#46627f', '#61808f'];
const SASH = ['#b9bdb8', '#c8c9c2', '#5e5a52', '#3f4447'];
const PANE = '#3b4d5c', BLIND = '#d6d3c6', CURTAIN = ['#cfc3a5', '#b9c4c8', '#d8cbb8', '#a9a28f'];
const STEEL = ['#6f6a60', '#7d3b31', '#56625f', '#8a8c86'];

/* ---------- 計画: 件ごとに1度だけ作る ---------- */
let planSeed = null; const plans = new Map();
function planOf(w) {
  if (planSeed !== state.seed) { planSeed = state.seed; plans.clear(); }
  let p = plans.get(w.n);
  if (!p) { p = w.bldgs.map((b, k) => makeBldg(w, b, k)); plans.set(w.n, p); if (plans.size > 6) plans.delete(plans.keys().next().value); }
  return p;
}
function makeBldg(w, b, k) {
  const r = rng(hash32(w.h, 73, k)), mat = b.mat, X0 = wx(b.a), X1 = wx(b.b), nb = w.bldgs[k + 1];
  const col = pick(r, mat === 'tile' ? TILE : mat === 'concrete' ? CONC : mat === 'panel' ? PANEL : GLASS_C);
  const fh = mat === 'glass' ? 36 + Math.floor(r() * 5) : 30 + Math.floor(r() * 8); // 階高
  const slabs = []; for (let y = GROUND - fh; y > -fh; y -= fh) slabs.push(y);  // 各階の床の行（下から）
  const o = { X0, X1, mat, col, fh, slabs, h: hash32(w.h, 74, k), sash: pick(r, SASH) };
  // 窓の寸法と柱割り（bay は窓1つ分の間隔。20 ドット以上）
  if (mat === 'tile') { o.ww = 24 + Math.floor(r() * 10); o.wh = 15 + Math.floor(r() * 5); o.bay = o.ww + 14 + Math.floor(r() * 16); }
  else if (mat === 'concrete') { o.slit = r() < 0.5; o.ww = o.slit ? 10 + Math.floor(r() * 4) : 30 + Math.floor(r() * 12); o.wh = o.slit ? 22 + Math.floor(r() * 4) : 14 + Math.floor(r() * 4); o.bay = o.ww + (o.slit ? 26 : 22) + Math.floor(r() * 20); }
  else if (mat === 'panel') { o.wh = 12 + Math.floor(r() * 5); o.bay = 28 + Math.floor(r() * 10); o.joint = 56 + Math.floor(r() * 30); }
  else { o.bay = 24 + Math.floor(r() * 8); o.band = 7 + Math.floor(r() * 4); }
  o.wy = mat === 'glass' ? 0 : Math.round((fh - o.wh) * (0.3 + 0.15 * r()));         // 床から窓の上端まで（上から）
  const span = X1 - X0 - 16, n = Math.max(1, Math.floor((span + (o.bay - (o.ww || o.bay))) / o.bay));
  o.n = n; o.bx = X0 + Math.round((X1 - X0 - (n - 1) * o.bay - (o.ww || 0)) / 2);   // 最初の窓の左端
  // 設備: 縦樋（棟の端寄りの柱の位置）、非常階段（端の1つ）、室外機・換気口（窓ごとに h から）
  o.pipe = mat !== 'glass' && r() < 0.8 ? (r() < 0.5 ? X0 + 5 : X1 - 8) : null;
  o.stair = (mat === 'tile' || mat === 'concrete') && X1 - X0 > 150 && r() < 0.45 ? { side: r() < 0.5 ? -1 : 1, c: pick(r, STEEL) } : null;
  o.stain = r(); o.pipeC = mat === 'panel' ? '#9aa0a0' : pick(r, ['#c9c8bd', '#4f514e', '#a9a597']);
  o.gap = b.gap; o.next = nb ? wx(nb.a) : null; o.dark = shade(col, 0.42);
  o.blindK = r(); o.curtain = pick(r, CURTAIN);
  return o;
}

/* ---------- 描画 ---------- */
export function drawCloseWall(g, i, r, L) {
  const cw = L.cw, ox = i * cw;
  // 通し座標 x で描く（チャンクの外は切る）
  const T = (x, y, w, h, c) => { const a = Math.max(x, ox), b = Math.min(x + w, ox + cw); if (b > a) R(g, a - ox, y, b - a, h, c); };
  const TE = (x, y, w, h, c) => { const a = Math.max(x, ox), b = Math.min(x + w, ox + cw); if (b > a) RE(g, a - ox, y, b - a, h, c); };
  for (const w of wallsIn(distAt(L, i, 0) - 20, distAt(L, i, cw) + 20)) {
    const ps = planOf(w);
    ps.forEach((o, k) => {
      if (o.X1 + SIDE + 30 < ox || o.X0 - SIDE - 30 > ox + cw) return;
      facade(T, TE, o, w, k, ox, cw);
      ends(T, o, k, ps);
    });
  }
}

/* 棟の端: 側面（影の面）と、すき間（暗い路地か、奥が見えるすき間） */
function ends(T, o, k, ps) {
  const sd = shade(o.col, 0.38), sdd = shade(o.col, 0.5);
  const sideFace = (x, w) => { T(x, 0, w, SH, sd); for (const y of o.slabs) T(x, y, w, 2, sdd); T(x, FOOT, w, SH - FOOT, shade('#7c7d78', 0.4)); };
  if (k === 0) { sideFace(o.X0 - SIDE, SIDE); T(o.X0 - SIDE, 0, 1, SH, sdd); }
  if (k === ps.length - 1) { sideFace(o.X1, SIDE); T(o.X1 + SIDE - 1, 0, 1, SH, sdd); return; }
  const n = ps[k + 1], gx0 = o.X1, gx1 = n.X0, gw = gx1 - gx0;
  if (gw <= 0) return;
  if (o.gap === 'alley') {
    // 暗い路地: 奥へ向かって暗くなる。両側の棟の側面を少しずつ、奥に配管と、地面の明るみ
    const f = Math.min(4, gw >> 2), a0 = gx0 + f, a1 = gx1 - f;
    T(gx0, 0, gw, SH, '#2d2f31');
    T(a0, 0, a1 - a0, SH, '#1f2123');
    T(a0 + 1, 0, Math.max(1, (a1 - a0) >> 2), SH, '#262829');
    if (a1 - a0 >= 6) { T(a0 + ((a1 - a0) >> 1), 0, 2, SH, '#3c3e3d'); for (let y = 6; y < SH; y += 23) T(a0 + ((a1 - a0) >> 1) - 1, y, 4, 1, '#2a2c2c'); }
    T(gx0, FOOT + 1, gw, SH - FOOT - 1, '#3b3a36'); T(a0, FOOT + 2, a1 - a0, 1, '#4a4842');
    T(gx0, 0, f, SH, sd); T(gx1 - f, 0, f, SH, shade(n.col, 0.38));
    for (const y of o.slabs) T(gx0, y, f, 1, sdd);
    for (const y of n.slabs) T(gx1 - f, y, f, 1, shade(n.col, 0.5));
  } else {
    // 奥が見えるすき間: 両側に細い側面だけ（間は透明で、線路際の景色が見える）
    const f = Math.min(3, gw >> 2);
    T(gx0, 0, f, SH, sd); T(gx1 - f, 0, f, SH, shade(n.col, 0.38));
    T(gx0, FOOT, f, SH - FOOT, sdd); T(gx1 - f, FOOT, f, SH - FOOT, shade(n.col, 0.5));
  }
}

function facade(T0, TE, o, w, k, ox, cw) {
  const { X0, X1, col, mat } = o;
  const T = (x, y, ww, h, c) => { const a = Math.max(x, X0), b = Math.min(x + ww, X1); if (b > a) T0(a, y, b - a, h, c); }; // 棟の外へはみ出さない
  const Wd = X1 - X0, lt = tint(col, 0.16), dk = shade(col, 0.14);
  const c0 = Math.max(X0, ox), c1 = Math.min(X1, ox + cw);
  T(X0, 0, Wd, SH, col);
  if (mat === 'tile') tileTex(T, o, c0, c1);
  else if (mat === 'concrete') concTex(T, o, c0, c1);
  else if (mat === 'panel') panelTex(T, o, c0, c1);
  if (mat === 'glass') curtain(T, TE, o, w, c0, c1);
  else {
    // 床の位置の帯（水切り・打ち継ぎ）
    for (const y of o.slabs) { T(X0, y - 1, Wd, 1, lt); T(X0, y, Wd, 2, dk); T(X0, y + 2, Wd, 1, shade(col, 0.06)); }
    windows(T, TE, o, w, k, c0, c1);
  }
  // 基礎（窓の下端にのぞく）
  T(X0, FOOT, Wd, SH - FOOT, '#7c7d78'); T(X0, FOOT, Wd, 1, '#9a9b94'); T(X0, FOOT + 1, Wd, 1, '#5f605c');
  // 角: 光の当たる縁と影の縁
  T(X0, 0, 2, FOOT, lt); T(X1 - 2, 0, 2, FOOT, dk);
  if (o.pipe !== null) pipe(T, o.pipe, o.pipeC);
  if (o.stair) stair(T, TE, o, w, k);
}

/* タイル: 横の目地（4 行ごと）と、ずらした縦の目地（間隔 12、ごく薄く）、ところどころ色の違うタイル */
function tileTex(T, o, c0, c1) {
  const jt = shade(o.col, 0.07), alt = [tint(o.col, 0.05), shade(o.col, 0.04)];
  for (let y = 3; y < FOOT; y += 4) T(c0, y, c1 - c0, 1, jt);
  for (let y = 0; y < FOOT; y += 4) {
    const off = (y >> 2) & 1 ? 6 : 0;
    for (let x = Math.floor((c0 - off) / 12) * 12 + off; x < c1; x += 12) {
      const v = hash32(o.h, 75, x * 131 + y) % 9;
      if (v < 2) T(x + 1, y, 11, 3, alt[v]);
      if (v === 8) T(x, y, 1, 3, jt);
    }
  }
}
/* 打ち放しのコンクリート: 型枠の継ぎ目（縦 90・横は階の中ほど）と P コンの穴、まだらと雨だれ */
function concTex(T, o, c0, c1) {
  const jt = shade(o.col, 0.12), hole = shade(o.col, 0.3), mot = [tint(o.col, 0.05), shade(o.col, 0.05)];
  for (let x = Math.floor(c0 / 30) * 30; x < c1; x += 30) for (let y = 0; y < FOOT; y += 15) {
    const v = hash32(o.h, 76, x * 7 + y);
    if (v % 3 === 0) T(x + (v >>> 4) % 10, y + (v >>> 8) % 6, 18, 9, mot[(v >>> 12) & 1]);
  }
  for (let x = Math.floor((c0 - o.X0) / 90) * 90 + o.X0 + 45; x < c1; x += 90) T(x, 0, 1, FOOT, jt);
  for (const y of o.slabs) T(c0, y + (o.fh >> 1), c1 - c0, 1, jt);
  for (let x = Math.floor((c0 - o.X0) / 22) * 22 + o.X0 + 11; x < c1; x += 22) for (const y0 of o.slabs) for (const dy of [7, 22]) if (y0 + dy < FOOT && y0 + dy > 0) T(x, y0 + dy, 2, 2, hole);
}
/* 金属パネル: 横張りの段（5 行ごとの影と光）と、縦の継ぎ目（間隔 joint） */
function panelTex(T, o, c0, c1) {
  const sh = shade(o.col, 0.1), hl = tint(o.col, 0.14);
  for (let y = 0; y < FOOT; y += 5) { T(c0, y, c1 - c0, 1, hl); T(c0, y + 4, c1 - c0, 1, sh); }
  for (let x = Math.floor((c0 - o.X0) / o.joint) * o.joint + o.X0 + (o.joint >> 1); x < c1; x += o.joint) { T(x, 0, 2, FOOT, shade(o.col, 0.2)); T(x + 2, 0, 1, FOOT, hl); }
}

/* 窓（タイル・コンクリート・金属パネル）。灯りは窓ごとに lit() */
function windows(T, TE, o, w, k, c0, c1) {
  const { mat } = o;
  o.slabs.forEach((ys, f) => {
    const top = ys + o.wy, wh = o.wh;
    if (top + wh <= 0 || top >= FOOT) return;
    if (mat === 'panel') { ribbon(T, TE, o, w, k, f, top, c0, c1); return; }
    for (let j = 0; j < o.n; j++) {
      const x = o.bx + j * o.bay, ww = o.ww;
      if (x + ww + 20 < c0 || x - 20 > c1) continue;
      const id = (k * 8 + f) * 64 + j, q = hash32(o.h, 77, id);
      if (o.stair && (o.stair.side < 0 ? j === 0 : j === o.n - 1)) { door(T, TE, o, w, x, ys, id); continue; } // 非常階段の前は扉
      const inner = (q & 7) === 0 ? o.curtain : (q & 7) < 3 ? BLIND : PANE;
      pane(T, TE, x, top, ww, wh, o.sash, inner, (q >> 3) & 3, lit(w.h, 80, (k << 12) + id, mat === 'concrete' ? 0.4 : 0.55), mat === 'concrete' ? 'office' : 'home');
      // 雨だれ（コンクリート）と窓の下の影
      if (mat === 'concrete' && o.stain > 0.3) { T(x + 2, top + wh + 3, 2, 8, shade(o.col, 0.1)); T(x + ww - 4, top + wh + 3, 2, 5, shade(o.col, 0.08)); }
      // 室外機（窓の下の壁に架台で）・換気口
      const kind = (q >>> 6) % 7;
      if (kind === 0 && top + wh + 19 <= Math.min(ys + o.fh - 2, FOOT + 4)) acUnit(T, x + ((q >> 9) & 1 ? ww - 16 : 0), top + wh + 4);
      else if (kind === 1 || kind === 2) vent(T, x + ww + 4, top + 3, o.col);
    }
  });
}
/* 引き違いの窓1つ: 枠、ガラス（中は暗いか、ブラインド・カーテン）、映り込み、水切り */
function pane(T, TE, x, y, w, h, sash, inner, refl, lv, kind) {
  const sd = shade(sash, 0.3);
  T(x - 1, y - 1, w + 2, h + 2, shade('#3a3c3d', 0.2));         // 開口の影
  T(x, y, w, h, sash);
  const gx = x + 2, gy = y + 2, gw = w - 4, gh = h - 4;
  if (lv >= 0) {
    const a = LAMPS[kind]; TE(gx, gy, gw, gh, a[Math.floor(lv * a.length)]);
    if (inner !== PANE) TE(gx, gy, gw, Math.max(2, gh >> 1), mix(a[Math.floor(lv * a.length)], inner, 0.45)); // ブラインド越しの灯り
  } else {
    T(gx, gy, gw, gh, inner);
    if (inner === PANE) { T(gx, gy, gw, 2, tint(PANE, 0.25)); if (refl) for (let k = 0; k < gh; k++) { const rx = gx + gw - 6 - k * 2 + refl * 2; if (rx >= gx && rx + 3 <= gx + gw) T(rx, gy + k, 3, 1, tint(PANE, 0.18)); } }
    else { for (let yy = gy + 2; yy < gy + gh; yy += 3) T(gx, yy, gw, 1, shade(inner, 0.1)); T(gx, gy + gh - 1, gw, 1, shade(inner, 0.25)); }
  }
  T(x + (w >> 1) - 1, y, 2, h, sash); T(x + (w >> 1) + 1, y + 1, 1, h - 2, sd); // 召し合わせ
  T(x, y, w, 1, tint(sash, 0.3)); T(x + w - 1, y, 1, h, sd);
  T(x - 2, y + h + 1, w + 4, 2, '#c9cac4'); T(x - 2, y + h + 3, w + 4, 1, shade('#5a5c5a', 0.2)); // 水切り
}
/* 横連窓（金属パネル）: 階ごとに横に続く窓の帯。方立は bay ごと。灯りは区画ごと */
function ribbon(T, TE, o, w, k, f, top, c0, c1) {
  const x0 = o.X0 + 10, x1 = o.X1 - 10, wh = o.wh;
  T(x0 - 1, top - 1, x1 - x0 + 2, wh + 2, shade('#2f3133', 0.1));
  for (let j = 0, x = x0; x < x1; j++, x += o.bay) {
    if (x + o.bay < c0 || x > c1) continue;
    const xe = Math.min(x1, x + o.bay), id = (k * 8 + f) * 64 + j, lv = lit(w.h, 81, (k << 12) + id, 0.6, 0.6);
    if (lv >= 0) TE(x, top, xe - x, wh, LAMPS.office[Math.floor(lv * LAMPS.office.length)]);
    else { T(x, top, xe - x, wh, '#465a69'); T(x, top, xe - x, 2, '#6c8494'); T(x + 3, top + 2, Math.min(6, xe - x - 3), wh - 3, '#53697a'); }
    T(x, top, 2, wh, '#a7adab'); T(x + 2, top, 1, wh, '#6d7372');                  // 方立
  }
  T(x0, top - 1, x1 - x0, 1, '#b6bbb8'); T(x0 - 1, top + wh, x1 - x0 + 2, 2, '#c4c8c4'); T(x0 - 1, top + wh + 2, x1 - x0 + 2, 1, shade(o.col, 0.3));
}
/* ガラスのカーテンウォール: 階ごとのスパンドレル（帯）と方立、空の映り込み（上ほど明るく、斜めの光の帯）。灯りは区画ごと */
function curtain(T, TE, o, w, c0, c1) {
  const { X0, X1, col, bay, band } = o, mul = '#a3acb0', mulD = '#5f686c', sp = shade(col, 0.45);
  const sky = tint(col, 0.3), hi = tint(col, 0.45);
  o.slabs.forEach((ys, f) => {
    const y0 = Math.max(0, ys + band), y1 = Math.min(FOOT, ys + o.fh);
    if (y1 <= y0) return;
    for (let j = Math.floor((c0 - X0) / bay), x = X0 + j * bay; x < c1; j++, x += bay) {
      const xe = Math.min(X1, x + bay), lv = lit(w.h, 82, (f << 12) + j, 0.5 + 0.3 * hv(w.h, 83, f), 0.7);
      if (lv >= 0) { TE(x, y0, xe - x, y1 - y0, LAMPS.glass[Math.floor(lv * LAMPS.glass.length)]); continue; }
      // 上から空の色 → ガラスの色（2段）、ところどころブラインドが下りた区画
      const q = hash32(o.h, 84, f * 1024 + j);
      T(x, y0, xe - x, y1 - y0, col);
      T(x, y0, xe - x, Math.min(6, y1 - y0), sky);
      T(x, y0 + 6, xe - x, Math.min(4, Math.max(0, y1 - y0 - 6)), mix(col, sky, 0.5));
      const bl = q % 5 === 0 ? Math.round((y1 - y0) * (0.3 + 0.4 * ((q >> 4) & 7) / 7)) : 0;
      // 斜めの光の帯（通し座標で。幅 14 と 4、間隔 96）。区画の中だけ
      const B = (a, y, n) => { const l = Math.max(a, x), rr = Math.min(a + n, xe); if (rr > l) T(l, y, rr - l, 1, hi); };
      for (let y = y0 + bl; y < y1; y++) {
        const ph = Math.round(y * 1.5), s = Math.floor((x - X0 + ph) / 96) * 96 + X0 - ph;
        for (let bx = s - 96; bx < xe; bx += 96) { B(bx, y, 14); B(bx + 18, y, 4); }
      }
      if (bl) { T(x, y0, xe - x, bl, '#c9cfcf'); T(x, y0 + bl - 1, xe - x, 1, '#9fa6a6'); }
    }
  });
  // 方立と、床の位置のスパンドレル（金属の帯）
  for (let x = X0 + Math.floor((c0 - X0) / bay) * bay; x < c1 + bay; x += bay) { T(x, 0, 3, FOOT, mul); T(x + 2, 0, 1, FOOT, mulD); }
  for (const ys of o.slabs) { T(X0, ys, X1 - X0, band, sp); T(X0, ys + band - 1, X1 - X0, 1, mulD); T(X0, ys, X1 - X0, 1, tint(sp, 0.3)); }
  // 1階の下は石張りの腰壁
  T(X0, GROUND - 14, X1 - X0, FOOT - GROUND + 14, '#8d8a82'); T(X0, GROUND - 14, X1 - X0, 1, '#b2aea4');
}
/* 縦樋: 幅 3。受け金物は 18 行ごと（横の模様なので流れてもちらつかない） */
function pipe(T, x, c) {
  T(x, 0, 3, FOOT + 2, c); T(x, 0, 1, FOOT + 2, tint(c, 0.25)); T(x + 2, 0, 1, FOOT + 2, shade(c, 0.3));
  for (let y = 6; y < FOOT; y += 18) T(x - 1, y, 5, 2, shade(c, 0.35));
}
/* 室外機（架台つき）: 16×11、左にファンの丸い格子 */
function acUnit(T, x, y) {
  const b = '#d9dbd5', d = '#8d918e';
  T(x, y, 16, 11, b); T(x, y, 16, 1, '#eeefea'); T(x + 15, y, 1, 11, d); T(x, y + 10, 16, 1, d);
  T(x + 2, y + 2, 7, 7, '#7c817f'); T(x + 3, y + 1, 5, 9, '#7c817f'); T(x + 1, y + 3, 9, 5, '#7c817f');
  T(x + 4, y + 4, 3, 3, '#a9adab'); T(x + 2, y + 5, 7, 1, '#6a6f6d');
  for (let k = 0; k < 4; k++) T(x + 11, y + 2 + k * 2, 3, 1, d);
  T(x + 1, y + 11, 2, 4, '#5c5f5d'); T(x + 13, y + 11, 2, 4, '#5c5f5d'); T(x + 1, y + 14, 14, 1, '#5c5f5d'); // 架台
}
/* 換気口のフード */
function vent(T, x, y, c) {
  T(x, y, 7, 6, '#c8c9c3'); T(x, y, 7, 1, '#e4e5e0'); T(x + 1, y + 5, 5, 1, '#5d605e'); T(x + 6, y + 1, 1, 5, '#8b8e8b');
  T(x - 1, y + 6, 9, 2, shade(c, 0.25));
}
/* 非常階段の前の鉄の扉（灯りは扉の上の小さな照明） */
function door(T, TE, o, w, x, ys, id) {
  const dw = 16, dh = Math.min(26, o.fh - 6), y = ys - dh;
  T(x - 1, y - 1, dw + 2, dh + 1, '#3c3d3b'); T(x, y, dw, dh, '#8a8f8d'); T(x + 1, y + 1, dw - 2, dh - 1, '#9da2a0'); T(x + dw - 4, y + (dh >> 1), 2, 2, '#4a4c4b');
  T(x + 5, y - 5, 6, 3, '#d8d8d0'); if (lit(w.h, 85, id, 1, 0.3) >= 0) TE(x + 5, y - 5, 6, 3, LAMPS.stair[0]);
}
/* 非常階段: 棟の端の柱割りの前に、各階の踊り場（鉄板の手すり）と斜めの段 */
function stair(T, TE, o, w, k) {
  const { side, c } = o.stair, x0 = side < 0 ? o.X0 + 4 : o.X1 - 4 - 48, x1 = x0 + 48, dk = shade(c, 0.35), lt = tint(c, 0.2);
  o.slabs.forEach((ys, f) => {
    // 斜めの段（下の踊り場 → 上の踊り場）。幅 3 の桁と、2 行ごとの段板
    const yb = ys + o.fh, yt = ys;
    for (let y = yt + 2; y < Math.min(yb, FOOT + 2); y++) {
      const t = (y - yt) / o.fh, sx = Math.round(side < 0 ? x0 + 4 + t * 36 : x1 - 7 - t * 36);
      T(sx, y, 4, 1, (y & 1) ? c : dk);
    }
    // 踊り場: 床板と鉄板の手すり（高さ 9）
    if (ys > -12 && ys < FOOT) {
      T(x0, ys, x1 - x0, 3, dk); T(x0, ys - 10, x1 - x0, 9, c); T(x0, ys - 10, x1 - x0, 1, lt); T(x0, ys - 2, x1 - x0, 1, dk);
      T(x0, ys - 10, 2, 13, dk); T(x1 - 2, ys - 10, 2, 13, dk);
    }
  });
  // 支柱
  T(side < 0 ? x1 - 3 : x0, 0, 3, FOOT + 2, dk);
}

/* ---------- 自車の映り込み（ガラスの棟の面に、自分の列車の側面がうっすら映る） ----------
   main.js の render() が lay(closewall) の直後に毎フレーム呼ぶ（チャンクには焼き込まない）。自分の列車なので画面に対して止まって見え、
   x は画面座標で固定、y だけ揺れ・カントの oy に合わせる（g.translate で半ドットのまま動かす）。重ねるのはガラスの棟の画面上の範囲
   （層の通し座標 X0..X1 − off）と、腰壁より上（景色内 y < GROUND − 14）だけ。棟の端で途切れ、ほかの素材の棟・すき間には出ない。
   縮尺は「ガラス面までの2倍の距離にある列車」なので本来は至近の壁の半分だが、それでは窓が小さすぎて列車に読めないので、壁よりわずかに小さい程度
   （1両 20m = SELF.car 176 ドット ≈ 11cm/ドット。壁は階高 36〜40 ≈ 10cm/ドット）にし、窓の列が壁の中ほど（景色内 y 28〜39）を横一列に通る。
   窓割りは車内（扉 x 0〜33 / 287〜319、窓 50〜158 / 162〜270、柱 158〜162）と同じ並び: 窓の中央の柱が x=160 に、
   その両側の扉が 160 ± pd/2 に来る（自分の席は4枚扉の真ん中の区画）。
   色: 車体・帯・下回りは R()（いまのトーンを通す）、夜の窓は RE()（灯り）。k はこのトーンの重み（クロスフェードの配分）、
   night は夜の度合い（0 昼 〜 1 夜）。昼は暗い窓の列と車体がうっすら、夜は灯った窓の列が明るめに映り、車体は暗い */
const SELF = {
  pd: 44, car: 176, gap: 4, x0: 72,   // 扉の間隔、1両の長さ（扉4枚）、連結のすき間、自分の車両の左端（画面 x。扉が 138 と 182 に来る）
  roof: 20, win: 28, winB: 39, band: 41, skirt: 54, under: 59,  // 景色内 y: 屋根、窓の上端・下端、帯、車体の下端、下回りの下端
  dw: 12, dWin: [27, 42], ew: 8,      // 扉の幅、扉の窓の上下、両端の区画の小窓の幅
  BODY: '#cdd2d2', ROOF: '#9ea4a6', BAND: '#2f6ea6', WIN: '#1d252d', UNDER: '#2a2d30', LIT: '#f2f4ea',
  aBody: 0.15, aBand: 0.18, aWin: 0.22, aLit: 0.5,  // 濃さ（globalAlpha）。昼の窓は aWin × (1 − night)、夜の窓は aLit × night
  litK: 0.12, blindK: 0.35, darkBoost: 0.8          // 区画ごとの倍率: 灯った区画 / ブラインドの所 / 暗い区画は夕方から強く（1 + darkBoost × √night）
};
const GLASS_BOT = GROUND - 14;        // ガラスの下端（その下は石張りの腰壁）
export function drawSelfReflection(g, dist, off, oy, k, night) {
  const w = wallNear(dist + W / 2, REACH);
  if (!w || !w.glass || k <= 0) return;
  const ps = planOf(w), S = SELF, period = S.car + S.gap;
  ps.forEach(o => {
    if (o.mat !== 'glass') return;
    const x0 = Math.max(0, o.X0 - off), x1 = Math.min(W, o.X1 - off);
    if (x1 <= x0) return;
    // 映るのはガラスの区画（方立・スパンドレルの間）だけ。濃さは区画の明るさで変える: 中が暗い区画ほど強く映り、
    // 灯った区画とブラインドの下りた所は中の明るさに負けてほとんど映らない（curtain() と同じ判定で区画ごとに決める）
    const panes = [], boost = S.darkBoost * Math.sqrt(night);
    o.slabs.forEach((ys, f) => {
      const y0 = Math.max(0, ys + o.band), y1 = Math.min(FOOT, GLASS_BOT, ys + o.fh);
      if (y1 <= y0) return;
      for (let j = Math.max(0, Math.floor((x0 + off - o.X0) / o.bay)), x = o.X0 + j * o.bay; x - off < x1; j++, x += o.bay) {
        const l = Math.max(x + 3 - off, x0), r = Math.min(Math.min(o.X1, x + o.bay) - off, x1);
        if (r <= l) continue;
        if (lit(w.h, 82, (f << 12) + j, 0.5 + 0.3 * hv(w.h, 83, f), 0.7) >= 0) { panes.push([l, y0, r, y1, S.litK]); continue; }
        const q = hash32(o.h, 84, f * 1024 + j), bl = q % 5 === 0 ? Math.round((y1 - y0) * (0.3 + 0.4 * ((q >> 4) & 7) / 7)) : 0;
        if (bl) panes.push([l, y0, r, y0 + bl, S.blindK]);
        panes.push([l, y0 + bl, r, y1, 1 + boost]);
      }
    });
    g.save(); g.translate(0, oy);
    const pass = (a, c, fn, lit = false) => {
      if (a <= 0) return;
      const T = (x, y, ww, h) => {
        for (const [pl, pt, pr, pb, pk] of panes) {
          const l = Math.max(x, pl), r = Math.min(x + ww, pr), t = Math.max(y, pt), b = Math.min(y + h, pb);
          if (r > l && b > t) { g.globalAlpha = Math.min(1, a * pk); (lit ? RE : R)(g, l, t, r - l, b - t, c); }
        }
      };
      for (let n = Math.floor((x0 - S.x0) / period) - 1, xc = S.x0 + n * period; xc < x1; n++, xc += period) fn(T, xc);
    };
    const doors = xc => [0, 1, 2, 3].map(i => xc + Math.round(S.pd * (i + 0.5)) - (S.dw >> 1));
    // 窓の位置（扉の間の区画に2枚ずつ、両端の区画に小窓1枚）
    const wins = (T, xc) => {
      const d = doors(xc);
      const ww = (S.pd - S.dw - 4) >> 1;   // 窓1枚の幅（区画の両端に1ドット、中央の柱に2ドット）
      for (let i = 0; i < 3; i++) { const s = d[i] + S.dw; T(s + 1, S.win, ww, S.winB - S.win); T(s + 3 + ww, S.win, ww, S.winB - S.win); }
      T(xc + 4, S.win, S.ew, S.winB - S.win); T(xc + S.car - 4 - S.ew, S.win, S.ew, S.winB - S.win);
      for (const x of d) T(x + ((S.dw - 4) >> 1), S.dWin[0], 4, S.dWin[1] - S.dWin[0]);
    };
    // 車体（屋根の角は1ドット落とす）と扉の縁、下回り
    pass(k * S.aBody, S.BODY, (T, xc) => { T(xc + 1, S.roof, S.car - 2, 1); T(xc, S.roof + 1, S.car, S.skirt - S.roof - 1); });
    pass(k * S.aBody, S.ROOF, (T, xc) => { T(xc + 1, S.roof, S.car - 2, 2); for (const x of doors(xc)) { T(x, S.roof + 4, 1, S.skirt - S.roof - 4); T(x + S.dw - 1, S.roof + 4, 1, S.skirt - S.roof - 4); } });
    pass(k * S.aBody, S.UNDER, (T, xc) => { T(xc, S.skirt - 1, S.car, 1); T(xc + 6, S.skirt, S.car - 12, 2); T(xc + 12, S.skirt + 2, 22, S.under - S.skirt - 2); T(xc + S.car - 34, S.skirt + 2, 22, S.under - S.skirt - 2); });
    // 帯（扉の上は通さない）
    pass(k * S.aBand, S.BAND, (T, xc) => { const d = doors(xc); let x = xc; for (const dx of d) { T(x, S.band, dx - x, 2); x = dx + S.dw; } T(x, S.band, xc + S.car - x, 2); });
    // 窓: 昼は暗い窓、夜は灯った窓（灯りの色）
    pass(k * S.aWin * (1 - night), S.WIN, wins);
    pass(k * S.aLit * night, S.LIT, wins, true);
    g.globalAlpha = 1;
    g.restore();
  });
}
