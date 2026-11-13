import { state } from './state.js';

/* ---------- random helpers ---------- */
export function hash32(a, b, c) {
  let h = 2166136261 ^ a;
  h = Math.imul(h ^ b, 16777619);
  h = Math.imul(h ^ (c | 0), 16777619);
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995);
  return (h ^ (h >>> 15)) >>> 0;
}
export function rng(s) {
  s = s >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const ri = (r, a, b) => a + Math.floor(r() * (b - a + 1));
export const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

export function vnoise(x, salt) {
  const i = Math.floor(x), f = x - i;
  const a = hash32(state.seed, salt, i) / 4294967296, b = hash32(state.seed, salt, i + 1) / 4294967296;
  return a + (b - a) * f * f * (3 - 2 * f);
}
