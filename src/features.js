import { state } from './state.js';
import { hash32, rng } from './rng.js';
import { world } from './world.js';
import { stationsIn } from './stations.js';

/* ---------- トンネルと橋の「区間」（シードから決定的に決める。描画はしない） ----------
   座標は駅の x0〜x1 と同じ線路際（視差 1.0）の走行距離 d。画面の x 位置 sx に見えている地点は d = state.dist + sx。
   区間: { type: 'tunnel' | 'bridge', n（通し番号 1〜）, a, b, len, h（絵づくり用の 32bit ハッシュ）,
           via: 'mount-edge'（山間の入口・出口）| 'mount-in'（山間の中）| 'sea-edge'（海沿いの入口・出口）| 'river'（橋） }
   表は d = 0 から STEP 刻みで world(d) を見ながら前へ走査して伸ばす。候補は中心の位置の順に決まり、
   前の区間と GAP 以上あかない候補は諦めるので、表は a の昇順・重なりなしで、後から n が変わることはない。 */
const SALT = 91;        // hash32(seed, SALT, 候補の通し番号): トンネルの候補（確率・長さ・h）
const SALT_BRIDGE = 92; // hash32(seed, SALT_BRIDGE, 枠の番号): 橋の候補
const STEP = 250;       // 走査の刻み
const START = 3000;     // これより手前（出発直後）には置かない
const GAP = 1500;       // 区間どうしの最小間隔
const ST_MARGIN = 700;  // 駅のホーム [x0 − ST_MARGIN, x1 + ST_MARGIN] と重ねない
const EDGE = 0.5;       // mount / sea の重みがこの値をまたぐ地点が「入口・出口」
const MOUNT_EDGE = { p: 1, len: [2400, 5000] };  // トンネル（山間の入口・出口）
const SEA_EDGE = { p: 0.5, len: [1200, 2600] };  // トンネル（海沿いの入口・出口）
const MOUNT_IN = { p: 0.6, len: [1800, 4500], every: [6000, 11000], min: 0.85, clear: 4000 };
// ↑ 山間の中: mount > min が続くあいだ、前の区間の終わりから every 進むごとに確率 p。
//   出口のトンネルを押しのけないよう、終わりの先 clear ドットまで mount > EDGE であること
const BRIDGE = { p: 0.5, len: [600, 1800], slot: 14000, wild: 0.05, clear: 4000 }; // 橋: slot ごとの枠に確率 p で1つ。mount + sea < wild の場所だけ（終わりの先 clear ドットに山間・海沿いの入口が無いこと）
const MIX_RAMP = 250;   // featureMix(): 区間の端の外側、このドット数で 0 へ
const LOOK = 8000;      // a <= d の区間がすべて決まるのに要る、d より先の走査距離（最大の長さの半分 + 駅をよけて戻る最大幅 より大きく）
const FAR = 3000000;    // nextFeature / featureNo が探すのを諦める距離

const clamp01 = v => Math.min(1, Math.max(0, v));
const between = (r, [lo, hi]) => lo + (hi - lo) * r();

/* ---------- 区間の表（シードごとにキャッシュ） ---------- */
let cacheSeed = null, list = [], scanD = 0, seq = 0, pm = 0, ps = 0, pend = null, lastTry = 0;
function reset() {
  cacheSeed = state.seed; list = []; scanD = 0; seq = 0; pend = null; lastTry = 0;
  const e = world(0); pm = e.mount; ps = e.sea;
}

/* 候補を表に足す。駅と重なるなら近い側へずらし、それでも置けなければ諦める */
function place(type, c, len, via, h) {
  len = Math.round(len);
  let a = Math.round(c - len / 2), b = a + len;
  const hit = stationsIn(a - ST_MARGIN, b + ST_MARGIN);
  if (hit.length) {
    const s = hit[0], back = b - (s.x0 - ST_MARGIN), fwd = (s.x1 + ST_MARGIN) - a;
    if (back <= fwd) { b = s.x0 - ST_MARGIN - 1; a = b - len; } else { a = s.x1 + ST_MARGIN + 1; b = a + len; }
    if (stationsIn(a - ST_MARGIN, b + ST_MARGIN).length) return false;
  }
  if (a < START) return false;
  const last = list[list.length - 1];
  if (last && a < last.b + GAP) return false;
  list.push(Object.freeze({ type, n: list.length + 1, a, b, len, h, via }));
  return true;
}
const roll = () => { const r = rng(hash32(state.seed, SALT, ++seq)); return { r, h: (r() * 4294967296) >>> 0 }; };

