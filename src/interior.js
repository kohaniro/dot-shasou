import { W } from './state.js';
import { rng, ri, pick } from './rng.js';
import { P, R, shade, tint } from './palette.js';
import { carStyle } from './carstyle.js';

/* ---------- interior (pre-rendered, windows punched out) ---------- */
export const interior = document.createElement('canvas');
interior.width = W; interior.height = 180;
/* 扉（左右の端に1枚ずつ見えている）。車内の絵とは別に持ち、開き具合に合わせて戸袋（座席側の壁の裏）へずらして描く */
const DOORS = [[0, 1], [286, -1]];
const leaves = DOORS.map(() => { const c = document.createElement('canvas'); c.width = 34; c.height = 180; return c; });
/* open: 0（閉）〜1（全開）。車内（interior）を重ねる前に呼ぶ。戸袋に入った分は描かない（開口 x 0〜32 / 287〜319 の中だけ） */
export const DOOR_W = 33;
export const doorShift = open => Math.round(DOOR_W * Math.min(1, Math.max(0, open)));
export function drawDoors(g, open) {
  const sh = doorShift(open), w = DOOR_W - sh;
  if (w <= 0) return;
  g.drawImage(leaves[0], 0, 0, w, 180, sh, 0, w, 180);
  g.drawImage(leaves[1], 1 + sh, 0, w, 180, 287, 0, w, 180);
}
export function drawInterior() {
  const g = interior.getContext('2d'), r = rng(20261113);
  const S = (x, y, w, h, c) => R(g, x, y, w, h, c);   // 面
  const HL = (x, y, w, c) => R(g, x, y, w, 1, c);     // 1ドットの横線
  const VL = (x, y, h, c) => R(g, x, y, 1, h, c);     // 1ドットの縦線
  const VR = (x, y, h, c) => R(g, x - 1, y, 1, h, c);
  // 路線ごとの車両（carstyle.js）。どの表も先頭が元の車内で、そのときは元の色・形のまま描く
  const car = carStyle();
  const wall = car.wall.c, wallSh = car.wall.sh || shade(wall, 0.18), wallTop = car.wall.top || tint(wall, 0.38);
  const fr = '#9aa0a3', frD = '#6c7275', frL = '#c7ccce';
  g.clearRect(0, 0, interior.width, interior.height);
  S(0, 0, 320, 180, wall);
  S(0, 0, 320, 6, wallTop); S(60, 2, 200, 2, '#fdfdf2'); S(0, 6, 320, 1, wallSh);
  // ad strip above the windows (架空の広告)
  for (let k = 0; k < 5; k++) {
    const px = 52 + k * 44, c = pick(r, ['#d85a4a', '#3f7fb5', '#e9c046', '#4f9a6a', '#ece8dc', '#7a5fa8']);
    S(px - 1, 9, 42, 11, wallSh); S(px, 10, 40, 9, c);
    const inkc = c === '#ece8dc' ? '#55606b' : tint(c, 0.8);
    S(px + 3, 12, ri(r, 10, 20), 2, inkc); S(px + 3, 15, ri(r, 14, 30), 1, inkc);
    if (r() < 0.6) S(px + 30, 12, 6, 5, shade(c, 0.25));
  }
  // luggage rack
  HL(44, 22, 232, frL); S(44, 23, 232, 1, frD);
  for (let x = 62; x < 270; x += 38) { S(x, 20, 1, 2, frD); S(x + 1, 21, 1, 2, frD); }
  HL(44, 24, 232, wallSh);
  // window frame
  S(48, 26, 224, 80, fr); HL(48, 26, 224, frL); VL(48, 26, 80, frL);
  S(271, 26, 1, 80, frD); S(48, 105, 224, 1, frD); S(49, 104, 222, 1, frL);
  S(158, 28, 4, 76, fr); VL(158, 28, 76, frL); VR(162, 28, 76, frD);
  // wall under window
  S(44, 106, 232, 4, wall); S(44, 109, 232, 1, wallSh);
  // seat back + cushion（7人掛け x 46〜274）
  bench(g, 46, 274, seatCols(car.seat), car.pattern);
  // seat base / heater
  S(46, 148, 228, 9, '#8f9496'); HL(46, 148, 228, '#5d6266');
  for (let x = 50; x < 270; x += 4) { S(x, 151, 2, 1, '#5d6266'); S(x, 153, 2, 1, '#5d6266'); }
  // floor
  S(0, 157, 320, 23, '#7b756b'); S(0, 157, 320, 1, '#4f4b45');
  // doors (left / right edges): 枠・鴨居・床の縁だけをここに描き、扉そのものは leaf に描いて毎フレーム重ねる（drawDoors）
  DOORS.forEach(([dx0, dir], k) => {
    S(dx0, 7, 34, 150, '#b7bcbe'); S(dx0, 7, 34, 7, '#2a2d31');
    for (let k = 0; k < 7; k++) if (k !== 3) S(dx0 + 6 + k * 3, 10, 2, 1, '#f2b84b');
    S(dx0, 14, 34, 1, '#8d9396');
    S(dir > 0 ? dx0 + 33 : dx0, 7, 1, 150, frD);
    S(dx0, 157, 34, 2, '#a7acae'); S(dx0, 159, 34, 2, '#d0ae3c');
    // 扉（閉じた位置で描く。窓は抜く）
    const lf = leaves[k], lg = lf.getContext('2d'), LS = (x, y, w, h, c) => R(lg, x - dx0, y, w, h, c);
    lg.clearRect(0, 0, lf.width, lf.height);
    LS(dx0, 15, 34, 142, '#b7bcbe');
    LS(dx0 + 6, 30, 22, 66, '#26282a');
    R(lg, 2, 100, 30, 1, '#9aa0a3'); LS(dx0, 150, 34, 7, '#9aa0a3');
    LS(dir > 0 ? dx0 : dx0 + 32, 15, 2, 142, '#d9b53f');
    lg.clearRect(8, 32, 18, 62);
  });
  S(34, 7, 10, 150, wall); S(276, 7, 10, 150, wall);
  // sleeve partitions + stanchions
  const top = sleeve(g, car.sleeve, frL, frD);
  [42, 276].forEach(px => { S(px, 6, 1, top - 6, '#d7dbdd'); S(px + 1, 6, 1, top - 6, '#8d9396'); });
  [111, 207].forEach(px => { S(px, 23, 1, 125, '#dfe3e5'); S(px + 1, 23, 1, 125, '#8d9396'); });
  S(44, 7, 232, 1, '#8d9396'); // strap rail
  // window openings
  [[50, 28, 108, 76], [162, 28, 108, 76], [0, 15, 33, 142], [287, 15, 33, 142]].forEach(([x, y, w, h]) => {
    g.clearRect(x, y, w, h);
  });
  // the mid stanchions pass in front of the glass
  [111, 207].forEach(px => { S(px, 28, 1, 76, '#dfe3e5'); S(px + 1, 28, 1, 76, '#8d9396'); });
}
/* 座席の色の組: 基準色 c、影 d、ハイライト l / ll。元の青だけ手で選んだ値（classic） */
const seatCols = s => s.classic ? { c: s.base, ...s.classic } : { c: s.base, d: shade(s.base, 0.33), l: tint(s.base, 0.16), ll: tint(s.base, 0.28) };
/* 座席（背もたれ・座面・席の境目）を x0〜x1 に描く。x0 = 46, x1 = 274 で元の座席と同じ。模様は座席全体で共通の格子に乗せる */
function bench(g, x0, x1, { c, d, l, ll }, pattern) {
  const S = (x, y, w, h, col) => R(g, x, y, w, h, col), w = x1 - x0;
  S(x0, 110, w, 26, c); S(x0, 110, w, 2, l); R(g, x0, 110, w, 1, ll); S(x0, 132, w, 4, d);
  if (pattern === '点') {
    const dy = 3, dx = 6;
    g.fillStyle = P(l);
    let row = 0;
    for (let y = 114; y < 131; y += dy, row++) {
      const o = 48 + (row & 1) * (dx >> 1);
      for (let x = o + Math.max(0, Math.ceil((x0 + 2 - o) / dx)) * dx; x < x1 - 1; x += dx) g.fillRect(x, y, 1, 1);
    }
  } else if (pattern === '縞') { // 細い縦縞（2ドット幅、間隔 6。中ほどの色）
    const m = tint(c, 0.08);
    for (let x = 48 + Math.max(0, Math.ceil((x0 + 2 - 48) / 6)) * 6; x < x1 - 2; x += 6) S(x, 113, 2, 19, m);
  }
  const div = k => Math.round(46 + k * 228 / 7);
  if (pattern === '無地') { // 席ごとに背もたれの上の丸み（ハイライト）と腰の継ぎ目
    for (let k = 0; k < 7; k++) {
      const a = Math.max(x0, div(k)) + 2, b = Math.min(x1, div(k + 1)) - 2;
      if (b > a) { S(a, 112, b - a, 1, ll); S(a, 124, b - a, 1, tint(c, 0.06)); }
    }
  }
  for (let k = 1; k < 7; k++) if (div(k) > x0 && div(k) < x1) R(g, div(k), 111, 1, 25, d);
  // cushion
  S(x0, 136, w, 6, l); R(g, x0, 136, w, 1, ll); S(x0, 142, w, 6, c); S(x0, 146, w, 2, d);
  for (let k = 1; k < 7; k++) if (div(k) > x0 && div(k) < x1) R(g, div(k), 136, 1, 12, d);
}
/* 座席の袖仕切り（x 40〜46 / 274〜280）。上端の y を返す（扉脇の縦の手すりはそこまで） */
function sleeve(g, kind, frL, frD) {
  const S = (x, y, w, h, col) => R(g, x, y, w, h, col);
  const top = kind === '高' ? 64 : kind === '丸' ? 92 : 96, h = 157 - top;
  [40, 274].forEach(px => {
    if (kind === '丸') { // 角の丸い板（縁はパイプの色）
      S(px + 2, top, 2, 1, frL);
      S(px + 1, top + 1, 4, 1, '#c9cdd0'); S(px + 1, top + 1, 1, 1, frD); S(px + 4, top + 1, 1, 1, frD);
      S(px, top + 2, 6, h - 2, '#c9cdd0'); S(px, top + 2, 1, h - 2, frD); S(px + 5, top + 2, 1, h - 2, frD);
      return;
    }
    S(px, top, 6, h, '#c9cdd0'); R(g, px, top, 6, 1, frL); R(g, px, top, 1, h, frD); R(g, px + 5, top, 1, h, frD);
    if (kind === '高') { S(px + 2, top + 4, 2, 28, '#e2e8ea'); S(px + 2, top + 32, 2, 1, frD); } // 上半分のすりガラス
  });
  return top;
}
/* つり革。輪は 8×8 ドット以内（線の太さ 1、握りの所は太く）、行ごとの [x, 幅, ...]。lean はカーブでの傾き（輪の位置でのドット数。正で右へ） */
const RING = [[2, 4], [1, 1, 6, 1], [0, 1, 7, 1], [0, 1, 7, 1], [0, 1, 7, 1], [0, 1, 7, 1], [1, 1, 6, 1], [2, 4]];
const TRI = [[3, 2], [2, 1, 5, 1], [2, 1, 5, 1], [1, 1, 6, 1], [1, 1, 6, 1], [0, 1, 7, 1], [0, 8], [0, 8]];
const SQR = [[1, 6], [0, 1, 7, 1], [0, 1, 7, 1], [0, 1, 7, 1], [0, 1, 7, 1], [0, 8], [0, 8], [1, 6]];
const SHAPES = { 丸: RING, 三角: TRI, 角: SQR };
export function drawStraps(g, t, jolt, lean = 0) {
  const y0 = 8, y1 = 30, bw = 2, rw = 8, car = carStyle(), shape = SHAPES[car.strap];
  for (let k = 0; k < 8; k++) {
    const x = 62 + k * 28, belt = car.belt;
    const off = Math.round(lean + Math.sin(t * 1.9 + k * 0.5) * 1.1 + jolt * Math.sin(k * 1.3 + t * 9));
    for (let y = y0; y < y1; y++) R(g, x + Math.round(off * (y - y0) / (y1 - y0)), y, bw, 1, y < y1 - 4 ? belt.c : belt.d);
    for (let p = 0; p < 2; p++) {
      g.fillStyle = P(p ? car.ring.c : '#5d6266');
      const ox = x + off - (rw >> 1) + (bw >> 1) + (p ? 0 : 1), oy = y1 - 1 + (p ? 0 : 1);
      shape.forEach((row, j) => { for (let i = 0; i < row.length; i += 2) g.fillRect(ox + row[i], oy + j, row[i + 1], 1); });
    }
  }
}
