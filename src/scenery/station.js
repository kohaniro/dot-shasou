import { W, SH, state } from '../state.js';
import { hash32, rng, ri, pick } from '../rng.js';
import { P, R, shade, tint, SIGN, GRASS } from '../palette.js';
import { distAt } from '../layers.js';
import { stationAt, stationsIn } from '../stations.js';
import { kanaLayout, drawKana } from '../kana.js';
import { sky } from './sky.js';

/* ---------- 駅のホーム（こちら側の窓のすぐ外。視差 1.5 の層 plat） ----------
   層の中の位置 lx と線路際座標 d の関係は layers.js の distAt と同じ: lx = (d - W/2) * F + W/2。
   停車中（state.dist === st.pos）は画面 x = lx - base（base = floor(st.pos * F)）に見える。
   絵は駅ごとの「計画」（makePlan: シード×駅番号から決定的に作る）を、チャンクごとに切り出して描く。

   縦の割り付け（景色内 y。画面 y はこれ + 26）
     0〜16  上屋の裏（奥の軒先が 15〜16）。上屋が無い区間は空と架線が見える
     23〜42 駅名標
     50     柵の上端（座った目の高さ = 地平線）
     68〜79 ホームの床（FY が奥の縁）
   柱は 120 ドットおき（BAY）で、停車位置では窓の柱（x 158〜161）と戸袋の壁の裏に隠れる。
   柱の間（スパン）ごとに 駅名標 / ベンチ / 自販機・時刻表 の役を順に割り当てる。 */
export const PLAT_F = 1.5;
const F = PLAT_F, BAY = 120, FY = 68, RY = 15;
const toL = d => Math.round((d - W / 2) * F + W / 2);
const clamp01 = v => Math.min(1, Math.max(0, v));
const mod = (a, n) => ((a % n) + n) % n;

const LINES = ['#3f9a5a', '#e58a3c', '#3f7fb5', '#c94f3f', '#7a5fa8', '#2f8f9a', '#d6a13a'];
const UND = '#7f8384', UND_D = '#6b6f71', BEAM = '#5c6062';          // 上屋の裏
const FLOOR_SH = '#8a8882', FLOOR = '#b1aea4', FLOOR_OLD = '#a8a496'; // 床（上屋の下 / 日なた / 小さな駅）
const BOARD = '#f6f5ee', BOARD_INK = '#1f2428', FRAME = '#4b5350', STEEL = '#8a8f8f';
const TACT = '#f2cf4a', TACT_D = '#c79f2c', EDGE = '#ecebe4';
const SKIN = ['#f0c9a4', '#e3b58f', '#d9a37c', '#f4d3b5'];
const HAIR = ['#2a2622', '#3a2e28', '#4b3a2f', '#1f2228', '#6b5a4a', '#8a8a8a'];
const TOPS = ['#e8e6e0', '#2f3a4f', '#6b7f99', '#8a4a44', '#4f6b55', '#c9b79a', '#3d3d42', '#b8c4d0', '#d9c26a', '#7a5f8a'];
const BOTTOMS = ['#2b3040', '#3f4654', '#5a5248', '#22252b', '#6f6a5c', '#34465e'];

/* ---------- 駅名標の割り付け（停車時の画面座標で決める） ----------
   短い名前は手すり（x 111 / 207）で分かれた窓の広いほうに収める。長い名前は字間を 2 ドットにして、
   手すりがちょうど字間に来るように置く */
const PAD = 4;
function signGeom(kana, left) {
  let lay = kanaLayout(kana, 1), bw = lay.w + PAD * 2, bx;
  if (bw <= 59) bx = (left ? 50 : 209) + ((61 - bw) >> 1);
  else {
    lay = kanaLayout(kana, 2); bw = lay.w + PAD * 2;
    const rail = left ? 111 : 207, p0 = left ? 50 : 162, ideal = p0 + ((108 - bw) >> 1);
    let best = null;
    for (let j = 0; j < lay.cells.length - 1; j++) {
      const c = lay.cells[j], x = rail - (PAD + c.x + c.w);
      if (best === null || Math.abs(x - ideal) < Math.abs(best - ideal)) best = x;
    }
    bx = Math.min(p0 + 107 - bw, Math.max(p0 + 1, best === null ? ideal : best));
  }
  return { lay, bw, bx };
}

