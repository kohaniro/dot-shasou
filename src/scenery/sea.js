import { SH, state } from '../state.js';
import { ri, pick, vnoise, rng, hash32 } from '../rng.js';
import { R, mix, shade, tint, ink, GREENS, GRASS, WIN_D, HILL_BACK } from '../palette.js';
import { world } from '../world.js';
import { distAt } from '../layers.js';
import { tunnelProx } from '../features.js';
import { hz, torii } from './common.js';

/* ---------- 海沿い: 水平線、海面、岬、防波堤と灯台、漁港、松林、漁村、浜、護岸 ---------- */
const clamp01 = v => Math.min(1, Math.max(0, v));
const sstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/* 色。海面は奥（水平線）から手前へ7段。レイヤーの帯（遠景 52〜 / 中景 59〜 / 近景 68〜）をまたいでも
   画面の高さだけで色が決まるので、視差の違う3レイヤーの海面がひと続きに見える */
const SEA = ['#8fbdd8', '#7fb1d1', '#6da5ca', '#5e9ac3', '#5090bb', '#4486b3', '#3a7caa'];
const SEA_Y = [52, 55, 59, 62, 65, 68, 72, SH];
const SEA_L = SEA.map(c => tint(c, 0.32)), SEA_D = SEA.map(c => shade(c, 0.13));
const HORIZON = '#6f9fc2', GLINT = '#eef6fa';
const SHALLOW = '#74c2c6', FOAM = '#f3f8f4';
const SAND = '#e3d6ad', SAND_WET = '#c8ba92', DUNE = '#93a862';
const ROCK = '#77736c', ROCK_D = '#55534f';
const CONC = '#b9b8ae', CONC_D = '#8f8f88';
const PINE = ['#2f5d43', '#3a6a47', '#2a5440'], TRUNK = '#6b4f3f';
const BOARD = ['#7d6d5b', '#8f8272', '#a39886', '#6f6558', '#b3ab9c'];
const TIN = ['#5a626a', '#4f6f8a', '#8a5a48', '#6b7378', '#3f5560'];
const HULL = ['#f0efe8', '#e6ecef', '#f3ead8'], STRIPE = ['#3f7fb5', '#c9503f', '#3f8f7a', '#e0a23a'];
const FLOAT = '#e8823c';

/* ---------- 海岸の形 ----------
   c = 「陸がどこまで続くか」の連続値。0 = 線路のすぐ先が海、1 = 近景まで陸（浜）、2 = 中景まで陸（岬）、3 以上 = 海は見えない。
   海沿いの重み（world の sea）が小さいうちは 3 を超え、重みが上がるにつれ遠くから海が現れる。
   重みが 1 の区間では、走行距離の低い周波数のノイズ cn で 0.1〜2.8 を行き来する（海が開ける ↔ 浜・松林・岬でさえぎられる）。
   走行距離だけの関数なので、全レイヤーで同じ地点が同じ海岸になる */
const DRY = { c: 9, cn: 0, sea: 0, d: 0 };
export function coastAt(e, d) {
  if (!(e.sea > 0)) return DRY;
  const n = clamp01((0.7 * vnoise(d / 1700, 61) + 0.3 * vnoise(d / 560, 62) - 0.5) * 2.1 + 0.5);
  let cn = 0.1 + 2.7 * Math.pow(n, 1.35); // 開けた側へ寄せる（岬は短く、海は長く）
  const t = tunnelProx(d, 700); // トンネルの坑口の近くは岬にする（陸が張り出して海を隠す）。坑口から 700 より離れた地点の値は変えない
  if (t > 0 && cn < 2.8) cn += (2.8 - cn) * t;
  return { c: 3.5 * (1 - e.sea) + e.sea * cn, cn, sea: e.sea, d };
}
const coast = (L, i, x) => { const d = distAt(L, i, x); return coastAt(world(d), d); };
/* 波打ち際の画面上の高さ: 陸が遠くまで続くほど上（奥）へ */
const shoreY = c => c >= 3 ? 52 : c >= 2 ? 59 - 7 * (c - 2) : c >= 1 ? 68 - 9 * (c - 1) : SH - 12 * Math.max(0, c);
/* 松林の帯（近景）: 浜より内陸側で、このノイズが高いところに続く */
const pineBelt = d => vnoise(d / 1300, 63);
/* 岬の高さ（中景）: 陸が中景を越えて張り出すところが盛り上がり、水平線を隠す */
function headH(k, X) {
  if (k.cn <= 2 || k.sea < 0.3) return 0;
  return Math.round(k.sea * k.sea * 25 * sstep(2.0, 2.65, k.cn) * (0.72 + 0.28 * vnoise(X / 23, 66)) + 1.4 * vnoise(X / 5, 67));
}
function hasSea(L, i) {
  for (let x = 0; x <= L.cw; x += 16) if (world(distAt(L, i, x)).sea > 0) return true;
  return false;
}

/* ---------- 海面 ---------- */
const toneOf = y => { let k = 0; while (k < 6 && y >= SEA_Y[k + 1]) k++; return k; };
/* 1列ぶんの海面を y0〜y1 に塗る。X はレイヤーの通し座標（模様がチャンクの境目でつながる）。
   波は横長の短い筋。きらめきの帯（低い周波数のノイズ）では明るい筋が増える */
