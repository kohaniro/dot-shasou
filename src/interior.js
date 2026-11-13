import { W } from './state.js';
import { rng, ri, pick } from './rng.js';
import { P, R, shade, tint } from './palette.js';

/* ---------- interior (pre-rendered, windows punched out) ---------- */
export const interior = document.createElement('canvas');
interior.width = W; interior.height = 180;
export function drawInterior() {
  const g = interior.getContext('2d'), r = rng(20261113);
  const S = (x, y, w, h, c) => R(g, x, y, w, h, c);   // 面
  const HL = (x, y, w, c) => R(g, x, y, w, 1, c);     // 1ドットの横線
  const VL = (x, y, h, c) => R(g, x, y, 1, h, c);     // 1ドットの縦線
  const VR = (x, y, h, c) => R(g, x - 1, y, 1, h, c);
  const wall = '#d9d6cc', wallSh = '#b9b6ac';
  const fr = '#9aa0a3', frD = '#6c7275', frL = '#c7ccce';
  const seat = '#3f6f8f', seatD = '#2f556f', seatL = '#5587a6', seatLL = '#6a9bb8';
  g.clearRect(0, 0, interior.width, interior.height);
  S(0, 0, 320, 180, wall);
  S(0, 0, 320, 6, '#e8e6de'); S(60, 2, 200, 2, '#fdfdf2'); S(0, 6, 320, 1, wallSh);
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
  // seat back
  S(46, 110, 228, 26, seat); S(46, 110, 228, 2, seatL); HL(46, 110, 228, seatLL); S(46, 132, 228, 4, seatD);
  const dy = 3, dx = 6;
  g.fillStyle = P(seatL);
  let row = 0;
  for (let y = 114; y < 131; y += dy, row++) for (let x = 48 + (row & 1) * (dx >> 1); x < 273; x += dx) g.fillRect(x, y, 1, 1);
  for (let k = 1; k < 7; k++) VL(Math.round(46 + k * 228 / 7), 111, 25, seatD);
  // cushion
  S(46, 136, 228, 6, seatL); HL(46, 136, 228, seatLL); S(46, 142, 228, 6, seat); S(46, 146, 228, 2, seatD);
  for (let k = 1; k < 7; k++) VL(Math.round(46 + k * 228 / 7), 136, 12, seatD);
  // seat base / heater
  S(46, 148, 228, 9, '#8f9496'); HL(46, 148, 228, '#5d6266');
  for (let x = 50; x < 270; x += 4) { S(x, 151, 2, 1, '#5d6266'); S(x, 153, 2, 1, '#5d6266'); }
  // floor
  S(0, 157, 320, 23, '#7b756b'); S(0, 157, 320, 1, '#4f4b45');
  // doors (left / right edges)
  [[0, 1], [286, -1]].forEach(([dx0, dir]) => {
    S(dx0, 7, 34, 150, '#b7bcbe'); S(dx0, 7, 34, 7, '#2a2d31');
    for (let k = 0; k < 7; k++) if (k !== 3) S(dx0 + 6 + k * 3, 10, 2, 1, '#f2b84b');
    S(dx0 + 6, 30, 22, 66, '#26282a');
    S(dx0, 14, 34, 1, '#8d9396'); HL(dx0 + 2, 100, 30, '#9aa0a3'); S(dx0, 150, 34, 7, '#9aa0a3');
    S(dir > 0 ? dx0 : dx0 + 32, 14, 2, 143, '#d9b53f');
    S(dir > 0 ? dx0 + 33 : dx0, 7, 1, 150, frD);
    S(dx0, 157, 34, 2, '#a7acae'); S(dx0, 159, 34, 2, '#d0ae3c');
  });
  S(34, 7, 10, 150, wall); S(276, 7, 10, 150, wall);
  // sleeve partitions + stanchions
  [40, 274].forEach(px => { S(px, 96, 6, 61, '#c9cdd0'); HL(px, 96, 6, frL); VL(px, 96, 61, frD); VR(px + 6, 96, 61, frD); });
  [42, 276].forEach(px => { S(px, 6, 1, 90, '#d7dbdd'); S(px + 1, 6, 1, 90, '#8d9396'); });
  [111, 207].forEach(px => { S(px, 23, 1, 125, '#dfe3e5'); S(px + 1, 23, 1, 125, '#8d9396'); });
  S(44, 7, 232, 1, '#8d9396'); // strap rail
  // window openings
  [[50, 28, 108, 76], [162, 28, 108, 76], [8, 32, 18, 62], [294, 32, 18, 62]].forEach(([x, y, w, h]) => {
    g.clearRect(x, y, w, h);
  });
  // the mid stanchions pass in front of the glass
  [111, 207].forEach(px => { S(px, 28, 1, 76, '#dfe3e5'); S(px + 1, 28, 1, 76, '#8d9396'); });
}
export function drawStraps(g, t, jolt) {
  const y0 = 8, y1 = 30, bw = 2, rw = 7, rh = 6;
  for (let k = 0; k < 8; k++) {
    const x = 62 + k * 28;
    const off = Math.round(Math.sin(t * 1.9 + k * 0.5) * 1.1 + jolt * Math.sin(k * 1.3 + t * 9));
    for (let y = y0; y < y1; y++) R(g, x + Math.round(off * (y - y0) / (y1 - y0)), y, bw, 1, y < y1 - 4 ? '#d7d4c8' : '#9a9c98');
    for (let p = 0; p < 2; p++) {
      g.fillStyle = P(p ? '#f4f4f0' : '#5d6266');
      const ox = x + off - (rw >> 1) + (bw >> 1) + (p ? 0 : 1), oy = y1 + (p ? 0 : 1);
      for (let j = 0; j < rh; j++) {
        const f = j / (rh - 1), ins = f <= 0.34 ? 0 : Math.round((f - 0.34) / 0.66 * rw * 0.3);
        if (j === 0) g.fillRect(ox + 1, oy, rw - 2, 1);
        else if (j === rh - 1) g.fillRect(ox + ins, oy + j, rw - 2 * ins, 1);
        else { g.fillRect(ox + ins, oy + j, 1, 1); g.fillRect(ox + rw - 1 - ins, oy + j, 1, 1); }
      }
    }
  }
}