/* ---------- 計画: 駅ごとに1度だけ作る ---------- */
let planSeed = null; const plans = new Map();
function planOf(st) {
  if (planSeed !== state.seed) { planSeed = state.seed; plans.clear(); }
  let p = plans.get(st.k);
  if (!p) { p = makePlan(st); plans.set(st.k, p); if (plans.size > 6) plans.delete(plans.keys().next().value); }
  return p;
}
function makePerson(r, x) {
  const q = r();
  return {
    x, skin: pick(r, SKIN), hair: pick(r, HAIR), top: pick(r, TOPS), bot: pick(r, BOTTOMS), h: ri(r, 0, 2), dy: ri(r, 0, 2),
    pose: q < 0.3 ? 'phone' : q < 0.45 ? 'back' : 'idle', long: r() < 0.3, coat: r() < 0.25, bag: r() < 0.4 ? pick(r, ['#3d3d42', '#6a5445', '#2f3a4f', '#8a4a44']) : null, side: r() < 0.5 ? -1 : 1
  };
}
function makePlan(st) {
  const r = rng(hash32(state.seed, 41, st.k)), s = st.size;
  const base = Math.floor(st.pos * F), p0 = toL(st.x0), p1 = toL(st.x1);
  const col = n => base + 158 + BAY * n;
  const n0 = Math.ceil((p0 + 24 - col(0)) / BAY), n1 = Math.floor((p1 - 28 - col(0)) / BAY);
  const line = LINES[hash32(state.seed, 42, 0) % LINES.length];
  // 上屋: 規模が大きいほど長い。あるなら停車位置の窓は必ず屋根の下
  const nb = n1 - n0, rb = Math.min(nb - 2, Math.round(clamp01((s - 0.3) / 0.45) * nb)), q = r(); // 両端の1スパンほどは屋根なし
  let ra = 0, hasRoof = rb >= 2;
  if (hasRoof) { const lo = Math.max(n0 + 1, 1 - rb), hi = Math.max(lo, Math.min(-1, n1 - 1 - rb)); ra = lo + Math.floor(q * (hi - lo + 1)); }
  const roof = hasRoof ? [col(ra) - 10, col(ra + rb) + 14] : null;
  const roofed = n => hasRoof && n >= ra && n < ra + rb;
  // 駅名標: 停車位置の左右どちらかの窓に1枚、あとは3スパンおき（小さな駅は6スパンおき）
  const left = r() < 0.5, signBay = left ? -1 : 0, sg = signGeom(st.kana, left);
  const signs = [];
  for (let m = -12; m <= 12; m++) { const x = base + sg.bx + (s < 0.4 ? 6 : 3) * BAY * m; if (x >= p0 + 30 && x + sg.bw <= p1 - 30) signs.push(x); }
  const prev = st.k > 1 ? stationAt(st.k - 1) : null, next = stationAt(st.k + 1);
  // ホームの奥: 壁（上屋の下だけ）/ 目隠しの柵 / 素通しの柵
  const pWall = clamp01((s - 0.4) / 0.45) * 0.85, pSlat = clamp01((s - 0.28) / 0.2);
  const low = pSlat > 0.5 ? 'slat' : 'rail';
  const fenceCol = r() < 0.5 ? '#e6e4da' : '#9a8468';
  const bodyCols = ['#e9eef0', '#c94f3f', '#3f7fb5'];
  const bays = [], items = [], people = [];
  let run = 0, cur = low;
  for (let n = n0; n < n1; n++) {
    const x = col(n), rf = roofed(n), kind = mod(n - signBay, 3);
    const a = r(), b = r(), c = r();
    if (run <= 0) { cur = a < pWall ? 'wall' : b < pSlat ? 'slat' : 'rail'; run = 1 + Math.floor(c * 3); }
    run--;
    const back = cur === 'wall' && !rf ? low : cur, wall = back === 'wall';
    bays.push({ n, x, rf, back });
    // 役ごとの設備（乱数は使わない分も同じ回数だけ引く）
    const e = [r(), r(), r(), r(), r(), r()];
    const atStop = n === -1 || n === 0, big = n === 0 || (!atStop && kind === 1) ? 53 : 14; // 窓の広いほうの左端（スパン内の位置）
    let busy = [];                                   // 人を立たせない範囲 [x0, x1]
    if (!hasRoof && atStop && n !== signBay) {       // 無人駅風: 屋根の代わりに小さな待合
      items.push({ t: 'hut', x: x + big + 1 });
      busy.push([x + big - 4, x + big + 62]);
    } else if (kind === 1) {
      if (rf) items.push({ t: 'hang', x: x + 66, num: 1 + (st.k & 1) });
      if (e[0] < (0.35 + 0.65 * s) * (rf ? 1 : 0.6)) { items.push({ t: 'bench', x: x + 68, c: e[1] < 0.5 ? line : '#6b7f99' }); busy.push([x + 62, x + 98]); }
      if (wall && e[2] < 0.8) items.push({ t: 'ad', x: x + 10, w: 30, c: SIGN[Math.floor(e[3] * SIGN.length)], v: e[4] });
    } else if (kind === 2) {
      if (e[0] < clamp01((s - 0.25) / 0.25)) {
        items.push({ t: 'vend', x: x + 18, c: bodyCols[Math.floor(e[1] * 3)], v: e[2] }); busy.push([x + 12, x + 34]);
        if (s > 0.6 && e[3] < 0.7) { items.push({ t: 'vend', x: x + 33, c: bodyCols[Math.floor(e[4] * 3)], v: e[5] }); busy.push([x + 30, x + 49]); }
      }
      if (e[5] < 0.3 + 0.7 * s) items.push({ t: 'table', x: x + 54, wall });
      if (rf && s > 0.45) items.push({ t: 'clock', x: x + 94 });
      if (wall && e[3] > 0.3) items.push({ t: 'ad', x: x + 82, w: 26, c: SIGN[Math.floor(e[4] * SIGN.length)], v: e[2] });
    } else if (wall && !signs.some(sx => sx < x + BAY && sx + sg.bw > x) && e[0] < 0.8) {
      items.push({ t: 'ad', x: x + 14, w: 34, c: SIGN[Math.floor(e[1] * SIGN.length)], v: e[2] });
      items.push({ t: 'ad', x: x + 68, w: 34, c: SIGN[Math.floor(e[3] * SIGN.length)], v: e[4] });
    }
    // 待っている人: 大きな駅・屋根の下ほど多い
    const np = Math.floor(r() * (0.7 + 3.4 * s) * (rf ? 1 : 0.35));
    for (let k = 0; k < 3; k++) {
      const px = x + 8 + Math.floor(r() * (BAY - 20)), pr = r();
      if (k >= np) continue;
      if (busy.some(z => px + 8 > z[0] && px - 1 < z[1]) || people.some(o => Math.abs(o.x - px) < 10)) continue;
      people.push(makePerson(rng(Math.floor(pr * 4294967296)), px));
    }
    if (!hasRoof && atStop && n !== signBay && r() < 0.6) people.push(makePerson(r, x + big + (r() < 0.5 ? -14 : 64)));
  }
  // 屋根の無い区間の照明柱（柱と同じ並びなので、停車位置では隠れる）
  const cols = [], lamps = [];
  for (let n = n0; n <= n1; n++) { if (hasRoof && n >= ra && n <= ra + rb) cols.push(col(n)); else if (mod(n, 2) === 0) lamps.push(col(n)); }
  return { st, s, base, p0, p1, line, roof, signs, sg, left, prev, next, bays, items, people, cols, lamps, low, fenceCol, gridX0: col(n0), gridX1: col(n1) };
}

