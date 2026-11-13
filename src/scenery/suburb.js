import { SH } from '../state.js';
import { ri, pick } from '../rng.js';
import { R, shade, tint, ink, win, BODY_LIGHT, SIGN, HOUSE_WALL, ROOF, WIN_D, WIN_M, WIN_L, GREENS, SOIL, GRASS, AZE } from '../palette.js';
import { hz } from './common.js';
import { bMansion, bZakkyo } from './city.js';
import { bShed, bGreenhouse } from './rural.js';

/* ---------- 住宅街・郊外: 戸建て、アパート、低層マンション、店、畑、空き地 ---------- */

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
function bApart(g, r, x, b, w) { // 2階建てアパート: 外廊下に玄関ドアが並び、端に外階段
  const c = pick(r, BODY_LIGHT), dc = pick(r, ['#6f7f8f', '#8a6f5f', '#5f7a6f', '#7b8388']), fl = 6, h = 2 * fl + 1, top = b - h, sw = 5, cw2 = w - sw - 1;
  R(g, x, top, w, h, c); R(g, x, top, w, 1, tint(c, 0.3)); R(g, x + w - 1, top, 1, h, shade(c, 0.22));
  for (let f = 0; f < 2; f++) {
    const y = top + 1 + f * fl;
    R(g, x + 1, y, cw2, fl - 1, shade(c, 0.2)); // 廊下の奥まった壁
    for (let xx = x + 2; xx + 5 <= x + cw2; xx += 6) { R(g, xx, y + 1, 2, fl - 2, dc); R(g, xx + 3, y + 1, 2, 2, r() < 0.2 ? WIN_L : WIN_D); }
    if (f === 0) R(g, x + 1, y + 3, cw2, 1, tint(c, 0.35)); // 2階の手すり
  }
  for (let k = 0; k < fl; k++) R(g, x + w - sw + (k * (sw - 1) / fl | 0), top + fl + 1 + k, 2, 1, '#7b8388'); // 外階段
  ink(g, x, top, w, h);
}

/* 住宅街の近景: 戸建てが中心。アパート、低層マンション、店、小さな雑居ビルが混じる。戻り値は使った幅 */
export function nearResi(g, r, x, b, rem) {
  const t = r(), wr = (a, z) => Math.min(ri(r, a, z), rem); let w;
  if (t < 0.5) { w = wr(14, 22); bHouse(g, r, x, b, w); }
  else if (t < 0.64) { w = wr(22, 34); bApart(g, r, x, b, w); }
  else if (t < 0.8) { w = wr(22, 36); bMansion(g, r, x, b, w, ri(r, 16, 32)); }
  else if (t < 0.9) { w = wr(20, 32); bShop(g, r, x, b, w); }
  else { w = wr(10, 15); bZakkyo(g, r, x, b, w, ri(r, 18, 28)); }
  return w;
}
/* 郊外の近景: 戸建てがまばら（world の build が低い）。ロードサイドの店、アパート、物置、ビニールハウス */
export function nearSuburb(g, r, x, b, rem) {
  const t = r(), wr = (a, z) => Math.min(ri(r, a, z), rem); let w;
  if (t < 0.6) { w = wr(14, 22); bHouse(g, r, x, b, w); }
  else if (t < 0.72) { w = wr(20, 32); bShop(g, r, x, b, w); }
  else if (t < 0.82) { w = wr(22, 30); bApart(g, r, x, b, w); }
  else if (t < 0.92 || rem < 26) { w = wr(9, 14); bShed(g, r, x, b, w); }
  else { w = wr(26, 40); bGreenhouse(g, r, x, b, w); }
  return w;
}

/* 中景の戸建て（かすませた小さな家） */
export function midHouse(g, r, x, b, w) {
  const c = hz(pick(r, HOUSE_WALL)), rc = hz(pick(r, ROOF), 0.42), h = ri(r, 2, 3);
  R(g, x, b - h, w, h, c); R(g, x + w - 1, b - h, 1, h, shade(c, 0.15));
  R(g, x - 1, b - h - 1, w + 2, 1, rc); R(g, x, b - h - 2, w, 1, tint(rc, 0.2));
  R(g, x + 2, b - h + 1, 1, 1, hz(WIN_D));
}

/* ---------- 地面: x から幅 w を y0 から下まで塗る。far = 0 近景 / >0 中景（かすませる） ---------- */
/* 畑: 土のうねに作物の列。区画ごとに作物（緑の濃さ、植えていない区画）が変わる */
export function vegGround(g, r, x, w, y0, far) {
  const f = c => far ? hz(c, far) : c, soil = f(SOIL);
  R(g, x, y0, w, SH - y0, soil); R(g, x, y0, w, 1, f(AZE));
  for (let px = x; px < x + w;) {
    let pw = ri(r, 14, 34); if (x + w - px - pw < 8) pw = x + w - px;
    const c = r() < 0.2 ? null : f(pick(r, GREENS.concat(GRASS)));
    if (c) for (let y = y0 + 2; y < SH; y += 2) {
      if (far) R(g, px + 1, y, pw - 2, 1, c);
      else for (let xx = px + 1 + (r() < 0.5 ? 1 : 0); xx < px + pw - 1; xx += 2) R(g, xx, y, 1, 1, c);
    }
    R(g, px + pw - 1, y0 + 1, 1, SH - y0, f(AZE)); // 区画の境の草
    px += pw;
  }
}
/* 空き地・草地: 草むら、ところどころ地肌 */
export function lotGround(g, r, x, w, y0, far) {
  const f = c => far ? hz(c, far) : c, c = far ? f('#86b04a') : pick(r, GRASS); // 中景は16色でも緑に残る明るい草色
  R(g, x, y0, w, SH - y0, c);
  for (let k = w >> 1; k > 0; k--) R(g, x + ri(r, 0, w - 2), ri(r, y0, SH - 1), ri(r, 1, 2), 1, r() < 0.6 ? shade(c, 0.14) : tint(c, 0.18));
  for (let k = w >> 4; k > 0; k--) R(g, x + ri(r, 0, Math.max(0, w - 6)), ri(r, y0 + 1, SH - 1), ri(r, 3, 6), 1, f('#b3ab98'));
}
