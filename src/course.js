import { state } from './state.js';
import { hash32, rng } from './rng.js';
import { world } from './world.js';
import { stationsIn, nextStation } from './stations.js';
import { featuresIn } from './features.js';

/* ---------- 線形（カーブ・高低差・制限速度。シードから決定的に決める。描画はしない） ----------
   座標は駅・トンネル・橋と同じ線路際（視差 1.0）の走行距離 d。
   カーブ: { n, a, b, len, h0, h1 }。向き heading(d) は a までは h0、b からは h1、あいだは smoothstep。
     単位は「遠景レイヤーのドット」: layers.js が各レイヤーの位置に pan × heading(d) を足すので、
     カーブの途中だけ遠くの景色の流れる速さが変わる（傾きが正 = 速く流れる = 窓がカーブの外側）。
   高架: { n, a, b, up, down }。elev(d) は a から up ドットかけて 0 → 1、b の手前 down ドットで 1 → 0。
   どちらも d = 0 から前へ順に決めて表を伸ばす（前の区間の終わりから次を決めるので、後から変わることはない）。 */
const SALT_CURVE = 93;  // hash32(seed, SALT_CURVE, 候補の通し番号)
const SALT_ELEV = 94;   // hash32(seed, SALT_ELEV, 枠の番号)
const SALT_SPEED = 95;  // hash32(seed, SALT_SPEED, 駅の番号 k): 駅 k−1 〜 駅 k の駅間の係数
const START = 3000;     // これより手前（出発直後）は直線・地上
const FAR = 3000000;    // nextCurve / nextElev が探すのを諦める距離
const STEP = 250;       // world(d) を見る刻み

export const HEADING_MAX = 120;  // |heading| の上限
export const SLOPE_MAX = 0.065;  // heading の傾きの上限（遠景 f = 0.09 より小さく: 遠景が逆流しない）
const CURVE = {
  len: [1500, 4000],    // カーブの長さ
  gap: [6000, 14000],   // 前のカーブの終わり（最初は START）から次の始まりまで
  turn: [0.45, 1],      // 向きの変化量: その長さで傾きが SLOPE_MAX になる量に対する割合
  turnMax: 110,         // 向きの変化量の上限（HEADING_MAX より小さく: どの向きからでも ±どちらかへは曲がれる）
  station: 300,         // 駅のホーム [x0, x1] の前後、カーブを置かない幅
  bridge: 200,          // 橋 [a, b] の前後
  portal: 300,          // トンネルの坑口（a と b）の前後
  tries: 8              // 置けないとき、じゃまな区間の先へずらして試す回数
};
const ELEV = {
  slot: 12000, p: 0.7,  // 枠ごとに確率 p で1つ
  len: [6000, 20000],   // 長さ（勾配を含む）。削られてこの下限を割ったら置かない
  ramp: [1500, 2500],   // 勾配の長さ
  urban: 0.6,           // city + resi の重みがこの値以上の所だけ
  clear: 500,           // 橋・トンネルの前後は地上
  station: 300,         // 勾配は駅のホームの前後に重ねない
  gap: 3000             // 高架どうしの最小間隔
};
/* 巡航の目標速度（ドット/秒。× 0.36 で km/h） */
const SPEED = { city: 205, resi: 235, suburb: 265, rural: 300, mount: 300, sea: 300 };
const SPEED_K = [0.9, 1.05];  // 駅間ごとの係数
const CURVE_SLOW = 0.6;       // |curve| = 1 のときの倍率（|curve| で線形）
export const V_MAX = Math.max(...Object.values(SPEED)) * SPEED_K[1]; // あり得る最高速度

const clamp01 = v => Math.min(1, Math.max(0, v));
const sstep = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
const between = (r, [lo, hi]) => lo + (hi - lo) * r();

/* ---------- 表（シードごとにキャッシュ） ---------- */
let cacheSeed = null, curves = [], curveSeq = 0, curveFrom = START, spans = [], slotK = 0, ci = 0, ei = 0;
function sync() {
  if (cacheSeed === state.seed) return;
  cacheSeed = state.seed; curves = []; curveSeq = 0; curveFrom = START; spans = []; slotK = 0; ci = 0; ei = 0;
}

