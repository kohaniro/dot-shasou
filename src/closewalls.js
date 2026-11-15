import { state } from './state.js';
import { hash32, rng } from './rng.js';
import { world } from './world.js';
import { stationsIn } from './stations.js';
import { featureNear } from './features.js';
import { elev } from './course.js';
import { crossingNear } from './crossings.js';

/* ---------- 至近距離の建物の位置（シードから決定的に決める。描画はしない） ----------
   線路際ぎりぎりに建つビルの壁が、窓いっぱいに流れる区間。座標は駅・踏切と同じ線路際（視差 1.0）の走行距離 d。
   1件: { n（通し番号 1〜）, a, b（線路際の座標）, len, h（絵づくり用の 32bit ハッシュ）, glass（ガラス張りの棟を含むか）,
          bldgs（棟の並び [{ a, b, mat, gap }]。mat は 'tile' | 'concrete' | 'panel' | 'glass'、gap はその棟の右のすき間の種類 'alley' | 'open' | null（最後の棟）） }
   FRAME ドットの枠 k ごとに hash32(seed, SALT_WALL, k) の乱数を必ず5回引いて（置くか・枠内の位置・長さ・h・glass）、置かない枠でも回数を変えない。
   棟の分け方は h だけから決める（枠の乱数には足さない）。glass が真なら棟のうち1つだけがガラスのカーテンウォール、偽ならガラスの棟は無い
   （次の「自車の映り込み」はこの bldgs の mat === 'glass' の範囲を見ればよい）。
   出現率は中心の world() の都心の重み city（と住宅街 resi を少し）に比例。駅・橋・トンネル・踏切・高架と勾配・出発直後に当たったら置かない（ずらさない）。
   表は a の昇順（各件は自分の枠の中に収まる）。 */
const SALT_WALL = 88;   // hash32(seed, SALT_WALL, 枠の番号)。88 は景色・vnoise の salt と重ならない（91〜97, 98〜101, 31, 9001〜 などは使用済み）
const FRAME = 4500;     // 枠の長さ（6000 では都心で約 130 秒に1件と少なかった。都心の地点の半分ほどが高架・駅・橋に当たって置けない）
const START = 2000;     // これより手前（出発直後）には置かない
const LEN = [150, 500]; // 1件の長さ（線路際の座標。視差 1.4 では 210〜700 ドット）
const P = { city: 0.9, resi: 0.1 };   // 枠ごとの出現率（中心の重みで混ぜる。郊外以下は 0）
const P_GLASS = [0.25, 0.6];          // ガラス張りの棟を含む確率（都心の中心寄り core 0 → 1）
const ST_MARGIN = 500;  // 駅のホーム [x0, x1] の前後、置かない幅（ホームの層・駅の線路際の絵と同じ窓に入らない）
const FT_MARGIN = 600;  // 橋・トンネル [a, b] の前後（トンネルの壁の層は坑口から 240、トラスは 130 まで描く）
const XG_MARGIN = 400;  // 踏切 [a, b] の前後（踏切の至近の層は道の端から 170 まで描く）
const EL_MARGIN = 400;  // [a − EL_MARGIN, b + EL_MARGIN] で elev > 0 なら置かない（高架・勾配の線路際の絵と並べない）
const EL_STEP = 50;     // ↑ を調べる刻み
const GAP = 2500;       // 前の件の終わり b から次の a までの最小間隔
const FAR = 3000000;    // nextWall / wallNo が探すのを諦める距離
/* 棟の分け方（h から） */
const BLD = [80, 170];  // 1棟の幅（線路際の座標。視差 1.4 では 112〜238 ドット）
const BLD_MIN = 70;     // 余りがこれより短ければ前の棟につなげる
const SLIT = [6, 15];   // 棟のすき間（線路際の座標。視差 1.4 では 8〜21 ドット）
const MATS = [['tile', 0.4], ['concrete', 0.3], ['panel', 0.3]]; // ガラス以外の外壁の素材の重み

/* ---------- 表（シードごとにキャッシュ） ---------- */
let cacheSeed = null, list = [], frameK = 0;
export function reset() { cacheSeed = state.seed; list = []; frameK = 0; }

