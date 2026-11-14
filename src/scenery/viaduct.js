import { SH, state } from '../state.js';
import { hash32, rng, ri, pick } from '../rng.js';
import { R, shade, tint, GRASS, CONC, TRUSS_PAINT } from '../palette.js';
import { elev, elevSpan } from '../course.js';

/* ---------- 高架と勾配の線路際（視差 1.0） ----------
   位置は course.js の高架 { n, a, b, up, down }。elev(d) > 0 の列だけ、もとの線路際の絵を消して描き直す
   （チャンクの乱数 r は使わない。elev = 0 の地点の絵は変わらない）。絵は高さ e = elev(d) で3つに分ける。
     0 < e < E1   盛土: 草の路肩と金網の柵。柵の向こうは地面が下がっていくので、奥の層が見える
     E1 〜 E2     擁壁: コンクリートの縁が 75 → 70 へ少しずつ立ち上がる。上に手すり
     E2 〜        高架橋: 高欄（上端 PT）。足もとにケーブルの樋。ところどころ防音壁・道路をまたぐ鋼桁（手すりごしに下が見える）・
                  張り出しに立つ架線柱。高欄より上は抜けていて、下がった近景・中景を見下ろす
   高架橋の中の割り付け（防音壁・鋼桁）は高架ごとの「計画」（makePlan: シード × 高架の番号から）で決める。 */
const SALT = 96;
const E1 = 0.3, E2 = 0.7;
const PT = 70;        // 高欄の上端
const BT = 56;        // 防音壁の上端
const POLE = 400;     // 架線柱の間隔
const sstepInv = e => { let lo = 0, hi = 1; for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (m * m * (3 - 2 * m) < e) lo = m; else hi = m; } return hi; };

let planSeed = null; const plans = new Map();
function planOf(s) {
  if (planSeed !== state.seed) { planSeed = state.seed; plans.clear(); }
  let p = plans.get(s.n);
  if (!p) { p = makePlan(s); plans.set(s.n, p); if (plans.size > 6) plans.delete(plans.keys().next().value); }
  return p;
}
function makePlan(s) {
  const r = rng(hash32(state.seed, SALT, s.n)), t2 = sstepInv(E2);
  const c0 = Math.round(s.a + s.up * t2), c1 = Math.round(s.b - s.down * t2); // 高架橋の区間
  const pieces = [];
  let x = c0 + ri(r, 90, 300);
  for (;;) {
    const q = r(), kind = q < 0.42 ? 'barrier' : q < 0.8 ? 'girder' : null;
    const len = kind === 'barrier' ? ri(r, 180, 520) : kind === 'girder' ? ri(r, 64, 130) : 0;
    const clear = r() < 0.65, col = pick(r, TRUSS_PAINT), gap = ri(r, 180, 560);
    if (x + len > c1 - 90) break;
    if (kind) pieces.push({ t: kind, a: x, b: x + len, clear, col });
    x += len + gap;
  }
  return { s, h: hash32(state.seed, SALT + 1, s.n), c0, c1, pieces, p0: c0 + 37 };
}
const pieceAt = (p, d, pad = 0) => { for (const q of p.pieces) if (d >= q.a - pad && d < q.b + pad) return q; return null; };

const FENCE = '#6f7f78', FENCE_M = '#7d8a84', FENCE_P = '#5f6f68', RAIL = '#59635f';
const TROUGH = '#c6c5ba', PANEL = '#c9cdc6', GLASSY = '#d4e4ea', POST = '#737d79';

