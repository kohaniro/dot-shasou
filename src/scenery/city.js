import { SH } from '../state.js';
import { ri, pick } from '../rng.js';
import { R, mix, shade, tint, ink, win, ell, HAZE, BODY, BODY_LIGHT, GLASS, SIGN, AWN, HOUSE_WALL, ROOF, WIN_D, WIN_M, WIN_L, GREENS } from '../palette.js';
import { dens } from '../layers.js';

/* ---------- far skyline ---------- */
export function drawFar(g, i, r, L) {
  const cw = L.cw, base = 52;
  const c1 = mix('#6f8aa8', HAZE, 0.5), c2 = mix('#7f93a8', HAZE, 0.42), c3 = mix('#566f8c', HAZE, 0.45), cw1 = mix('#4a6585', HAZE, 0.5);
  R(g, 0, base, cw, SH - base, mix('#8fa3b3', HAZE, 0.35));
  let x = 0;
  while (x < cw) {
    const d = dens(L, i, x);
    if (r() < 0.25 - 0.2 * d) { x += ri(r, 2, 8); continue; }
    const w = Math.min(ri(r, 5, 14), cw - x);
    let h = Math.round((2 + d * d * 26) * (0.4 + r() * 0.9));
    if (d > 0.7 && r() < 0.14) h += ri(r, 8, 16);
    const c = r() < 0.5 ? c1 : c2;
    R(g, x, base - h, w, h, c); R(g, x + w - 1, base - h, 1, h, c3);
    if (h > 10 && w > 4 && r() < 0.55) for (let y = base - h + 2; y < base - 1; y += 3) R(g, x + 1, y, w - 3, 1, cw1);
    if (h > 20 && r() < 0.3) { const ah = ri(r, 3, 6); R(g, x + (w >> 1), base - h - ah, 1, ah, c3); }
    x += w + (r() < 0.4 ? 1 : 0);
  }
}

