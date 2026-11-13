import { ri, pick } from '../rng.js';
import { R, shade, tint, ink, win, BODY, BODY_LIGHT, GLASS, SIGN, AWN, WIN_D, WIN_M, WIN_L } from '../palette.js';
import { hz } from './common.js';

/* ---------- 都心: 遠景のビル群、中景のビル、近景の高層・オフィス・雑居ビル・マンション ---------- */

/* ---------- far skyline ---------- */
const F1 = hz('#6f8aa8', 0.5), F2 = hz('#7f93a8', 0.42), F3 = hz('#566f8c', 0.45), FW = hz('#4a6585', 0.5);
export function farTower(g, r, x, base, w, h) {
  const c = r() < 0.5 ? F1 : F2;
  R(g, x, base - h, w, h, c); R(g, x + w - 1, base - h, 1, h, F3);
  if (h > 10 && w > 4 && r() < 0.55) for (let y = base - h + 2; y < base - 1; y += 3) R(g, x + 1, y, w - 3, 1, FW);
  if (h > 20 && r() < 0.3) { const ah = ri(r, 3, 6); R(g, x + (w >> 1), base - h - ah, 1, ah, F3); }
}

/* ---------- mid-distance buildings ---------- */
export function midBlock(g, r, x, base, w, h) {
  const c = hz(pick(r, BODY), 0.48), wd = hz(WIN_D, 0.42), top = base - h, m = 2, st = 3, pw = 2, ph = 1;
  R(g, x, top, w, h, c); R(g, x, top, 1, h, tint(c, 0.25)); R(g, x, top, w, 1, tint(c, 0.25));
  R(g, x + w - m, top, m, h, shade(c, 0.16));
  if (w > 5) {
    if (r() < 0.5) { for (let y = top + 2; y + ph < base - 1; y += st) for (let xx = x + m; xx + pw <= x + w - m - 1; xx += st) R(g, xx, y, pw, ph, wd); }
    else {
      const bs = 4, bh2 = 2;
      for (let y = top + 2; y + bh2 < base - 1; y += bs) R(g, x + m, y, w - 2 * m - 1, bh2, wd);
    }
  }
  if (h > 12 && r() < 0.5) R(g, x + ri(r, 1, Math.max(1, w - 6)), top - 2, ri(r, 3, 5), 2, shade(c, 0.12));
  if (h > 18 && r() < 0.25) { const ah = ri(r, 4, 7); R(g, x + ri(r, 2, Math.max(2, w - 3)), top - ah, 1, ah, shade(c, 0.3)); }
}

