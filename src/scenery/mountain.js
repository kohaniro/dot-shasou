import { SH, state } from '../state.js';
import { hash32, ri, pick, vnoise } from '../rng.js';
import { R, shade, tint, ink, ell, GREENS, GRASS, HOUSE_WALL, ROOF, WIN_D, WATER, RICE, AZE, HILL_BACK, TORII, CEDAR, BROAD, BAMBOO, MEADOW, MOUNT_FAR, ROCK, CONC, EARTH, STREAM, FOAM, GRAVEL } from '../palette.js';
import { world } from '../world.js';
import { distAt } from '../layers.js';
import { hz, tree, bush, utilityPole } from './common.js';
import { midHouse } from './suburb.js';
import { bShed, midPylon } from './rural.js';

/* ---------- 山間: 重なる山並み、森の斜面、谷あいの集落・棚田・渓流、杉木立、竹やぶ、法面 ---------- */

const clamp01 = v => Math.min(1, Math.max(0, v));
const sstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const TRUNK = '#5a4638';

/* 谷の開け具合 0（森や斜面が迫る）..1（谷が開けて奥まで見通せる）。走行距離の低い周波数のノイズなので、
   全レイヤーが同じ地点で同じ値になり、閉じた区間と開けた区間が十数秒ごとに入れ替わる */
export function openAt(d) { return sstep(0.4, 0.6, 0.72 * vnoise(d / 1500, 31) + 0.28 * vnoise(d / 520, 32)); }
/* 山の高さに掛ける重み: 山間の重みが半分を超えたあたりで、山はもう十分に高い */
const rise = m => Math.min(1, m * 1.3);
/* チャンクのどこかに山間がかかっているか（かかっていなければ何も描かない） */
function touches(L, i) {
  for (let x = -16; x <= L.cw + 16; x += 16) if (world(distAt(L, i, x)).mount > 0) return true;
  return false;
}

/* ---------- 森の斜面: 高さの列 H（H[x + PAD]）を塗り、樹冠をレイヤー通し座標の格子に並べる（チャンクの境目でつながる） ---------- */
function crown(g, x, y, kind, big, p) {
  const c = p[0], cl = p[1], cd = p[2];
  if (!big) {
    if (kind === 0) { // 杉: 細くとがる
      R(g, x - 1, y - 1, 3, 4, c); R(g, x, y - 3, 1, 2, cl); R(g, x - 1, y - 1, 1, 2, cl); R(g, x + 1, y, 1, 3, cd);
    } else { // 広葉樹: 丸い
      ell(g, x, y, 2, 2, c); R(g, x - 1, y - 2, 2, 1, cl); R(g, x, y + 2, 2, 1, cd);
    }
  } else if (kind === 0) {
    const HALF = [0, 0, 1, 1, 2, 1, 2, 3, 2, 3, 4, 3, 4];
    for (let k = 0; k < HALF.length; k++) {
      const h = HALF[k], yy = y - 7 + k;
      R(g, x - h, yy, 2 * h + 1, 1, c);
      if (h > 0) { R(g, x - h, yy, h > 2 ? 2 : 1, 1, cl); R(g, x + h - (h > 2 ? 1 : 0), yy, h > 2 ? 2 : 1, 1, cd); }
      else R(g, x, yy, 1, 1, cl);
    }
  } else {
    ell(g, x, y, 5, 4, c); ell(g, x - 2, y - 2, 2, 1, cl); R(g, x - 2, y + 3, 7, 1, cd); R(g, x + 3, y + 1, 2, 2, cd);
  }
}
function forest(g, L, i, base, H, PAD, o) {
  const cw = L.cw, { cell, rs, big, salt } = o;
  const pal = [CEDAR, BROAD].map(set => set.map(c => { const b = hz(c, o.haze); return [b, tint(b, 0.15), shade(b, 0.2)]; }));
  const fill = shade(hz(CEDAR[2], o.haze), 0.12);
  let maxH = 0;
  for (let x = 0; x < cw; x++) { const h = Math.round(H[x + PAD]); if (h > 0) { R(g, x, base - h, 1, h, fill); if (h > maxH) maxH = h; } }
  if (maxH < 1) return;
  const c0 = Math.floor((i * cw - PAD) / cell), c1 = Math.ceil((i * cw + cw + PAD) / cell), rows = Math.ceil(maxH / rs) + 1;
  for (let j = 0; j < rows; j++) for (let c = c0; c <= c1; c++) {
    const hh = hash32(state.seed, salt + j, c);
    const X = c * cell + ((j & 1) ? cell >> 1 : 0) + (((hh & 255) * cell) >> 8), x = X - i * cw;
    if (x < 1 - PAD || x >= cw + PAD - 1) continue;
    const h = H[x + PAD]; if (!(h >= o.minH)) continue;
    const y = Math.round(base - h) + j * rs + ((((hh >> 8) & 255) * rs) >> 8);
    if (y > base - (big ? 2 : 0)) continue;
    const mixv = vnoise(X / o.patch + j * 0.19, salt + 90) + (((hh >> 16) & 255) / 255 - 0.5) * 0.3;
    const kind = mixv < o.cedar ? 0 : 1;
    crown(g, x, y, kind, big, pal[kind][(hh >>> 24) % 3]);
  }
}