/* ---------- mid-distance buildings ---------- */
export function drawMid(g, i, r, L) {
  const cw = L.cw, base = 59;
  R(g, 0, base, cw, SH - base, mix('#8a938f', HAZE, 0.35));
  for (let k = 0; k < 40; k++) { // 低い屋根の連なり
    const c = mix(pick(r, ROOF.concat(HOUSE_WALL)), HAZE, 0.5);
    R(g, ri(r, 0, cw - 8), base + ri(r, 0, 7), ri(r, 4, 9), ri(r, 1, 2), c);
  }
  const wd = mix(WIN_D, HAZE, 0.42);
  const st = 3, pw = 2, ph = 1;
  let x = 0;
  while (x < cw) {
    const d = dens(L, i, x);
    if (r() < 0.2 - 0.15 * d) { x += ri(r, 3, 10); continue; }
    const w = Math.min(ri(r, 9, 24), cw - x);
    const h = Math.round((5 + d * 42) * (0.5 + r() * 0.8));
    const c = mix(pick(r, BODY), HAZE, 0.48), top = base - h, m = 2;
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
    x += w + (r() < 0.4 ? ri(r, 1, 2) : 0);
  }
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
function bMansion(g, r, x, b, w, h) {
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
function bZakkyo(g, r, x, b, w, h) {
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
function bHouse(g, r, x, b, w) {
  const c = pick(r, HOUSE_WALL), rc = pick(r, ROOF), h = ri(r, 9, 13), rh = ri(r, 3, 5), top = b - h;
  R(g, x + 1, top, w - 2, h, c); R(g, x + w - 2, top, 1, h, shade(c, 0.2));
  for (let k = 0; k < rh; k++) R(g, x + (rh - 1 - k), top - rh + k, w - 2 * (rh - 1 - k), 1, k === 0 ? tint(rc, 0.25) : rc);
  R(g, x, top, w, 1, shade(rc, 0.3));
  win(g, x + 3, top + 2, 3, 2, WIN_D); if (w > 13) win(g, x + w - 7, top + 2, 3, 2, WIN_M);
  if (r() < 0.5) R(g, x + 2, top + 5, Math.min(8, w - 5), 2, tint(c, 0.4));
  R(g, x + 3, b - 4, 2, 4, '#5b4d47'); if (w > 12) win(g, x + w - 8, b - 4, 4, 2, WIN_D);
  ink(g, x + 1, top, w - 2, h);
}
function bShop(g, r, x, b, w) {
  const c = pick(r, BODY_LIGHT), sc = pick(r, SIGN), h = ri(r, 8, 11), top = b - h, sg = 3;
  R(g, x, top, w, h, c); R(g, x, top, w, sg, sc); R(g, x + 3, top + (sg >> 1), (w / 2) | 0, 1, tint(sc, 0.8));
  R(g, x + 2, top + sg + 1, w - 4, h - sg - 2, WIN_L);
  for (let xx = x + 6; xx < x + w - 3; xx += 6) R(g, xx, top + sg + 1, 1, h - sg - 2, c);
  R(g, x + ri(r, 2, Math.max(2, w - 7)), top - 2, 4, 2, '#aab1b3');
  R(g, x + w - 1, top, 1, h, shade(c, 0.25)); ink(g, x, top, w, h);
}
function tree(g, r, x, b, s) {
  const c = pick(r, GREENS), rx = s > 1 ? 5 : 3, ry = s > 1 ? 4 : 3, tr = 3, cxp = x + rx + 1, cy = b - tr - ry;
  R(g, cxp - 1, b - tr - 1, 2, tr + 1, '#6a5445');
  ell(g, cxp, cy, rx, ry, c);
  ell(g, cxp - Math.round(rx * 0.35), cy - Math.round(ry * 0.4), Math.max(1, Math.round(rx * 0.4)), Math.max(1, Math.round(ry * 0.35)), tint(c, 0.22));
  R(g, cxp, cy + ry - 1, rx - 1, 1, shade(c, 0.25));
}
function utilityPole(g, x, b) {
  R(g, x, b - 19, 1, 19, '#5a5650'); R(g, x - 2, b - 18, 5, 1, '#5a5650'); R(g, x - 2, b - 15, 5, 1, '#5a5650');
  R(g, x + 1, b - 12, 2, 3, '#8a8f8f');
}
function gapStuff(g, r, x, b, gw, d) {
  if (gw >= 12 && r() < 0.7) tree(g, r, x, b, 2);
  else if (gw >= 8 && r() < 0.6) tree(g, r, x, b, 1);
  else if (d < 0.7) utilityPole(g, x + (gw >> 1), b);
}
export function drawNear(g, i, r, L) {
  const cw = L.cw, base = 68;
  R(g, 0, base, cw, SH - base, '#8e9190');
  const wr = (a, b2, rem) => Math.min(ri(r, a, b2), rem), hr = (a, b2) => ri(r, a, b2);
  let x = 0;
  while (x < cw) {
    const d = dens(L, i, x), rem = cw - x;
    if (rem < 9) break;
    if (r() < 0.22 - 0.17 * d) { const gw = wr(5, 14, rem); gapStuff(g, r, x, base, gw, d); x += gw; continue; }
    const t = r(); let w;
    if (d > 0.68) {
      if (t < 0.4) { w = wr(24, 42, rem); bGlass(g, r, x, base, w, hr(58, 108)); }
      else if (t < 0.8) { w = wr(20, 38, rem); bOffice(g, r, x, base, w, hr(36, 70)); }
      else { w = wr(10, 15, rem); bZakkyo(g, r, x, base, w, hr(28, 50)); }
    } else if (d > 0.36) {
      if (t < 0.35) { w = wr(24, 44, rem); bMansion(g, r, x, base, w, hr(26, 56)); }
      else if (t < 0.6) { w = wr(18, 32, rem); bOffice(g, r, x, base, w, hr(22, 44)); }
      else if (t < 0.8) { w = wr(10, 15, rem); bZakkyo(g, r, x, base, w, hr(20, 38)); }
      else if (t < 0.9) { w = wr(20, 32, rem); bShop(g, r, x, base, w); }
      else { w = wr(14, 22, rem); bHouse(g, r, x, base, w); }
    } else {
      if (t < 0.55) { w = wr(14, 22, rem); bHouse(g, r, x, base, w); }
      else if (t < 0.7) { w = wr(20, 32, rem); bShop(g, r, x, base, w); }
      else if (t < 0.85) { w = wr(22, 36, rem); bMansion(g, r, x, base, w, hr(16, 28)); }
      else { w = Math.min(14, rem); tree(g, r, x, base, 2); }
    }
    x += w + (r() < 0.35 ? ri(r, 1, 2) : 0);
  }
}
