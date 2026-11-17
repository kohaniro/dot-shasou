import { W, SH, state } from '../state.js';
import { hash32, rng, pick } from '../rng.js';
import { R, RE, E, shade, tint, GRASS } from '../palette.js';
import { world } from '../world.js';
import { distAt, layerX, tones } from '../layers.js';
import { crossingsIn, crossingNear } from '../crossings.js';
import { hz, utilityPole } from './common.js';
import { coastAt, shoreY } from './sea.js';

/* ---------- 踏切 ----------
   位置は crossings.js の表 { n, c, a, b, w, h }（線路際の走行距離。a〜b が道幅 w）。絵は踏切ごとの「計画」（makePlan: h だけから決める。
   チャンクの乱数 r は使わない）で、どれも既存の絵が済んだあとに上から描き直すので、踏切から離れた地点の絵は変わらない。

   道は線路と直交して奥へ延びる。景色内 y の行ごとの道幅は透視で決める: 画面上の半幅 = w/2 × (y − HZ) / (80 − HZ)（HZ = 50 が消失点の高さ）。
   これは各層の地面の帯の上端（中景 59 → 0.3、近景 68 → 0.6）が視差係数とほぼ一致するので、窓の中央では 中景 → 近景 → 線路際 の道が
   ひと続きの台形になり、奥へすぼまる。各層は自分の視差で行ごとの半幅を走行距離に直し（÷ f）、列ごとの distAt と比べて塗る。
     線路際（視差 1.0）: 路肩・路面・停止線・敷板、待っている車・人（警報機・遮断機は描かない。踏切の設備は至近の層だけ）
     近景・中景: 道の上に載った建物・木を [a, b] の列だけ消し（奥を見通す）、帯を路面に。近景は電柱と、列の2台目の車
     至近の層（視差 XING_F。下の「至近の層」）: 窓のすぐ外を横切る、こちら側の大きな警報機・遮断機・柵
   赤い灯の点滅は main.js の render() が毎フレーム drawCrossingNearLamps で重ねる（チャンクには消えた灯を描いておく）。 */
const HZ = 50, YB = 80;                       // 消失点の高さ、幅が w ちょうどになる行
const half = (w, y) => w / 2 * (y - HZ) / (YB - HZ); // 行 y の画面上の半幅（窓の中央で）
const PAD = 12;                               // 線路際: 道の外側で既存の絵を消して描き直す幅
const CAR_B = 72, STOP_Y = 74;   // 線路際: 待つ車の足もと、停止線の行
const ASPH = '#6e7275', LINE = '#e2e0d6', YEL = '#f0c419', BLK = '#25231f', LAMP_OFF = '#4f1c19';
const CAR_COL = ['#eeeeea', '#e9e8e2', '#b9bdc0', '#9ea4a8', '#2b2e33', '#3c4a63', '#8a2f2a', '#5b6b4f', '#d9cfb4', '#7a8fa6'];
const TOPS = ['#3f5f7f', '#d8cfa8', '#c94f3f', '#4f7a5a', '#e6e2d8', '#5a4f6a', '#2f3640', '#d98a3a'];
const BOTTOMS = ['#2f3640', '#3d4a5c', '#5b4d47', '#8a8478', '#23262b'];
const SKIN = ['#f0c9a4', '#e3b58f', '#d9a37c'], HAIR = ['#2a2622', '#3a2e28', '#4b3a2f', '#8a8a8a'];
const toLX = (L, d) => Math.round(layerX(L, d));