/* ---------- 遠景 ---------- */
/* 奥の高い山並み: 淡く、高い。既存の hills() より先に描く（その向こうにそびえる） */
export function farRange(g, L, i, base) {
  if (!touches(L, i)) return;
  const cw = L.cw, c = hz(HILL_BACK, 0.55), cl = tint(c, 0.12), c2 = hz(HILL_BACK, 0.42);
  for (let x = 0; x < cw; x++) {
    const m = world(distAt(L, i, x)).mount; if (m <= 0) continue;
    const X = i * cw + x, k = rise(m);
    const h = Math.round(k * (13 + 27 * (0.55 * vnoise(X / 95, 33) + 0.3 * vnoise(X / 31, 34) + 0.15 * vnoise(X / 9, 35))));
    R(g, x, base - h, 1, h, c); R(g, x, base - h, 1, 1, cl);
    const h2 = Math.round(k * (7 + 17 * (0.6 * vnoise(X / 64, 39) + 0.4 * vnoise(X / 20, 40)))); // その手前の、少し濃い山
    R(g, x, base - h2, 1, h2, c2);
  }
}
/* 手前の濃い緑の尾根と山すそ: 地面を塗ったあとに描く。開けた区間では低くして、奥の山を見せる */
export function farRidge(g, L, i, base) {
  if (!touches(L, i)) return;
  const cw = L.cw, c = hz(MOUNT_FAR, 0.22), cl = tint(c, 0.13), cd = shade(c, 0.15), foot = hz(GREENS[2], 0.28), foot2 = hz(BROAD[0], 0.3);
  const H = [], M = [];
  for (let x = -1; x <= cw; x++) {
    const d = distAt(L, i, x), m = world(d).mount, X = i * cw + x;
    M.push(m);
    H.push(m <= 0 ? 0 : rise(m) * (5 + 21 * (0.6 * vnoise(X / 58, 36) + 0.4 * vnoise(X / 17, 37))) * (1 - 0.4 * openAt(d)));
  }
  for (let x = 0; x < cw; x++) {
    const m = M[x + 1]; if (m <= 0) continue;
    const X = i * cw + x, h = Math.round(H[x + 1]), top = base - h, dh = H[x + 2] - H[x];
    for (let y = base; y < 60; y++) if (BAYER[(x & 3) + ((y & 3) << 2)] < m * 17) R(g, x, y, 1, 1, ((x + y * 3) % 7 < 2) ? foot2 : foot); // 山すその森
    if (h < 1) continue;
    R(g, x, top, 1, h, c);
    if (dh > 0.2) R(g, x, top, 1, Math.min(h, 1 + Math.round(Math.min(1, dh) * h * 0.4)), cl); // 左上からの光: 左向きの斜面は明るく
    else if (dh < -0.2) R(g, x, top + 1, 1, Math.min(h - 1, 1 + Math.round(Math.min(1, -dh) * h * 0.5)), cd);
    if (vnoise(X / 4, 38) > 0.8) R(g, x, top + 3, 1, (h >> 1) - 2, cd); // 谷筋
  }
}

