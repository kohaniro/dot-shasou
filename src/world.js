import { vnoise } from './rng.js';

/* ---------- world parameters ---------- */
/* 都市度 0..1: 高いほど高層・高密度。距離に沿ってゆっくり変化する */
export function density(d) {
  let n = 0.7 * vnoise(d / 7000, 11) + 0.3 * vnoise(d / 1900, 12);
  n = Math.min(1, Math.max(0, (n - 0.5) * 1.8 + 0.5));
  const k = Math.min(1, Math.max(0, (d - 2500) / 6000));
  return 0.82 + (n - 0.82) * k * k * (3 - 2 * k); // 出発直後は都心から
}
