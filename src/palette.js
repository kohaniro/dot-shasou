/* ---------- colour helpers ---------- */
export function rgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
export function mix(a, b, t) {
  const A = rgb(a), B = rgb(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
export const shade = (c, t) => mix(c, '#1b2230', t);
export const tint = (c, t) => mix(c, '#ffffff', t);

/* ---------- 絵柄（スタイル）: 描画時に色を差し替える ---------- */
export const lum = c => { const [r, g, b] = rgb(c); return 0.299 * r + 0.587 * g + 0.114 * b; };
const S16 = ['#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179', '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57'];
const S16rgb = S16.map(rgb);
function nearest16(c) { const [r, g, b] = rgb(c); let bi = 0, bd = 1e9; S16rgb.forEach((p, i) => { const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2; if (d < bd) { bd = d; bi = i; } }); return S16[bi]; }
const MONO = ['#1f2b24', '#4a6650', '#8fae7c', '#d9e6b9'];
function mono(c) { const l = lum(c); return MONO[l < 72 ? 0 : l < 128 ? 1 : l < 188 ? 2 : 3]; }
function soft(c) { const l = Math.round(lum(c)).toString(16).padStart(2, '0'); return mix(mix(c, '#' + l + l + l, 0.3), '#fff6ea', 0.2); }
export const STYLES = {
  real: { pal: null, outline: false, glass: true },
  game: { pal: nearest16, outline: true, glass: false },
  mono: { pal: mono, outline: true, glass: false },
  soft: { pal: soft, outline: false, glass: true }
};
export let STYLE = STYLES.real;
export function setStyle(name) { STYLE = STYLES[name] || STYLES.real; }
export const palCache = new Map(), INK = '#1a1c2c';
export function P(c) { if (!STYLE.pal) return c; let v = palCache.get(c); if (v === undefined) { v = STYLE.pal(c); palCache.set(c, v); } return v; }
export function R(g, x, y, w, h, c) { if (w <= 0 || h <= 0) return; g.fillStyle = P(c); g.fillRect(x | 0, y | 0, w | 0, h | 0); }
export function ink(g, x, top, w, h) { if (!STYLE.outline) return; R(g, x, top, 1, h, INK); R(g, x + w - 1, top, 1, h, INK); R(g, x, top, w, 1, INK); }
/* 窓 */
export function win(g, x, y, w, h, c) {
  R(g, x, y, w, h, c);
}
export function ell(g, ex, ey, rx, ry, c) {
  for (let dy = -ry; dy <= ry; dy++) {
    const half = Math.round(rx * Math.sqrt(1 - (dy * dy) / (ry * ry + 0.5)));
    R(g, ex - half, ey + dy, half * 2, 1, c);
  }
}

/* ---------- 景色の色 ---------- */
export const HAZE = '#c5d9e6';
export const BODY = ['#cfcabd', '#b9b3a6', '#d8d2c2', '#a89f93', '#c2b8a3', '#9b8f86', '#e2dfd6', '#b0a7a0', '#8f8a8a', '#c9bfb0', '#a3877a', '#7d6f6a'];
export const BODY_LIGHT = ['#e2dfd6', '#d8d2c2', '#cfcabd', '#d9cdbd', '#c9d0d0', '#e6dccb'];
export const GLASS = [['#5d7f99', '#86aac2', '#42607a'], ['#5f8f8a', '#8ab8b0', '#416b68'], ['#6a7f95', '#9bb3c8', '#4a5b70'], ['#4f6f8f', '#7d9fc0', '#38516c']];
export const SIGN = ['#d85a4a', '#3f7fb5', '#e9c046', '#4f9a6a', '#e8e4d8', '#7a5fa8', '#e58a3c', '#2f8f9a'];
export const AWN = ['#b5483c', '#3f6f8f', '#4f8a5a', '#d6a13a', '#e8e4d8'];
export const HOUSE_WALL = ['#e6e0d2', '#d6cfc0', '#c9c4bc', '#b8a58f', '#ded6c4', '#a9a39b', '#cdbfa8'];
export const ROOF = ['#4a5560', '#5b4d47', '#3f4a5a', '#7a4f3f', '#56605a', '#6b6f73'];
export const WIN_D = '#3d4f63', WIN_M = '#5b7389', WIN_L = '#8fb1c9';
export const GREENS = ['#4f7a45', '#5f8c4f', '#3f6a3d'];
/* 田園・郊外の色: ゲーム風16色・モノクロ4色に変換されても 水面 / 稲 / あぜ が別の色になる明るさ・色相で選んである */
export const WATER = '#a5dcee';                       // 水を張った田（空の映り込み）
export const RICE = ['#7fae4f', '#93b85a'];           // 稲
export const AZE = '#5f7a45';                         // あぜ
export const SOIL = '#a8946c', PATH = '#c2b48c';      // 畑の土、あぜ道
export const GRASS = ['#7c9b55', '#6c9150'];          // 草地
export const HILL_BACK = '#7f9fb0', HILL_FRONT = '#4f8a6a'; // 遠くの山並み、手前の丘
export const VINYL = '#e9eef0', VINYL_RIB = '#b9c7c6'; // ビニールハウス
export const TORII = '#c94f3f';
