import { state } from './state.js';
import { hash32, rng } from './rng.js';
import { world } from './world.js';
import { stationsIn } from './stations.js';
import { featureNear } from './features.js';
import { elev, curve } from './course.js';

/* ---------- 踏切の位置（シードから決定的に決める。描画・音はしない） ----------
   座標は駅・トンネル・橋と同じ線路際（視差 1.0）の走行距離 d。
   踏切: { n（通し番号 1〜）, c（道の中心）, a, b（a = c − w/2, b = c + w/2）, w（道幅）, h（絵づくり用の 32bit ハッシュ） }
   FRAME ドットの枠 k ごとに hash32(seed, SALT_XING, k) の乱数で「置くか・枠内の位置・道幅・h」を決める。
   乱数は枠ごとに常に同じ回数（4回）だけ引くので、置かない条件を変えても他の枠の踏切は変わらない。
   出現率は中心 c のバイオームの重みで混ぜる。駅・橋・トンネル・高架・勾配・カーブに当たったら置かない（ずらさない）。
   枠は前から順に決めるので、表は c の昇順で、後から n が変わることはない。 */
const SALT_XING = 97;   // hash32(seed, SALT_XING, 枠の番号)。91〜96 は features.js / course.js などで使用済み
const FRAME = 3500;     // 枠の長さ（5000 だと山間・海沿い・都心で外れる枠が多く、平均の間隔が 80 秒を超えた）
const START = 2000;     // これより手前（出発直後）には置かない
const WIDTH = [40, 70]; // 道幅
const P = { city: 0.15, resi: 0.65, suburb: 0.7, rural: 0.6, mount: 0.15, sea: 0.2 }; // バイオームごとの出現率（重みで混ぜる）
const ST_MARGIN = 400;  // 駅のホーム [x0, x1] の前後、置かない幅
const FT_MARGIN = 600;  // 橋・トンネル [a, b] の前後
const CO_MARGIN = 400;  // [a − CO_MARGIN, b + CO_MARGIN] で curve ≠ 0 なら置かない
const EL_MARGIN = 700;  // [a − EL_MARGIN, b + EL_MARGIN] で elev > 0 なら置かない。中景（視差 0.28）は窓の端で中央から約 570 ドット先を映すので、
                        // 道の帯の幅（約 85）と合わせて、列車が高架・勾配の上にいるあいだは踏切のどの層も窓に入らない幅にする
const CO_STEP = 50;     // ↑ を調べる刻み
const GAP = 2000;       // 前の踏切との最小間隔（中心どうし）
const FAR = 3000000;    // nextCrossing / crossingNo が探すのを諦める距離
export const XING_HEAR = 1500; // crossingAt(): 中心からこの距離以内なら返す（音用）

/* ---------- 表（シードごとにキャッシュ） ---------- */
let cacheSeed = null, list = [], frameK = 0;
export function reset() { cacheSeed = state.seed; list = []; frameK = 0; }

function ok(c, a, b) {
  if (a < START) return false;
  const last = list[list.length - 1];
  if (last && c - last.c < GAP) return false;
  if (stationsIn(a - ST_MARGIN, b + ST_MARGIN).length) return false;
  if (featureNear(c, (b - a) / 2 + FT_MARGIN)) return false;
  for (let x = a - CO_MARGIN; x <= b + CO_MARGIN + CO_STEP - 1; x += CO_STEP) if (curve(Math.min(x, b + CO_MARGIN)) !== 0) return false;
  for (let x = a - EL_MARGIN; x <= b + EL_MARGIN + CO_STEP - 1; x += CO_STEP) if (elev(Math.min(x, b + EL_MARGIN)) > 0) return false;
  return true;
}
/* 枠 k を決める（置くなら表に足す） */
function genFrame(k) {
  const r = rng(hash32(state.seed, SALT_XING, k));
  const u = r(), at = r(), w = Math.round(WIDTH[0] + (WIDTH[1] - WIDTH[0]) * r()), h = (r() * 4294967296) >>> 0;
  const c = Math.round(k * FRAME + w / 2 + at * (FRAME - w)), a = c - w / 2, b = c + w / 2;
  const e = world(c);
  let p = 0; for (const key in P) p += e[key] * P[key];
  if (u >= p || !ok(c, a, b)) return;
  list.push(Object.freeze({ n: list.length + 1, c, a, b, w, h }));
}
const sync = () => { if (cacheSeed !== state.seed) reset(); };
/* a <= d の踏切がすべて表に入るまで枠を進める（枠 k の踏切は k × FRAME 以降にある） */
function ensure(d) {
  sync();
  while (frameK * FRAME <= d) genFrame(frameK++);
}
/* b >= d である最初の踏切の添字（無ければ list.length） */
function firstEndingAt(d) {
  let lo = 0, hi = list.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].b < d) lo = m + 1; else hi = m; }
  return lo;
}

/* [d0, d1] と重なる踏切の配列（チャンク1枚ぶんの描画に。featuresIn と同じ使い方） */
export function crossingsIn(d0, d1) {
  ensure(d1);
  const out = [];
  for (let i = firstEndingAt(d0); i < list.length && list[i].a <= d1; i++) out.push(list[i]);
  return out;
}
/* d が [a − margin, b + margin] に入る踏切。無ければ null（複数あれば手前のもの） */
export function crossingNear(d, margin = 0) {
  ensure(d + margin);
  const i = firstEndingAt(d - margin);
  return i < list.length && list[i].a - margin <= d ? list[i] : null;
}
/* a >= d で最も近い踏切。FAR 先まで無ければ null（debug.js の beforeCourse に渡せる） */
export function nextCrossing(d) {
  sync();
  for (let i = firstEndingAt(d); ; i++) {
    while (i >= list.length && frameK * FRAME < d + FAR) genFrame(frameK++);
    if (i >= list.length) return null;
    if (list[i].a >= d) return list[i];
  }
}
/* k 番目（1〜）の踏切（撮影用）。FAR までに無ければ null */
export function crossingNo(k) {
  sync();
  while (list.length < k && frameK * FRAME < FAR) genFrame(frameK++);
  return list[k - 1] || null;
}
/* 最寄りの踏切までの符号つき距離 { x: d − c, xing }（中心から XING_HEAR 以内のとき。無ければ null）。音用 */
export function crossingAt(d) {
  let best = null;
  for (const q of crossingsIn(d - XING_HEAR, d + XING_HEAR)) {
    const x = d - q.c;
    if (Math.abs(x) <= XING_HEAR && (!best || Math.abs(x) < Math.abs(best.x))) best = { x, xing: q };
  }
  return best;
}
