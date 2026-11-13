import { SH } from '../state.js';
import { ri, pick } from '../rng.js';
import { P, R, shade, tint, GREENS, GRASS, PATH } from '../palette.js';
import { pickKind } from '../world.js';
import { env } from '../layers.js';

/* ---------- trackside: 線路際の地面。都心は壁・フェンス、住宅街は生垣、郊外・田園は草地・柵・用水路・あぜ道 ---------- */
function wall(g, r, x, len) {
  const c = pick(r, ['#a9aaa5', '#9d9e99', '#b3b2aa']), top = ri(r, 69, 71);
  R(g, x, top, len, SH - top, c); R(g, x, top, len, 1, tint(c, 0.35));
  for (let k = ri(r, 8, 20); k < len; k += ri(r, 11, 24)) R(g, x + k, top + 1, 1, SH - top, shade(c, 0.14));
  if (r() < 0.4) R(g, x + ri(r, 2, Math.max(2, len - 8)), top + 3, ri(r, 3, 6), SH, shade(c, 0.08));
}
function hedge(g, r, x, len) {
  const gy = 73, by = 75;
  R(g, x, gy, len, SH - gy, '#8d8b82');
  for (let xx = 0; xx < len;) {
    const bw = ri(r, 4, 8), bh = ri(r, 3, 8), c = pick(r, GREENS), vw = Math.min(bw, len - xx);
    R(g, x + xx, by - bh, vw, bh + 5, c);
    R(g, x + xx + 1, by - bh - 1, Math.min(bw - 2, len - xx - 1), 1, c);
    R(g, x + xx + 1, by - bh, 2, 1, tint(c, 0.25));
    xx += bw - 1;
  }
}
function fence(g, r, x, len) { // 金網のフェンス
  const gy = 74, ry = 69;
  R(g, x, gy, len, SH - gy, '#857f78');
  for (let k = 0; k < len / 3; k++) R(g, x + ri(r, 0, len - 1), ri(r, gy + 1, SH - 1), 1, 1, r() < 0.5 ? '#9a948c' : '#6f6a64');
  R(g, x, ry, len, 1, '#6f7f78');
  g.fillStyle = P('#7d8a84');
  for (let yy = ry + 1; yy < gy; yy++) for (let xx = (yy & 1); xx < len; xx += 2) g.fillRect(x + xx, yy, 1, 1);
  for (let k = 0; k < len; k += ri(r, 12, 19)) R(g, x + k, ry - 1, 1, gy - ry + 2, '#5f6f68');
}
/* 低い草地: 奥の田畑が見えるよう、線路際でいちばん低い。ほかの田園の線路際もこの上に描く */
function grass(g, r, x, len) {
  const gy = 75, c = pick(r, GRASS);
  R(g, x, gy, len, SH - gy, c); R(g, x, gy, len, 1, tint(c, 0.15));
  for (let k = 0; k < len / 2; k++) R(g, x + ri(r, 0, len - 1), ri(r, gy + 1, SH - 1), ri(r, 1, 2), 1, shade(c, 0.16));
  for (let xx = ri(r, 0, 5); xx < len - 2; xx += ri(r, 3, 9)) { // 草の穂先
    const h = r() < 0.25 ? 2 : 1;
    R(g, x + xx, gy - h, r() < 0.5 ? 2 : 1, h, c);
  }
  for (let k = 0; k < len / 14; k++) if (r() < 0.5) R(g, x + ri(r, 0, len - 1), ri(r, gy, gy + 2), 1, 1, '#f1edd8'); // 野の花
}
function stakes(g, r, x, len) { // 簡素な柵: 木のくいに横木1本
  grass(g, r, x, len);
  R(g, x, 72, len, 1, '#8a7a63');
  for (let k = ri(r, 2, 8); k < len; k += 13) R(g, x + k, 70, 1, 6, '#6f5f4c');
}
function channel(g, r, x, len) { // 用水路: コンクリートの縁と水面、ところどころ渡り板
  grass(g, r, x, len);
  R(g, x, 76, len, 4, '#c2c2b8'); R(g, x, 77, len, 2, '#5fa0c8');
  for (let k = ri(r, 2, 9); k < len - 5; k += ri(r, 9, 17)) R(g, x + k, 77, ri(r, 2, 4), 1, tint('#5fa0c8', 0.45));
  for (let k = ri(r, 12, 30); k < len - 6; k += ri(r, 34, 60)) { R(g, x + k, 76, 5, 4, '#a9aaa5'); R(g, x + k, 76, 5, 1, '#c9cac4'); }
}
function path(g, r, x, len) { // あぜ道: 土のわだちと中央の草
  grass(g, r, x, len);
  R(g, x, 76, len, 3, PATH);
  for (let xx = ri(r, 0, 3); xx < len - 1; xx += ri(r, 2, 5)) R(g, x + xx, 77, ri(r, 1, 2), 1, GRASS[0]);
  for (let k = 0; k < len / 8; k++) R(g, x + ri(r, 0, len - 1), r() < 0.5 ? 76 : 78, 1, 1, shade(PATH, 0.18));
}
const SEG = { wall, hedge, fence, grass, stakes, channel, path };
/* バイオームごとの出やすさ。混ざる区間では world の重みで按分される */
const SEG_RATE = {
  city:   { wall: 0.55, fence: 0.35, hedge: 0.10, grass: 0, stakes: 0, channel: 0, path: 0 },
  resi:   { wall: 0.25, fence: 0.30, hedge: 0.45, grass: 0, stakes: 0, channel: 0, path: 0 },
  suburb: { wall: 0.00, fence: 0.12, hedge: 0.15, grass: 0.38, stakes: 0.22, channel: 0.08, path: 0.05 },
  rural:  { wall: 0.00, fence: 0.00, hedge: 0.00, grass: 0.40, stakes: 0.20, channel: 0.20, path: 0.20 }
};
export function drawTrackside(g, i, r, L) {
  const cw = L.cw;
  let x = 0;
  while (x < cw) {
    let len = ri(r, 24, 90); if (cw - x - len < 12) len = cw - x;
    SEG[pickKind(env(L, i, x + (len >> 1)), r, SEG_RATE)](g, r, x, len);
    x += len;
  }
}