/* ---------- 中景 ---------- */
function midH(L, i, x) {
  const d = distAt(L, i, x), m = world(d).mount; if (m <= 0) return 0;
  const X = i * L.cw + x, o = openAt(d);
  return rise(m) * (3 + 7 * vnoise(X / 33, 41) + (1 - o) * (12 + 30 * (0.65 * vnoise(X / 85, 42) + 0.35 * vnoise(X / 27, 43))) * (0.8 + 0.2 * m));
}
/* 森の斜面と、開けた区間の渓流。地面を塗ったあと、建物などを置く前に描く */
export function midSlope(g, L, i, base) {
  if (!touches(L, i)) return;
  const cw = L.cw, PAD = 8, H = [];
  for (let x = -PAD; x < cw + PAD; x++) H.push(midH(L, i, x));
  forest(g, L, i, base, H, PAD, { cell: 4, rs: 3, big: false, salt: 600, haze: 0.2, patch: 46, cedar: 0.56, minH: 2 });
  const gravel = hz(GRAVEL, 0.2), water = hz(STREAM, 0.15), foam = hz(FOAM, 0.1), rock = hz(ROCK, 0.25);
  for (let x = 0; x < cw; x++) { // 渓流: 谷が開けたところで河原ごと現れる
    const d = distAt(L, i, x), m = world(d).mount; if (m <= 0) continue;
    const rv = rise(m) * sstep(0.5, 0.92, openAt(d)); if (rv < 0.2) continue;
    const X = i * cw + x, wd = Math.round(1 + 3 * rv), yc = base + 3 + Math.round(2.4 * vnoise(X / 52, 44));
    const g0 = Math.round(1.6 * vnoise(X / 19, 45) * rv), g1 = Math.round(1.6 * vnoise(X / 23, 46) * rv), hh = hash32(state.seed, 47, X);
    R(g, x, yc - g0, 1, wd + g0 + g1, gravel);
    R(g, x, yc, 1, wd, water);
    if ((hh & 15) < 3) R(g, x, yc + ((hh >> 4) % wd), 1, 1, foam);
    else if ((hh & 255) > 247) R(g, x, yc + wd - 1 + g1, 2, 1, rock);
  }
}
function midCedar(g, r, x, b) { // 中景の杉（小さな三角）
  const h = ri(r, 6, 10), c = hz(pick(r, CEDAR), 0.24), cl = tint(c, 0.15);
  R(g, x, b - 2, 1, 2, hz(TRUNK, 0.25));
  for (let k = 0; k < h - 1; k++) { const hf = Math.min(2, Math.floor(k * 2.6 / h)); R(g, x - hf, b - h + k, 2 * hf + 1, 1, c); if (hf) R(g, x - hf, b - h + k, 1, 1, cl); }
  R(g, x, b - h, 1, 1, cl);
}
function midCedars(g, r, x, b, w) { for (let px = x + 2; px < x + w - 2; px += ri(r, 2, 5)) midCedar(g, r, px, b - (r() < 0.3 ? 1 : 0)); return w; }
function hamlet(g, r, x, b, w) { // 谷あいの集落: 石垣の段に数軒
  const wall = hz(ROCK, 0.3), field = hz(pick(r, RICE), 0.3);
  midCedar(g, r, x + 2, b); midCedar(g, r, x + 5, b - 1);
  let px = x + 9;
  while (px + 8 < x + w - 4) {
    const hw = ri(r, 6, 9), up = pick(r, [0, 0, 1, 2, 3]);
    if (up) { R(g, px - 1, b - up, hw + 2, up, wall); R(g, px - 1, b - up, hw + 2, 1, tint(wall, 0.2)); }
    if (r() < 0.2) { // 蔵
      R(g, px + 1, b - up - 4, hw - 3, 4, hz('#ece8dc', 0.2)); R(g, px, b - up - 5, hw - 1, 1, hz(ROOF[0], 0.35)); R(g, px + 2, b - up - 2, 1, 1, hz(WIN_D));
    } else midHouse(g, r, px, b - up, hw);
    px += hw + ri(r, 1, 4);
    if (r() < 0.3 && px + 6 < x + w) { R(g, px, b - 1, ri(r, 4, 7), 1, field); px += 6; }
  }
  if (r() < 0.6) midCedar(g, r, x + w - 3, b);
  return w + 2;
}
function terraces(g, r, x, b, w) { // 棚田: 石積みの段が斜面をのぼる
  const n = ri(r, 3, 5), dir = r() < 0.5, riser = hz(shade(AZE, 0.1), 0.25), water = hz(WATER, 0.25);
  for (let k = 0; k < n; k++) {
    const y = b - 1 - 2 * k, x0 = x + k * (dir ? 4 : 2), x1 = x + w - k * (dir ? 2 : 4);
    if (x1 - x0 < 8) break;
    R(g, x0, y, x1 - x0, 2, riser);
    for (let px = x0 + 1; px < x1 - 2;) {
      let pw = ri(r, 6, 14); if (x1 - 1 - px - pw < 4) pw = x1 - 1 - px;
      R(g, px, y, pw - 1, 1, r() < 0.4 ? water : hz(pick(r, RICE), 0.25));
      px += pw;
    }
  }
  if (r() < 0.5) midCedar(g, r, x + (dir ? w - 2 : 1), b);
  return w + 2;
}
/* 中景に置くもの。開けた区間は集落・棚田、閉じた区間は斜面の上の鉄塔・林道・滝。戻り値は使った幅 */
export function midMount(g, r, x, b, rem, L, i) {
  const o = openAt(distAt(L, i, x)), t = r(), wr = (a, z) => Math.min(ri(r, a, z), rem);
  if (o > 0.5) {
    if (t < 0.15 && rem >= 44) return hamlet(g, r, x, b, wr(34, 54));
    if (t < 0.29 && rem >= 40) return terraces(g, r, x, b, wr(30, 50));
    if (t < 0.42 && rem >= 16) return midCedars(g, r, x, b, wr(9, 22));
    if (t < 0.48 && rem >= 12) { midHouse(g, r, x + 1, b, ri(r, 6, 9)); midCedar(g, r, x + 10, b); return 13; }
    if (t < 0.51 && rem >= 12) { midPylon(g, x, b - Math.round(midH(L, i, x + 3)) + 2); return 12; }
    return wr(8, 30);
  }
  if (t < 0.025 && rem >= 30) { midPylon(g, x, b - Math.round(midH(L, i, x + 3)) + 3); return 30; } // 尾根の送電鉄塔
  if (t < 0.13 && rem >= 60) { // 斜面を横切る林道: ガードレールの白い線と擁壁のかげ
    const w = wr(40, 90), up = ri(r, 5, 10), dir = r() < 0.5 ? 1 : -1, c = hz('#c3c7be', 0.25), cd = hz(shade(CEDAR[2], 0.3), 0.2);
    for (let k = 0; k < w; k++) {
      const yo = up + Math.round((dir > 0 ? k : w - k) * 0.07);
      if (midH(L, i, x + k) < yo + 5) continue;
      if (k % 5 < 4) R(g, x + k, b - yo, 1, 1, c);
      R(g, x + k, b - yo + 1, 1, 1, cd);
    }
    return w;
  }
  if (t < 0.17 && rem >= 8) { // 滝・沢筋
    const h = Math.round(midH(L, i, x + 3)), c = hz(STREAM, 0.45);
    if (h > 12) { let px = x + 3; for (let y = b - Math.round(h * 0.5); y < b; y += 2) { R(g, px, y, 1, 1, c); if (r() < 0.4) px += r() < 0.5 ? 1 : -1; } }
    return 8;
  }
  if (t < 0.36 && rem >= 16) return midCedars(g, r, x, b, wr(9, 26));
  return wr(10, 30);
}