/* ---------- 計画: 踏切ごとに1度だけ作る ---------- */
let planSeed = null; const plans = new Map();
function planOf(x) {
  if (planSeed !== state.seed) { planSeed = state.seed; plans.clear(); }
  let p = plans.get(x.n);
  if (!p) { p = makePlan(x); plans.set(x.n, p); if (plans.size > 8) plans.delete(plans.keys().next().value); }
  return p;
}
function makePlan(x) {
  const r = rng(hash32(x.h, 61, 0)), e = world(x.c), { c, w } = x;
  const urb = e.city + e.resi + 0.35 * e.suburb;
  const q = r(), nCar = q < 0.22 ? 0 : q < 0.66 ? 1 : 2;
  const cars = [];
  for (let k = 0; k < 2; k++) { const t = r(); cars.push({ kind: t < 0.45 ? 'sedan' : t < 0.75 ? 'kei' : t < 0.93 ? 'van' : 'truck', col: pick(r, CAR_COL) }); }
  const pq = r(), ped = pq < 0.22 ? 'walk' : pq < 0.4 ? 'bike' : null;
  const who = { top: pick(r, TOPS), bottom: pick(r, BOTTOMS), skin: pick(r, SKIN), hair: pick(r, HAIR), side: r() < 0.5 ? -1 : 1 };
  const pole = r() < 0.65, poleSide = r() < 0.5 ? -1 : 1;
  // 海沿い: 道は波打ち際より手前（下）だけ。shore はその行（海が見えなければ 0）
  const k = coastAt(e, c), shore = e.sea > 0 && k.c < 3 ? Math.ceil(shoreY(k.c)) + 2 : 0;
  return {
    x, c, w, h: x.h, paved: urb > 0.5, nCar, cars, ped, who, pole, poleSide,
    twoArms: w >= 56, shore,
    near: nearPlan(x)
  };
}
/* ---------- 線路際（視差 1.0）: trackside.js の末尾、tunnelTrack の後で呼ぶ ---------- */
export function crossingTrack(g, L, i) {
  const cw = L.cw, ox = i * cw, T = (x, y, w, h, c) => R(g, x - ox, y, w, h, c);
  for (const x of crossingsIn(ox - 40, ox + cw + 40)) {
    const p = planOf(x), { c, w } = p, x0 = Math.floor(x.a) - PAD, x1 = Math.ceil(x.b) + PAD;
    const c0 = Math.max(ox, x0), c1 = Math.min(ox + cw, x1);
    if (c1 > c0) g.clearRect(c0 - ox, 0, c1 - c0, SH);
    // 路肩（道の外。街なかは舗装と砂利、田園は草）と、その端の植え込み・縁石
    const sh = p.paved ? '#8d8b82' : GRASS[0], shD = shade(sh, 0.15), shL = tint(sh, 0.15);
    for (let gx = Math.max(c0, x0); gx < Math.min(c1, x1); gx++) {
      for (let y = 70; y < SH; y++) { const v = hash32(p.h, 62, gx * 97 + y) % 11; T(gx, y, 1, 1, y === 70 ? shL : v === 0 ? shD : v === 1 ? shL : sh); }
      if (!p.paved && hash32(p.h, 63, gx) % 4 === 0) T(gx, 69, 1, 1, sh); // 草の穂先
    }
    // 路面: 行ごとに透視の半幅
    for (let y = 69; y < SH; y++) {
      const hh = Math.round(half(w, y)), l = c - hh, rr = c + hh;
      for (let gx = Math.max(c0, l); gx < Math.min(c1, rr); gx++) {
        const v = hash32(p.h, 64, gx * 131 + y) % 17;
        T(gx, y, 1, 1, v === 0 ? shade(ASPH, 0.1) : v === 1 ? tint(ASPH, 0.1) : ASPH);
      }
      if (y >= 70 && hh >= 9) { T(l + 1, y, 1, 1, LINE); T(rr - 2, y, 1, 1, LINE); } // 外側線
    }
    const hS = Math.round(half(w, STOP_Y));
    T(c + 1, STOP_Y, hS - 2, 1, LINE);                                           // 停止線（こちらへ来る車線 = 右半分）
    for (const y of [77, 79]) { const hh = Math.round(half(w, y)); T(c - hh, y, 2 * hh, 1, '#4b4f52'); } // 隣の線路の敷板の溝
    // 待っているもの（奥 → 手前の順）
    const hC = half(w, CAR_B);
    if (p.ped) { const px = p.who.side < 0 ? Math.round(c - hC) + 1 : Math.round(c + hC) - 6; person(T, p, px, CAR_B + 1); }
    if (p.nCar > 0) { const cx = Math.round(c + hC / 2); car(T, p.cars[0], cx, CAR_B); }
  }
}
function car(T, c, cx, b) {
  const col = c.col, dk = shade(col, 0.3), lt = tint(col, 0.3), gl = '#3c4f62', glL = '#6d8499';
  const W0 = c.kind === 'kei' ? 14 : c.kind === 'truck' ? 18 : 16, H0 = c.kind === 'sedan' ? 12 : c.kind === 'kei' ? 14 : c.kind === 'van' ? 15 : 19;
  const x = cx - (W0 >> 1), top = b - H0;
  T(x + 1, b - 1, 3, 2, '#1e1f22'); T(x + W0 - 4, b - 1, 3, 2, '#1e1f22');                       // タイヤ
  T(x, b - 6, W0, 5, col); T(x, b - 3, W0, 1, dk); T(x + 1, b - 2, W0 - 2, 1, shade(col, 0.45));  // 車体の下部とバンパー
  T(x + 1, b - 5, 3, 1, '#f3f0dc'); T(x + W0 - 4, b - 5, 3, 1, '#f3f0dc');                       // ヘッドライト
  T(x + 5, b - 5, W0 - 10, 1, shade(col, 0.55));                                                    // グリル
  T(cx - 2, b - 4, 4, 2, c.kind === 'kei' ? '#f0d84a' : '#f2f2ea'); T(cx - 1, b - 3, 2, 1, '#4a5a4a'); // ナンバー
  if (c.kind === 'truck') { // 小型トラック: 箱形の運転台
    T(x, top, W0, b - 6 - top, col); T(x, top, W0, 1, lt); T(x + 2, top + 3, W0 - 4, 5, gl); T(x + 2, top + 3, 3, 2, glL);
    T(x - 1, top + 6, 1, 2, BLK); T(x + W0, top + 6, 1, 2, BLK);
    return;
  }
  const hood = c.kind === 'sedan' ? 2 : 1, gb = b - 6 - hood;                                      // ボンネット、ガラスの下端
  T(x, gb, W0, hood, lt); T(x, b - 6, W0, 1, tint(col, 0.15));
  const gt = top + 1;
  for (let y = gt; y < gb; y++) { const ins = Math.round((gb - y) * 0.35) + 1; T(x + ins - 1, y, W0 - 2 * ins + 2, 1, col); T(x + ins, y, W0 - 2 * ins, 1, y < gt + 2 ? glL : gl); }
  T(x + 2 + Math.round((gb - gt) * 0.35), top, W0 - 4 - 2 * Math.round((gb - gt) * 0.35), 1, lt);    // 屋根
  T(x - 1, gb - 2, 1, 2, dk); T(x + W0, gb - 2, 1, 2, dk);                                          // ミラー
}
/* 待っている人（正面）。自転車のときは前輪とハンドルを手前に */
function person(T, p, x, b) {
  const o = p.who, ts = shade(o.top, 0.2);
  T(x + 1, b - 6, 1, 6, o.bottom); T(x + 3, b - 6, 1, 6, shade(o.bottom, 0.15)); T(x + 1, b - 1, 1, 1, BLK); T(x + 3, b - 1, 1, 1, BLK); // 脚
  T(x, b - 12, 5, 6, o.top); T(x + 4, b - 11, 1, 5, ts); T(x, b - 7, 1, 1, o.skin); T(x + 4, b - 7, 1, 1, o.skin); // 胴と手
  T(x + 1, b - 15, 3, 3, o.skin); T(x + 1, b - 16, 3, 1, o.hair); T(x + 1, b - 15, 1, 1, o.hair);                // 頭
  if (p.ped === 'bike') {
    T(x - 1, b - 8, 7, 1, '#3a3d40'); T(x + 2, b - 7, 1, 2, '#3a3d40');                              // ハンドルと軸
    T(x + 2, b - 5, 1, 5, '#202224'); T(x + 2, b - 6, 1, 1, '#c9cbc6');                              // 前輪とライト
    T(x + 1, b - 6, 3, 1, '#9aa0a2');                                                                 // かご
  }
}