function waterCol(g, x, X, y0, y1, salt) {
  if (y1 > SH) y1 = SH;
  if (y1 <= y0) return;
  for (let k = 0; k < 7; k++) { const a = Math.max(y0, SEA_Y[k]), b = Math.min(y1, SEA_Y[k + 1]); if (b > a) R(g, x, a, 1, b - a, SEA[k]); }
  const spark = sstep(0.5, 0.82, vnoise(X / 48, 64 + salt));
  for (let y = y0; y < y1; y++) {
    const k = toneOf(y);
    if (k > 0 && y === SEA_Y[k] && ((X + y) & 1)) R(g, x, y, 1, 1, SEA[k - 1]); // 段の境目を市松でなじませる
    const cwid = 6 + ((y - 52) >> 2) * 2, u = X + y * 7, cell = Math.floor(u / cwid), o = u - cell * cwid;
    const h = hash32(state.seed, 300 + y + salt * 40, cell), len = 2 + ((h >>> 8) % (cwid - 3)), p = (h & 255) / 255;
    if (o >= len) continue;
    if (p < 0.07 + 0.4 * spark) R(g, x, y, 1, 1, p < 0.16 * spark ? GLINT : SEA_L[k]);
    else if (p > 0.86) R(g, x, y, 1, 1, SEA_D[k]);
  }
}
function waterRect(g, x, w, X, y0, y1, salt) { for (let k = 0; k < w; k++) waterCol(g, x + k, X + k, y0, y1, salt); }
/* 波打ち際: 浅瀬の色、白い波、ぬれた砂 */
function shoreCol(g, x, X, sy, top, far) {
  const f = c => far ? hz(c, far) : c, h = hash32(state.seed, 290, Math.floor((X + 3) / 5));
  if (sy - 3 >= top && ((X + sy) & 1)) R(g, x, sy - 3, 1, 1, f(SHALLOW));
  if (sy - 2 >= top) R(g, x, sy - 2, 1, 1, f(SHALLOW));
  if (sy - 1 >= top) R(g, x, sy - 1, 1, 1, (h & 7) < 5 ? FOAM : f(SHALLOW));
  if (sy < SH) R(g, x, sy, 1, far ? 1 : 2, f(far ? SAND : SAND_WET));
}

/* ---------- 地面（landscape.js の ground() から区画ごとに呼ばれる）: 浜に近い側は砂、内陸は草 ---------- */
function shoreGround(g, r, x, w, y0, L, i, far) {
  const f = c => far ? hz(c, far) : c, grass = f(DUNE), sand = f(SAND);
  for (let k = 0; k < w; k++) {
    const X = i * L.cw + x + k, c = coast(L, i, x + k).c + 0.25 * (vnoise(X / 9, 68) - 0.5);
    if (far) { R(g, x + k, y0, 1, SH - y0, grass); continue; }
    if (c < 1.5) R(g, x + k, y0, 1, SH - y0, sand);
    else { R(g, x + k, y0, 1, SH - y0, grass); if (c < 1.62) R(g, x + k, y0 + 2 + (X & 1), 1, SH, sand); } // 砂が草地へ食い込む
  }
  if (far) { for (let k = (w >> 2); k > 0; k--) R(g, x + ri(r, 0, w - 1), y0 + ri(r, 0, 8), ri(r, 2, 5), 1, f(r() < 0.5 ? GRASS[1] : SAND)); return; }
  for (let k = (w >> 1); k > 0; k--) { // 砂のむら、草の株
    const px = x + ri(r, 0, w - 1), py = y0 + ri(r, 1, SH - y0 - 1), dry = coast(L, i, px).c < 1.5;
    R(g, px, py, ri(r, 1, 3), 1, dry ? (r() < 0.6 ? shade(SAND, 0.1) : tint(SAND, 0.3)) : (r() < 0.5 ? GRASS[1] : shade(DUNE, 0.14)));
  }
}
export const seaGroundMid = (g, r, x, w, y0, L, i) => shoreGround(g, r, x, w, y0, L, i, 0.3);
export const seaGroundNear = (g, r, x, w, y0, L, i) => shoreGround(g, r, x, w, y0, L, i, 0);