/* ---------- near buildings ---------- */
function tank(g, px, top) {
  const tw = 4, th = 3, leg = 2;
  R(g, px, top - leg - th, tw, th, '#bcc7cc'); R(g, px, top - leg - th, tw, 1, '#dfe6e9');
  R(g, px, top - leg, 1, leg, '#6c7275'); R(g, px + tw - 1, top - leg, 1, leg, '#6c7275');
}
function roofStuff(g, r, x, top, w, c) {
  if (w < 10) return;
  const t = r();
  if (t < 0.35) {
    const pw = ri(r, 4, Math.max(4, (w / 3) | 0)), ph = ri(r, 3, 5), px = x + ri(r, 1, Math.max(1, w - pw - 2));
    R(g, px, top - ph, pw, ph, shade(c, 0.14)); R(g, px, top - ph, pw, 1, tint(c, 0.2));
  } else if (t < 0.55) {
    tank(g, x + ri(r, 2, Math.max(2, w - 7)), top);
  } else if (t < 0.72) {
    const bw = Math.min(w - 4, ri(r, 9, 16)), bh = 7, leg = 2, bx = x + ri(r, 1, Math.max(1, w - bw - 2)), sc = pick(r, SIGN), lh = 1;
    R(g, bx + 1, top - leg, 1, leg, '#5d6266'); R(g, bx + bw - 2, top - leg, 1, leg, '#5d6266');
    R(g, bx, top - leg - bh, bw, bh, sc);
    R(g, bx + 2, top - leg - bh + 2, bw - 5, lh, tint(sc, 0.75));
    R(g, bx + 2, top - leg - bh + 4, (bw / 2) | 0, lh, tint(sc, 0.75));
  }
  if (r() < 0.3) { const ah = ri(r, 4, 8); R(g, x + ri(r, 2, w - 3), top - ah, 1, ah, '#565b5e'); }
}
function bOffice(g, r, x, b, w, h) {
  const c = pick(r, BODY), hi = tint(c, 0.25), sh = shade(c, 0.28), top = b - h, m = 2;
  R(g, x, top, w, h, c); R(g, x, top, 1, h, hi); R(g, x + w - m, top, m, h, sh); R(g, x, top, w, 1, hi);
  const fh = r() < 0.5 ? 5 : 6, wh = fh - 3, pw = ri(r, 3, 6), gf = 6, xe = x + w - m - 1;
  for (let y = top + 3; y + wh < b - gf; y += fh) {
    R(g, x + m, y, xe - x - m, wh, WIN_D);
    for (let xx = x + m; xx < xe; xx += pw + 1) {
      const cwid = Math.min(pw, xe - xx), t = r();
      if (t < 0.25) R(g, xx, y, cwid, wh, t < 0.12 ? WIN_M : WIN_L);
      if (xx + pw < xe) R(g, xx + pw, y, 1, wh, c);
    }
  }
  R(g, x + 1, b - 5, w - m - 1, 5, shade(c, 0.5));
  if (r() < 0.6) R(g, x + 1, b - 6, w - m - 1, 1, pick(r, AWN));
  win(g, x + 3, b - 4, Math.min(w - 6, ri(r, 3, 7)), 4, WIN_L);
  ink(g, x, top, w, h);
  roofStuff(g, r, x, top, w, c);
}
function bGlass(g, r, x, b, w, h) {
  const s = pick(r, GLASS), top = b - h, a = top + ((h * 0.3) | 0), z = top + ((h * 0.68) | 0), side = 3, mx = 4, my = 5;
  R(g, x, top, w, h, s[0]); R(g, x, top, w, a - top, s[1]); R(g, x, z, w, b - z, s[2]);
  for (let xx = x; xx < x + w; xx += 2) { R(g, xx, a, 1, 1, s[1]); R(g, xx + 1, a + 1, 1, 1, s[1]); R(g, xx, z - 1, 1, 1, s[2]); R(g, xx + 1, z - 2, 1, 1, s[2]); }
  const mull = shade(s[0], 0.28);
  for (let xx = x + 3; xx < x + w - side; xx += mx) R(g, xx, top, 1, h, mull);
  for (let y = top + 4; y < b; y += my) R(g, x, y, w, 1, shade(s[0], 0.14));
  R(g, x, top, 1, h, tint(s[1], 0.35)); R(g, x + w - side, top, side, h, shade(s[2], 0.25));
  R(g, x, top, w, 2, shade(s[2], 0.35)); R(g, x + 2, top - 3, w - 6, 3, shade(s[0], 0.4));
  R(g, x + (w >> 1), top - 10, 1, 7, '#565b5e');
  R(g, x + 1, b - 6, w - side - 1, 6, shade(s[2], 0.45)); win(g, x + 3, b - 5, w - 8, 4, WIN_L);
  ink(g, x, top, w, h);
}
export function bMansion(g, r, x, b, w, h) {
  const c = pick(r, BODY_LIGHT), top = b - h, sw = 4, left = r() < 0.5;
  const fl = 6, rec = 3, rail = 2, cell = 4, ww = 2;
  R(g, x, top, w, h, c); R(g, x, top, w, 1, tint(c, 0.3)); R(g, x + w - 1, top, 1, h, shade(c, 0.22));
  const sx = left ? x : x + w - sw - 1, bx = left ? x + sw + 1 : x + 1, bw = w - sw - 3;
  R(g, sx, top, sw, h, shade(c, 0.14)); ink(g, x, top, w, h);
  for (let y = top + 2; y + fl <= b - 1; y += fl) {
    R(g, sx + 1, y + 1, sw - 2, rec - 1, WIN_D);
    R(g, bx, y, bw, rec, WIN_D);
    for (let xx = bx; xx + cell - 1 <= bx + bw; xx += cell) R(g, xx + 1, y, ww, rec, r() < 0.2 ? '#d9d2b8' : WIN_M);
    R(g, bx, y + rec, bw, rail, tint(c, 0.35));
    R(g, bx, y + rec + rail, bw, fl - rec - rail, shade(c, 0.22));
    for (let xx = bx + 8 - 1; xx < bx + bw - 1; xx += 8) R(g, xx, y, 1, rec + rail, c);
    if (r() < 0.3) R(g, bx + ri(r, 0, Math.max(0, bw - 3)), y + rec, 2, 1, pick(r, ['#f2f2f6', '#e9a8a8', '#a8c4e9', '#e9d9a8']));
  }
  if (r() < 0.6 && w > 12) tank(g, x + ri(r, 2, w - 7), top);
}
export function bZakkyo(g, r, x, b, w, h) {
  const c = pick(r, BODY), top = b - h, signs = r() < 0.65, m = 2;
  R(g, x, top, w, h, c); R(g, x, top, 1, h, tint(c, 0.25)); R(g, x + w - m, top, m, h, shade(c, 0.28)); R(g, x, top, w, 1, tint(c, 0.25));
  const wx = signs ? x + 4 : x + m, ww = x + w - m - 1 - wx, fl = 7, wh = 4, sb = 2, sw = 3;
  for (let y = top + 3; y + fl - 1 < b - 2; y += fl) {
    win(g, wx, y, ww, wh, r() < 0.2 ? WIN_L : WIN_D);
    if (r() < 0.35) R(g, wx, y + wh, ww, sb, pick(r, SIGN));
    if (signs) {
      const sc = pick(r, SIGN), tc = tint(sc, 0.8);
      R(g, x, y - 1, sw, fl - 1, sc);
      for (let k = 1; k < fl - 2; k += 2) if (r() < 0.7) R(g, x + (sw >> 1), y - 1 + k, 1, 1, tc);
    }
  }
  R(g, x + 1, b - 5, w - m - 1, 5, shade(c, 0.5)); win(g, x + m, b - 4, w - 6, 4, WIN_L);
  ink(g, x, top, w, h);
  roofStuff(g, r, x, top, w, c);
}
/* 都心の近景: e.core（都心の中心寄り）が高いほどガラス張りの高層が増え、全体に背が高くなる。戻り値は使った幅 */
export function nearCity(g, r, x, b, rem, e) {
  const t = r(), hs = 0.6 + 0.4 * e.core, pg = 0.06 + 0.36 * e.core;
  const wr = (a, z) => Math.min(ri(r, a, z), rem), hr = (a, z) => Math.round(ri(r, a, z) * hs);
  let w;
  if (t < pg) { w = wr(24, 42); bGlass(g, r, x, b, w, hr(58, 108)); }
  else if (t < pg + 0.4) { w = wr(20, 38); bOffice(g, r, x, b, w, hr(36, 70)); }
  else if (t < pg + 0.6) { w = wr(10, 15); bZakkyo(g, r, x, b, w, hr(28, 50)); }
  else { w = wr(24, 44); bMansion(g, r, x, b, w, hr(30, 58)); }
  return w;
}
