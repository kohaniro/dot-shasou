import { W, SH } from '../state.js';
import { ri } from '../rng.js';
import { P, R, ell } from '../palette.js';

/* ---------- sky ---------- */
export const sky = document.createElement('canvas');
sky.width = W; sky.height = SH + 2;
export function buildSky() {
  const g = sky.getContext('2d');
  const bands = ['#4f93cf', '#62a3d8', '#7bb4e0', '#98c6e8', '#b7d8ef', '#d3e8f4'];
  const bh = 9;
  bands.forEach((c, k) => R(g, 0, k * bh, W, bh, c));
  for (let k = 1; k < bands.length; k++) {           // 境目を市松ディザでなじませる
    g.fillStyle = P(bands[k]);
    for (let x = 0; x < W; x += 2) { g.fillRect(x, k * bh - 1, 1, 1); g.fillRect(x + 1, k * bh - 2, 1, 1); }
    g.fillStyle = P(bands[k - 1]);
    for (let x = 0; x < W; x += 4) g.fillRect(x + 2, k * bh, 1, 1);
  }
  R(g, 0, bands.length * bh, W, SH + 2 - bands.length * bh, '#d3e8f4');
}

export function drawClouds(g, i, r, L) {
  const n = ri(r, 1, 3);
  for (let k = 0; k < n; k++) {
    const x0 = ri(r, 30, L.cw - 40), y0 = ri(r, 9, 34), parts = [];
    for (let p = ri(r, 3, 5); p > 0; p--) parts.push([x0 + ri(r, -15, 15), y0 + ri(r, -2, 2), ri(r, 6, 13), ri(r, 2, 4)]);
    parts.forEach(p => ell(g, p[0], p[1] + 1, p[2], p[3], '#d2e0ec'));
    parts.forEach(p => ell(g, p[0], p[1], p[2], p[3], '#f4f8fb'));
  }
}