/* 走査を1刻み進める（scanD − STEP 〜 scanD のあいだに中心がある候補を、中心の順に決める） */
function step() {
  const d0 = scanD, d = scanD += STEP, e = world(d), m = e.mount, s = e.sea, cands = [];
  // 山間・海沿いの入口・出口: 重みが EDGE をまたぐ地点を中心に
  for (const [p0, p1, cfg, via] of [[pm, m, MOUNT_EDGE, 'mount-edge'], [ps, s, SEA_EDGE, 'sea-edge']]) {
    if ((p0 < EDGE) === (p1 < EDGE)) continue;
    const { r, h } = roll(), ok = r() < cfg.p, len = between(r, cfg.len);
    if (ok) cands.push({ type: 'tunnel', c: d0 + STEP * (EDGE - p0) / (p1 - p0), len, via, h });
  }
  // 山間の中
  if (m > MOUNT_IN.min) {
    if (!pend) {
      const { r, h } = roll(), ref = Math.max(list.length ? list[list.length - 1].b : 0, lastTry, d0);
      const a = Math.round(ref + between(r, MOUNT_IN.every)), len = Math.round(between(r, MOUNT_IN.len));
      pend = { a, b: a + len, len, h, ok: r() < MOUNT_IN.p };
    }
    if (d >= pend.a + pend.len / 2) {
      let ok = pend.ok && world(pend.a).mount > MOUNT_IN.min && world(pend.b).mount > MOUNT_IN.min;
      for (let x = pend.a; ok && x <= pend.b + MOUNT_IN.clear; x += STEP) ok = world(x).mount > EDGE;
      if (ok) cands.push({ type: 'tunnel', c: pend.a + pend.len / 2, len: pend.len, via: 'mount-in', h: pend.h });
      lastTry = pend.b; pend = null;
    }
  } else pend = null;
  // 橋: 枠ごとに1つ
  for (let k = Math.floor(d0 / BRIDGE.slot); k <= Math.floor(d / BRIDGE.slot); k++) {
    const r = rng(hash32(state.seed, SALT_BRIDGE, k)), ok = r() < BRIDGE.p, len = Math.round(between(r, BRIDGE.len));
    const c = k * BRIDGE.slot + len / 2 + r() * (BRIDGE.slot - len), h = (r() * 4294967296) >>> 0;
    if (!ok || !(c > d0 && c <= d)) continue;
    const tame = x => { const w = world(x); return w.mount + w.sea < BRIDGE.wild; };
    let free = tame(c - len / 2) && tame(c) && tame(c + len / 2);
    // 先に決まる橋が、すぐ先の入口のトンネル（確率で必ず置くほう）を押しのけないように、先まで山間・海沿いの境目が無いこと
    for (let x = c + len / 2; free && x <= c + len / 2 + BRIDGE.clear; x += STEP) { const w = world(x); free = w.mount < EDGE && w.sea < EDGE; }
    if (free) cands.push({ type: 'bridge', c, len, via: 'river', h });
  }
  cands.sort((x, y) => x.c - y.c);
  for (const q of cands) place(q.type, q.c, q.len, q.via, q.h);
  pm = m; ps = s;
}
/* a <= d の区間がすべて表に入るまで走査を進める */
function ensure(d) {
  if (cacheSeed !== state.seed) reset();
  while (scanD < d + LOOK) step();
}
/* b >= d である最初の区間の添字（無ければ list.length）。表は a の昇順・重なりなしなので b も昇順 */
function firstEndingAt(d) {
  let lo = 0, hi = list.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].b < d) lo = m + 1; else hi = m; }
  return lo;
}

/* [d0, d1] と重なる区間の配列（チャンク1枚ぶんの描画に。stationsIn と同じ使い方） */
export function featuresIn(d0, d1) {
  ensure(d1);
  const out = [];
  for (let i = firstEndingAt(d0); i < list.length && list[i].a <= d1; i++) out.push(list[i]);
  return out;
}

/* d が [a − margin, b + margin] に入る区間。無ければ null（複数あれば手前のもの） */
export function featureNear(d, margin = 0) {
  ensure(d + margin);
  const i = firstEndingAt(d - margin);
  return i < list.length && list[i].a - margin <= d ? list[i] : null;
}

/* a >= d で最も近い区間（type を省略すると種類を問わない）。FAR 先まで無ければ null */
export function nextFeature(d, type) {
  ensure(d);
  for (let i = firstEndingAt(d); ; i++) {
    while (i >= list.length && scanD < d + FAR) step();
    if (i >= list.length) return null;
    const f = list[i];
    if (f.a >= d && (!type || f.type === type)) return f;
  }
}

/* その種類の k 番目（1〜）の区間（撮影用）。FAR までに無ければ null */
export function featureNo(type, k) {
  ensure(0);
  for (let i = 0, c = 0; ; i++) {
    while (i >= list.length && scanD < FAR) step();
    if (i >= list.length) return null;
    if (list[i].type === type && ++c >= k) return list[i];
  }
}

/* d から type の区間までの距離（中は 0）が reach 以内のもののうち、最も近い距離。無ければ Infinity */
function gapTo(d, type, reach) {
  ensure(d + reach);
  let best = Infinity;
  for (let i = firstEndingAt(d - reach); i < list.length && list[i].a <= d + reach; i++) {
    const f = list[i];
    if (f.type === type) best = Math.min(best, Math.max(0, f.a - d, d - f.b));
  }
  return best;
}

/* トンネルへの近さ 0..1（区間の中は 1、坑口から外へ ramp ドットかけて 0 へ。smoothstep） */
export function tunnelProx(d, ramp = 600) {
  const t = clamp01(1 - gapTo(d, 'tunnel', ramp) / ramp);
  return t * t * (3 - 2 * t);
}

/* { tunnel, bridge }: それぞれ 0..1（区間の中が 1、端の外側 MIX_RAMP ドットで 0 へ直線的に）。音の切り替え用 */
export function featureMix(d) {
  return { tunnel: clamp01(1 - gapTo(d, 'tunnel', MIX_RAMP) / MIX_RAMP), bridge: clamp01(1 - gapTo(d, 'bridge', MIX_RAMP) / MIX_RAMP) };
}