/* ---------- 地面（山あいの草地）: far = 0 近景 / >0 中景 ---------- */
export function mountGround(g, r, x, w, y0, far) {
  const f = c => far ? hz(c, far) : c, c = f(pick(r, MEADOW)), cd = shade(c, 0.16), cl = tint(c, 0.16);
  R(g, x, y0, w, SH - y0, c);
  for (let k = w >> 1; k > 0; k--) R(g, x + ri(r, 0, w - 2), ri(r, y0, SH - 1), ri(r, 1, 2), 1, r() < 0.65 ? cd : cl);
  for (let k = w >> 4; k > 0; k--) { // やぶ
    const bx = x + ri(r, 0, Math.max(0, w - 5)), by = ri(r, y0 + 1, SH - 2), bc = f(pick(r, GREENS));
    R(g, bx, by, ri(r, 3, 5), 1, bc); R(g, bx + 1, by - 1, 2, 1, bc);
  }
  if (!far) for (let xx = x + ri(r, 0, 4); xx < x + w - 1; xx += ri(r, 3, 8)) R(g, xx, y0 - 1, r() < 0.4 ? 2 : 1, 1, c); // 草の穂先
}

/* ---------- 近景 ---------- */
function nearH(L, i, x) {
  const d = distAt(L, i, x), m = world(d).mount; if (m <= 0) return 0;
  const X = i * L.cw + x, k = Math.min(1, Math.max(0, 0.7 * vnoise(X / 170, 51) + 0.3 * vnoise(X / 43, 52) - 0.47) * 3.2);
  return rise(m) * (1 - openAt(d)) * k * (15 + 9 * vnoise(X / 29, 53));
}
/* 迫る斜面: 閉じた区間のところどころで、木の茂った土手が線路のすぐ脇まで寄ってくる */
export function nearBank(g, L, i, base) {
  if (!touches(L, i)) return;
  const cw = L.cw, PAD = 12, H = [];
  for (let x = -PAD; x < cw + PAD; x++) H.push(nearH(L, i, x));
  forest(g, L, i, base, H, PAD, { cell: 7, rs: 5, big: true, salt: 700, haze: 0.04, patch: 60, cedar: 0.5, minH: 3 });
  const fern = GREENS[1], dark = shade(CEDAR[2], 0.25);
  for (let x = 0; x < cw; x++) { // 足もとの下草とかげ
    const h = Math.round(H[x + PAD]); if (h < 3) continue;
    const hh = hash32(state.seed, 54, i * cw + x);
    R(g, x, base - 1, 1, 1, dark);
    if ((hh & 3) === 0) R(g, x, base - 1 - ((hh >> 2) & 1), 1, 1 + ((hh >> 2) & 1), fern);
  }
}
function cedar(g, r, cx, b, h, c) { // 杉: 細長い円錐。cx は幹の位置
  const tr = Math.round(h * 0.26), ch = h - tr, hw = h > 30 ? 4 : 3, cl = tint(c, 0.15), cd = shade(c, 0.22);
  R(g, cx, b - tr - 3, h > 30 ? 2 : 1, tr + 3, TRUNK);
  for (let k = 0; k < ch; k++) {
    const half = Math.min(hw + 1, Math.floor(0.4 + (k / ch) * hw) + (k % 4 === 3 ? 1 : 0)), y = b - h + k;
    R(g, cx - half, y, 2 * half + 1, 1, c);
    if (half > 0) { R(g, cx - half, y, half > 2 ? 2 : 1, 1, cl); R(g, cx + half - (half > 2 ? 1 : 0), y, half > 2 ? 2 : 1, 1, cd); }
    else R(g, cx, y, 1, 1, cl);
  }
}
function cedarStand(g, r, x, b, w) { // 杉木立: 奥の列は暗く、手前の列は幹が見える
  const back = shade(CEDAR[2], 0.12);
  for (let px = x + 3; px < x + w - 3; px += ri(r, 4, 6)) cedar(g, r, px, b - 1, ri(r, 22, 32), back);
  if (w > 16) R(g, x + 4, b - 9, w - 8, 9, shade(CEDAR[2], 0.38)); // 林の中の暗がり
  for (let px = x + 5; px < x + w - 5; px += ri(r, 6, 10)) cedar(g, r, px, b, ri(r, 26, 38), pick(r, CEDAR));
  for (let px = x + 1; px < x + w - 6; px += ri(r, 5, 12)) if (r() < 0.5) bush(g, r, px, b);
}
function mixedWood(g, r, x, b, w) { // 雑木林
  for (let px = x; px + 16 <= x + w; px += ri(r, 6, 9)) tree(g, r, px, b - 1, 3);
  for (let px = x + 2; px + 12 <= x + w; px += ri(r, 7, 11)) { if (r() < 0.3) cedar(g, r, px + 5, b, ri(r, 20, 28), pick(r, CEDAR)); else tree(g, r, px, b, 2); }
  for (let px = x + 1; px < x + w - 6; px += ri(r, 5, 10)) if (r() < 0.6) bush(g, r, px, b);
}
function bamboo(g, r, x, b, w) { // 竹やぶ: 明るい黄緑の葉のかたまりと、細い稈
  const body = shade(BAMBOO[1], 0.3), culm = '#b9c77a';
  for (let px = x + 3; px < x + w - 2; px += ri(r, 3, 5)) ell(g, px, b - ri(r, 15, 20), ri(r, 3, 4), ri(r, 3, 5), shade(BAMBOO[1], 0.14));
  R(g, x + 2, b - 14, w - 4, 14, body);
  for (let px = x + 2; px < x + w - 2; px += ri(r, 2, 3)) R(g, px, b - ri(r, 11, 15), 1, 15, r() < 0.5 ? culm : shade(culm, 0.2));
  R(g, x + 2, b - 1, w - 4, 1, shade(body, 0.3));
  for (let px = x + 2; px < x + w - 1; px += ri(r, 3, 5)) { // しなだれる穂先
    const top = b - ri(r, 18, 26), dir = r() < 0.5 ? 1 : -1, c = pick(r, BAMBOO);
    ell(g, px, top + 3, ri(r, 2, 4), ri(r, 2, 3), c);
    R(g, px + dir, top, 2, 1, tint(c, 0.2)); R(g, px + 2 * dir, top + 1, 2, 1, tint(c, 0.2)); R(g, px + 3 * dir, top + 2, 1, 2, c);
  }
  for (let k = w; k > 0; k--) R(g, x + ri(r, 2, w - 3), b - ri(r, 9, 22), 1, 1, r() < 0.5 ? tint(BAMBOO[2], 0.15) : shade(BAMBOO[1], 0.3));
}
function shrine(g, r, x, b, w) { // 小さな社: 鳥居、石段、杉の木立の奥の祠
  const stone = '#a3a196', wood = '#7a5f4a', roof = '#454d55', mid = x + (w >> 1);
  cedar(g, r, x + 5, b - 1, ri(r, 30, 36), shade(CEDAR[2], 0.1)); cedar(g, r, x + w - 6, b - 1, ri(r, 28, 36), shade(CEDAR[2], 0.1));
  cedar(g, r, mid - 9, b - 1, ri(r, 24, 30), CEDAR[0]); cedar(g, r, mid + 9, b - 1, ri(r, 24, 30), CEDAR[1]);
  R(g, mid - 6, b - 3, 13, 3, stone); R(g, mid - 6, b - 3, 13, 1, tint(stone, 0.25)); // 石の基壇
  R(g, mid - 4, b - 9, 9, 6, wood); R(g, mid - 1, b - 7, 3, 4, shade(wood, 0.4)); R(g, mid - 4, b - 9, 9, 1, '#ece8dc');
  R(g, mid - 6, b - 11, 13, 2, roof); R(g, mid - 4, b - 12, 9, 1, tint(roof, 0.2)); R(g, mid - 7, b - 10, 15, 1, shade(roof, 0.2));
  R(g, mid - 2, b - 2, 5, 2, shade(stone, 0.15)); // 石段
  const tx = mid - 5;
  R(g, tx, b - 8, 1, 8, TORII); R(g, tx + 9, b - 8, 1, 8, TORII); R(g, tx - 2, b - 9, 14, 1, TORII); R(g, tx - 1, b - 10, 12, 1, shade(TORII, 0.25)); R(g, tx, b - 6, 10, 1, TORII);
  R(g, mid + 9, b - 4, 2, 4, stone); R(g, mid + 8, b - 5, 4, 1, shade(stone, 0.2)); // 石灯籠
}
function kominka(g, r, x, b, w) { // 山あいの民家: 板壁としっくい、大きなトタン屋根、石垣、まきの山
  const rc = pick(r, ['#7a4f3f', '#3f5a6f', '#56605a', '#8a5a45', '#4a5560']), wood = pick(r, ['#6a5646', '#5f5048', '#75604c']), plaster = pick(r, HOUSE_WALL);
  const h = 7, rh = 6, bb = b - 2, top = bb - h;
  cedar(g, r, x + (r() < 0.5 ? 3 : w - 4), b - 1, ri(r, 24, 32), pick(r, CEDAR));
  R(g, x, bb, w, 2, ROCK); for (let xx = x + ri(r, 0, 2); xx < x + w - 1; xx += ri(r, 2, 4)) R(g, xx, bb + (xx & 1), 1, 1, shade(ROCK, 0.25)); // 石垣
  R(g, x + 2, top, w - 4, h, plaster); R(g, x + 2, bb - 3, w - 4, 3, wood); R(g, x + w - 3, top, 1, h, shade(plaster, 0.25));
  R(g, x + 4, top + 2, w - 13, 3, WIN_D); for (let xx = x + 6; xx < x + w - 9; xx += 3) R(g, xx, top + 2, 1, 3, '#cfcabd');
  R(g, x + w - 8, bb - 5, 3, 5, shade(wood, 0.35));
  ink(g, x + 2, top, w - 4, h);
  for (let k = 0; k < rh; k++) { const s = (rh - 1 - k) * 2; R(g, x + s, top - rh + k + 1, w - 2 * s, 1, k === 0 ? tint(rc, 0.3) : (k & 1) ? rc : shade(rc, 0.08)); }
  R(g, x, top + 1, w, 1, shade(rc, 0.35));
  if (r() < 0.6) { const fx = x + w - 5; R(g, fx, bb - 3, 4, 3, '#a3825f'); R(g, fx, bb - 3, 1, 1, '#d9c3a0'); R(g, fx + 2, bb - 2, 1, 1, '#d9c3a0'); R(g, fx + 3, bb - 3, 1, 1, '#6a5445'); } // まき
}
function persimmon(g, r, x, b) { // 柿の木
  tree(g, r, x, b, 2);
  for (let k = ri(r, 4, 7); k > 0; k--) R(g, x + ri(r, 2, 10), b - ri(r, 5, 10), 1, 1, '#e58a3c');
}
function stoneField(g, r, x, b, w) { // 石垣の上の小さな畑・茶畑
  R(g, x, b - 3, w, 3, ROCK); R(g, x, b - 3, w, 1, tint(ROCK, 0.2));
  for (let xx = x + 1; xx < x + w - 1; xx += ri(r, 2, 4)) R(g, xx, b - 2 + (xx & 1), 1, 1, shade(ROCK, 0.28));
  const c = pick(r, GREENS);
  for (let xx = x + 1; xx + 4 < x + w; xx += 5) { R(g, xx, b - 5, 4, 2, c); R(g, xx + 1, b - 6, 2, 1, tint(c, 0.2)); }
}
/* 近景に置くもの。閉じた区間は杉木立・雑木林・竹やぶ、開けた区間はすき間を広くとって民家や柿の木をぽつぽつ。戻り値は使った幅 */
const NEAR_W = {
  //         杉木立 雑木林 竹やぶ 社    民家  柿    小屋  石垣畑 電柱  すき間
  closed: [0.39, 0.21, 0.06, 0.012, 0.03, 0.01, 0.01, 0.02, 0.03, 0.22],
  open:   [0.05, 0.03, 0.015, 0.012, 0.10, 0.05, 0.04, 0.06, 0.07, 0.555]
};
export function nearMount(g, r, x, b, rem, L, i) {
  const o = openAt(distAt(L, i, x)), wr = (a, z) => Math.min(ri(r, a, z), rem);
  let t = r(), k = 0;
  for (; k < 9; k++) { const p = NEAR_W.closed[k] * (1 - o) + NEAR_W.open[k] * o; if (t < p) break; t -= p; }
  let w;
  if (k === 0 && rem >= 22) { w = wr(26, 90); cedarStand(g, r, x, b, w); }
  else if (k === 1 && rem >= 24) { w = wr(26, 70); mixedWood(g, r, x, b, w); }
  else if (k === 2 && rem >= 18) { w = wr(20, 48); bamboo(g, r, x, b, w); }
  else if (k === 3 && rem >= 40) { w = 40; shrine(g, r, x, b, w); }
  else if (k === 4 && rem >= 24) { w = wr(24, 32); kominka(g, r, x, b, w); }
  else if (k === 5 && rem >= 14) { w = 14; persimmon(g, r, x, b); }
  else if (k === 6 && rem >= 12) { w = wr(9, 13); bShed(g, r, x, b, w); }
  else if (k === 7 && rem >= 18) { w = wr(18, 36); stoneField(g, r, x, b, w); }
  else if (k === 8) { w = Math.min(8, rem); utilityPole(g, x + 3, b); }
  else w = wr(10, 14 + Math.round(40 * o));
  return w;
}

