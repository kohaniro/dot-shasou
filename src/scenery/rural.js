import { SH } from '../state.js';
import { ri, pick, vnoise } from '../rng.js';
import { R, shade, tint, ink, ell, GREENS, HOUSE_WALL, ROOF, WIN_D, WATER, RICE, AZE, SOIL, GRASS, HILL_BACK, HILL_FRONT, VINYL, VINYL_RIB } from '../palette.js';
import { env } from '../layers.js';
import { hz, tree, midTree, torii } from './common.js';

/* ---------- 田園: 田んぼ、農家、小屋、ビニールハウス、鎮守の森、山並み ---------- */

/* 田んぼ1枚。far = 0 近景（苗や株の列まで描く）/ >0 中景（かすませて面だけ） */
function paddy(g, r, x, y, w, h, far) {
  if (w < 1 || h < 1) return;
  const t = r(), f = c => far ? hz(c, far) : c;
  if (t < 0.42) { // 水を張った田: 空を映す水面に苗の点々
    R(g, x, y, w, h, f(WATER));
    if (!far) for (let yy = 0; yy < h; yy++) for (let xx = (yy & 1) + 1; xx < w; xx += 3) R(g, x + xx, y + yy, 1, 1, RICE[0]);
    if (w > 8 && r() < 0.7) R(g, x + ri(r, 1, w - 7), y + ri(r, 0, h - 1), ri(r, 3, 6), 1, f(tint(WATER, 0.6)));
  } else if (t < 0.88) { // 育った稲: 株の列
    const c = pick(r, RICE);
    R(g, x, y, w, h, f(c));
    if (!far) for (let xx = 1; xx < w; xx += 2) R(g, x + xx, y, 1, h, shade(c, 0.1));
    else if (h > 1) R(g, x, y, w, 1, f(tint(c, 0.15)));
  } else { // 休耕田: 土に草
    R(g, x, y, w, h, f(SOIL));
    for (let k = (w * h) >> 3; k > 0; k--) R(g, x + ri(r, 0, w - 1), y + ri(r, 0, h - 1), ri(r, 1, 2), 1, f(GRASS[0]));
  }
}
/* 田んぼの広がり: rows（奥から手前への段の高さ）ごとに横へ区切り、あぜを残して1枚ずつ塗る */
export function paddyGround(g, r, x, w, y0, rows, far) {
  R(g, x, y0, w, SH - y0, far ? hz(AZE, far) : AZE);
  let y = y0 + 1;
  rows.forEach((rh, k) => {
    const last = k === rows.length - 1, h = last ? SH - y : rh - 1;
    for (let px = x; px < x + w;) {
      let pw = ri(r, 18, 46); if (x + w - px - pw < 8) pw = x + w - px;
      paddy(g, r, px, y, pw - 1, h, far);
      px += pw;
    }
    y += rh;
  });
}

/* 遠景の山並み: レイヤーの通し座標のノイズで稜線を決める（チャンクの境目でつながる）。奥は淡く高く、手前は緑で低い */
export function hills(g, r, L, i, base) {
  const cw = L.cw, cb = hz(HILL_BACK, 0.3), cbl = tint(cb, 0.18), cf = hz(HILL_FRONT, 0.12), cfd = shade(cf, 0.14), front = [];
  for (let x = 0; x < cw; x++) {
    const X = i * cw + x, a = env(L, i, x).hill;
    const hb = Math.round(a * (6 + 24 * (0.6 * vnoise(X / 70, 21) + 0.3 * vnoise(X / 23, 22) + 0.1 * vnoise(X / 7, 23))));
    const hf = Math.round(a * (2 + 12 * (0.65 * vnoise(X / 45, 24) + 0.35 * vnoise(X / 13, 25))));
    R(g, x, base - hb, 1, hb, cb); R(g, x, base - hb, 1, 1, cbl);
    R(g, x, base - hf, 1, hf, cf);
    front.push(hf);
  }
  for (let k = 0; k < 70; k++) { // 手前の丘の木立の影
    const x = ri(r, 0, cw - 3), h = front[x];
    if (h > 3) R(g, x, base - ri(r, 1, h - 2), 2, 1, cfd);
  }
}

