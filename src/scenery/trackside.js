import { SH } from '../state.js';
import { ri, pick } from '../rng.js';
import { P, R, shade, tint, GREENS } from '../palette.js';

/* ---------- trackside (wall / hedge / fence) ---------- */
export function drawTrackside(g, i, r, L) {
  const cw = L.cw;
  let x = 0;
  while (x < cw) {
    const t = r(), len = Math.min(ri(r, 24, 90), cw - x);
    if (t < 0.45) {
      const c = pick(r, ['#a9aaa5', '#9d9e99', '#b3b2aa']), top = ri(r, 69, 71);
      R(g, x, top, len, SH - top, c); R(g, x, top, len, 1, tint(c, 0.35));
      for (let k = ri(r, 8, 20); k < len; k += ri(r, 11, 24)) R(g, x + k, top + 1, 1, SH - top, shade(c, 0.14));
      if (r() < 0.4) R(g, x + ri(r, 2, Math.max(2, len - 8)), top + 3, ri(r, 3, 6), SH, shade(c, 0.08));
    } else if (t < 0.75) {
      const gy = 73, by = 75;
      R(g, x, gy, len, SH - gy, '#8d8b82');
      for (let xx = 0; xx < len;) {
        const bw = ri(r, 4, 8), bh = ri(r, 3, 8), c = pick(r, GREENS), vw = Math.min(bw, len - xx);
        R(g, x + xx, by - bh, vw, bh + 5, c);
        R(g, x + xx + 1, by - bh - 1, Math.min(bw - 2, len - xx - 1), 1, c);
        R(g, x + xx + 1, by - bh, 2, 1, tint(c, 0.25));
        xx += bw - 1;
      }
    } else {
      const gy = 74, ry = 69;
      R(g, x, gy, len, SH - gy, '#857f78');
      for (let k = 0; k < len / 3; k++) R(g, x + ri(r, 0, len - 1), ri(r, gy + 1, SH - 1), 1, 1, r() < 0.5 ? '#9a948c' : '#6f6a64');
      R(g, x, ry, len, 1, '#6f7f78');
      g.fillStyle = P('#7d8a84');
      for (let yy = ry + 1; yy < gy; yy++) for (let xx = (yy & 1); xx < len; xx += 2) g.fillRect(x + xx, yy, 1, 1);
      for (let k = 0; k < len; k += ri(r, 12, 19)) R(g, x + k, ry - 1, 1, gy - ry + 2, '#5f6f68');
    }
    x += len;
  }
}