/* ---------- 海面の描き込み（地面のあと、建物・部品の前に呼ぶ）。海沿いでないチャンクでは何もしない ---------- */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/* 中景（base 59）: 海面と岬 */
export function seaMidWater(g, i, L, base) {
  if (!hasSea(L, i)) return;
  const cw = L.cw, hc = hz(GREENS[2], 0.22), hl = hz(GREENS[1], 0.25), hd = shade(hc, 0.16), rock = hz(ROCK, 0.25);
  for (let x = 0; x < cw; x++) {
    const k = coast(L, i, x);
    if (!k.sea) continue;
    const X = i * cw + x;
    if (k.c < 2) {
      const sy = k.c < 0.9 ? SH : Math.round(shoreY(k.c) + 1.6 * vnoise(X / 11, 65) - 0.8);
      waterCol(g, x, X, base, sy, 1);
      if (sy < SH && sy > base) shoreCol(g, x, X, sy, base, 0.25);
    }
    const hh = headH(k, X);
    if (hh > 0) { // 岬: 木に覆われた丘。すそは岩
      const top = base - hh;
      R(g, x, top, 1, hh + 3, hc); R(g, x, top, 1, 1, hl);
      for (let y = top + 1; y < base; y++) {
        const h = hash32(state.seed, 310 + y, (X + y * 3) >> 2) & 15;
        if (h < 3) R(g, x, y, 1, 1, hd); else if (h > 13) R(g, x, y, 1, 1, hl);
      }
      if (hh < 4) R(g, x, base - 1, 1, 2, rock);
    }
  }
}
/* 近景（base 68）: 浜まで寄せる波 */
export function seaNearWater(g, i, L, base) {
  if (!hasSea(L, i)) return;
  const cw = L.cw;
  for (let x = 0; x < cw; x++) {
    const k = coast(L, i, x);
    if (k.c >= 1) continue;
    const X = i * cw + x, sy = Math.round(shoreY(k.c) + 1.6 * vnoise(X / 13, 69) - 0.8);
    if (sy <= base) continue;
    waterCol(g, x, X, base, sy, 2);
    if (sy < SH) shoreCol(g, x, X, sy, base, 0);
  }
}
/* 遠景（base 52）: 水平線と沖。乱数は専用の列を使う（既存の景色の乱数を消費しない） */
export function seaFar(g, i, L, base) {
  if (!hasSea(L, i)) return;
  const cw = L.cw, land = hz('#7fa35a', 0.35), wood = hz(GREENS[2], 0.35), open = [];
  for (let x = 0; x < cw; x++) {
    const k = coast(L, i, x);
    open.push(k.c);
    if (!k.sea) continue;
    const X = i * cw + x;
    let sy = base;
    if (k.c < 3) {
      sy = k.c < 2 ? SH : Math.max(base + 1, Math.round(shoreY(k.c) + 0.8 * vnoise(X / 9, 70) - 0.4));
      waterCol(g, x, X, base, sy, 0);
      R(g, x, base, 1, 1, HORIZON);
      if (sy < SH) R(g, x, sy, 1, 1, hz(SAND, 0.3));
    }
    for (let y = sy + (k.c < 3 ? 1 : 0); y < 61; y++) { // 海沿いの陸: 草と林の色へ（重みでディザ）
      const b = BAYER[(X & 3) + ((y & 3) << 2)];
      if (b < k.sea * 20) R(g, x, y, 1, 1, (hash32(state.seed, 330 + y, (X + y) >> 2) & 7) < 2 ? wood : land);
    }
  }
  const r = rng(hash32(state.seed, 77, i));
  const free = (x, w, lim) => { for (let k = x; k <= x + w; k += 4) if (!(open[Math.min(cw - 1, k)] < lim)) return false; return open[Math.min(cw - 1, x + w)] < lim; };
  /* 沖の島・対岸の岬（水平線の上に薄い影） */
  for (let n = ri(r, 0, 2); n > 0; n--) {
    const cape = r() < 0.35, w = cape ? ri(r, 46, 90) : ri(r, 14, 40), x = ri(r, 2, cw - w - 2), h = cape ? ri(r, 2, 4) : ri(r, 3, 7), light = r() < 0.3;
    if (!free(x, w, 2.5)) continue;
    const c = hz(HILL_BACK, cape ? 0.5 : 0.3), cl = tint(c, 0.2), s1 = r() * 9, s2 = 0.3 + r() * 0.5;
    let px = -1, ph = 0;
    for (let k = 0; k < w; k++) {
      const t = k / (w - 1), hh = Math.round(h * Math.pow(Math.sin(Math.PI * t), 0.6) * (0.6 + 0.4 * Math.sin(s1 + t * 6 * s2 + 1)) + 0.3);
      if (hh < 1) continue;
      R(g, x + k, base - hh + 1, 1, hh, c); R(g, x + k, base - hh + 1, 1, 1, cl);
      if (hh > ph) { ph = hh; px = x + k; }
    }
    if (light && ph > 2) { R(g, px, base - ph - 2, 1, 3, '#f1f1ea'); R(g, px, base - ph - 3, 1, 1, '#5a626a'); } // 島の灯台
  }
  /* 沖を行く船 */
  for (let n = ri(r, 0, 3); n > 0; n--) {
    const t = r(), y = base + ri(r, 1, 3), dir = r() < 0.5;
    if (t < 0.3) { // 貨物船
      const w = ri(r, 13, 18), x = ri(r, 2, cw - w - 2), hc = hz(pick(r, ['#3f4f63', '#7a3f38', '#2f3f4a']), 0.35);
      if (!free(x, w, 1.9)) continue;
      R(g, x, y, w, 2, hc); R(g, x + 1, y + 2, w - 2, 1, hz('#8a3f38', 0.35));
      const bx = dir ? x + 1 : x + w - 4;
      R(g, bx, y - 3, 3, 3, hz('#eeeee6', 0.2)); R(g, bx + 1, y - 4, 1, 1, hz('#3f4f63', 0.3));
      for (let k = dir ? x + 5 : x + 1; k < (dir ? x + w - 2 : x + w - 6); k += 2) R(g, k, y - 1 - (r() < 0.5 ? 1 : 0), 2, 2, hz(pick(r, ['#b5553f', '#3f6f9a', '#c9a23f', '#5f8a6a', '#8f8f8a']), 0.35));
    } else if (t < 0.45) { // フェリー
      const w = ri(r, 9, 12), x = ri(r, 2, cw - w - 2);
      if (!free(x, w, 1.9)) continue;
      R(g, x, y, w, 2, hz('#f1f1ea', 0.15)); R(g, x + 2, y - 1, w - 4, 1, hz('#f1f1ea', 0.15)); R(g, x, y + 1, w, 1, hz('#3f6f9a', 0.3));
      R(g, x + (w >> 1), y - 2, 1, 1, hz('#c9503f', 0.3));
    } else { // 漁船: 白い点とマスト。2〜3隻が固まることもある
      let x = ri(r, 4, cw - 24);
      for (let m = ri(r, 1, 3); m > 0; m--) {
        if (free(x, 4, 1.9)) { R(g, x, y, 4, 1, hz('#f1f1ea', 0.15)); R(g, x + (dir ? 1 : 2), y - 1, 1, 1, hz('#f1f1ea', 0.15)); R(g, x, y + 1, 4, 1, SEA_D[0]); }
        x += ri(r, 6, 11);
      }
    }
  }
}
/* 遠景のその位置が海か（landscape.js が、遠くの建物・林を海の上に描かないために使う） */
export const farWet = (L, i, x, e) => coastAt(e, distAt(L, i, x)).c < 3.05;

