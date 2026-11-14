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
  real: { pal: null, outline: false, glass: true, fade: true },
  game: { pal: nearest16, outline: true, glass: false, fade: false },
  mono: { pal: mono, outline: true, glass: false, fade: false },
  soft: { pal: soft, outline: false, glass: true, fade: true }
}; // fade: トーン（時間帯・天気）の切り替えをクロスフェードで見せるか（色数の少ない絵柄は中間色が出ないよう瞬時に切り替える）
export let STYLE = STYLES.real;
export function setStyle(name) { STYLE = STYLES[name] || STYLES.real; }
export const palCache = new Map(), INK = '#1a1c2c'; // palCache: トーン無し（昼・晴、車内、灯り）の「色 → 絵柄の色」

/* ---------- トーン（時間帯・天気による景色の色調）: 絵柄の変換の前にかける ----------
   トーンは外から渡すオブジェクト { key, id, fn }（作るのは tone.js）: key は段階ごとの文字列、fn(c) が色を変える。
   id が真（昼・晴）のトーンと null は「トーン無し」で、色は今までどおり絵柄の変換だけを通る。
   setTone() で「いま描く物にかけるトーン」を切り替える。窓の外の景色を描く間だけ設定し、終わったら戻すこと
   （車内・乗客・つり革・扉・トンネルの中はトーン無しで描く）。変換結果はトーンの key ごとに覚える */
/* 奥行きの区分（setTone の depth）: トーンの色変換は、遠い層ほど空の色になじませる。cloud は雲、lit は灯りに照らされた駅のホーム */
export const AIR = { front: 0, near: 1, mid: 2, far: 3, cloud: 4, lit: 5 };
const TONE_CACHES = 40;       // 覚えておく「トーン × 奥行き（× 地面かどうか）」の数（古いものから捨てる）
const toneCaches = new Map(); // key/depth → Map（色 → トーンと絵柄を通した色）
let TONE = null, DEPTH = 0, toneCache = null, GY = 0, groundCache = null;
const cacheOf = key => {
  let m = toneCaches.get(key);
  if (!m) { toneCaches.set(key, m = new Map()); if (toneCaches.size > TONE_CACHES) toneCaches.delete(toneCaches.keys().next().value); }
  return m;
};
/* いまのトーンを切り替え、前の状態を返す（戻すときは返り値をそのまま渡す）。depth は AIR の値（省略 = いちばん手前）。
   地面の線（setGround）は、新しいトーンでは外れ、前の状態へ戻すときは一緒に戻る */
export function setTone(tone, depth = 0) {
  const prev = { prevTone: true, tone: TONE, depth: DEPTH, gy: GY };
  let gy = 0;
  if (tone && tone.prevTone) { depth = tone.depth; gy = tone.gy; tone = tone.tone; }
  TONE = tone && !tone.id ? tone : null; DEPTH = depth;
  if (TONE) toneCache = cacheOf(TONE.key + '/' + depth);
  setGround(gy);
  return prev;
}
/* 地面の線（天気の絵づくり用）: R() で y がこの値以上の矩形は「地面」とみなし、トーンの色変換に ground = true を渡す
   （雪の積もった地面・雨に濡れた地面の色になる。tone.js）。0 で外す。layers.js が、雨・雪のトーンでチャンクを描く間だけ設定する。
   直接 fillStyle = P() で描く所と、トーン無しの間は効かない。前の値を返す */
