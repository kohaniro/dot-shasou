import { ri, pick } from '../rng.js';
import { R, RE, mix, shade, tint, ell, HAZE, GREENS, TORII } from '../palette.js';
import { glow, halo, LAMPS } from '../lights.js';

/* ---------- どのバイオームでも使う部品 ---------- */
/* 遠くのものほど空気の色に寄せる */
export const hz = (c, t = 0.45) => mix(c, HAZE, t);

/* 木: s = 1 小 / 2 中 / 3 大（屋敷林・鎮守の森） */
export function tree(g, r, x, b, s) {
  const c = pick(r, GREENS), rx = s > 2 ? 7 : s > 1 ? 5 : 3, ry = s > 2 ? 6 : s > 1 ? 4 : 3, tr = s > 2 ? 5 : 3, cxp = x + rx + 1, cy = b - tr - ry;
  R(g, cxp - 1, b - tr - 1, 2, tr + 1, '#6a5445');
  ell(g, cxp, cy, rx, ry, c);
  ell(g, cxp - Math.round(rx * 0.35), cy - Math.round(ry * 0.4), Math.max(1, Math.round(rx * 0.4)), Math.max(1, Math.round(ry * 0.35)), tint(c, 0.22));
  R(g, cxp, cy + ry - 1, rx - 1, 1, shade(c, 0.25));
}
export function bush(g, r, x, b) {
  const c = pick(r, GREENS), w = ri(r, 4, 7);
  R(g, x, b - 2, w, 2, c); R(g, x + 1, b - 3, w - 2, 1, c); R(g, x + 1, b - 3, 2, 1, tint(c, 0.25));
}
export function utilityPole(g, x, b) {
  R(g, x, b - 19, 1, 19, '#5a5650'); R(g, x - 2, b - 18, 5, 1, '#5a5650'); R(g, x - 2, b - 15, 5, 1, '#5a5650');
  R(g, x + 1, b - 12, 2, 3, '#8a8f8f');
  const v = glow(x, b, 0.6, 0.3); // 夜: 街灯のついた電柱。灯具と、足もとへ落ちる光
  if (v >= 0) {
    const c = LAMPS.street[Math.floor(v * LAMPS.street.length)];
    RE(g, x - 3, b - 14, 3, 1, c); halo(g, x - 4, b - 15, 5, 3, c, 0.22);
    halo(g, x - 3, b - 13, 3, 1, c, 0.12); halo(g, x - 6, b, 9, 2, c, 0.13); halo(g, x - 4, b, 5, 1, c, 0.16);
  }
}
/* 中景の木（小さく、かすませる） */
export function midTree(g, r, x, b) {
  const c = hz(pick(r, GREENS), 0.3), rx = ri(r, 2, 3), ry = ri(r, 2, 3);
  R(g, x + rx, b - 2, 1, 2, hz('#6a5445', 0.3));
  ell(g, x + rx, b - 1 - ry, rx, ry, c); R(g, x + rx - 1, b - 1 - 2 * ry, 2, 1, tint(c, 0.2));
}
/* 鳥居: x は左の柱。s = 1 中景 / 2 近景 */
export function torii(g, x, b, s) {
  const w = s > 1 ? 7 : 3, h = s > 1 ? 7 : 3, c = s > 1 ? TORII : hz(TORII, 0.2);
  R(g, x, b - h, 1, h, c); R(g, x + w - 1, b - h, 1, h, c); R(g, x - 1, b - h, w + 2, 1, c);
  if (s > 1) R(g, x, b - h + 2, w, 1, c);
}