/* ---------- 中景の部品 ---------- */
const mh = c => hz(c, 0.3);
function midBoat(g, r, x, y) { // 漁船
  const w = ri(r, 6, 9), dir = r() < 0.5, st = mh(pick(r, STRIPE));
  R(g, x, y, w, 1, mh(HULL[0])); R(g, x + 1, y + 1, w - 2, 1, st);
  R(g, dir ? x + 1 : x + w - 3, y - 2, 2, 2, mh('#e9e6dc')); R(g, dir ? x + 4 : x + w - 5, y - 4, 1, 4, mh('#5a626a'));
  R(g, x - 1, y + 2, w + 2, 1, SEA_L[2]);
  return w;
}
function midBuoys(g, r, x, y) { // 浮き玉の列
  const n = ri(r, 3, 6), step = ri(r, 3, 5);
  for (let k = 0; k < n; k++) R(g, x + k * step, y + (k & 1 && r() < 0.4 ? 1 : 0), 1, 1, r() < 0.7 ? mh(FLOAT) : mh('#f1f1ea'));
  return n * step;
}
function midRafts(g, r, x, y, w) { // 養殖のいかだ: 沖に並ぶ黒い筋と浮き
  const c = mh('#4f5a5f');
  for (let row = 0; row < 3; row++) {
    const yy = y + row * 2, off = row & 1 ? 3 : 0;
    for (let px = x + off; px + 6 < x + w; px += 9) { R(g, px, yy, 7, 1, c); if (r() < 0.6) R(g, px + ri(r, 0, 6), yy - 1, 1, 1, r() < 0.5 ? mh(FLOAT) : mh('#f1f1ea')); }
  }
  if (r() < 0.5) midBoat(g, r, x + ri(r, 4, w - 12), y + 3);
}
function midPine(g, r, x, b) {
  const c = mh(pick(r, PINE)), h = ri(r, 4, 6);
  R(g, x, b - h, 1, h, mh(TRUNK)); R(g, x - 2, b - h - 1, 5, 2, c); R(g, x - 1, b - h - 2, 3, 1, tint(c, 0.15)); if (h > 4) R(g, x - (r() < 0.5 ? 3 : -1), b - h + 2, 3, 1, c);
}
function midIslet(g, r, x, y, w) { // 岩礁・小島: 岩に松、ときに鳥居
  const h = ri(r, 2, 5), c = mh(ROCK), cd = mh(ROCK_D);
  for (let k = 0; k < w; k++) {
    const t = k / (w - 1), hh = Math.max(1, Math.round(h * Math.pow(Math.sin(Math.PI * t), 0.5) * (0.7 + 0.3 * Math.sin(t * 9 + h))));
    R(g, x + k, y - hh + 1, 1, hh, k > w * 0.6 ? cd : c); if (hh > 1 && k <= w * 0.6) R(g, x + k, y - hh + 1, 1, 1, tint(c, 0.25));
  }
  for (let k = 0; k < w; k += 2) if (r() < 0.6) R(g, x + k, y + 1, 2, 1, FOAM);
  if (w > 12) { for (let n = ri(r, 1, 3), px = x + (w >> 1) - 3; n > 0; n--, px += ri(r, 3, 5)) midPine(g, r, px, y - h + 1); if (r() < 0.25) torii(g, x + 2, y - 1, 1); }
}
function midBreakwater(g, r, x, y, w) { // 防波堤と灯台: 沖側に消波ブロック
  const c = mh(CONC), red = r() < 0.5, left = r() < 0.5;
  for (let k = 1; k < w - 1; k++) if (hash32(state.seed, 320, x + k) % 3) R(g, x + k, y - 1, 1, 1, mh(k & 1 ? CONC_D : '#a3a39b'));
  R(g, x, y, w, 2, c); R(g, x, y, w, 1, tint(c, 0.3)); R(g, x, y + 2, w, 1, SEA_D[3]);
  const lx = left ? x + 2 : x + w - 4;
  R(g, lx - 1, y - 1, 4, 1, tint(c, 0.2)); R(g, lx, y - 7, 2, 6, red ? mh('#c9503f') : mh('#f1f1ea')); R(g, lx, y - 8, 2, 1, mh('#3f4a55')); R(g, lx, y - 5, 2, 1, red ? mh('#f1f1ea') : mh('#c9503f'));
}
function midShed(g, r, x, b, w) { // 漁村の家・倉庫
  const c = mh(pick(r, BOARD)), rc = hz(pick(r, TIN), 0.38), h = ri(r, 2, 4);
  R(g, x, b - h, w, h, c); R(g, x + w - 1, b - h, 1, h, shade(c, 0.15));
  R(g, x - 1, b - h - 1, w + 2, 1, rc); R(g, x, b - h - 2, w, 1, tint(rc, 0.2));
  if (w > 5) R(g, x + 2, b - h + 1, 2, 1, hz(WIN_D));
}
function midPort(g, r, x, b, w, X) { // 漁港: 岸壁、倉庫、もやった船、突き出た防波堤
  const q = b + 4, c = mh(CONC);
  waterRect(g, x, w, X, b, q, 1);
  R(g, x, q, w, SH - q, mh('#a9aaa0')); R(g, x, q, w, 1, tint(c, 0.3)); R(g, x, q + 1, w, 1, mh(CONC_D));
  for (let px = x + ri(r, 2, 5); px + 9 < x + w;) { const sw = ri(r, 6, 11); midShed(g, r, px, q + 3, sw); px += sw + ri(r, 2, 9); }
  for (let px = x + ri(r, 3, 8); px + 10 < x + w; px += ri(r, 10, 18)) midBoat(g, r, px, q - 2);
  const left = r() < 0.5, bl = ri(r, 14, 24);
  midBreakwater(g, r, left ? x - bl + 6 : x + w - 6, b + 1, bl);
}
/* 中景の1区切り。戻り値は使った幅（0 なら何もせず、田園の部品に任せる） */
export function seaMid(g, r, x, b, rem, e, L, i) {
  const k = coastAt(e, distAt(L, i, x)), X = i * L.cw + x;
  if (k.c >= 2) { // 陸
    const hh = headH(k, X);
    if (hh > 2) { // 岬の上: たまに灯台
      if (hh > 12 && rem > 8 && r() < 0.025) { const t = b - headH(coast(L, i, x + 3), X + 3); R(g, x + 3, t - 7, 2, 7, mh('#f1f1ea')); R(g, x + 3, t - 8, 2, 1, mh('#3f4a55')); R(g, x + 2, t - 6, 4, 1, mh('#dcdcd2')); }
      return Math.min(ri(r, 8, 18), rem);
    }
    if (r() >= k.sea) return 0;
    const t = r();
    if (t < 0.12 && rem > 40) { let px = x; for (let n = ri(r, 3, 6); n > 0; n--) { const w = ri(r, 5, 9); midShed(g, r, px + 1, b + ri(r, 0, 1), w); px += w + ri(r, 1, 3); } return px - x + 2; } // 集落
    if (t < 0.3) { for (let n = ri(r, 2, 5), px = x + 2; n > 0; n--, px += ri(r, 3, 5)) midPine(g, r, px, b + ri(r, 0, 1)); return 22; }
    return Math.min(ri(r, 6, 14), rem);
  }
  const t = r(), y = b + ri(r, 2, 6), wet = (w, lim) => coast(L, i, x + w).c < lim;
  if (k.c < 1.15) { // 沖まで海
    if (t < 0.03 && rem > 70) { const w = ri(r, 36, 66); if (wet(w, 1.15)) { midBreakwater(g, r, x, Math.min(y, b + 5), w); return w + 6; } }
    else if (t < 0.055 && rem > 60) { const w = ri(r, 34, 56); if (wet(w, 1.15)) { midRafts(g, r, x, b + 1, w); return w + 4; } }
    else if (t < 0.085 && rem > 30) { const w = ri(r, 9, 24); if (wet(w, 1.15)) { midIslet(g, r, x, y, w); return w + 6; } }
    else if (t < 0.13 && rem > 12) return midBoat(g, r, x, y) + 6;
    else if (t < 0.17 && rem > 30) return midBuoys(g, r, x, y) + 4;
  } else if (k.c > 1.3 && k.c < 1.85) { // 岸が中景の帯の中にある
    if (t < 0.07 && rem > 80) { const w = ri(r, 44, 68), c2 = coast(L, i, x + w).c; if (c2 > 1.3 && c2 < 1.9) { midPort(g, r, x, b, w, X); return w + 8; } }
    else if (t < 0.12 && rem > 12 && shoreY(k.c) - b > 5) return midBoat(g, r, x, b + 2) + 6;
  }
  return Math.min(ri(r, 6, 16), rem);
}

