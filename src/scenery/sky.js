import { W, SH, state } from '../state.js';
import { hash32, rng, ri } from '../rng.js';
import { P, R, E, RE, ell, setTone, toneNow } from '../palette.js';

/* ---------- sky ----------
   sky: いま見せているトーンの空 / skyB: 次のトーンの空（切り替えの準備中とクロスフェード中だけ使う）。描き直すのは tone.js */
const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = SH + 2; return c; };
export const sky = mk(), skyB = mk();
const BAND_H = [10, 9, 8, 7, 7, 6, 5];  // 昼・晴以外の空: 帯の高さ（上から。8色目は残り全部。地平線 y = 52 に向かって細かくする）
const HORIZON = 52;                     // 遠景の地面の上端
const BULGE = [0, 0, 1, 2, 4, 6, 8, 10, 12], GLOW_RX = 120; // 光のにじみ: 帯の境目（上から）をふくらませるドット数（gk = 1 のとき、中心で）と、横の半径
const STARS = 96, SALT_STAR = 9101, SALT_MOON = 9102;
const hx = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
const hex = c => '#' + hx(c[0]) + hx(c[1]) + hx(c[2]);
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/* 昼・晴の空（時間帯・天気を入れる前と同じ絵） */
function daySky(g) {
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
/* 空を cv に描く。tone は時間帯・天気のトーン（null = 昼・晴）。
   昼・晴以外は、トーンの見た目 tone.look（tone.js の「見た目のキー」）から描く: 帯のグラデーション（sky の 8 色）、
   地平線の光のにじみ（glow / gk）、星と月（star）。色はトーンをかけずに E() / RE() で置く
   （look の色がすでにその時刻・天気の色なので）。曇り空・雨空の作り込みは look の sky を変えるか、ここに足す */
export function buildSky(tone = null, cv = sky) {
  const g = cv.getContext('2d'), prev = setTone(null);
  if (!tone || tone.id) { daySky(g); setTone(prev); return; }
  const K = tone.look, H = SH + 2;
  // 帯: 境目は3行のディザでなじませる（上から 1/4・1/2 が下の色、境目の行は 1/4 が上の色）。
  // 地平線の光のにじみ（沈んだ・昇る前の太陽のあたり。夕方は右寄り、朝は左寄り）: その方角だけ帯の境目を上へふくらませ、
  // いちばん下に光の色 glow の帯を足す。窓の向きは決めていないので、太陽そのものは描かない
  const N = K.sky.length, top = [0], cs = K.sky.map(c => E(hex(c))).concat(E(hex(K.glow)));
  for (let k = 0; k < BAND_H.length; k++) top.push(top[k] + BAND_H[k]);
  top.push(HORIZON + 3); // 光の帯（ふくらんだ所でだけ地平線の上に出る）
  const gx = tone.step < 20 ? 226 : 92, by = [];
  for (let x = 0; x < W; x++) {
    const u = Math.min(1, Math.abs(x - gx) / GLOW_RX), f = K.gk * (1 - u * u) * (1 - u * u);
    for (let k = 0; k <= N; k++) by[k] = top[k] - Math.round(BULGE[k] * f);
    by[N + 1] = H;
    for (let k = 0; k <= N; k++) {
      const y0 = Math.max(0, by[k]), y1 = Math.min(H, by[k + 1]);
      if (y1 <= y0) continue;
      g.fillStyle = cs[k]; g.fillRect(x, y0, 1, y1 - y0);
      if (k < N) {
        g.fillStyle = cs[k + 1];
        if ((x & 3) === 1 && y1 - 2 >= y0) g.fillRect(x, y1 - 2, 1, 1);
        if ((x + y1) & 1 && y1 - 1 >= y0) g.fillRect(x, y1 - 1, 1, 1);
      }
      if (k > 0 && (x & 3) === 3 && y1 - y0 > 3) { g.fillStyle = cs[k - 1]; g.fillRect(x, y0, 1, 1); }
    }
  }
  const rowC = y => { let k = 0; while (k < N - 1 && y >= top[k + 1]) k++; return K.sky[k]; };
  // 星: 明るい星から順に出る（星ごとのしきい値は固定なので、段階が進んでも位置は変わらない）
  if (K.star > 0.02) {
    for (let k = 0; k < STARS; k++) {
      const h = hash32(state.seed, SALT_STAR, k), x = h % W, u = ((h >>> 9) % 1024) / 1024, sy = Math.floor(Math.pow(u, 1.5) * 48), b = (h >>> 20) % 100;
      const need = b < 9 ? 0.12 : b < 36 ? 0.4 : 0.7;
      if (K.star < need + ((h >>> 27) & 7) * 0.03) continue;
      if (b >= 36 && sy > 38) continue; // 地平線の近くは、街の明かりにかすんで暗い星が見えない
      RE(g, x, sy, 1, 1, b < 9 ? ((h >>> 30) & 1 ? '#ffeccc' : '#f2f5ff') : b < 36 ? '#a9b6d8' : '#63709a');
      if (b < 3 && K.star > 0.8) { g.globalAlpha = 0.35; RE(g, x - 1, sy, 3, 1, '#c9d4f0'); RE(g, x, sy - 1, 1, 3, '#c9d4f0'); g.globalAlpha = 1; RE(g, x, sy, 1, 1, '#ffffff'); }
    }
    // 月: 位置と欠け方は路線（シード）ごと。出具合に合わせて空の色から浮かび上がる
    const h = hash32(state.seed, SALT_MOON, 0), m = Math.min(1, K.star / 0.7);
    const mx = ((h & 1) ? 62 : 174) + (h >>> 1) % 85, my = 8 + (h >>> 9) % 10, off = 3 + (h >>> 14) % 7, dir = (h >>> 18) & 1 ? 1 : -1, R2 = 18.5;
    const lit = [246, 241, 214], dim = [216, 211, 186];
    g.globalAlpha = 0.16 * m * m; g.fillStyle = E('#aebfe6'); // うすい光の輪
    for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) { const d = dx * dx + dy * dy; if (d <= 52 && d > R2 && (d <= 34 || ((dx + dy) & 1))) g.fillRect(mx + dx, my + dy, 1, 1); }
    g.globalAlpha = 1;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      if (dx * dx + dy * dy > R2) continue;
      const sx = dx - off * dir * 0.9;
      if (off < 9 && sx * sx + dy * dy <= R2 - 1) continue; // 欠けた側
      const mare = (hash32(h, dx + 9, dy + 9) & 7) === 0 || (dx * dir > 1 && dy > 0 && dy < 3);
      const pale = rowC(my + dy).map(v => v + 0.45 * (255 - v)); // 出はじめは、空の色を白っぽくしただけの淡い月
      RE(g, mx + dx, my + dy, 1, 1, hex(lerp3(pale, mare && m > 0.4 ? dim : lit, m)));
    }
  }
  setTone(prev);
}