/* [a, b] にカーブを置けないなら、じゃまな区間の終わり（最も先のもの）。置けるなら -1 */
function blockedUntil(a, b) {
  let end = -1;
  for (const s of stationsIn(a - CURVE.station, b + CURVE.station)) end = Math.max(end, s.x1 + CURVE.station);
  for (const f of featuresIn(a - CURVE.portal, b + CURVE.portal)) {
    if (f.type === 'bridge') { if (f.a - CURVE.bridge <= b && f.b + CURVE.bridge >= a) end = Math.max(end, f.b + CURVE.bridge); }
    else for (const p of [f.a, f.b]) if (p - CURVE.portal <= b && p + CURVE.portal >= a) end = Math.max(end, p + CURVE.portal);
  }
  return end;
}
/* 次のカーブの候補を1つ決める（置けなければ表には足さず、探す起点だけ進める） */
function genCurve() {
  const r = rng(hash32(state.seed, SALT_CURVE, ++curveSeq));
  const len = Math.round(between(r, CURVE.len)), q = between(r, CURVE.turn), left = r() < 0.5;
  let a = Math.round(curveFrom + between(r, CURVE.gap)), ok = false;
  for (let k = 0; k < CURVE.tries && !ok; k++) { const e = blockedUntil(a, a + len); if (e < 0) ok = true; else a = e + 1; }
  curveFrom = a + len;
  if (!ok) return;
  const h0 = curves.length ? curves[curves.length - 1].h1 : 0;
  const mag = Math.min(CURVE.turnMax, q * SLOPE_MAX * len / 1.5); // smoothstep の最大の傾きは 1.5 × 変化量 / 長さ
  let h1 = h0 + (left ? -mag : mag);
  if (Math.abs(h1) > HEADING_MAX) h1 = h0 - (left ? -mag : mag);  // はみ出すなら逆へ曲がる（有界に保つ）
  h1 = Math.max(-HEADING_MAX, Math.min(HEADING_MAX, h1));
  curves.push(Object.freeze({ n: curves.length + 1, a, b: a + len, len, h0, h1 }));
}
/* a <= d のカーブがすべて表に入るまで伸ばす */
function ensureCurves(d) {
  sync();
  while (curveFrom + CURVE.gap[0] <= d) genCurve();
}
/* a <= d である最後のカーブ（無ければ null）。前回の添字の近くを先に見る */
function curveAt(d) {
  ensureCurves(d);
  const n = curves.length;
  if (!n || d < curves[0].a) return null;
  if (ci >= n) ci = n - 1;
  if (!(curves[ci].a <= d && (ci + 1 >= n || curves[ci + 1].a > d))) {
    let lo = 0, hi = n - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (curves[m].a <= d) lo = m; else hi = m - 1; }
    ci = lo;
  }
  return curves[ci];
}

/* 向きの積算（遠景レイヤーのドット）。|heading| <= HEADING_MAX */
export function heading(d) {
  const c = curveAt(d);
  if (!c) return 0;
  return d >= c.b ? c.h1 : c.h0 + (c.h1 - c.h0) * sstep((d - c.a) / c.len);
}
/* カーブのきつさ −1..1（heading の傾き ÷ SLOPE_MAX）。正 = 遠景が速く流れる（窓がカーブの外側）、負 = 窓が内側 */
export function curve(d) {
  const c = curveAt(d);
  if (!c || d >= c.b) return 0;
  const t = (d - c.a) / c.len;
  return 6 * t * (1 - t) * (c.h1 - c.h0) / c.len / SLOPE_MAX;
}
/* a >= d で最も近いカーブ { n, a, b, len, h0, h1 }。FAR 先まで無ければ null */
export function nextCurve(d) {
  sync();
  for (let i = 0; ; i++) {
    while (i >= curves.length && curveFrom < d + FAR) genCurve();
    if (i >= curves.length) return null;
    if (curves[i].a >= d) return curves[i];
  }
}