/* ---------- 部品（x は層の中の位置。T が チャンクの原点を引いて R() に渡す） ---------- */
function backRail(T, x0, x1, c) {
  T(x0, 54, x1 - x0, 1, c); T(x0, 55, x1 - x0, 1, shade(c, 0.25)); T(x0, 61, x1 - x0, 1, c); T(x0, 62, x1 - x0, 1, shade(c, 0.25));
  for (let x = Math.ceil(x0 / 24) * 24; x < x1; x += 24) { T(x, 51, 2, FY - 51, c); T(x + 1, 52, 1, FY - 52, shade(c, 0.25)); }
}
function backSlat(T, x0, x1) {
  T(x0, 50, x1 - x0, FY - 50, '#d6d4c8'); T(x0, 50, x1 - x0, 1, '#f0eee4'); T(x0, 51, x1 - x0, 1, '#b3b1a6');
  for (let x = Math.ceil(x0 / 4) * 4; x < x1; x += 4) T(x, 52, 1, FY - 52, '#c1bfb3');
  for (let x = Math.ceil(x0 / 40) * 40; x < x1; x += 40) T(x, 49, 2, FY - 49, '#96948a');
}
function backWall(T, x0, x1) {
  const w = x1 - x0;
  T(x0, RY, w, FY - RY, '#cdc9ba'); T(x0, RY, w, 4, '#aeaa9c');
  for (let x = Math.ceil(x0 / 30) * 30; x < x1; x += 30) T(x, RY + 4, 1, 53 - RY, '#bcb8aa');
  T(x0, 57, w, FY - 57, '#a5a194'); T(x0, 57, w, 1, '#8b887c'); T(x0, 56, w, 1, '#dedacb');
}
function drawBack(T, type, x0, x1, pl) {
  if (x1 <= x0) return;
  if (type === 'wall') backWall(T, x0, x1); else if (type === 'slat') backSlat(T, x0, x1); else backRail(T, x0, x1, pl.fenceCol);
}
function nameSign(T, g, ox, x, pl, wall) {
  const { bw, lay } = pl.sg, y = 23, h = 20, line = pl.line;
  if (!wall) { T(x + 3, y + h, 2, FY + 1 - y - h, STEEL); T(x + bw - 5, y + h, 2, FY + 1 - y - h, STEEL); T(x + 4, y + h, 1, FY + 1 - y - h, '#6c7173'); T(x + bw - 4, y + h, 1, FY + 1 - y - h, '#6c7173'); }
  T(x - 1, y - 1, bw + 2, h + 2, FRAME); T(x, y, bw, h, BOARD);
  drawKana(g, pl.st.kana, x - ox + PAD, y + 3, BOARD_INK, 1, lay);
  T(x + 3, y + 14, bw - 9, 2, line); T(x + bw - 6, y + 13, 1, 4, line); T(x + bw - 5, y + 14, 1, 2, line);
  // 前後の駅（字は小さすぎるので、長さだけ合わせた線で表す）
  const ink = '#70767b';
  if (pl.prev) T(x + 3, y + 17, Math.min(14, 2 * pl.prev.kana.length), 1, ink);
  const nw = Math.min(14, 2 * pl.next.kana.length); T(x + bw - 3 - nw, y + 17, nw, 1, ink);
}
function hangSign(T, x, num) {
  T(x + 4, RY, 1, 3, STEEL); T(x + 25, RY, 1, 3, STEEL);
  T(x, 18, 30, 7, '#27324a'); T(x, 18, 30, 1, '#3d4a66');
  T(x + 2, 19, 5, 5, BOARD); T(x + 4, 20, 1, 3, '#27324a'); if (num === 2) { T(x + 3, 20, 3, 1, '#27324a'); T(x + 3, 22, 3, 1, '#27324a'); }
  T(x + 9, 20, 9, 3, '#f2cf4a'); T(x + 11, 21, 4, 1, '#27324a');
  T(x + 20, 20, 7, 1, BOARD); T(x + 20, 22, 5, 1, '#b8c4d0');
}
function clock(T, x) {
  T(x + 3, RY, 2, 3, STEEL);
  T(x, 18, 8, 8, FRAME); T(x + 1, 19, 6, 6, BOARD);
  T(x + 4, 20, 1, 3, BOARD_INK); T(x + 4, 22, 2, 1, BOARD_INK);
}
function ad(T, it) {
  const { x, w, c } = it, y = 26, light = c === '#e8e4d8', ink = light ? '#55606b' : tint(c, 0.8);
  T(x - 1, y - 1, w + 2, 19, '#8b887c'); T(x, y, w, 17, c);
  T(x + 3, y + 3, 8 + Math.floor(it.v * (w - 16)), 2, ink); T(x + 3, y + 7, w - 12, 1, ink); T(x + 3, y + 9, w - 16, 1, ink);
  if (it.v < 0.6) T(x + w - 9, y + 9, 6, 6, light ? '#d85a4a' : shade(c, 0.3)); else T(x + 3, y + 12, w - 6, 3, light ? '#3f7fb5' : shade(c, 0.25));
}
function timetable(T, it, line) {
  const { x } = it, y = 27;
  if (!it.wall) { T(x + 2, y + 17, 1, FY + 1 - y - 17, STEEL); T(x + 19, y + 17, 1, FY + 1 - y - 17, STEEL); }
  T(x - 1, y - 1, 24, 19, FRAME); T(x, y, 22, 17, BOARD); T(x, y, 22, 3, line);
  for (let yy = y + 5; yy < y + 16; yy += 2) { T(x + 2, yy, 3, 1, '#70767b'); T(x + 6, yy, 14, 1, '#a9aeb2'); }
  T(x + 11, y + 4, 1, 12, '#c9cdd0');
}
function bench(T, it) {
  const { x, c } = it;
  for (let k = 0; k < 4; k++) { const sx = x + k * 7; T(sx, FY - 10, 6, 5, c); T(sx, FY - 10, 6, 1, tint(c, 0.3)); T(sx, FY - 5, 6, 2, tint(c, 0.18)); T(sx, FY - 4, 6, 1, shade(c, 0.2)); }
  T(x, FY - 3, 27, 1, '#5d6266'); T(x + 2, FY - 2, 1, 3, '#5d6266'); T(x + 24, FY - 2, 1, 3, '#5d6266');
}
function vending(T, it) {
  const { x, c } = it, y = FY - 25, r = rng(Math.floor(it.v * 4294967296));
  T(x, y, 13, 26, c); T(x, y, 13, 1, tint(c, 0.4)); T(x + 12, y + 1, 1, 25, shade(c, 0.22));
  T(x + 1, y + 2, 11, 10, '#2c3138'); T(x + 1, y + 6, 11, 1, '#eef1f1'); T(x + 1, y + 11, 11, 1, '#eef1f1');
  for (let k = 0; k < 5; k++) { T(x + 2 + 2 * k, y + 3, 1, 3, pick(r, SIGN)); T(x + 2 + 2 * k, y + 8, 1, 3, pick(r, SIGN)); }
  T(x + 2, y + 14, 6, 1, tint(c, 0.55)); T(x + 9, y + 14, 2, 4, '#5d6266'); T(x + 9, y + 15, 1, 1, '#f2cf4a');
  T(x + 2, y + 20, 9, 3, '#22262b'); T(x, y + 25, 13, 1, '#5d6266');
}
function hut(T, x, pl) {
  const w = 56, y = 29, wc = '#d4cab2';
  T(x, y, w, FY - y, '#8a8376'); T(x, y, w, 2, '#6f695e');                       // 中は日かげ
  T(x + 8, y + 5, 15, 9, '#b9d4e0'); T(x + 7, y + 4, 17, 1, wc); T(x + 7, y + 14, 17, 1, wc); T(x + 7, y + 4, 1, 11, wc); T(x + 23, y + 4, 1, 11, wc); T(x + 15, y + 5, 1, 9, wc); // 奥の窓
  T(x + 31, y + 4, 14, 12, BOARD); T(x + 31, y + 4, 14, 2, pl.line); for (let yy = y + 8; yy < y + 15; yy += 2) T(x + 33, yy, 10, 1, '#a9aeb2');   // 時刻表
  T(x + 5, FY - 7, w - 10, 2, '#b08a5e'); T(x + 5, FY - 5, w - 10, 1, '#7d6244'); T(x + 8, FY - 4, 1, 4, '#5d6266'); T(x + w - 9, FY - 4, 1, 4, '#5d6266'); // 木のベンチ
  T(x, y, 3, FY - y + 1, wc); T(x + w - 3, y, 3, FY - y + 1, wc); T(x + 2, y, 1, FY - y + 1, shade(wc, 0.2)); T(x + w - 1, y, 1, FY - y + 1, shade(wc, 0.2));
  T(x, 52, 3, 1, shade(wc, 0.2)); T(x + w - 3, 52, 3, 1, shade(wc, 0.2));
  T(x - 4, y - 4, w + 8, 3, '#70757a'); T(x - 4, y - 4, w + 8, 1, '#8f959a'); T(x - 3, y - 1, w + 6, 1, '#4a4e52');  // 屋根
}
function person(T, p) {
  const x = p.x, yb = FY + 1 + p.dy, top = yb - 24 + p.h, sk = p.skin, ts = shade(p.top, 0.24), shoe = '#22252b';
  if (p.bag) { T(x + (p.side > 0 ? 8 : -4), yb - 14, 4, 6, p.bag); T(x + (p.side > 0 ? 8 : -4), yb - 14, 4, 1, tint(p.bag, 0.25)); }
  T(x + 1, yb - 10, 2, 9, p.bot); T(x + 4, yb - 10, 2, 9, p.bot); T(x + 1, yb - 1, 2, 1, shoe); T(x + 4, yb - 1, 2, 1, shoe);
  if (p.coat) T(x, yb - 11, 7, 5, p.top);
  T(x, top + 6, 7, yb - 10 - top - 6, p.top); T(x + 1, top + 6, 5, 1, tint(p.top, 0.15));
  T(x - 1, top + 7, 1, 8, ts); T(x + 7, top + 7, 1, 8, ts);
  T(x + 2, top + 5, 3, 1, shade(sk, 0.2));
  T(x + 1, top, 5, 5, sk);
  if (p.pose === 'back') { T(x + 1, top - 1, 5, 5, p.hair); T(x + 6, top + 6, 1, 9, ts); }
  else {
    T(x + 1, top - 1, 5, 2, p.hair); T(x + 1, top + 1, 1, 1, p.hair); T(x + 5, top + 1, 1, 1, p.hair);
    T(x + 2, top + 2, 1, 1, '#2a2622'); T(x + 4, top + 2, 1, 1, '#2a2622');
    if (p.pose === 'phone') { T(x + 1, top + 10, 5, 2, ts); T(x + 3, top + 8, 2, 3, '#2a2d33'); T(x + 2, top + 10, 1, 1, sk); T(x + 5, top + 10, 1, 1, sk); }
    else { T(x - 1, top + 15, 1, 1, sk); T(x + 7, top + 15, 1, 1, sk); }
  }
  if (p.long) { T(x, top + 1, 1, 6, p.hair); T(x + 6, top + 1, 1, 6, p.hair); }
}
function endFence(T, x) {
  for (let y = 50; y < FY; y += 2) T(x, y, 2, 2, ((y - 50) >> 1) & 1 ? '#22262b' : '#f2cf4a');
  T(x + 3, 53, 8, 6, BOARD); T(x + 3, 53, 8, 1, '#c94f3f'); T(x + 5, 56, 4, 1, '#c94f3f'); T(x + 6, 59, 1, FY - 59, STEEL);
}