/* ---------- 線路際 ---------- */
function mgrass(g, r, x, len, gy) { // 草地（trackside.js の grass と同じつくり）
  const c = pick(r, GRASS);
  R(g, x, gy, len, SH - gy, c); R(g, x, gy, len, 1, tint(c, 0.15));
  for (let k = 0; k < len / 2; k++) R(g, x + ri(r, 0, len - 1), ri(r, gy + 1, SH - 1), ri(r, 1, 2), 1, shade(c, 0.16));
  for (let xx = ri(r, 0, 5); xx < len - 2; xx += ri(r, 3, 9)) { const h = r() < 0.25 ? 2 : 1; R(g, x + xx, gy - h, r() < 0.5 ? 2 : 1, h, c); }
  return c;
}
function tufts(g, r, x, len, y) { // 壁の上にかぶさる草
  for (let xx = ri(r, 0, 3); xx < len - 2; xx += ri(r, 2, 6)) { const c = pick(r, GRASS.concat(GREENS)), w = ri(r, 1, 3); R(g, x + xx, y - 1, w, 1, c); if (r() < 0.35) R(g, x + xx, y - 2, 1, 1, c); if (r() < 0.2) R(g, x + xx, y, 1, ri(r, 1, 2), c); }
}
function retain(g, r, x, len) { // コンクリート擁壁: 目地、水抜き穴、雨だれ
  const c = pick(r, [CONC, '#a9aaa5', '#bdbbb0']), top = ri(r, 63, 67);
  R(g, x, top, len, SH - top, c); R(g, x, top, len, 1, tint(c, 0.3)); R(g, x, top + 1, len, 1, shade(c, 0.06));
  for (let k = ri(r, 6, 18); k < len; k += ri(r, 14, 22)) R(g, x + k, top + 1, 1, SH - top, shade(c, 0.16));
  for (let k = ri(r, 2, 6); k < len - 1; k += 7) {
    const y = top + 5 + ((k / 7 | 0) & 1) * 4;
    R(g, x + k, y, 1, 1, shade(c, 0.5));
    if (r() < 0.45) R(g, x + k, y + 1, 1, ri(r, 2, 6), shade(c, 0.13));
  }
  for (let k = len >> 3; k > 0; k--) R(g, x + ri(r, 0, len - 2), SH - ri(r, 1, 3), ri(r, 1, 3), 1, GRASS[1]); // 足もとのこけ・草
  tufts(g, r, x, len, top);
}
function ishigaki(g, r, x, len) { // 石積み
  const top = ri(r, 66, 70), joint = shade(ROCK, 0.32);
  R(g, x, top, len, SH - top, joint);
  for (let y = top, row = 0; y < SH; y += 3, row++) {
    for (let xx = (row & 1) ? -2 : 0; xx < len;) {
      const sw = ri(r, 3, 6), t = r(), c = t < 0.3 ? tint(ROCK, 0.14) : t < 0.6 ? ROCK : t < 0.85 ? shade(ROCK, 0.1) : '#9a9382';
      const x0 = Math.max(0, xx), x1 = Math.min(len, xx + sw - 1);
      R(g, x + x0, y, x1 - x0, 2, c);
      xx += sw;
    }
  }
  for (let k = len >> 2; k > 0; k--) R(g, x + ri(r, 0, len - 1), ri(r, top + 1, SH - 1), 1, 1, GRASS[1]); // すき間の草
  tufts(g, r, x, len, top);
}
function rockFence(g, r, x, len) { // 落石防護柵: コンクリートの土台に H 鋼の柱とワイヤー
  const by = 73, ty = 60, post = pick(r, ['#7a6658', '#6f7673', '#8a6f58']), wire = '#757c7a';
  mgrass(g, r, x, len, 75);
  R(g, x, by, len, SH - by, CONC); R(g, x, by, len, 1, tint(CONC, 0.3));
  for (let k = ri(r, 9, 20); k < len; k += ri(r, 13, 22)) R(g, x + k, by + 1, 1, SH - by, shade(CONC, 0.15));
  for (let y = ty + 1; y < by; y += 3) R(g, x, y, len, 1, wire);
  for (let y = ty + 2; y < by; y++) if ((y - ty) % 3 !== 1) for (let xx = (y & 1) * 2; xx < len; xx += 4) R(g, x + xx, y, 1, 1, wire); // 金網
  for (let k = 2; k < len; k += 14) { R(g, x + k, ty - 1, 2, by - ty + 1, post); R(g, x + k, ty - 1, 1, by - ty + 1, tint(post, 0.2)); }
  for (let k = len >> 4; k > 0; k--) { const rx = x + ri(r, 1, Math.max(1, len - 4)); R(g, rx, by - 2, 3, 2, ROCK); R(g, rx, by - 2, 2, 1, tint(ROCK, 0.2)); } // 受け止めた石
}
function lattice(g, r, x, len) { // 法枠: 斜面を押さえるコンクリートの格子。両端は斜めに下がる
  const top = ri(r, 57, 62), by = 75, c = CONC, cd = shade(c, 0.14), inner = pick(r, GRASS), ramp = Math.min(10, len >> 2), ph = ri(r, 0, 6);
  mgrass(g, r, x, len, by);
  for (let k = 0; k < len; k++) {
    const e = Math.min(k, len - 1 - k), t = e >= ramp ? top : Math.round(by - (by - top) * (e / ramp));
    if (t >= by) continue;
    const gx = (k + ph) % 8 === 0;
    for (let y = t; y < by; y++) {
      const gy = (y - top) % 6 === 0, edge = y === t;
      R(g, x + k, y, 1, 1, edge ? tint(c, 0.25) : gx ? c : gy ? cd : ((k * 7 + y * 3) % 11 < 2 ? shade(inner, 0.18) : inner));
    }
  }
  R(g, x, by, len, 2, c); R(g, x, by, len, 1, tint(c, 0.25)); // 足もとの側溝
  tufts(g, r, x + ramp, len - 2 * ramp, top);
}
function grassBank(g, r, x, len) { // 草の斜面: すすきの穂、しだ
  const c = mgrass(g, r, x, len, 75), dark = shade(c, 0.12);
  let h = ri(r, 2, 5);
  for (let k = 0; k < len; k++) {
    const e = Math.min(k, len - 1 - k);
    if (r() < 0.3) h = Math.max(2, Math.min(8, h + (r() < 0.5 ? 1 : -1)));
    const hh = Math.min(h, 1 + (e >> 1)), y = 75 - hh;
    R(g, x + k, y, 1, hh, (k + y) % 5 < 2 ? dark : c); R(g, x + k, y, 1, 1, tint(c, 0.15));
  }
  for (let k = ri(r, 3, 10); k < len - 3; k += ri(r, 5, 13)) { // すすき
    const sy = 75 - ri(r, 8, 12), dir = r() < 0.5 ? 1 : -1;
    R(g, x + k, sy + 2, 1, 6, '#9aa66a'); R(g, x + k + dir, sy, 1, 3, '#e6dcc0'); R(g, x + k, sy + 1, 1, 1, '#e6dcc0');
  }
  for (let k = len >> 3; k > 0; k--) R(g, x + ri(r, 1, len - 3), ri(r, 71, 74), 2, 1, GREENS[2]); // しだ
  for (let k = 0; k < len / 16; k++) if (r() < 0.5) R(g, x + ri(r, 0, len - 1), ri(r, 72, 76), 1, 1, pick(r, ['#f1edd8', '#e9c046', '#c98fc0'])); // 野の花
}
function sawa(g, r, x, len) { // 沢: 岩のあいだを白い水が落ち、線路の下の暗きょへ
  mgrass(g, r, x, len, 75);
  const cx = x + ri(r, 8, Math.max(8, len - 12)), w = Math.min(13, len - 4);
  for (let y = 69; y < SH; y++) { // 沢筋の岩
    const half = 2 + ((y - 69) >> 1), x0 = Math.max(x, cx - half), x1 = Math.min(x + len, cx + half + 1);
    R(g, x0, y, x1 - x0, 1, (y & 1) ? ROCK : shade(ROCK, 0.12));
  }
  let px = cx;
  for (let y = 68; y < SH - 2; y++) { R(g, px - 1, y, 2 + (y > 73 ? 1 : 0), 1, y % 3 === 0 ? FOAM : STREAM); if (r() < 0.45) px += r() < 0.5 ? 1 : -1; px = Math.max(cx - 2, Math.min(cx + 2, px)); }
  for (let k = 5; k > 0; k--) { const rx = cx + ri(r, -w >> 1, w >> 1), ry = ri(r, 70, SH - 2); if (rx > x && rx < x + len - 3) { R(g, rx, ry, ri(r, 2, 3), 2, tint(ROCK, 0.16)); R(g, rx, ry + 1, 3, 1, shade(ROCK, 0.25)); } }
  if (cx - 5 >= x && cx + 6 <= x + len) { R(g, cx - 5, SH - 3, 11, 3, CONC); R(g, cx - 5, SH - 3, 11, 1, tint(CONC, 0.3)); R(g, cx - 2, SH - 2, 5, 2, '#3a4248'); } // 暗きょの口
}
function guard(g, r, x, len) { // 線路沿いの道とガードレール
  mgrass(g, r, x, len, 75);
  R(g, x, 73, len, 5, '#74787a'); R(g, x, 73, len, 1, '#8a8e8e');
  for (let k = ri(r, 0, 8); k < len - 4; k += 12) R(g, x + k, 75, 5, 1, '#d9dbd4'); // 中央線
  for (let k = len >> 3; k > 0; k--) R(g, x + ri(r, 0, len - 2), ri(r, 74, 77), 2, 1, '#6a6e70');
  R(g, x, 70, len, 2, '#e9ece8'); R(g, x, 71, len, 1, '#b9c0bf');
  for (let k = ri(r, 1, 6); k < len; k += 10) R(g, x + k, 70, 1, 4, '#9aa3a3');
  if (len > 30 && r() < 0.35) { const sx = x + ri(r, 6, len - 8); R(g, sx, 61, 1, 12, '#9aa3a3'); R(g, sx - 2, 59, 5, 5, '#e9c046'); R(g, sx - 1, 60, 3, 3, '#3a3f44'); } // 警戒標識
}
const SEGS = [retain, ishigaki, rockFence, lattice, grassBank, sawa, guard, (g, r, x, len) => mgrass(g, r, x, len, 75)];
const SEG_W = {
  //        擁壁  石積み 防護柵 法枠  草の斜面 沢    道    草地
  closed: [0.15, 0.12, 0.11, 0.08, 0.28, 0.06, 0.02, 0.18],
  open:   [0.03, 0.10, 0.00, 0.00, 0.22, 0.07, 0.22, 0.36]
};
/* 山間の線路際: 閉じた区間は擁壁・法枠・防護柵で固め、開けた区間は草地・道・沢 */
export function mountSeg(g, r, x, len, L, i) {
  const o = openAt(distAt(L, i, x + (len >> 1)));
  let t = r(), k = 0;
  for (; k < 7; k++) { const p = SEG_W.closed[k] * (1 - o) + SEG_W.open[k] * o; if (t < p) break; t -= p; }
  if (k === 5 && len < 20) k = 4;
  if (k === 3 && len < 44) k = 0;
  SEGS[k](g, r, x, len);
}
