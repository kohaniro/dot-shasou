import { state } from './state.js';
import { hash32 } from './rng.js';
import { R, RE, toneNow } from './palette.js';

/* ---------- 夜の灯り（窓あかり・街灯・看板など、自分で光るもの）----------
   灯るかどうかは、チャンクの乱数 r を使わず、位置のハッシュだけで決める（r の呼び出し回数を変えると景色そのものが変わるため）。
   灯りの候補1つにつき、ハッシュから3つの値を取る:
     「そもそも灯る窓か」（確率 p）/「灯り始めるしきい値」onset（0..1）/ 色などの個体差 v（0..1）
   いまのトーンの灯りの段階 lit（tone.js の look.lit。夕方 0 → 夜 1、朝に 1 → 0）がしきい値を超えていれば灯る。
   段階が進んでも候補ごとのしきい値は変わらないので、いったん灯った窓が消えたり、場所が変わったりしない。
   昼・晴（トーン無し）では lit = 0 で、何も描かない。色は RE()（トーンをかけず、絵柄の変換だけ通す）で描く。 */
let salt = 0;
/* これから描くチャンク（レイヤー id、チャンク番号）。Layer.chunk が描く前に呼ぶ。ハッシュの種になる */
export function lightSalt(id, i) { salt = hash32(state.seed, 9200 + id, i); }
/* いまの灯りの段階 0..1 */
export const litNow = () => { const t = toneNow(); return t ? t.lit : 0; };
/* 位置 (x, y) の灯りが、いま灯っているか。灯っていれば個体差 v（0..1）、消えていれば −1。
   p: 灯る窓の割合 / span: しきい値の広がり（小さいほど早い段階でそろって灯る。街灯・看板は小さく、家の窓は大きく）/ s: 同じ位置に別の灯りを置くときの種 */
export function glow(x, y, p = 1, span = 0.9, s = 0) {
  const t = toneNow(); if (!t || t.lit <= 0) return -1;
  const h = hash32(salt + s, x | 0, y | 0);
  if ((h & 4095) >= p * 4096) return -1;
  return t.lit > 0.04 + span * ((h >>> 12) & 4095) / 4096 ? (h >>> 24) / 256 : -1;
}
/* 位置で決まる 0..1 の値（灯りの段階によらない。建物ごと・階ごとの「灯りの多さ」などに使う） */
export const tend = (x, y, s = 0) => (hash32(salt + 77 + s, x | 0, y | 0) & 65535) / 65536;

/* 灯りの色。v で選ぶ */
export const LAMPS = {
  home: ['#ffd98a', '#ffce78', '#ffe2a4', '#ffc56b', '#ffd98a', '#f6ecd2', '#e4eefc'],   // 住宅: 電球色が中心、ときどき白
  office: ['#eaf2ff', '#e2efee', '#f4f6ec', '#eaf2ff', '#d8e6fb', '#ffe8b6'],            // オフィス: 蛍光灯の白、まれに暖色
  glass: ['#b9d2ea', '#d2e2f0', '#a9c6e2', '#e6dcb0', '#c6daec'],                        // ガラス越し（カーテンウォール）: やや沈んだ青白
  shop: ['#fff3c8', '#ffffff', '#ffefb4'],                                               // 店先
  mid: ['#f2cf86', '#e9d9ae', '#d9e2f0', '#f6c878', '#cfdcf0', '#f2cf86'],               // 中景
  far: ['#dcc088', '#cfc8ae', '#b9c6dc', '#e4c890', '#aebcd6'],                          // 遠景（かすんで少し沈む）
  stair: ['#dcecdc', '#e2efe6'],                                                         // 共用の階段・廊下の蛍光灯
  red: ['#ff5646'],                                                                      // 航空障害灯
  street: ['#fff2c6', '#eaf2ff', '#ffd692']                                              // 街灯
};
/* 灯り1つ: (x, y, w, h) を kind の色で。灯ったら true */
export function lamp(g, x, y, w, h, kind, p = 1, span = 0.9, s = 0) {
  const v = glow(x, y, p, span, s); if (v < 0) return false;
  const a = LAMPS[kind]; RE(g, x, y, w, h, a[Math.floor(v * a.length)]);
  return true;
}
/* 窓: 昼の色 c で塗り、灯っていれば灯りの色で塗り直す */
export function win(g, x, y, w, h, c, kind = 'home', p = 0.5, span = 0.9) {
  R(g, x, y, w, h, c);
  return lamp(g, x, y, w, h, kind, p, span);
}
/* にじみ: (x, y, w, h) に色 c を濃さ a で重ねる（街灯の下の光の輪、店先からこぼれる明かりなど。控えめに使う） */
export function halo(g, x, y, w, h, c, a) {
  g.globalAlpha = a; RE(g, x, y, w, h, c); g.globalAlpha = 1;
}