export function viaductTrack(g, L, i) {
  const cw = L.cw, ox = i * cw;
  const conc = CONC, concL = tint(conc, 0.35), concL2 = tint(conc, 0.12), concD = shade(conc, 0.14), concS = shade(conc, 0.3);
  for (let x = 0; x < cw; x++) {
    const d = ox + x, s = elevSpan(d); if (!s) continue;
    const e = elev(d); if (e <= 0) continue;
    const p = planOf(s), hc = hash32(p.h, 1, d);
    g.clearRect(x, 0, 1, SH);
    if (e < E1) { // 盛土: 草の路肩と金網の柵
      const gy = 75, c = GRASS[(hash32(p.h, 2, d >> 6) & 1)];
      R(g, x, gy, 1, SH - gy, c); R(g, x, gy, 1, 1, tint(c, 0.15));
      if ((hc & 7) === 0) R(g, x, gy + 1 + ((hc >>> 3) % 4), 1, 1, shade(c, 0.16));
      if ((hc >>> 6) % 5 === 0) R(g, x, gy - 1 - ((hc >>> 9) & 1), 1, 1 + ((hc >>> 9) & 1), c);
      R(g, x, 69, 1, 1, FENCE);
      for (let y = 70; y < gy; y++) if ((d + y) & 1) R(g, x, y, 1, 1, FENCE_M);
      if ((d - s.a) % 16 === 0) R(g, x, 68, 1, gy - 67, FENCE_P);
      continue;
    }
    if (e < E2) { // 擁壁: 縁が立ち上がり、上に手すり
      const top = Math.round(75 - (75 - PT) * (e - E1) / (E2 - E1));
      wallCol(g, x, d, top, conc, concL, concL2, concD, concS, hc);
      if (top > PT + 1) {
        R(g, x, 67, 1, 1, RAIL);
        if (top > 73) R(g, x, 70, 1, 1, RAIL);
        if (d % 12 === 0) R(g, x, 67, 1, top - 67, RAIL);
      }
      continue;
    }
    // 高架橋
    const q = pieceAt(p, d), u = d - p.c0;
    if (q && q.t === 'girder') { // 道路をまたぐ鋼桁: 手すりごしに下が見える
      const k = Math.min(d - q.a, q.b - 1 - d), col = q.col, gd = shade(col, 0.26);
      if (k < 9) { // 橋台
        R(g, x, PT - 2, 1, SH - PT + 2, k === 8 ? concS : conc); R(g, x, PT - 2, 1, 1, concL); R(g, x, PT - 1, 1, 1, concL2);
        if (k >= 2 && k <= 6) R(g, x, 74, 1, 2, concD);
        continue;
      }
      R(g, x, 68, 1, 1, RAIL); R(g, x, 71, 1, 1, RAIL);
      if ((d - q.a) % 8 === 4) R(g, x, 68, 1, 6, RAIL);
      R(g, x, 74, 1, 1, tint(col, 0.3)); R(g, x, 75, 1, 4, gd); R(g, x, 79, 1, 1, shade(gd, 0.25));
      if ((d - q.a) % 16 === 12) R(g, x, 75, 1, 4, shade(gd, 0.2));
      if ((d - q.a) % 4 === 1) R(g, x, 76, 1, 1, shade(gd, 0.12));
      continue;
    }
    wallCol(g, x, d, PT, conc, concL, concL2, concD, concS, hc);
    if (u % 25 === 0) R(g, x, PT + 1, 1, 6, concD);                 // 高欄の目地
    if (u % 100 === 62) R(g, x, PT + 4, 1, 2, concS);               // 排水口
    if (q) { // 防音壁: H 鋼の柱の間にパネル。上は透明板
      const m = (d - q.a) % 20, end = d - q.a < 2 || q.b - d <= 2, tb = q.clear ? BT + 7 : BT;
      if (m === 0 || end) { R(g, x, BT - 1, 1, PT - BT + 1, POST); continue; }
      R(g, x, tb, 1, PT - tb, m === 1 ? tint(PANEL, 0.3) : PANEL);
      for (let y = tb + 3; y < PT; y += 3) R(g, x, y, 1, 1, shade(PANEL, 0.09));
      if (q.clear) { R(g, x, BT, 1, 1, POST); for (let y = BT + 1; y < tb; y++) if ((d + y) & 1) R(g, x, y, 1, 1, GLASSY); R(g, x, tb, 1, 1, POST); }
      else R(g, x, BT, 1, 1, tint(PANEL, 0.4));
      if (!q.clear && (hc >>> 12) % 37 === 0) R(g, x, BT + 2, 1, 3 + (hc >>> 20) % 8, shade(PANEL, 0.14)); // 雨だれ
    }
    // 張り出しに立つ架線柱（鋼桁の上には立てない）
    const pm = ((d - p.p0) % POLE + POLE) % POLE, pk = pm > POLE / 2 ? pm - POLE : pm; // 柱の中心からの距離
    if (pk >= -4 && pk <= 4 && d - pk > p.c0 && d - pk < p.c1 && !pieceAt({ pieces: p.pieces.filter(z => z.t === 'girder') }, d - pk, 14)) {
      R(g, x, PT - 4, 1, SH - PT + 4, pk === 4 ? concD : conc); R(g, x, PT - 4, 1, 1, concL);
      if (pk === -1 || pk === 0) { R(g, x, 0, 1, PT - 4, pk < 0 ? '#75807c' : '#4b5350'); R(g, x, PT - 6, 1, 2, '#3d4442'); }
      if (pk >= -4 && pk <= 3) { R(g, x, 5, 1, 1, '#4b5350'); if (pk === -4) R(g, x, 6, 1, 2, '#8a9a94'); } // 腕金とがいし
    }
  }
}
/* コンクリートの縁（擁壁・高欄）の1列: 笠の明るい線、面、足もとのかげ、ケーブルの樋 */
function wallCol(g, x, d, top, conc, concL, concL2, concD, concS, hc) {
  R(g, x, top, 1, 77 - top, conc); R(g, x, top, 1, 1, concL); if (top < 75) R(g, x, top + 1, 1, 1, concL2);
  if (top < 74) R(g, x, top + 2, 1, 1, shade(conc, 0.07)); // 笠の下のかげ
  if ((hc & 31) === 0 && top < 73) R(g, x, top + 2, 1, 1 + (hc >>> 5) % 4, concD); // 雨だれ
  R(g, x, 77, 1, 1, concS);
  R(g, x, 78, 1, 2, d % 6 === 0 ? shade(TROUGH, 0.16) : TROUGH); R(g, x, 78, 1, 1, d % 6 === 0 ? shade(TROUGH, 0.16) : tint(TROUGH, 0.2));
}
