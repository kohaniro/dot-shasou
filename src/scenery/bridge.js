import { W, SH, state } from '../state.js';
import { hash32, rng, ri, pick } from '../rng.js';
import { R, shade, tint, mix, HAZE, GRASS, PATH, CONC, GRAVEL, SIGN, RIVER, GLINT, LEVEE, REED, DIRT, REVET, REVET_D, TRUSS_PAINT, SPAN_PAINT } from '../palette.js';
import { world } from '../world.js';
import { distAt } from '../layers.js';
import { featuresIn, featureNear } from '../features.js';
import { hz, tree, bush, midTree } from './common.js';

/* ---------- トラス橋と川 ----------
   橋の位置は features.js の区間 { type: 'bridge', a, b, len, h }（線路際の走行距離）。絵は橋ごとの「計画」
   （makePlan: 区間の h だけから決める。チャンクの乱数 r は使わない）を、各レイヤーが自分の視差で切り出して描く。
   どれも既存の絵が済んだあとに上から描き直すので、橋の無い地点の絵は変わらない。

   川の断面（走行距離 d の方向。両岸で対称に、岸からの距離 s = min(d − a, b − d) で決める）
     s < −lo        手を入れない
     −lo 〜 −cr     堤防の外のり
     −cr 〜 cr      堤防の天端（a・b がその中心 = 橋台）
     cr 〜 li       堤防の内のり（街なかの川はコンクリート護岸）
     li 〜          高水敷（草地・グラウンド）と水面 [wa, wb]
   遠景・中景・近景は地面の帯（base 〜）だけを描き直し、中景・近景は川の上に立つ建物を消して奥を見通す。
   窓の中央では全レイヤーが同じ地点を指すので、岸が窓の中央に来たとき3つの帯の岸が縦に並び、
   橋の中ほどでは川幅が 近景 0.6・中景 0.28・遠景 0.09 倍に並んで、奥へすぼまる川になる。

   線路際（視差 1.0）: 橋の区間は隣の線路の桁と手すり、前後は堤防へ上る取り付けと橋台。
   トラス（視差 TRUSS_F の層 truss）: こちらの線路の鉄骨。窓のすぐ外を横切る。 */
export const TRUSS_F = 1.6;
const AP = 110;      // 線路際: 橋の前後、取り付けの斜面の長さ
const REACH = 140;   // 橋の外側で絵に手を入れる最大幅（lo・AP より大きく）
const BAND = {       // レイヤー id → 地面の帯: base 地面の上端 / lev 堤防の高さ / end 描く下端（手前のレイヤーに隠れる）/ haze かすみ
  2: { base: 52, lev: 1, end: 60, haze: 0.3 },
  3: { base: 59, lev: 3, end: 69, haze: 0.14 },
  4: { base: 68, lev: 6, end: SH, haze: 0 }
};
export const toX = (d, f) => Math.round((d - W / 2) * f + W / 2); // 走行距離 → レイヤー通しの x（layers.js の distAt の逆）

/* ---------- 計画: 橋ごとに1度だけ作る ---------- */
let planSeed = null; const plans = new Map();
function planOf(f) {
  if (planSeed !== state.seed) { planSeed = state.seed; plans.clear(); }
  let p = plans.get(f.n);
  if (!p) { p = makePlan(f); plans.set(f.n, p); if (plans.size > 8) plans.delete(plans.keys().next().value); }
  return p;
}
function makePlan(f) {
  const r = rng(hash32(f.h, 71, 0)), { a, b, len } = f, e = world((a + b) / 2);
  const urb = e.city + 0.75 * e.resi + 0.1 * e.suburb;
  const hard = urb > 0.42 + 0.16 * r();                        // 街なかの川: コンクリート護岸で、川幅いっぱいに水
  const lo = hard ? 14 : ri(r, 60, 90), cr = hard ? 6 : ri(r, 9, 14), li = hard ? ri(r, 24, 38) : ri(r, 44, 64);
  const frac = hard ? Math.min(1, 0.78 + 0.3 * r()) : 0.36 + 0.3 * r(); // 高水敷を含む幅のうち水面の割合
  const wd = len - 2 * li, slack = wd * (1 - frac), wa = a + li + slack * (0.5 + (r() - 0.5) * 0.8), wb = wa + wd * frac;
  const tone = RIVER[hard ? (r() < 0.6 ? 2 : 1) : (r() < 0.6 ? 0 : 1)];
  const q = r(), span = q < 0.22 ? 'none' : q < 0.42 ? 'far' : q < 0.74 ? 'girder' : 'arch'; // 遠くに架かる別の橋
  return { f, h: f.h, a, b, len, hard, lo, cr, li, wa, wb, tone, span, spanCol: pick(r, SPAN_PAINT), items: {}, truss: null };
}
const bridgesIn = (L, i) => featuresIn(distAt(L, i, 0) - REACH, distAt(L, i, L.cw) + REACH).filter(f => f.type === 'bridge').map(planOf);