/* ---------- 近景・中景: landscape.js の中景・近景の末尾（riverBand の後）で呼ぶ ---------- */
const BAND = { 3: { base: 59, top: 57, end: 70, haze: 0.14 }, 4: { base: 68, top: 68, end: SH, haze: 0 } };
export function crossingBand(g, L, i) {
  const o = BAND[L.id]; if (!o) return;
  const cw = L.cw, ox = i * cw, { base, top, end, haze } = o, H = c => haze ? hz(c, haze) : c, f = L.f;
  const reach = half(80, end) / f + 4; // 最も広い行の半幅（走行距離）
  for (const x of crossingsIn(distAt(L, i, 0) - reach, distAt(L, i, cw) + reach)) {
    const p = planOf(x), { c, w } = p;
    const g0 = Math.max(0, toLX(L, c - half(w, end) / f) - 1 - ox), g1 = Math.min(cw, toLX(L, c + half(w, end) / f) + 2 - ox);
    if (g1 <= g0) continue;
    const D = []; for (let k = g0; k < g1; k++) D.push(distAt(L, i, k));
    // 道の上に立っていた建物・木を消して奥を見通す（列ごとに [a, b] に入るか）
    if (p.shore < base) for (let k = g0; k < g1; k++) { const d = D[k - g0]; if (d >= x.a && d < x.b) g.clearRect(k, 0, 1, base); }
    // 路面
    const as = H(ASPH), asD = H(shade(ASPH, 0.1)), asL = H(tint(ASPH, 0.1)), ln = H(LINE);
    for (let y = Math.max(top, p.shore); y < end; y++) {
      const hw = half(w, y) / f;
      let first = -1, last = -1;
      for (let k = g0; k < g1; k++) {
        if (Math.abs(D[k - g0] - c) >= hw) continue;
        if (first < 0) first = k; last = k;
        const v = hash32(p.h, 65 + L.id, (ox + k) * 131 + y) % 17;
        R(g, k, y, 1, 1, v === 0 ? asD : v === 1 ? asL : as);
      }
      if (L.id === 4 && first >= 0 && last - first >= 8) { R(g, first + 1, y, 1, 1, ln); R(g, last - 1, y, 1, 1, ln); } // 外側線
    }
    if (L.id === 4 && p.shore < base) {
      // 電柱を道の脇に1本
      if (p.pole) { const px = toLX(L, p.poleSide < 0 ? x.a : x.b) + (p.poleSide < 0 ? -3 : 2) - ox; if (px > -6 && px < cw + 6) utilityPole(g, px, base + 1); }
      // 列の2台目（線路際の1台目の後ろ。こちらへ来る車線）
      if (p.nCar > 1) {
        const cx = toLX(L, c + half(w, base) / f / 2) - ox;
        if (cx > -8 && cx < cw + 8) smallCar(g, p.cars[1], cx, base);
      }
    }
  }
}
/* 近景の小さい車（正面）。幅 10 */
function smallCar(g, c, cx, b) {
  const col = c.col, x = cx - 5, T = (xx, y, w, h, cc) => R(g, xx, y, w, h, cc), tall = c.kind === 'van' || c.kind === 'truck' || c.kind === 'kei';
  const top = b - (tall ? 9 : 8);
  T(x + 1, b - 1, 2, 1, '#1e1f22'); T(x + 7, b - 1, 2, 1, '#1e1f22');
  T(x, b - 4, 10, 3, col); T(x, b - 2, 10, 1, shade(col, 0.35));
  T(x + 1, b - 3, 2, 1, '#f3f0dc'); T(x + 7, b - 3, 2, 1, '#f3f0dc');
  T(x + 1, top + 1, 8, b - 5 - top, col); T(x + 2, top + 1, 6, b - 5 - top, '#3c4f62'); T(x + 2, top, 6, 1, tint(col, 0.3));
}