/* ---------- 近景の部品 ---------- */
function pad(g, cx, y, rw, c) { // 松の枝ぶり1段
  R(g, cx - rw, y, 2 * rw + 1, 2, c); R(g, cx - rw + 1, y - 1, 2 * rw - 1, 1, c);
  R(g, cx - rw + 1, y - 1, rw, 1, tint(c, 0.2)); R(g, cx - rw + 1, y + 2, 2 * rw - 1, 1, shade(c, 0.3));
}
function pine(g, r, x, b, h) { // クロマツ: 曲がった幹に、平たい枝ぶりが段になる
  const ln = r() < 0.5 ? 1 : -1, c = pick(r, PINE), top = b - h, m = b - (h >> 1);
  R(g, x, m, 1, b - m, TRUNK); R(g, x + ln, top + 3, 1, m - top - 3, TRUNK); R(g, x + 2 * ln, top + 2, 1, 3, TRUNK);
  if (h > 13) { R(g, x - 2 * ln, m - 2, 2, 1, TRUNK); pad(g, x - 4 * ln, m - 4, 2, c); }
  pad(g, x + 4 * ln, top + 6, 3, c); pad(g, x - ln, top + 4, 3, c); pad(g, x + 2 * ln, top + 1, 4, c);
}
function fishHouse(g, r, x, b, w) { // 漁村の民家: 板壁に瓦かトタンの切妻屋根
  const c = pick(r, BOARD), rc = pick(r, TIN), h = ri(r, 6, 7), rh = 4, top = b - h;
  R(g, x + 1, top, w - 2, h, c); R(g, x + w - 2, top, 1, h, shade(c, 0.2));
  for (let xx = x + 3; xx < x + w - 2; xx += 3) R(g, xx, top + 1, 1, h - 1, shade(c, 0.08));
  R(g, x + 3, top + 2, 4, 2, WIN_D); R(g, x + 5, top + 2, 1, 2, tint(c, 0.3));
  R(g, x + w - 7, b - 5, 3, 5, shade(c, 0.4)); if (w > 16) R(g, x + 9, top + 2, 3, 2, WIN_D);
  ink(g, x + 1, top, w - 2, h);
  for (let k = 0; k < rh; k++) { const s = (rh - 1 - k) * 2; R(g, x + s, top - rh + k + 1, w - 2 * s, 1, k === 0 ? tint(rc, 0.25) : rc); }
  R(g, x, top + 1, w, 1, shade(rc, 0.3));
}
function banya(g, r, x, b, w) { // 番屋: 波板の小屋、軒に浮き玉、わきに魚箱
  const c = pick(r, ['#8f9aa0', '#7f8f96', '#a39b8c', '#6f8a94']), h = ri(r, 5, 7), top = b - h;
  R(g, x + 1, top, w - 5, h, c);
  for (let xx = x + 2; xx < x + w - 5; xx += 2) R(g, xx, top, 1, h, shade(c, 0.1));
  R(g, x + 2, b - 4, 3, 4, shade(c, 0.45));
  ink(g, x + 1, top, w - 5, h);
  R(g, x, top - 1, w - 3, 1, shade(c, 0.4)); R(g, x, top, w - 3, 1, shade(c, 0.22));
  for (let xx = x + 6; xx < x + w - 5; xx += 2) R(g, xx, top + 2, 1, 1, r() < 0.7 ? FLOAT : '#f1f1ea');
  const bc = pick(r, ['#3f7fb5', '#e8e8e0', '#4f9a8a']);
  R(g, x + w - 3, b - 3, 3, 3, bc); R(g, x + w - 3, b - 2, 3, 1, shade(bc, 0.2));
}
function nets(g, r, x, b, w) { // 干してある網: さおに掛けた網と浮き
  const c = pick(r, ['#5f7f7a', '#7a6a55', '#4f6f8a']), top = b - 6;
  R(g, x, top, 1, 6, TRUNK); R(g, x + w - 1, top, 1, 6, TRUNK); R(g, x, top, w, 1, '#8a7a63');
  for (let yy = 1; yy < 5; yy++) for (let xx = 1 + (yy & 1); xx < w - 1; xx += 2) R(g, x + xx, top + yy, 1, 1, c);
  for (let xx = 2; xx < w - 2; xx += 3) if (r() < 0.5) R(g, x + xx, top + 1, 1, 1, FLOAT);
}
function beachBoat(g, r, x, y, w) { // 浜に揚げた小舟
  const hull = pick(r, HULL), st = pick(r, STRIPE), dir = r() < 0.5;
  R(g, x + 1, y - 2, w - 2, 2, hull); R(g, dir ? x + w - 1 : x, y - 3, 1, 2, hull); R(g, x, y - 2, w, 1, st);
  R(g, x + 2, y, w - 4, 1, shade(hull, 0.35));
  if (r() < 0.4) { R(g, dir ? x + 2 : x + w - 5, y - 4, 3, 2, '#dcd9cf'); R(g, dir ? x + 3 : x + w - 4, y - 4, 1, 1, WIN_D); }
}
function seaBoat(g, r, x, y) { // 岸近くの漁船
  const w = ri(r, 15, 20), hull = pick(r, HULL), st = pick(r, STRIPE), dir = r() < 0.5, cx0 = dir ? x + 3 : x + w - 8;
  R(g, x + 1, y - 2, w - 2, 2, hull); R(g, dir ? x + w - 1 : x, y - 3, 2, 2, hull); R(g, x + 2, y, w - 4, 1, st);
  R(g, cx0, y - 6, 5, 4, '#e9e6dc'); R(g, cx0 + 1, y - 5, 3, 1, WIN_D); R(g, cx0, y - 7, 5, 1, '#5a626a');
  R(g, cx0 + (dir ? 7 : -3), y - 9, 1, 7, '#5a626a'); R(g, cx0 + (dir ? 8 : -5), y - 8, 2, 1, pick(r, ['#c9503f', '#e0a23a', '#3f7fb5']));
  R(g, x, y + 1, w + 1, 1, FOAM);
  return w;
}
function rock(g, r, x, y, w) { // 岩場: 波が白く砕ける
  const h = ri(r, 2, 4) + (w > 9 ? 1 : 0);
  for (let k = 0; k < w; k++) {
    const t = k / (w - 1 || 1), hh = Math.max(1, Math.round(h * Math.pow(Math.sin(Math.PI * t), 0.5) * (0.65 + 0.35 * Math.sin(t * 11 + w))));
    R(g, x + k, y - hh + 1, 1, hh, k > w * 0.55 ? ROCK_D : ROCK); if (hh > 1 && k <= w * 0.55) R(g, x + k, y - hh + 1, 1, 1, tint(ROCK, 0.3));
  }
  for (let k = -1; k <= w; k++) if (r() < 0.7) R(g, x + k, y + 1, 1, 1, FOAM);
  if (r() < 0.5) R(g, x - 2, y, 2, 1, FOAM);
}
function tufts(g, r, x, b, w) { // 浜の草（ハマニンニクなど）
  for (let k = ri(r, 2, 4); k > 0; k--) { const px = x + ri(r, 0, w - 2), py = b + ri(r, 1, 5); R(g, px, py - 1, 1, 2, DUNE); R(g, px + 1, py, 2, 1, shade(DUNE, 0.12)); R(g, px + 2, py - 2, 1, 2, tint(DUNE, 0.12)); }
}
/* 近景の1区切り。戻り値は使った幅（0 なら田園の部品に任せる） */
export function seaNear(g, r, x, b, rem, e, L, i) {
  const d = distAt(L, i, x), k = coastAt(e, d);
  if (!k.sea) return 0;
  if (k.c < 1) { // 波打ち際が近景の帯の中: 岩場、岸近くの船
    const t = r(), sy = shoreY(k.c);
    if (t < 0.1 && rem > 14) { const w = ri(r, 4, 12); rock(g, r, x + 1, b + ri(r, 2, Math.max(2, Math.min(6, sy - b - 2))), w); return w + 4; }
    if (t < 0.15 && rem > 24 && k.c < 0.55) return seaBoat(g, r, x + 1, b + ri(r, 3, 5)) + 6;
    return Math.min(ri(r, 6, 16), rem);
  }
  if (r() >= Math.min(1, k.sea * 1.4)) return 0;
  const t = r(), wr = (a, z) => Math.min(ri(r, a, z), rem);
  if (k.c < 1.5) { // 浜: 見通しをさえぎらない低いものだけ
    if (t < 0.09 && rem > 16) { const w = ri(r, 10, 14); beachBoat(g, r, x, b + ri(r, 2, 5), w); return w + 4; }
    if (t < 0.14 && rem > 20) { const w = ri(r, 11, 17); nets(g, r, x, b + ri(r, 1, 3), w); return w + 3; }
    if (t < 0.18 && rem > 16) { const w = ri(r, 12, 15); banya(g, r, x, b + 1, w); return w + 2; }
    if (t < 0.24 && rem > 12) { const w = ri(r, 4, 9); rock(g, r, x + 1, b + ri(r, 2, 5), w); return w + 3; }
    if (t < 0.4) tufts(g, r, x, b, 10);
    return wr(8, 16);
  }
  const belt = sstep(0.5, 0.62, pineBelt(d)) * sstep(1.5, 1.75, k.c);
  if (r() < belt) { // 松林: 幹のあいだから海がのぞく
    const w = wr(6, 11);
    if (rem > 12) pine(g, r, x + 4, b + ri(r, 0, 2), ri(r, 12, 19));
    return w;
  }
  if (t < 0.2 && rem >= 22) { const w = wr(15, 22); fishHouse(g, r, x, b, w); return w; } // 漁村
  if (t < 0.28 && rem >= 16) { const w = ri(r, 12, 15); banya(g, r, x, b, w); return w + 1; }
  if (t < 0.34 && rem >= 20) { const w = ri(r, 11, 17); nets(g, r, x, b + 1, w); return w + 2; }
  if (t < 0.42 && rem > 12) { pine(g, r, x + 4, b + 1, ri(r, 11, 16)); return 10; }
  if (t < 0.47 && rem > 16) { const w = ri(r, 10, 14); beachBoat(g, r, x, b + ri(r, 2, 4), w); return w + 3; }
  if (t < 0.6) tufts(g, r, x, b, 10);
  return wr(7, 15);
}

