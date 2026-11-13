import { W, SH, state } from './state.js';
import { hash32, rng } from './rng.js';
import { density } from './world.js';

/* ---------- chunked parallax layers ---------- */
export function Layer(id, factor, cw, draw) { this.id = id; this.f = factor; this.cw = cw; this.draw = draw; this.cache = new Map(); }
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
Layer.prototype.render = function (g, off, oy) {
  const wx = Math.floor(off);
  const i0 = Math.floor(wx / this.cw), i1 = Math.floor((wx + W - 1) / this.cw);
  for (let i = i0; i <= i1; i++) g.drawImage(this.chunk(i), i * this.cw - wx, oy);
};
export const dens = (L, i, x) => density((i * L.cw + x) / L.f);