/* ---------- 遠景・中景・近景: 川の帯 ---------- */
export function riverBand(g, L, i) {
  for (const p of bridgesIn(L, i)) { band(g, L, i * L.cw, p); drawItems(g, L, i * L.cw, p); }
}
function band(g, L, ox, p) {
  const id = L.id, { base, lev, end, haze } = BAND[id], f = L.f, cw = L.cw;
  const H = c => haze ? hz(c, haze) : c, X = d => toX(d, f);
  // 川の上に立っていた建物・木を消して奥を見通す（遠景は残す: 川の先の街並み）
  if (id !== 2) { const x0 = Math.max(0, X(p.a - p.cr) - ox), x1 = Math.min(cw, X(p.b + p.cr) - ox); if (x1 > x0) g.clearRect(x0, 0, x1 - x0, SH); }
  const sun = H(LEVEE[0]), dark = H(LEVEE[1]), sunD = H(shade(LEVEE[0], 0.14)), darkD = H(shade(LEVEE[1], 0.14)), road = H(PATH);
  const wall = H(REVET), wallD = H(REVET_D), wallL = H(tint(REVET, 0.3)), wallS = H(shade(REVET_D, 0.16)), rail = H('#66726e');
  const plain = H(p.hard ? tint(REVET, 0.12) : GRASS[0]), plainD = H(p.hard ? REVET_D : shade(GRASS[0], 0.14)), plainL = H(p.hard ? tint(REVET, 0.3) : tint(GRASS[0], 0.14));
  const gravel = H(GRAVEL), gravelD = H(shade(GRAVEL, 0.14));
  const tone = p.tone, toneD = tone.map(c => shade(c, 0.1)), refl = mix(tone[0], H(p.hard ? '#8a9aa2' : '#7f9f78'), 0.45);
  const cell = id === 2 ? 2 : id === 3 ? 3 : 4, gl = id === 2 ? 6 : id === 3 ? 5 : 3, gpx = p.hard ? 0 : id === 4 ? 5 : id === 3 ? 3 : 1;
  const xwa = X(p.wa), xwb = X(p.wb), wobA = [], wobB = [];
  for (let y = base; y < end; y++) { // 水ぎわのゆらぎ（2行ごと。街なかの川はまっすぐ）
    wobA[y] = p.hard ? 0 : (hash32(p.h, 75 + id, y >> 1) % 5) - 2; wobB[y] = p.hard ? 0 : (hash32(p.h, 85 + id, y >> 1) % 5) - 2;
  }
  const x0 = Math.max(0, X(p.a - p.lo) - 1 - ox), x1 = Math.min(cw, X(p.b + p.lo) + 2 - ox);
  for (let x = x0; x < x1; x++) {
    const gx = ox + x, d = (gx - W / 2) / f + W / 2, left = d - p.a < p.b - d, s = left ? d - p.a : p.b - d;
    if (s < -p.lo) continue;
    if (s < p.li) { // 堤防
      const outer = s < -p.cr, crest = !outer && s <= p.cr;
      const hgt = outer ? (s + p.lo) / (p.lo - p.cr) : crest ? 1 : 1 - (s - p.cr) / (p.li - p.cr);
      const top = base - Math.round(hgt * lev);
      if (p.hard) {
        R(g, x, top, 1, end - top, outer ? wallS : crest ? wall : wallD);
        if (crest) { R(g, x, top, 1, 1, wallL); if (id === 4) { R(g, x, top - 3, 1, 1, rail); if (gx % 6 === 0) R(g, x, top - 2, 1, 2, rail); } else if (id === 3 && (gx & 1)) R(g, x, top - 1, 1, 1, rail); }
        else if (!outer) for (let y = top; y < end; y++) if (y % 3 === 0 || gx % (id === 4 ? 12 : 7) === 0) R(g, x, y, 1, 1, wall); // のり面の目地
      } else {
        const lit = outer === left; // 日は左から
        R(g, x, top, 1, end - top, lit ? sun : dark);
        for (let y = top; y < end; y++) if (hash32(gx, 77 + id, y) % 9 === 0) R(g, x, y, 1, 1, lit ? sunD : darkD);
        if (crest) R(g, x, top, 1, 1, road);
      }
      continue;
    }
    for (let y = base; y < end; y++) { // 高水敷と水面
      const wl = xwa + wobA[y], wr = xwb - wobB[y];
      let c;
      if (gx >= wl && gx < wr) {
        let k = y < 55 ? 0 : y < 61 ? 1 : y < 69 ? 2 : 3;
        if ((y === 55 || y === 61 || y === 69) && ((gx + y) & 1)) k--; // 段の境目は市松で混ぜる
        const q = hash32(p.h + y, 73 + id, Math.floor(gx / cell)) % 64;
        c = y === 52 ? refl : q < gl ? GLINT : q < gl + 5 ? toneD[k] : tone[k];
      } else {
        const dw = gx < wl ? wl - gx : gx - wr + 1, q = hash32(gx, 78 + id, y) % 23;
        c = dw <= gpx ? (q < 3 ? gravelD : gravel) : p.hard ? (y % 4 === 0 || gx % 9 === 0 ? plainD : plain) : q < 3 ? plainD : q === 5 ? plainL : plain;
      }
      R(g, x, y, 1, 1, c);
    }
  }
}