/* 曇り・雨・雪の雲。曇り具合 q（トーンの cloud。0.25 刻み）が上がるほど雲が増え、大きく厚くなり、q = 1 で一面の層雲になる。
   雲ごとに「現れる曇り具合」のしきい値を持たせるので、段階が進んでも、すでに出ている雲の位置と形は変わらない。
   チャンクの乱数 r は使わない（晴れの雲の並びを変えないため）。左右のチャンクの雲も描くので、チャンクの境目で切れない。
   色は 本体 / 下の縁 / 底 の3つで、トーンの色変換が明るさから look.cl の3色へ置きかえる（tone.js の CL0〜CL2） */
const SALT_WXC = 9301, WXC_N = 34, WXC_STREAK = 44;
const CLOUD = ['#f4f8fb', '#e3ecf4', '#d2e0ec', '#b0bcc8']; // 本体 / 本体と縁の間 / 下の縁 / 底
function weatherClouds(g, i, L, q) {
  const cw = L.cw, thick = q >= 0.5;
  for (let di = -1; di <= 1; di++) {
    const hr = rng(hash32(state.seed, SALT_WXC, i + di)), ox = di * cw;
    for (let k = 0; k < WXC_N; k++) {
      const th = (k + 0.15 + 0.7 * hr()) / WXC_N * 0.88, big = 0.6 + 1.0 * th; // あとから現れる雲ほど大きい
      const x0 = ox + ri(hr, 0, cw - 1), y0 = ri(hr, 4, 47), low = y0 > 36 ? 0.6 : 1, parts = []; // 地平線の近くの雲は薄く
      for (let p = ri(hr, 4, 7); p > 0; p--) parts.push([Math.round(x0 + ri(hr, -24, 24) * big), y0 + ri(hr, -3, 3), Math.round(ri(hr, 9, 19) * big), Math.max(2, Math.round(ri(hr, 3, 5) * low * Math.min(1.25, big)))]);
      if (q < th || x0 < -110 || x0 > cw + 110) continue;
      if (thick) parts.forEach(p => ell(g, p[0] + 2, p[1] + 2, p[2] - 2, p[3], CLOUD[3]));
      parts.forEach(p => ell(g, p[0], p[1] + 1, p[2], p[3], CLOUD[2]));
      parts.forEach(p => ell(g, p[0], p[1], p[2], p[3], CLOUD[0]));
      if (thick) parts.forEach(p => { if (p[3] > 2) R(g, p[0] - (p[2] >> 1), p[1] + p[3] - 1, p[2], 1, CLOUD[1]); }); // 厚い雲: 腹に薄いかげ
    }
    if (q < 0.75) continue;
    for (let k = 0; k < WXC_STREAK; k++) { // 層雲のすじ: 一面の雲に、横に長い明暗のむらを重ねる
      const x = ox + ri(hr, 0, cw - 1), y = ri(hr, 1, 50), len = ri(hr, 22, 84), c = CLOUD[ri(hr, 0, 3)], th = 0.7 + 0.3 * hr();
      if (q < th) continue;
      R(g, x, y, len, 1, c); R(g, x + 5, y + 1, len - 12, 1, c);
      if (len > 50) R(g, x + 12, y - 1, len - 30, 1, c);
    }
  }
}

export function drawClouds(g, i, r, L) {
  const n = ri(r, 1, 3);
  for (let k = 0; k < n; k++) {
    const x0 = ri(r, 30, L.cw - 40), y0 = ri(r, 9, 34), parts = [];
    for (let p = ri(r, 3, 5); p > 0; p--) parts.push([x0 + ri(r, -15, 15), y0 + ri(r, -2, 2), ri(r, 6, 13), ri(r, 2, 4)]);
    parts.forEach(p => ell(g, p[0], p[1] + 1, p[2], p[3], '#d2e0ec'));
    parts.forEach(p => ell(g, p[0], p[1], p[2], p[3], '#f4f8fb'));
  }
  const tn = toneNow();
  if (tn && tn.cloud > 0) weatherClouds(g, i, L, tn.cloud);
}