/* ---------- 至近の層（視差 XING_F。scenery/index.js の xing）: 窓のすぐ外を横切る、こちら側の踏切の設備 ----------
   橋のトラスと同じ扱いの層で、main.js の render() が crossingClose のときだけ描く。x はレイヤー通し座標 nx(d)。
   道 [a, b] の片側（side）に大きな警報機（×形の警標・赤い2灯・方向指示器・黄黒の縞の柱・遮断機）、反対側に遮断機だけの柱（竿が1本なら車止め）、
   その外側に短い柵、窓の下端に路面の手前の端。地面は窓の下端より下なので、柱の足もとは見えない。
   向こう側（線路際の層）の警報機のおよそ2倍の大きさ。速く流れるので、細部より大きな形を優先する。
   計画は h のハッシュだけから決める（makePlan の乱数の順番には足さない）。 */
export const XING_F = 1.6;
const NEAR_REACH = 170;                        // 道の端から、至近の層の絵が届く走行距離（柵の端 ÷ XING_F ＋ 窓の半幅 ÷ XING_F より大きく）
const nx = d => Math.round((d - W / 2) * XING_F + W / 2);
const N_BUCK = 21, N_LAMP = 41, N_ARM = 70;    // 警標の中心、灯の中心、竿の上端の行
function nearPlan(x) {
  const side = hash32(x.h, 67, 0) & 1 ? 1 : -1; // 警報機が立つ側（−1 = 道の左）
  const XA = nx(x.a), XB = nx(x.b), XC = nx(x.c);
  const sx = side < 0 ? XA - 12 : XB + 12, ox = side < 0 ? XB + 10 : XA - 10; // 警報機の柱の中心、反対側の柱の中心
  return { side, XA, XB, XC, sx, ox, lamps: [[sx - 12, N_LAMP - 2], [sx + 7, N_LAMP - 2]] }; // lamps: 5×5 の灯の左上
}
/* 窓の中央の走行距離 d の近くに踏切があるか（至近の層を描くかどうか） */
export function crossingClose(d) { return !!crossingNear(d, NEAR_REACH); }
/* 架線柱（視差 1.2 の通し座標 x）が踏切の道の上に当たるか。道の上とそのすぐ脇には柱を立てない */
export function poleOnCrossing(x) { return !!crossingNear((x - W / 2) / 1.2 + W / 2, 45); }