/* ---------- 線路際 ---------- */
function wallBody(g, r, x, len, top, c) {
  R(g, x, top, len, SH - top, c); R(g, x, top, len, 1, tint(c, 0.4)); R(g, x, top + 1, len, 1, shade(c, 0.1));
  for (let k = ri(r, 6, 16); k < len; k += 18) R(g, x + k, top + 2, 1, SH, shade(c, 0.13));
  for (let k = ri(r, 4, 14); k < len - 2; k += ri(r, 14, 30)) { R(g, x + k, top + 3, 1, 1, shade(c, 0.5)); if (r() < 0.6) R(g, x + k, top + 4, 1, ri(r, 2, 4), mix(c, '#8a6a4a', 0.35)); } // 水抜き穴とさびの筋
  R(g, x, SH - 1, len, 1, '#857f78');
}
function seawall(g, r, x, len) { wallBody(g, r, x, len, 73, CONC); } // 護岸の壁
function tetra(g, r, x, len) { // 消波ブロック: 壁の向こうに積まれた頭がのぞく
  R(g, x, 71, len, 2, '#6f6f6b'); // ブロックのすき間の影
  for (let row = 0; row < 2; row++) for (let xx = ri(r, -2, 1); xx < len - 1; xx += ri(r, 4, 6)) { // 奥の段、手前の段
    const c = pick(r, ['#a9a9a0', '#9a9a93', '#b5b5ac', '#8f8f8a']), y = 69 + row * 2 + ri(r, 0, 1), w = ri(r, 3, 4), a = Math.max(0, xx), b = Math.min(len, xx + w);
    if (b <= a || (row === 0 && r() < 0.25)) continue;
    R(g, x + a, y, b - a, 74 - y, c); R(g, x + a, y, b - a - 1, 1, tint(c, 0.3)); R(g, x + b - 1, y + 1, 1, 2, shade(c, 0.28));
    if (r() < 0.6 && b - a > 2) R(g, x + a + ri(r, 0, 1), y - 1, 2, 1, c); // 突き出た脚
  }
  wallBody(g, r, x, len, 73, CONC);
}
function pipeRail(g, r, x, len) { // 低い護岸に白い手すり: 海がよく見える
  wallBody(g, r, x, len, 75, CONC);
  R(g, x, 71, len, 1, '#e9e9e2'); R(g, x, 73, len, 1, '#d5d5cc');
  for (let k = ri(r, 2, 8); k < len; k += 10) R(g, x + k, 71, 1, 4, '#c9c9c0');
}
function sandy(g, r, x, len) { // 砂地: 浜の草、流木のくい
  const gy = 75;
  R(g, x, gy, len, SH - gy, SAND); R(g, x, gy, len, 1, tint(SAND, 0.3));
  for (let k = 0; k < len / 2; k++) R(g, x + ri(r, 0, len - 1), ri(r, gy + 1, SH - 1), ri(r, 1, 3), 1, shade(SAND, r() < 0.5 ? 0.1 : 0.2));
  for (let xx = ri(r, 0, 6); xx < len - 3; xx += ri(r, 4, 13)) { const h = ri(r, 1, 3); R(g, x + xx, gy - h, 1, h + 1, DUNE); R(g, x + xx + 1, gy - 1, 2, 2, shade(DUNE, 0.1)); if (h > 2) R(g, x + xx + 2, gy - 2, 1, 1, tint(DUNE, 0.15)); }
  if (r() < 0.45) for (let k = ri(r, 2, 8); k < len; k += 11) R(g, x + k, 71 + (k & 1), 1, 5, '#8a7a63'); // 古いくいの列
}
function road(g, r, x, len) { // 海沿いの道路: ガードレールとアスファルト
  const gy = 75;
  R(g, x, gy, len, SH - gy, '#74787b'); R(g, x, gy, len, 1, '#c9c9c0'); R(g, x, SH - 1, len, 1, '#8d8b82');
  for (let k = 2; k < len - 4; k += 9) R(g, x + k, 77, 5, 1, '#e8e4c8');
  R(g, x, 72, len, 2, '#eeeee8'); R(g, x, 73, len, 1, '#c5c5bd');
  for (let k = ri(r, 2, 7); k < len; k += 8) R(g, x + k, 72, 1, 3, '#9a9a93');
}
/* 線路際の1区切り。描いたら true（false なら既存の田園の線路際に任せる） */
export function seaTrack(g, r, x, len, e, L, i) {
  if (r() >= Math.min(1, e.sea * 1.3)) return false;
  const k = coastAt(e, distAt(L, i, x + (len >> 1))), t = r();
  if (k.c < 1.2) (t < 0.4 ? seawall : t < 0.72 ? tetra : pipeRail)(g, r, x, len); // 海がすぐそこ: 護岸
  else if (t < 0.38) sandy(g, r, x, len);
  else if (t < 0.56) road(g, r, x, len);
  else if (t < 0.68) pipeRail(g, r, x, len);
  else return false;
  return true;
}