/* ---------- チャンクの描画 ---------- */
export function drawPlatform(g, i, r, L) {
  const ox = i * L.cw, cw = L.cw, T = (x, y, w, h, c) => R(g, x - ox, y, w, h, c);
  const vis = (x, w, m = 0) => x + w + m > ox && x - m < ox + cw;
  for (const st of stationsIn(distAt(L, i, 0) - 40, distAt(L, i, cw) + 40)) {
    const pl = planOf(st), { p0, p1, roof } = pl;
    const a = Math.max(ox, p0), b = Math.min(ox + cw, p1);
    // 奥の壁・柵
    drawBack(T, pl.low, Math.max(a, p0), Math.min(b, pl.gridX0), pl); drawBack(T, pl.low, Math.max(a, pl.gridX1), Math.min(b, p1), pl);
    for (const bay of pl.bays) if (vis(bay.x, BAY)) drawBack(T, bay.back, Math.max(a, bay.x), Math.min(b, bay.x + BAY), pl);
    // 素通しの柵の足もとに草
    for (const bay of pl.bays) if (bay.back === 'rail' && vis(bay.x, BAY)) {
      const rr = rng(hash32(state.seed, 43, bay.x));
      for (let k = 0; k < 9; k++) { const gx = bay.x + ri(rr, 0, BAY - 3), gh = ri(rr, 1, 3); T(gx, FY - gh, ri(rr, 1, 2), gh, pick(rr, GRASS)); }
    }
    // 床と、両端のスロープ
    if (b > a) {
      const fl = pl.s < 0.4 ? FLOOR_OLD : FLOOR;
      T(a, FY, b - a, SH - FY, fl); T(a, FY, b - a, 1, tint(fl, 0.25));
      if (roof) { const ra = Math.max(a, roof[0] + 6), rb = Math.min(b, roof[1] + 6); T(ra, FY, rb - ra, SH - FY, FLOOR_SH); T(ra, FY, rb - ra, 1, shade(FLOOR_SH, 0.15)); }
      const sp = shade(fl, 0.14), dens = 5 + Math.round(14 * pl.s);      // 小さな駅ほど荒れた舗装
      for (let x = a; x < b; x++) {
        if (roof && x >= roof[0] + 6 && x < roof[1] + 6) continue;
        for (let y = FY + 1; y < SH; y++) if (hash32(hash32(x, 44, y), state.seed, st.k) % dens === 0) T(x, y, 1, 1, sp);
      }
    }
    for (let dx = 1; dx <= 22; dx++) { const y = FY + Math.ceil(dx / 2), c = pl.s < 0.4 ? FLOOR_OLD : FLOOR; T(p0 - dx, y, 1, SH - y, c); T(p0 - dx, y, 1, 1, tint(c, 0.25)); T(p1 - 1 + dx, y, 1, SH - y, c); T(p1 - 1 + dx, y, 1, 1, tint(c, 0.25)); }
    // 上屋の裏: 母屋・梁・蛍光灯、奥の軒先
    if (roof && vis(roof[0], roof[1] - roof[0])) {
      const x0 = Math.max(ox, roof[0]), x1 = Math.min(ox + cw, roof[1]), w = x1 - x0;
      T(x0, 0, w, RY, UND); T(x0, 4, w, 1, UND_D); T(x0, 9, w, 1, UND_D);
      for (const cx of pl.cols) { T(cx + 1, 0, 2, RY, BEAM); if (cx + 60 < roof[1]) T(cx + 61, 0, 1, RY, UND_D); }
      for (const cx of pl.cols) for (const dx of [26, 86]) if (cx + dx + 14 < roof[1] - 8) { T(cx + dx, 11, 14, 1, '#b4b9bc'); T(cx + dx + 1, 12, 12, 1, '#fffbe6'); }
      T(x0, RY, w, 1, '#565a5d'); T(x0, RY + 1, w, 1, '#3a3e41');
      T(roof[0], 0, 2, RY + 2, '#3a3e41'); T(roof[1] - 2, 0, 2, RY + 2, '#3a3e41');
    }
    for (const cx of pl.cols) if (vis(cx, 6, 2)) {
      T(cx, RY + 2, 2, FY - RY - 1, '#9ea4a3'); T(cx + 2, RY + 2, 2, FY - RY - 1, '#6f7577');
      T(cx, 38, 4, 2, pl.line); T(cx - 1, FY - 2, 6, 3, '#6c7173');
    }
    for (const cx of pl.lamps) if (vis(cx, 12, 8)) {
      T(cx + 1, 12, 2, FY - 11, STEEL); T(cx + 2, 13, 1, FY - 12, '#6c7173'); T(cx - 4, 11, 7, 1, STEEL); T(cx - 6, 12, 6, 2, '#f4f1dc'); T(cx - 6, 12, 6, 1, STEEL); T(cx, FY - 1, 4, 2, '#6c7173');
    }
    const isWall = x => { const bay = pl.bays.find(q => x >= q.x && x < q.x + BAY); return !!bay && bay.back === 'wall'; };
    for (const it of pl.items) {
      if (!vis(it.x, 64, 8)) continue;
      if (it.t === 'ad') ad(T, it); else if (it.t === 'table') timetable(T, it, pl.line); else if (it.t === 'hut') hut(T, it.x, pl);
    }
    for (const sx of pl.signs) if (vis(sx, pl.sg.bw, 2)) nameSign(T, g, ox, sx, pl, isWall(sx) && isWall(sx + pl.sg.bw - 1));
    for (const it of pl.items) {
      if (!vis(it.x, 64, 8)) continue;
      if (it.t === 'vend') vending(T, it); else if (it.t === 'bench') bench(T, it); else if (it.t === 'hang') hangSign(T, it.x, it.num); else if (it.t === 'clock') clock(T, it.x);
    }
    for (const p of pl.people) if (vis(p.x, 8, 6)) person(T, p);
    if (vis(p0, 12)) endFence(T, p0 + 1);
    if (vis(p1 - 12, 12)) endFence(T, p1 - 12);
  }
}