const DISC = [5, 7, 9, 11, 11, 11, 11, 11, 9, 7, 5], LENS = [3, 5, 5, 5, 3];
export function drawCrossingNear(g, i, r, L) {
  const cw = L.cw, ox = i * cw;
  const T = (x, y, w, h, c) => { if (x + w > ox && x < ox + cw) R(g, x - ox, y, w, h, c); };
  const TE = (x, y, w, h, c) => { if (x + w > ox && x < ox + cw) RE(g, x - ox, y, w, h, c); };
  for (const x of crossingsIn(distAt(L, i, 0) - NEAR_REACH, distAt(L, i, cw) + NEAR_REACH)) {
    const p = planOf(x), n = p.near, { side, XA, XB, XC } = n;
    // 路面の手前の端（窓の下端にのぞく敷板）
    T(XA - 3, 77, XB - XA + 6, 1, '#c4c2b7'); T(XA - 3, 78, XB - XA + 6, 2, '#5d6164');
    T(XA - 1, 78, 2, 2, LINE); T(XB - 1, 78, 2, 2, LINE);
    // 柵: 柱の外側へ短く（白いパイプ。街なかは長め）
    const fl = p.paved ? 70 : 44;
    for (const [x0, dir] of [[XA - 26, -1], [XB + 26, 1]]) {
      const a = dir < 0 ? x0 - fl : x0, b = a + fl;
      T(a, 71, fl, 2, '#e6e4da'); T(a, 72, fl, 1, '#b5b4aa'); T(a, 76, fl, 1, '#d5d3c9');
      for (let k = 0; k <= fl; k += 14) { const px = dir < 0 ? b - 2 - k : a + k; T(px, 70, 2, 10, '#d9d7cd'); T(px + 1, 71, 1, 9, '#a9a89f'); }
    }
    // 反対側: 遮断機だけの柱（竿が2本のとき）か、黄黒の車止め
    if (p.twoArms) gate(T, n.ox, side, Math.abs(XC - n.ox) - 9, true);
    else for (let y = 66; y < SH; y++) for (let k = 0; k < 4; k++) T(n.ox - 2 + k, y, 1, 1, stripe(y, k));
    // 警報機
    bigSignal(T, TE, n.sx);
    gate(T, n.sx, -side, p.twoArms ? Math.abs(XC - n.sx) - 9 : Math.abs((side < 0 ? XB : XA) - n.sx) - 6, false);
  }
}
/* 黄黒の斜めの縞（柱 4 列ぶん）。k は列 */
function stripe(y, k) {
  const b = ((y + k) >> 2) & 1;
  return b ? (k === 0 ? '#3a3834' : BLK) : k === 0 ? tint(YEL, 0.3) : k === 3 ? shade(YEL, 0.3) : YEL;
}
/* 大きな警報機。cx は柱の中心（柱は cx−2 〜 cx+1 の 4 列） */
function bigSignal(T, TE, cx) {
  const g0 = '#a9aeac', g1 = '#70767a', bk = '#1d1c1a', bkL = '#3b3935';
  T(cx - 3, 5, 6, 4, g0); T(cx - 3, 5, 6, 1, tint(g0, 0.4)); T(cx + 2, 6, 1, 3, g1); T(cx - 2, 9, 4, 2, g1); // てっぺんのスピーカー
  for (let y = 11; y < SH; y++) for (let k = 0; k < 4; k++) T(cx - 2 + k, y, 1, 1, stripe(y, k));              // 柱
  // ×形の警標: 黄色の板2枚に黒の帯
  for (const d of [1, -1]) for (let t = -13; t <= 13; t++) {
    const y = N_BUCK + d * Math.round(t * 0.55), a = Math.abs(t), blk = a >= 2 && ((a + 1) / 3 | 0) & 1;
    T(cx + t - 1, y - 2, 2, 1, blk ? '#3a3834' : tint(YEL, 0.35)); T(cx + t - 1, y - 1, 2, 2, blk ? BLK : YEL); T(cx + t - 1, y + 1, 2, 1, blk ? BLK : shade(YEL, 0.3));
  }
  T(cx - 1, N_BUCK - 1, 2, 2, '#8a8d8a');                                                                     // 留め金
  // 赤い2灯: 腕木、黒い円い背板、灯（消えた状態。点滅は drawCrossingNearLamps）
  T(cx - 10, N_LAMP - 1, 20, 2, bk); T(cx - 10, N_LAMP - 1, 20, 1, bkL);
  for (const lc of [cx - 10, cx + 9]) {
    DISC.forEach((w, k) => { T(lc - (w >> 1), N_LAMP - 5 + k, w, 1, bk); });
    T(lc - 2, N_LAMP - 5, 5, 1, bkL); T(lc - 4, N_LAMP - 4, 2, 1, bkL); T(lc - 5, N_LAMP - 3, 1, 2, bkL); T(lc + 3, N_LAMP - 4, 2, 1, bkL); // 庇のふち
    LENS.forEach((w, k) => { T(lc - (w >> 1), N_LAMP - 2 + k, w, 1, LAMP_OFF); });
    T(lc - 1, N_LAMP - 1, 1, 1, tint(LAMP_OFF, 0.25));
  }
  // 方向指示器: 黒い箱に、列車の進む向き（右）の矢印が灯る
  T(cx - 8, 50, 16, 8, bk); T(cx - 8, 50, 16, 1, bkL);
  TE(cx - 5, 53, 8, 2, '#ff9a2e'); TE(cx + 2, 51, 2, 6, '#ff9a2e'); TE(cx + 4, 52, 1, 4, '#ff9a2e'); TE(cx + 5, 53, 1, 2, '#ffc15a');
}
/* 遮断機: 柱 cx の道側（dir）に機構箱と、下りた竿（長さ len。黄黒の縞、先の半分は細い）。post: 柱も描く（警報機の無い側） */
function gate(T, cx, dir, len, post) {
  const bx = dir > 0 ? cx + 2 : cx - 10, c = '#8f9493';
  const by = N_ARM - 5;
  if (post) { for (let y = by - 1; y < SH; y++) for (let k = 0; k < 4; k++) T(cx - 2 + k, y, 1, 1, stripe(y, k)); T(cx - 3, by - 3, 6, 2, '#70767a'); }
  T(bx, by, 8, 13, c); T(bx, by, 8, 1, tint(c, 0.4)); T(dir > 0 ? bx + 7 : bx, by + 1, 1, 12, shade(c, 0.3)); T(bx + 1, by + 12, 6, 1, shade(c, 0.3));
  T(bx + 3, N_ARM, 2, 3, BLK);                                                                                   // 軸
  const x0 = dir > 0 ? bx + 8 : bx - 1;
  for (let k = 0; k < len; k++) {
    const gx = x0 + dir * k, b = ((k + 3) / 7 | 0) & 1, thin = k > len * 0.55;
    T(gx, N_ARM, 1, 1, b ? '#3a3834' : tint(YEL, 0.3)); T(gx, N_ARM + 1, 1, 1, b ? BLK : YEL);
    if (!thin) T(gx, N_ARM + 2, 1, 1, b ? BLK : shade(YEL, 0.3));
  }
  const tx = x0 + dir * (len - 1); T(dir > 0 ? tx - 1 : tx, N_ARM, 2, 2, '#c8372b');                           // 竿の先の赤い反射板
}

