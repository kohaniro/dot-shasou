import { W, SH, state } from './state.js';
import { hash32, rng } from './rng.js';
import { world } from './world.js';
import { heading, HEADING_MAX } from './course.js';

/* ---------- chunked parallax layers ----------
   f: 視差係数 / pan: カーブで向きが変わるぶん横へ流れる量（course.js の heading に掛ける。遠いほど大きい。0 なら流れない）
   drop: 高架（elev = 1）のとき下げるドット数（main.js の render() が描く位置をずらす。チャンクの絵は変えない） */
export function Layer(id, factor, cw, draw, pan = 0, drop = 0) { this.id = id; this.f = factor; this.cw = cw; this.draw = draw; this.pan = pan; this.drop = drop; this.cache = new Map(); }
Layer.prototype.chunk = function (i) {
  let c = this.cache.get(i);
  if (!c) {
    c = document.createElement('canvas'); c.width = this.cw; c.height = SH;
    this.draw(c.getContext('2d'), i, rng(hash32(state.seed, this.id, i)), this);
    this.cache.set(i, c);
    if (this.cache.size > 8) for (const k of this.cache.keys()) if (Math.abs(k - i) > 3) this.cache.delete(k);
  }
  return c;
};
/* top を渡すと、絵を下へずらして描くとき（oy > top）にできる上のすき間を、絵のいちばん上の行を引きのばして埋める */
Layer.prototype.render = function (g, off, oy, top) {
  const wx = Math.floor(off);
  const i0 = Math.floor(wx / this.cw), i1 = Math.floor((wx + W - 1) / this.cw);
  for (let i = i0; i <= i1; i++) {
    const c = this.chunk(i);
    g.drawImage(c, i * this.cw - wx, oy);
    if (oy > top) g.drawImage(c, 0, 0, this.cw, 1, i * this.cw - wx, top, this.cw, oy - top);
  }
};
/* 走行距離 d → レイヤー通しの座標。窓の中央で全レイヤーが同じ地点を指すようにそろえる（遠景だけ先に景色が変わって見えないように）。
   pan のあるレイヤーは、カーブで向き heading(d) が変わるぶんだけ余計に（または少なく）流れる */
export const layerX = (L, d) => (d - W / 2) * L.f + W / 2 + (L.pan ? L.pan * heading(d) : 0);
/* state.dist = dist のときの描画のオフセット（= layerX(L, dist + W/2) − W/2） */
export const layerOff = (L, dist) => dist * L.f + (L.pan ? L.pan * heading(dist + W / 2) : 0);
/* レイヤー内の位置 → 走行距離（layerX の逆。pan / f × heading の傾き < 1 なので単調。雲は単調でないので使わないこと） */
export function distAt(L, i, x) {
  const X = i * L.cw + x, d0 = (X - W / 2) / L.f + W / 2;
  if (!L.pan) return d0;
  const k = L.pan / L.f, h0 = heading(d0), d1 = d0 - k * h0;
  if (heading(d1) === h0) return d1; // d0 と答えが同じ直線区間にある（ほとんどの地点）
  let lo = d0 - k * HEADING_MAX, hi = d0 + k * HEADING_MAX; // カーブの途中: 二分法
  for (let n = 0; n < 44; n++) { const m = (lo + hi) / 2; if (layerX(L, m) < X) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
/* その位置の world()（都市度・バイオームの重みなど） */
export const env = (L, i, x) => world(distAt(L, i, x));