/* ---------- ドアが開いたときに見える、景色の層の外側（上と下） ----------
   停車中の画面 x 〜 x+w について、景色の描画域（画面 y 26〜106）の上に上屋の裏か空、下にホームの床・点字ブロック・ホームの縁を描く */
export function drawDoorBackdrop(g, st, x, w) {
  const pl = planOf(st), fl = pl.s < 0.4 ? FLOOR_OLD : FLOOR;
  for (let sx = x; sx < x + w; sx++) {
    const lx = pl.base + sx, under = pl.roof && lx >= pl.roof[0] && lx < pl.roof[1], shadeF = pl.roof && lx >= pl.roof[0] + 6 && lx < pl.roof[1] + 6;
    if (under) R(g, sx, 14, 1, 12, UND); else g.drawImage(sky, sx, 0, 1, 1, sx, 14, 1, 12);
    R(g, sx, 106, 1, 52, shadeF ? FLOOR_SH : fl);
    R(g, sx, 132, 1, 6, TACT); if (sx % 3 === 0) { R(g, sx, 133, 1, 1, TACT_D); R(g, sx, 136, 1, 1, TACT_D); } else if (sx % 3 === 1) R(g, sx, 134, 1, 1, TACT_D);
    R(g, sx, 145, 1, 13, EDGE); R(g, sx, 144, 1, 1, shade(fl, 0.2));
    if (sx < 6 || sx >= W - 6) R(g, sx, 140, 1, 2, pl.line);   // 乗車位置の印（ドアの中央 = 画面の端）
  }
}