/* ---------- 川の小物: 計画の一部として、レイヤーごとに1度だけ決める（x はレイヤー通し座標） ---------- */
function itemsOf(p, L) { return p.items[L.id] || (p.items[L.id] = buildItems(p, L)); }
function buildItems(p, L) {
  const r = rng(hash32(p.h, 72, L.id)), id = L.id, X = d => toX(d, L.f), out = [];
  const sd = () => Math.floor(r() * 4294967296);
  const plains = [[X(p.a + p.li), X(p.wa), 1], [X(p.wb), X(p.b - p.li), -1]]; // 高水敷 [x0, x1, 水のある向き]
  const wx0 = X(p.wa), ww = X(p.wb) - wx0;
  if (id === 4) {
    for (const [x0, x1, dir] of plains) {
      const w = x1 - x0, t = r(), u = r(), v = r();
      if (p.hard) { if (w >= 14 && t < 0.7) out.push({ t: 'planter', x: x0 + 3 + Math.floor(u * (w - 10)), seed: sd() }); continue; }
      if (w >= 44) out.push({ t: 'path', x: dir > 0 ? x0 + 3 : x1 - 7 });
      if (w >= 84 && t < 0.6) out.push({ t: u < 0.55 ? 'ball' : 'pitch', x: x0 + 14 + Math.floor(v * (w - 84)), dir });
      else if (w >= 24) for (let k = Math.min(3, 1 + Math.floor(u * w / 30)); k > 0; k--) out.push({ t: r() < 0.6 ? 'tree' : 'bush', x: x0 + 8 + Math.floor(r() * (w - 22)), s: r() < 0.4 ? 2 : 1, b: 69, seed: sd() });
      if (w >= 12) out.push({ t: 'reeds', x: dir > 0 ? x1 : x0, dir, seed: sd() });
    }
    if (!p.hard) for (const dd of [p.a, p.b]) if (r() < 0.55) out.push({ t: 'tree', x: X(dd) - 6, s: 2, b: 63, seed: sd() }); // 堤防の上の木
    if (ww >= 60 && r() < (p.hard ? 0.55 : 0.4)) out.push({ t: p.hard ? 'yakata' : 'boat', x: wx0 + 12 + Math.floor(r() * (ww - 44)), y: 71 + ri(r, 0, 2) });
    if (!p.hard && ww >= 110 && r() < 0.5) { const w = ri(r, 26, 44); out.push({ t: 'bar', x: wx0 + 20 + Math.floor(r() * (ww - 40 - w)), y: 70 + ri(r, 0, 2), w, seed: sd() }); }
  } else if (id === 3) {
    if (p.span === 'girder' || p.span === 'arch') out.push({ t: p.span, x0: X(p.a - p.cr), x1: X(p.b + p.cr), seed: sd() });
    if (!p.hard) {
      for (const [x0, x1] of plains) { const w = x1 - x0; if (w >= 10) for (let k = Math.floor(r() * Math.min(4, w / 10)); k > 0; k--) out.push({ t: 'mtree', x: x0 + Math.floor(r() * (w - 6)), b: 60, seed: sd() }); }
      for (const dd of [p.a, p.b]) if (r() < 0.6) out.push({ t: 'mtree', x: X(dd) - 3, b: 57, seed: sd() });
      if (ww >= 50 && r() < 0.6) { const w = ri(r, 14, 26); out.push({ t: 'bar', x: wx0 + 8 + Math.floor(r() * (ww - 16 - w)), y: 61 + ri(r, 0, 3), w, seed: sd() }); }
    }
    if (ww >= 40 && r() < 0.3) out.push({ t: 'boat', x: wx0 + 6 + Math.floor(r() * (ww - 20)), y: 63 + ri(r, 0, 2), small: true });
  } else if (p.span === 'far') out.push({ t: 'farspan', x0: X(p.a - p.cr), x1: X(p.b + p.cr) });
  return out;
}
function drawItems(g, L, ox, p) {
  const cw = L.cw, T = (x, y, w, h, c) => R(g, x - ox, y, w, h, c);
  for (const it of itemsOf(p, L)) {
    if (it.x0 !== undefined ? (it.x1 < ox - 4 || it.x0 > ox + cw + 4) : (it.x < ox - 80 || it.x > ox + cw + 80)) continue;
    ITEM[it.t](T, it, p, g, ox, cw);
  }
}
const ITEM = {
  path(T, it) { // 高水敷を川に沿って走る道（奥へ続くので、帯の中では縦の筋になる）
    T(it.x + 1, 68, 2, 3, PATH); T(it.x, 71, 3, 5, PATH); T(it.x, 76, 4, 4, PATH); T(it.x + 3, 72, 1, 4, shade(PATH, 0.14));
  },
  ball(T, it) { // 野球のグラウンド: 土の内野、バックネット、ベンチ
    const x = it.x, w = 56, hx = it.dir > 0 ? x - 4 : x + w + 3, net = '#5c6f66';
    T(x + 4, 70, w - 8, 1, DIRT); T(x, 71, w, 4, DIRT); T(x + 3, 75, w - 6, 1, DIRT);
    T(x + 6, 73, w - 12, 1, tint(DIRT, 0.45)); T(x + (w >> 1), 71, 2, 1, tint(DIRT, 0.45)); T(x + 2, 74, 4, 1, shade(DIRT, 0.14));
    for (let y = 60; y < 69; y++) for (let k = (y & 1); k < 9; k += 2) T(hx - 4 + k, y, 1, 1, net);
    T(hx - 4, 59, 9, 1, net); T(hx - 4, 59, 1, 11, net); T(hx + 4, 59, 1, 11, net);
    T(x + (it.dir > 0 ? 12 : w - 22), 69, 10, 1, '#3f6f9f');
  },
  pitch(T, it) { // サッカー場: 白線とゴール
    const x = it.x, w = 60, c = '#eef0e6';
    T(x, 70, w, 1, c); T(x, 76, w, 1, c); T(x, 70, 1, 7, c); T(x + w - 1, 70, 1, 7, c); T(x + (w >> 1), 70, 1, 7, c);
    for (const gx of [x - 2, x + w - 2]) { T(gx, 66, 4, 1, c); T(gx, 66, 1, 5, c); T(gx + 3, 66, 1, 5, c); }
  },
  tree(T, it, p, g, ox) { tree(g, rng(it.seed), it.x - ox, it.b, it.s); },
  bush(T, it, p, g, ox) { bush(g, rng(it.seed), it.x - ox, it.b); },
  mtree(T, it, p, g, ox) { midTree(g, rng(it.seed), it.x - ox, it.b); },
  reeds(T, it) { // 水ぎわのヨシ: 奥の縁に立つ穂と、岸に沿った株
    const r = rng(it.seed);
    for (let k = 0; k < 9; k++) { const x = it.x - it.dir * ri(r, 1, 18), h = ri(r, 1, 4); T(x, 68 - h, 1, h + 1, pick(r, REED)); }
    for (let k = 0; k < 7; k++) T(it.x - it.dir * ri(r, 2, 8), ri(r, 69, 78), 2, 1, pick(r, REED));
  },
  bar(T, it) { // 中州: 砂利に草
    const { x, y, w } = it, r = rng(it.seed);
    T(x + 3, y, w - 7, 1, tint(GRAVEL, 0.25)); T(x, y + 1, w, 1, GRAVEL); T(x + 2, y + 2, w - 5, 1, shade(GRAVEL, 0.16));
    const gw = Math.round(w * (0.3 + 0.3 * r())), gx = x + 4 + Math.floor(r() * (w - gw - 6));
    T(gx, y, gw, 1, GRASS[1]); T(gx + 1, y - 1, gw - 3, 1, GRASS[0]);
    for (let k = 0; k < 3; k++) T(gx + ri(r, 1, gw - 2), y - 2, 1, 1, REED[1]);
    if (w > 20 && r() < 0.6) { const bx = x + w - 6; T(bx, y - 2, 1, 2, '#f4f4ee'); T(bx + 1, y - 2, 1, 1, '#f4f4ee'); } // 白い鳥
  },
  boat(T, it, p) { // 小舟と釣り人
    const { x, y } = it, w = it.small ? 6 : 10;
    T(x, y, w, 1, '#6a5445'); T(x + 1, y + 1, w - 2, 1, '#4b3a2f'); T(x + 1, y + 2, w - 2, 1, shade(p.tone[2], 0.2));
    if (!it.small) { T(x + 4, y - 3, 2, 3, '#3f5f7f'); T(x + 4, y - 4, 2, 1, '#e3b58f'); T(x + 3, y - 5, 4, 1, '#d8cfa8'); T(x + 6, y - 3, 3, 1, '#4b3a2f'); }
    else T(x + 2, y - 1, 1, 1, '#3f5f7f');
  },
  yakata(T, it, p) { // 屋形船
    const { x, y } = it;
    T(x, y, 24, 1, '#3d3a36'); T(x + 2, y + 1, 20, 1, '#2a2826'); T(x + 2, y + 2, 20, 1, shade(p.tone[3], 0.22));
    T(x + 4, y - 3, 16, 3, '#e6dcc0'); T(x + 3, y - 4, 18, 1, '#4a5560');
    for (let k = 0; k < 5; k++) { T(x + 5 + 3 * k, y - 2, 2, 1, '#5b7389'); T(x + 5 + 3 * k, y - 1, 1, 1, '#c94f3f'); }
  },
  planter(T, it) { // 護岸のテラスの植え込み
    T(it.x, 67, 7, 2, GRASS[1]); T(it.x + 1, 66, 5, 1, GRASS[1]); T(it.x + 1, 66, 2, 1, tint(GRASS[1], 0.25)); T(it.x, 69, 7, 1, REVET_D);
  },
  girder(T, it, p, g, ox, cw) { spanBridge(T, it, p, ox, cw, false); },
  arch(T, it, p, g, ox, cw) { spanBridge(T, it, p, ox, cw, true); },
  farspan(T, it) { // 遠景: ずっと先に架かる橋の細い線
    const c = hz('#6a767c', 0.4), w = it.x1 - it.x0, n = Math.max(2, Math.round(w / 9));
    T(it.x0, 51, w, 1, c);
    for (let k = 1; k < n; k++) T(it.x0 + Math.round(k * w / n), 52, 1, 2, c);
  }
};
/* 中景: 川に並行して架かる道路橋（桁橋 / アーチ橋）。路面は堤防の天端の高さ */
function spanBridge(T, it, p, ox, cw, arch) {
  const { x0, x1 } = it, w = x1 - x0, r = rng(it.seed), conc = hz(CONC, 0.2), dk = hz('#5c676c', 0.2), col = hz(it.t === 'arch' ? p.spanCol : '#8d979a', 0.06);
  const n = Math.max(1, Math.round(w / (arch ? 96 : 44))), px = k => x0 + Math.round(k * w / n);
  for (let k = 1; k < n; k++) { T(px(k), 57, 2, 4, conc); T(px(k) + 2, 57, 1, 4, shade(conc, 0.2)); T(px(k) - 1, 61, 4, 1, shade(p.tone[1], 0.16)); }
  if (arch) for (let k = 0; k < n; k++) { // 径間ごとに、路面の上へ立ち上がるアーチと吊り材
    const s0 = px(k) + 1, s1 = px(k + 1), sw = s1 - s0, rise = Math.min(12, Math.round(sw / 7)), yOf = gx => { const t = (2 * (gx - s0) + 1) / sw - 1; return 55 - Math.round(rise * (1 - t * t)); };
    for (let gx = Math.max(s0, ox - 2); gx < Math.min(s1, ox + cw + 2); gx++) {
      const y = yOf(gx), yn = gx + 1 < s1 ? yOf(gx + 1) : 55, yp = gx > s0 ? yOf(gx - 1) : 55, yb = Math.max(y + 1, Math.min(55, Math.max(yn, yp)));
      T(gx, y, 1, yb - y, col);
      if ((gx - s0) % 6 === 3 && y < 53) T(gx, yb, 1, 55 - yb, mix(col, HAZE, 0.45));
    }
  } else for (let k = 0; k <= n; k++) if (k % 2 === 1) { T(px(k) - 1, 51, 1, 4, dk); T(px(k) - 1, 51, 3, 1, dk); } // 街灯
  T(x0, 55, w, 1, arch ? col : hz('#c9cdc8', 0.14)); T(x0, 56, w, 1, dk);
  for (let k = ri(r, 2, 4); k > 0; k--) T(x0 + ri(r, 4, Math.max(4, w - 8)), 54, ri(r, 2, 3), 1, hz(pick(r, SIGN), 0.2)); // 車
}

