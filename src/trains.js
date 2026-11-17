import { W, state } from './state.js';
import { hash32, rng } from './rng.js';
import { world } from './world.js';
import { nextStation } from './stations.js';
import { featureNear } from './features.js';
import { speedLimit } from './course.js';
import { crossingNear } from './crossings.js';

/* ---------- 対向列車の位置（シードから決定的に決める。描画はしない） ----------
   隣の線路を逆向きに走ってくる通勤電車が、一瞬で窓の前を通り過ぎる。時刻は使わず、走行距離だけで決まる「視差の大きい静止物」として置く:
   対向列車の速さを自車の速さの K 倍とみなすと相対速度は自車 ×(1 + K) なので、見かけの視差 F0 の物を視差 TRAIN_F = F0 × (1 + K) の層に止めて描けばよい。
   K は固定（1件ごとに変えると層の視差が件ごとに変わるため）。だから自車が遅いと相手も遅く見え、停車すると止まる → 減速・停車・発車加速の区間には置かない。
   座標は駅・踏切と同じ線路際（視差 1.0）の走行距離 d（窓の中央の地点）。
   1件: { n（通し番号 1〜）, a（先頭が窓の中央に来る地点）, b（最後尾が窓の中央に来る地点）, c（中ほど）, cars（両数）, len（層の通し座標での長さ）,
          v（見込んだ自車の速さ。駅の余白の判定に使った値）, h（絵づくり用の 32bit ハッシュ） }
   先頭は層の通し座標の左端（a の側）。窓の右端から先頭が入り、左端へ最後尾が出ていく。
   FRAME ドットの枠 k ごとに hash32(seed, SALT_TRAIN, k) の乱数を必ず4回引いて（置くか・枠内の位置・両数・h）、置かない枠でも回数を変えない。
   両数は乱数で CARS の範囲から等確率に選ぶ（ユーザーの方針、2026-11-16: 編成の長さはランダム）。出現率は中心の world() の重みで混ぜる。
   駅の減速・停車・発車加速の区間、橋・トンネル、踏切、前の件の近く、出発直後に当たったら置かない（ずらさない）。高架・至近の建物とは重なってよい。 */
export const TRAIN_K = 1.0;               // 対向列車の速さ ÷ 自車の速さ
export const TRAIN_F0 = 1.5;              // 見かけの視差（隣の線路: 線路際 1.0・架線柱 1.2 より手前）
export const TRAIN_F = TRAIN_F0 * (1 + TRAIN_K); // 層の視差 3.0
export const TRAIN = { car: 480, gap: 12 }; // 1両の長さ、連結のすき間（層のドット）
const SALT_TRAIN = 9401; // hash32(seed, SALT_TRAIN, 枠の番号)。31, 77, 78, 88, 91〜97, 9001〜9003, 9101, 9102, 9200〜, 9301, 9350 と vnoise の salt は使用済み
const FRAME = 5000;      // 枠の長さ
const START = 3000;      // これより手前（出発直後）には置かない
const P = { city: 0.8, resi: 0.75, suburb: 0.5, rural: 0.25, mount: 0.06, sea: 0.06 }; // 枠ごとの出現率（中心の重みで混ぜる）
const CARS = [2, 6];     // 両数の範囲（等確率。巡航 230 で通過は約 1.9〜4.8 秒。8 両は長すぎるとユーザーの指摘）
/* 駅: 停車位置 pos（state.dist）の手前 brake(v)・後ろ after(v) の区間に、列車が窓に見えている state.dist が入ったら置かない。
   journey.js は import できない（循環）ので、減速度・加速度の近似の式で（shots の journey mode で測った値: 巡航 230 で減速の開始は 4200〜4700 手前、
   発車後は約 6500 で巡航に戻る）。v は見込んだ速さ */
const brakeRoom = v => v * v / (2 * 7) + 1000;  // A_BRAKE 7 の止まるまでの距離 ＋ 停止寸前の緩めと余裕
const departRoom = v => v * v / (2 * 8) + 14 * v; // A_ACCEL 8 で上がるまで ＋ 巡航へ合流するまでのゆるい加速
const FT_MARGIN = 700;   // 橋・トンネル [a, b] の前後（トラス 1.6・トンネルの壁 1.7 の層と同じ窓に入らない）
const XG_MARGIN = 400;   // 踏切 [a, b] の前後（踏切の至近の層 1.6 は道の端から 170 まで描く）
const GAP = 2500;        // 前の件の終わり b から次の a までの最小間隔
const FAR = 3000000;     // nextTrain / trainNo が探すのを諦める距離
/* 巡航の速さの見込み（journey.js の cruiseAt の近似。前方の低い制限へは 3.6 で減速して間に合う速さ、後方の低い制限からは 4.8 で加速してきた速さ） */
const EST = { span: 6000, step: 100, dec: 3.6, acc: 4.8 };
export const REACH_T = W / 2 / TRAIN_F + 12; // 件の端から、この層の絵が窓に入りうる走行距離（窓の半幅 / 視差 ＋ 前面・灯りのにじみ）