/* ---------- 中景（かすませた小さな部品）: 戻り値は使った幅 ---------- */
export function midFarm(g, r, x, b) { // 農家と屋敷林
  const w = ri(r, 11, 15), c = hz(pick(r, HOUSE_WALL)), rc = hz(pick(r, ROOF), 0.4), left = r() < 0.5;
  midTree(g, r, left ? x : x + w + 1, b); midTree(g, r, left ? x + 3 : x + w + 4, b);
  const hx = left ? x + 6 : x;
  R(g, hx + 1, b - 3, w - 2, 3, c); R(g, hx + 3, b - 2, w - 7, 1, hz(WIN_D));
  R(g, hx, b - 4, w, 1, shade(rc, 0.15)); R(g, hx + 1, b - 5, w - 2, 1, rc); R(g, hx + 2, b - 6, w - 4, 1, tint(rc, 0.2));
  return w + 12;
}
export function midGreenhouses(g, r, x, b, rem) { // ビニールハウスが数棟並ぶ
  const c = hz(VINYL, 0.2), rib = hz(VINYL_RIB, 0.25);
  let px = x;
  for (let n = ri(r, 1, 3); n > 0 && px + 20 < x + rem; n--) {
    const w = ri(r, 11, 19);
    R(g, px + 1, b - 3, w - 2, 1, c); R(g, px, b - 2, w, 2, c);
    for (let xx = px + 3; xx < px + w - 1; xx += 4) R(g, xx, b - 2, 1, 2, rib);
    px += w + 1;
  }
  return px - x + 2;
}
export function midGrove(g, r, x, b) { // 鎮守の森: こんもりした木立と鳥居
  const w = ri(r, 18, 30), n = ri(r, 5, 8), dark = hz(GREENS[2], 0.25), c = hz(GREENS[0], 0.3);
  for (let k = 0; k < n; k++) {
    const rx = ri(r, 3, 5), ry = ri(r, 3, 5), ex = x + rx + Math.round((w - 2 * rx) * k / (n - 1));
    ell(g, ex, b - ry, rx, ry, k & 1 ? c : dark);
    R(g, ex - 1, b - 2 * ry, 2, 1, tint(c, 0.2));
  }
  R(g, x + 1, b - 1, w - 1, 1, shade(dark, 0.15));
  if (r() < 0.6) torii(g, x + ri(r, 4, w - 8), b, 1);
  return w + 3;
}
export function midPylon(g, x, b) { // 送電鉄塔
  const c = hz('#6f7a80', 0.35), h = 21;
  R(g, x + 3, b - h, 1, h - 5, c); R(g, x + 2, b - 5, 1, 3, c); R(g, x + 4, b - 5, 1, 3, c); R(g, x + 1, b - 2, 1, 2, c); R(g, x + 5, b - 2, 1, 2, c);
  R(g, x, b - h + 2, 7, 1, c); R(g, x + 1, b - h + 6, 5, 1, c); R(g, x, b - h + 10, 7, 1, c);
  return 9;
}

/* ---------- 近景 ---------- */
function engawa(g, x, y, w, h) { // 縁側のガラス戸
  R(g, x, y, w, h, WIN_D);
  for (let xx = x + 3; xx < x + w; xx += 4) R(g, xx, y, 1, h, '#cfcabd');
}
export function bFarm(g, r, x, b, w) { // 農家: 大きな寄棟屋根、縁側、背後に屋敷林
  const c = pick(r, HOUSE_WALL), rc = pick(r, ROOF), h = 8, rh = 6, top = b - h;
  if (r() < 0.8) tree(g, r, x + (r() < 0.5 ? 0 : w - 16), b, 3);
  R(g, x + 2, top, w - 4, h, c); R(g, x + w - 3, top, 1, h, shade(c, 0.2));
  R(g, x + 2, b - 2, w - 4, 2, shade(c, 0.3)); // 腰板
  engawa(g, x + 4, top + 3, w - 14, 3); R(g, x + w - 8, b - 5, 3, 5, '#5b4d47');
  ink(g, x + 2, top, w - 4, h);
  for (let k = 0; k < rh; k++) { const s = (rh - 1 - k) * 2; R(g, x + s, top - rh + k + 1, w - 2 * s, 1, k === 0 ? tint(rc, 0.25) : rc); }
  R(g, x, top + 1, w, 1, shade(rc, 0.3));
}
export function bShed(g, r, x, b, w) { // 農機具小屋・物置: 波板の壁
  const c = pick(r, ['#8f9aa0', '#a39b8c', '#9a8f86', '#7f9a8f']), h = ri(r, 7, 9), top = b - h;
  R(g, x + 1, top, w - 2, h, c);
  for (let xx = x + 2; xx < x + w - 1; xx += 2) R(g, xx, top, 1, h, shade(c, 0.1));
  R(g, x + 3, b - 5, 4, 5, shade(c, 0.45));
  ink(g, x + 1, top, w - 2, h);
  R(g, x, top - 1, w, 1, shade(c, 0.35)); R(g, x, top, w, 1, shade(c, 0.2));
}
export function bGreenhouse(g, r, x, b, w) { // ビニールハウス（長手を横から）
  const top = b - 8;
  R(g, x + 2, top, w - 4, 1, tint(VINYL, 0.5)); R(g, x + 1, top + 1, w - 2, 1, VINYL); R(g, x, top + 2, w, 6, VINYL);
  R(g, x + 1, b - 2, w - 2, 2, '#b7cfae'); // 透けて見える作物
  for (let xx = x + 4; xx < x + w - 1; xx += 5) R(g, xx, top + 1, 1, 7, VINYL_RIB);
  R(g, x, top + 2, 1, 6, VINYL_RIB); R(g, x + w - 1, top + 2, 1, 6, VINYL_RIB);
  ink(g, x, top + 2, w, 6);
}
export function grove(g, r, x, b, w) { // 鎮守の森
  for (let px = x; px + 16 <= x + w; px += ri(r, 6, 9)) tree(g, r, px, b, 3);
  for (let px = x + 3; px + 12 <= x + w; px += ri(r, 8, 12)) tree(g, r, px, b, 2);
  if (r() < 0.6) torii(g, x + (w >> 1) - 3, b, 2);
}
/* 田園の近景: 建物はごくまれ（world の build が低い）。出るのは農家・ビニールハウス・木立・小屋 */
export function nearRural(g, r, x, b, rem) {
  const t = r(), wr = (a, z) => Math.min(ri(r, a, z), rem); let w;
  if (t < 0.32 && rem >= 24) { w = wr(24, 34); bFarm(g, r, x, b, w); }
  else if (t < 0.55 && rem >= 26) { w = wr(26, 44); bGreenhouse(g, r, x, b, w); }
  else if (t < 0.72 && rem >= 30) { w = wr(30, 46); grove(g, r, x, b, w); }
  else { w = wr(9, 14); bShed(g, r, x, b, w); }
  return w;
}