/* ---------- 線路際（視差 1.0）: 取り付け・橋台・隣の線路の桁 ---------- */
export function bridgeTrack(g, L, i) {
  const cw = L.cw, ox = i * cw, T = (x, y, w, h, c) => R(g, x - ox, y, w, h, c);
  for (const p of bridgesIn(L, i)) {
    const xa = toX(p.a, 1), xb = toX(p.b, 1), col = trussOf(p).paint, gd = shade(col, 0.26), g0 = LEVEE[0], g1 = shade(g0, 0.14);
    // 取り付け: 堤防へ上る斜面（街なかはコンクリートの擁壁が段になって上がる）
    for (let k = 1; k <= AP; k++) for (const gx of [xa - k, xb - 1 + k]) {
      if (gx < ox || gx >= ox + cw) continue;
      const t = 1 - k / AP;
      if (p.hard) {
        const top = 76 - 2 * Math.round(3 * t);
        T(gx, top, 1, SH - top, REVET_D); T(gx, top, 1, 1, tint(REVET, 0.3)); if (gx % 14 === 0) T(gx, top + 1, 1, SH - top, shade(REVET_D, 0.12));
      } else {
        const top = 76 - Math.round(6 * t);
        T(gx, top, 1, SH - top, g0); T(gx, top, 1, 1, tint(g0, 0.15));
        for (let y = top + 1; y < SH; y++) if (hash32(gx, 79, y) % 7 === 0) T(gx, y, 1, 1, g1);
        if (hash32(gx, 80, 0) % 5 === 0) T(gx, top - 1 - (hash32(gx, 80, 1) & 1), 1, 2, g0); // 草の穂先
      }
    }
    // 橋の区間: もとの壁・生垣を消して、隣の線路の桁と手すり
    const c0 = Math.max(ox, xa), c1 = Math.min(ox + cw, xb);
    if (c1 > c0) {
      g.clearRect(c0 - ox, 0, c1 - c0, SH);
      T(c0, 70, c1 - c0, 1, '#59635f');
      T(c0, 74, c1 - c0, 1, '#737c7c'); T(c0, 75, c1 - c0, 1, tint(col, 0.2)); T(c0, 76, c1 - c0, 4, gd); T(c0, 79, c1 - c0, 1, shade(gd, 0.2));
      for (let gx = c0; gx < c1; gx++) { const m = (gx - xa) % 16; if (m === 8) T(gx, 70, 1, 4, '#59635f'); if ((gx - xa) % 32 === 0) T(gx, 76, 1, 3, shade(gd, 0.2)); }
    }
    // 橋台
    for (const [x, dir] of [[xa, 1], [xb, -1]]) {
      const x0 = dir > 0 ? x - 12 : x - 3;
      T(x0, 68, 15, SH - 68, CONC); T(x0, 68, 15, 1, tint(CONC, 0.4)); T(dir > 0 ? x0 + 14 : x0, 69, 1, SH - 69, shade(CONC, 0.2));
      T(x0 + 4, 71, 7, 2, shade(CONC, 0.12)); T(dir > 0 ? x : x - 3, 73, 3, 2, '#4a5458'); // 橋名板、支承
    }
  }
}