/* 層の通し座標での長さ */
export const trainLen = cars => cars * (TRAIN.car + TRAIN.gap) - TRAIN.gap;

/* 地点 c で見込む自車の速さ */
function estSpeed(c) {
  let best = Infinity;
  for (let x = c - EST.span; x <= c + EST.span; x += EST.step) {
    const l = speedLimit(Math.max(0, x)), v = Math.sqrt(l * l + 2 * (x >= c ? EST.dec : EST.acc) * Math.abs(x - c));
    if (v < best) best = v;
  }
  return best;
}

/* ---------- 表（シードごとにキャッシュ） ---------- */
let cacheSeed = null, list = [], frameK = 0;
export function reset() { cacheSeed = state.seed; list = []; frameK = 0; }

function ok(a, b, v) {
  if (a < START) return false;
  const last = list[list.length - 1];
  if (last && a - last.b < GAP) return false;
  // 列車が窓に見えている state.dist の範囲が、駅の減速〜発車加速の区間に入らない
  const d0 = a - W / 2 - REACH_T, d1 = b - W / 2 + REACH_T, s = nextStation(d0 - departRoom(v));
  if (s.pos - brakeRoom(v) <= d1) return false;
  if (featureNear((a + b) / 2, (b - a) / 2 + FT_MARGIN)) return false;
  if (crossingNear((a + b) / 2, (b - a) / 2 + XG_MARGIN)) return false;
  return true;
}
/* 枠 k を決める（置くなら表に足す）。乱数は常に4回 */
function genFrame(k) {
  const r = rng(hash32(state.seed, SALT_TRAIN, k));
  const u = r(), at = r(), tu = r(), h = (r() * 4294967296) >>> 0;
  const c = Math.round(k * FRAME + 600 + at * (FRAME - 1200));
  const e = world(c);
  let p = 0; for (const key in P) p += e[key] * P[key];
  if (u >= p) return;
  const v = estSpeed(c), cars = CARS[0] + Math.min(CARS[1] - CARS[0], Math.floor(tu * (CARS[1] - CARS[0] + 1)));
  const len = trainLen(cars), half = Math.round(len / TRAIN_F / 2), a = c - half, b = c + half;
  if (!ok(a, b, v)) return;
  list.push(Object.freeze({ n: list.length + 1, a, b, c, cars, len, v: Math.round(v), h }));
}
const sync = () => { if (cacheSeed !== state.seed) reset(); };
/* a <= d の件がすべて表に入るまで枠を進める（枠 k の件は k × FRAME 以降にある） */
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
export function trainsIn(d0, d1) {
  ensure(d1);
  const out = [];
  for (let i = firstEndingAt(d0); i < list.length && list[i].a <= d1; i++) out.push(list[i]);
  return out;
}
/* d が [a − margin, b + margin] に入る件。無ければ null（複数あれば手前のもの） */
export function trainNear(d, margin = 0) {
  ensure(d + margin);
  const i = firstEndingAt(d - margin);
  return i < list.length && list[i].a - margin <= d ? list[i] : null;
}
/* a >= d で最も近い件。FAR 先まで無ければ null（debug.js の beforeCourse に渡せる） */
export function nextTrain(d) {
  sync();
  for (let i = firstEndingAt(d); ; i++) {
    while (i >= list.length && frameK * FRAME < d + FAR) genFrame(frameK++);
    if (i >= list.length) return null;
    if (list[i].a >= d) return list[i];
  }
}
/* k 番目（1〜）の件（撮影用）。FAR までに無ければ null */
export function trainNo(k) {
  sync();
  while (list.length < k && frameK * FRAME < FAR) genFrame(frameK++);
  return list[k - 1] || null;
}
/* 席（窓の中央の地点 d）と対向列車の関係（音用）。件の [a − margin, b + margin] に d が入るとき { s, train }、無ければ null。
   s = (d − a) × TRAIN_F は、席の真横に来ている所の先頭からの位置（層のドット）: s < 0 は近づく前、0〜len はすれ違い中、len より大きければ去った後。
   席から見た相手の速さは 自車の速さ × TRAIN_F（層のドット/秒） */
export function trainAt(d, margin = 300) {
  const t = trainNear(d, margin);
  return t ? { s: (d - t.a) * TRAIN_F, train: t } : null;
}