function ok(a, b) {
  if (a < START) return false;
  const last = list[list.length - 1];
  if (last && a - last.b < GAP) return false;
  if (stationsIn(a - ST_MARGIN, b + ST_MARGIN).length) return false;
  if (featureNear((a + b) / 2, (b - a) / 2 + FT_MARGIN)) return false;
  if (crossingNear((a + b) / 2, (b - a) / 2 + XG_MARGIN)) return false;
  for (let x = a - EL_MARGIN; x <= b + EL_MARGIN + EL_STEP - 1; x += EL_STEP) if (elev(Math.min(x, b + EL_MARGIN)) > 0) return false;
  return true;
}
/* 棟の並び（h だけから決める） */
function split(a, b, h, glass) {
  const r = rng(hash32(h, 71, 0)), out = [];
  let x = a;
  while (x < b) {
    let w = Math.round(BLD[0] + (BLD[1] - BLD[0]) * r()), s = Math.round(SLIT[0] + (SLIT[1] - SLIT[0]) * r());
    const gap = r() < 0.55 ? 'alley' : 'open', m = r();
    if (b - (x + w) < BLD_MIN + s) { w = b - x; s = 0; }
    let mat = MATS[MATS.length - 1][0];
    for (let t = m * MATS.reduce((v, q) => v + q[1], 0), k = 0; k < MATS.length; k++) { if (t < MATS[k][1]) { mat = MATS[k][0]; break; } t -= MATS[k][1]; }
    out.push({ a: x, b: x + w, mat, gap: s ? gap : null });
    x += w + s;
  }
  // 隣り合う棟が同じ素材なら、後ろの棟の素材を1つずらす（1枚の板に見えないように）
  for (let k = 1; k < out.length; k++) if (out[k].mat === out[k - 1].mat) { const i = MATS.findIndex(q => q[0] === out[k].mat); out[k].mat = MATS[(i + 1) % MATS.length][0]; }
  if (glass) out[hash32(h, 72, 0) % out.length].mat = 'glass';
  return out.map(o => Object.freeze(o));
}
/* 枠 k を決める（置くなら表に足す）。乱数は常に5回 */
function genFrame(k) {
  const r = rng(hash32(state.seed, SALT_WALL, k));
  const u = r(), at = r(), lu = r(), h = (r() * 4294967296) >>> 0, gu = r();
  const len = Math.round(LEN[0] + (LEN[1] - LEN[0]) * lu * lu);
  const a = Math.round(k * FRAME + at * (FRAME - len)), b = a + len;
  const e = world((a + b) / 2);
  let p = 0; for (const key in P) p += e[key] * P[key];
  if (u >= p || !ok(a, b)) return;
  const glass = gu < P_GLASS[0] + (P_GLASS[1] - P_GLASS[0]) * e.core;
  list.push(Object.freeze({ n: list.length + 1, a, b, len, h, glass, bldgs: Object.freeze(split(a, b, h, glass)) }));
}
const sync = () => { if (cacheSeed !== state.seed) reset(); };
/* a <= d の件がすべて表に入るまで枠を進める */
function ensure(d) {
  sync();
  while (frameK * FRAME <= d) genFrame(frameK++);
}
/* b >= d である最初の件の添字（無ければ list.length） */
function firstEndingAt(d) {
  let lo = 0, hi = list.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].b < d) lo = m + 1; else hi = m; }
  return lo;
}

/* [d0, d1] と重なる件の配列（チャンク1枚ぶんの描画に） */
export function wallsIn(d0, d1) {
  ensure(d1);
  const out = [];
  for (let i = firstEndingAt(d0); i < list.length && list[i].a <= d1; i++) out.push(list[i]);
  return out;
}
/* d が [a − margin, b + margin] に入る件。無ければ null（複数あれば手前のもの） */
export function wallNear(d, margin = 0) {
  ensure(d + margin);
  const i = firstEndingAt(d - margin);
  return i < list.length && list[i].a - margin <= d ? list[i] : null;
}
/* a >= d で最も近い件。FAR 先まで無ければ null（debug.js の beforeCourse に渡せる） */
export function nextWall(d) {
  sync();
  for (let i = firstEndingAt(d); ; i++) {
    while (i >= list.length && frameK * FRAME < d + FAR) genFrame(frameK++);
    if (i >= list.length) return null;
    if (list[i].a >= d) return list[i];
  }
}
/* k 番目（1〜）の件（撮影用）。FAR までに無ければ null */
export function wallNo(k) {
  sync();
  while (list.length < k && frameK * FRAME < FAR) genFrame(frameK++);
  return list[k - 1] || null;
}