/* ---------- トラス（視差 TRUSS_F）: 窓のすぐ外を横切る鉄骨 ----------
   形式: 0 ワーレン / 1 垂直材入りワーレン / 2 プラット。low は上弦材が窓の上端に見える低いトラス、
   そうでなければ上弦材は窓より上で、斜材だけが横切る。長い橋は 2〜3 径間に分け、径間ごとに斜めの端柱で始まり・終わる */
function trussOf(p) {
  if (p.truss) return p.truss;
  const r = rng(hash32(p.h, 74, 0)), paint = pick(r, TRUSS_PAINT), form = Math.floor(r() * 3), low = r() < 0.4;
  const XA = toX(p.a, TRUSS_F), XB = toX(p.b, TRUSS_F), n = p.len < 1000 ? 1 : p.len < 1500 ? 2 : 3, GAPX = 26;
  const sw = (XB - XA - GAPX * (n - 1)) / n, yT = low ? 6 : -14, yB = 75, run = (form === 2 ? 106 : 98) * (low ? 0.78 : 1);
  const spans = [];
  for (let k = 0; k < n; k++) {
    const x0 = Math.round(XA + k * (sw + GAPX)), x1 = Math.round(XA + k * (sw + GAPX) + sw);
    const m = Math.max(2, Math.round((x1 - x0) / (2 * run))), N = 2 * m, P = (x1 - x0) / N, nx = j => Math.round(x0 + j * P);
    const di = [], ve = [], bn = [], tn = []; // 斜材 [下の x, 上の x, 太さ]、垂直材の x、下・上の格点 [x, 左に斜材, 右に斜材]
    if (form < 2) {
      for (let j = 0; j < m; j++) {
        di.push([nx(2 * j), nx(2 * j + 1), j === 0 ? 9 : 7], [nx(2 * j + 2), nx(2 * j + 1), j === m - 1 ? 9 : 7]);
        tn.push([nx(2 * j + 1), true, true]); if (form === 1) ve.push(nx(2 * j + 1));
      }
      for (let j = 0; j <= m; j++) bn.push([nx(2 * j), j > 0, j < m]);
    } else {
      di.push([nx(0), nx(1), 9], [nx(N), nx(N - 1), 9]);
      for (let j = 1; j < N; j++) ve.push(nx(j));
      for (let j = 1; j < m; j++) di.push([nx(j + 1), nx(j), 7]);     // 左半分: 上の格点 j から下の格点 j+1 へ
      for (let j = m; j < N - 1; j++) di.push([nx(j), nx(j + 1), 7]); // 右半分は逆向き
      for (let j = 0; j <= N; j++) bn.push([nx(j), j === N || (j >= 2 && j <= m), j === 0 || (j >= m && j <= N - 2)]);
      for (let j = 1; j < N; j++) tn.push([nx(j), j === 1 || j > m, j === N - 1 || j < m]);
    }
    spans.push({ x0, x1, di, ve, bn, tn, slope: P / (yB - yT) });
  }
  return (p.truss = { paint, form, low, yT, yB, spans });
}
export function drawTruss(g, i, r, L) {
  const cw = L.cw, ox = i * cw;
  const T = (x, y, w, h, c) => { if (x + w > ox && x < ox + cw) R(g, x - ox, y, w, h, c); };
  for (const p of bridgesIn(L, i)) {
    const t = trussOf(p), { yT, yB } = t, c = t.paint, hi = tint(c, 0.34), lo = shade(c, 0.38), plate = tint(c, 0.1), riv = shade(c, 0.2);
    const y0 = Math.max(0, yT);
    const gusset = (x, l, rr, ya, yb, off) => { // 格点のガセット: 斜材の来る側へ広がる板とリベット
      for (let y = ya; y <= yb; y++) {
        const o = Math.round(off(y)), xl = x - 5 - (l ? o : 0), xr = x + 5 + (rr ? o : 0);
        T(xl, y, xr - xl + 1, 1, plate); T(xl, y, 1, 1, hi); T(xr, y, 1, 1, lo);
        if (y & 1) for (let gx = xl + 2; gx < xr - 1; gx += 3) T(gx, y, 1, 1, riv);
      }
    };
    t.spans.forEach((s, k) => {
      if (s.x1 < ox - 40 || s.x0 > ox + cw + 40) return;
      const a0 = Math.max(s.x0, ox - 8), a1 = Math.min(s.x1, ox + cw + 8);
      if (t.low) { // 上弦材
        const u0 = s.tn[0][0] - 7, u1 = s.tn[s.tn.length - 1][0] + 7;
        T(u0, 3, u1 - u0, 7, c); T(u0, 3, u1 - u0, 1, hi); T(u0, 8, u1 - u0, 2, lo);
        for (let gx = Math.max(u0, a0); gx < Math.min(u1, a1); gx++) if ((gx - s.x0) % 5 === 2) T(gx, 5, 1, 1, riv);
      }
      for (const x of s.ve) { // 垂直材
        T(x - 2, y0, 5, yB - y0, c); T(x - 2, y0, 1, yB - y0, hi); T(x + 1, y0, 2, yB - y0, lo);
        for (let y = y0 + 2; y < yB; y += 4) T(x - 1, y, 1, 1, riv);
      }
      for (const [xb, xt, w] of s.di) { // 斜材・端柱
        if (Math.max(xb, xt) < ox - 12 || Math.min(xb, xt) > ox + cw + 12) continue;
        for (let y = y0; y <= yB; y++) {
          const x = Math.round(xb + (xt - xb) * (yB - y) / (yB - yT)) - (w >> 1);
          T(x, y, w, 1, c); T(x, y, 1, 1, hi); T(x + w - 2, y, 2, 1, lo);
          if (y % 4 === 1) T(x + 2, y, 1, 1, riv);
          if (w > 7 && y % 4 === 3) T(x + w - 4, y, 1, 1, riv);
        }
      }
      // 下弦材
      T(s.x0 - 5, 74, s.x1 - s.x0 + 10, 6, c); T(s.x0 - 5, 74, s.x1 - s.x0 + 10, 1, hi); T(s.x0 - 5, 78, s.x1 - s.x0 + 10, 2, lo);
      for (let gx = a0; gx < a1; gx++) if ((gx - s.x0) % 4 === 1) T(gx, 76, 1, 1, riv);
      for (const [x, l, rr] of s.bn) gusset(x, l, rr, 67, 73, y => (yB - y) * s.slope);
      if (t.low) for (const [x, l, rr] of s.tn) gusset(x, l, rr, 10, 15, y => (y - yT) * s.slope);
      // 径間の間（橋脚の上）: 低い桁でつなぐ
      const nx = t.spans[k + 1];
      if (nx) { T(s.x1 + 5, 76, nx.x0 - s.x1 - 10, 4, lo); T(s.x1 + 5, 76, nx.x0 - s.x1 - 10, 1, c); }
    });
  }
}

/* ---------- main.js の render() 用 ---------- */
/* 窓の中央の走行距離 d の近くに橋があるか（トラスの層を描くかどうか） */
export function bridgeNear(d) { const f = featureNear(d, 130); return !!f && f.type === 'bridge'; }
/* 架線柱（視差 1.2 の通し座標 x）が橋の上に当たるか。橋の上では柱を立てない（架線はトラスから吊る） */
export function poleOnBridge(x) {
  const d = (x - W / 2) / 1.2 + W / 2, f = featureNear(d, 0);
  return !!f && f.type === 'bridge' && d > f.a + 8 && d < f.b - 8;
}