export function setGround(y) {
  const prev = GY; GY = TONE && y ? y : 0;
  if (GY) groundCache = cacheOf(TONE.key + '/' + DEPTH + '/g');
  return prev;
}
function PG(c) {
  let v = groundCache.get(c);
  if (v === undefined) { v = TONE.fn(c, DEPTH, true); if (STYLE.pal) v = STYLE.pal(v); groundCache.set(c, v); }
  return v;
}
/* いまかかっているトーン（昼・晴とトーン無しは null）と奥行き */
export const toneNow = () => TONE;
export const depthNow = () => DEPTH;
/* 絵柄を替えたとき: 覚えた色をすべて捨てる */
export function clearPal() { palCache.clear(); toneCaches.clear(); if (TONE) toneCache = cacheOf(TONE.key + '/' + DEPTH); setGround(GY); }
/* 灯りの色（夜の窓あかり・街灯・トンネルの照明など、自分で光るもの）: トーンをかけず、絵柄の変換だけ通す */
export function E(c) { if (!STYLE.pal) return c; let v = palCache.get(c); if (v === undefined) { v = STYLE.pal(c); palCache.set(c, v); } return v; }
export function P(c) {
  if (!TONE) return E(c);
  let v = toneCache.get(c);
  if (v === undefined) { v = TONE.fn(c, DEPTH); if (STYLE.pal) v = STYLE.pal(v); toneCache.set(c, v); }
  return v;
}
export function R(g, x, y, w, h, c) { if (w <= 0 || h <= 0) return; g.fillStyle = GY && y >= GY ? PG(c) : P(c); g.fillRect(x | 0, y | 0, w | 0, h | 0); }
/* R() の灯り版（トーンをかけない） */
export function RE(g, x, y, w, h, c) { if (w <= 0 || h <= 0) return; g.fillStyle = E(c); g.fillRect(x | 0, y | 0, w | 0, h | 0); }
export function ink(g, x, top, w, h) { if (!STYLE.outline) return; R(g, x, top, 1, h, INK); R(g, x + w - 1, top, 1, h, INK); R(g, x, top, w, 1, INK); }
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
/* 山間の色 */
export const CEDAR = ['#2f5a44', '#386349', '#28503f'];  // 杉・ヒノキ（青みのある濃い緑）
export const BROAD = ['#5f8f4a', '#74a052', '#4f7f45'];  // 広葉樹
export const BAMBOO = ['#9dbb5c', '#86a94f', '#b3c96c']; // 竹
export const MEADOW = ['#7fa353', '#739a50'];            // 山あいの草地
export const MOUNT_FAR = '#3f7358';                      // 遠景の手前の尾根
export const ROCK = '#8d8c84', CONC = '#b5b4aa', EARTH = '#9a7f62'; // 岩・石積み、コンクリート、土
export const STREAM = '#6fb0cc', FOAM = '#e8f3f4', GRAVEL = '#c9c7b6'; // 渓流、白波、河原
/* 川と橋の色 */
export const RIVER = [                                   // 水面（奥 → 手前の4段）。川ごとに1組
  ['#b4d6e6', '#93c1dc', '#77aad0', '#6297c2'],          // 青
  ['#b6d8dc', '#96c2cc', '#7aaaba', '#6496aa'],          // 青緑
  ['#b9cfd2', '#9db8be', '#869fa8', '#718a96']           // くすんだ灰緑（街なかの川）
];
export const GLINT = '#eef7fa';                          // 水面のきらめき
export const LEVEE = ['#86a85a', '#6f9450'];             // 堤防の草（日なた / かげ）
export const REED = ['#b0ae62', '#93a155'];              // ヨシ
export const DIRT = '#cdb98e';                           // グラウンドの土
export const REVET = '#bdbcb1', REVET_D = '#a3a298';     // コンクリート護岸
export const TRUSS_PAINT = ['#7fae90', '#b65a44', '#72a6c6', '#98a1a5', '#d6cfa9', '#55806c']; // トラスの塗装: 淡い緑、さび止めの赤、水色、グレー、クリーム、深緑
/* トンネルの色 */
export const TUN_DARK = '#0b0d13';                       // 闇
export const TUN_LINING = {                              // 覆工: 地 / 明るいむら / 目地・かげ
  conc: ['#9a9b93', '#abaca3', '#6c6d68'],               // コンクリート
  brick: ['#96604a', '#a87258', '#5a4038'],              // れんが
  shot: ['#868479', '#97958a', '#5f5e59']                // 吹き付け
};
export const TUN_LAMP = { sodium: ['#ffae45', '#ffe6b0'], fluo: ['#d8f0e2', '#ffffff'], led: ['#dfe9ff', '#ffffff'] }; // 灯具: 光の色味 / 芯
export const TUN_EXIT = '#35d68a', TUN_SIGNAL = '#8fc6ff'; // 非常口の灯、青白い標識灯
export const PORTAL = {                                  // 坑門: 面壁 / 明るい縁（笠石・アーチ環）/ 目地
  conc: ['#b9b8ae', '#d3d2c7', '#93928a'],
  brick: ['#9c6650', '#cdc8b8', '#6c463a'],
  stone: ['#a09d90', '#c4c1b3', '#74726a']
};
export const SPAN_PAINT = ['#e6e3d8', '#c2604f', '#7aa3c8', '#9fb5a2']; // 遠くの道路橋