/* ---------- main.js の render() 用: 赤い灯の点滅 ----------
   2灯を約 2Hz で交互に点ける（昼でも）。灯りなのでトーンはかけず、絵柄の変換だけ通す（E）。揺れの半ドットに合わせるため fillRect を直接使う */
/* 至近の層の灯（xing レイヤーの直後に呼ぶ。oy は xing を描いた縦の位置）。円い灯と、背板の上のにじみ。夜は外側にもにじむ */
export function drawCrossingNearLamps(g, dist, oy, t) {
  const wx = Math.floor(dist * XING_F), ph = Math.floor(t * 2) & 1, lit = tones.a ? tones.a.lit : 0;
  for (const x of crossingsIn(dist + W / 2 - NEAR_REACH, dist + W / 2 + NEAR_REACH)) {
    const [lx, ly] = planOf(x).near.lamps[ph], sx = lx - wx;
    if (sx < -12 || sx > W + 8) continue;
    if (lit > 0.3) { g.globalAlpha = 0.14 * lit; g.fillStyle = E('#ff4a30'); g.fillRect(sx - 6, oy + ly - 5, 17, 15); g.fillRect(sx - 4, oy + ly - 7, 13, 19); }
    g.globalAlpha = 0.4; g.fillStyle = E('#ff4a30'); g.fillRect(sx - 1, oy + ly - 2, 7, 9); g.fillRect(sx - 2, oy + ly - 1, 9, 7);
    g.globalAlpha = 1; g.fillStyle = E('#ff3a28');
    LENS.forEach((w, k) => g.fillRect(sx + 2 - (w >> 1), oy + ly + k, w, 1));
    g.fillStyle = E('#ff7a5c'); g.fillRect(sx + 1, oy + ly + 1, 3, 3);
    g.fillStyle = E('#ffd0bd'); g.fillRect(sx + 1, oy + ly + 1, 2, 2);
  }
}