/* ---------- 高架 ---------- */
const urbanOK = x => { const e = world(x); return e.city + e.resi >= ELEV.urban && e.mount <= 0 && e.sea <= 0; };
function genSlot(k) {
  const r = rng(hash32(state.seed, SALT_ELEV, k));
  const ok = r() < ELEV.p, len = Math.round(between(r, ELEV.len)), at = r();
  const up = Math.round(between(r, ELEV.ramp)), down = Math.round(between(r, ELEV.ramp));
  if (!ok) return;
  const last = spans[spans.length - 1];
  let a = Math.round((k + at) * ELEV.slot), b = a + len;
  a = Math.max(a, START, last ? last.b + ELEV.gap : 0);
  // 街なか（都心・住宅街）が続く範囲だけに削る
  while (a < b && !urbanOK(a)) a += STEP;
  let e = a; while (e + STEP <= b && urbanOK(e + STEP)) e += STEP;
  b = e;
  // 橋・トンネルをよける（手前に十分な長さがあれば手前で終える。無ければ先から始める）
  for (const f of featuresIn(a - ELEV.clear, b + ELEV.clear)) {
    if (f.b + ELEV.clear < a || f.a - ELEV.clear > b) continue;
    if (f.a - ELEV.clear - 1 - a >= ELEV.len[0]) { b = f.a - ELEV.clear - 1; break; }
    a = f.b + ELEV.clear + 1;
  }
  // 勾配を駅のホームに重ねない（上りはホームの先から、下りはホームの手前で終える）
  if (b - a < ELEV.len[0]) return;
  const s0 = stationsIn(a - ELEV.station, a + up + ELEV.station)[0]; if (s0) a = s0.x1 + ELEV.station + 1;
  const s1 = stationsIn(b - down - ELEV.station, b + ELEV.station)[0]; if (s1) b = s1.x0 - ELEV.station - 1;
  if (b - a < ELEV.len[0]) return;
  spans.push(Object.freeze({ n: spans.length + 1, a, b, up, down }));
}
/* a <= d の高架がすべて表に入るまで伸ばす（枠 k の高架は k × slot 以降に始まる） */
function ensureSpans(d) {
  sync();
  while (slotK * ELEV.slot <= d) genSlot(slotK++);
}
/* 高さ 0（地上）〜 1（高架） */
export function elev(d) {
  ensureSpans(d);
  const n = spans.length;
  if (!n || d < spans[0].a) return 0;
  if (ei >= n) ei = n - 1;
  if (!(spans[ei].a <= d && (ei + 1 >= n || spans[ei + 1].a > d))) {
    let lo = 0, hi = n - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (spans[m].a <= d) lo = m; else hi = m - 1; }
    ei = lo;
  }
  const s = spans[ei];
  return d >= s.b ? 0 : Math.min(sstep((d - s.a) / s.up), sstep((s.b - d) / s.down));
}
/* d を含む高架 { n, a, b, up, down }（a <= d < b。無ければ null）。絵づくり用（scenery/viaduct.js） */
export function elevSpan(d) {
  if (elev(d) <= 0 && !(spans[ei] && spans[ei].a <= d && d < spans[ei].b)) return null;
  return spans[ei];
}
/* a >= d で最も近い高架 { n, a, b, up, down }（a は上り勾配の始点）。FAR 先まで無ければ null */
export function nextElev(d) {
  sync();
  for (let i = 0; ; i++) {
    while (i >= spans.length && slotK * ELEV.slot < d + FAR) genSlot(slotK++);
    if (i >= spans.length) return null;
    if (spans[i].a >= d) return spans[i];
  }
}

/* ---------- 制限速度 ---------- */
/* その地点の巡航の目標速度（ドット/秒）: バイオームの基準 × 駅間ごとの係数 × カーブの制限 */
export function speedLimit(d) {
  const e = world(d);
  let v = 0; for (const b in SPEED) v += e[b] * SPEED[b];
  const k = SPEED_K[0] + (SPEED_K[1] - SPEED_K[0]) * hash32(state.seed, SALT_SPEED, nextStation(d).k) / 4294967296;
  return v * k * (1 - (1 - CURVE_SLOW) * Math.abs(curve(d)));
}
