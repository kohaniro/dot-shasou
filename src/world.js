import { state } from './state.js';
import { hash32, vnoise } from './rng.js';

/* ---------- world parameters ---------- */
/* 走行距離 d（線路際のドット）→ その地点の連続値。景色はすべてここを見て決める。
   軸は「都市度」1本で、バイオームはその上の帯。帯の順に 都心↔住宅街↔郊外↔田園 と隣り合うので、
   都心の次にいきなり田園が来ることはない。山間・海沿い・駅などは、軸（標高、海までの距離…）と
   BIOMES の行・列を足して world() の戻り値に加えていく。 */
const clamp01 = v => Math.min(1, Math.max(0, v));
const sstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/* 都市度 0..1: 都心(1)と田園(0)を往復する三角波。位相をノイズでゆらして区間の長さを不ぞろいにする */
const CYCLE = 48000; // 都心→田園→都心の基準距離（時速86kmで約200秒）
export function urban(d) {
  const len = CYCLE * (0.85 + 0.3 * hash32(state.seed, 10, 0) / 4294967296);
  const p = d / len + 0.14 * (vnoise(d / 15000, 11) - vnoise(0, 11)); // d=0 で位相0 → 出発直後は都心から
  const u = Math.abs(1 - 2 * (p - Math.floor(p)));
  return clamp01(u + 0.1 * (vnoise(d / 2300, 12) - 0.5));
}
export const density = urban;

/* バイオームの帯: 境目(EDGE)の前後 ±BLEND で重みがなだらかに入れ替わる */
const EDGE = [0.25, 0.5, 0.76], BLEND = 0.07;
/* バイオームごとの性質。world() が重みで混ぜて連続値にする
   height: 建物の高さ / build: 建物の建て込み具合 / roofs: 中景の地面を埋める屋根 / tree: 木
   paddy・veg・lot: 地面が田んぼ・畑・空き地になる割合（残りは街の地面） / hill: 遠景の山並み */
const BIOMES = {
  city:   { height: 1.00, build: 0.94, roofs: 1.0, tree: 0.10, paddy: 0.00, veg: 0.00, lot: 0.00, hill: 0.0 },
  resi:   { height: 0.34, build: 0.84, roofs: 1.0, tree: 0.30, paddy: 0.00, veg: 0.03, lot: 0.07, hill: 0.15 },
  suburb: { height: 0.16, build: 0.42, roofs: 0.5, tree: 0.55, paddy: 0.08, veg: 0.30, lot: 0.30, hill: 0.7 },
  rural:  { height: 0.06, build: 0.035, roofs: 0.0, tree: 0.35, paddy: 0.80, veg: 0.10, lot: 0.10, hill: 1.0 }
};
export const BIOME_KEYS = Object.keys(BIOMES);
const PROPS = Object.keys(BIOMES.city);

export function world(d) {
  const u = urban(d);
  const s1 = sstep(EDGE[0] - BLEND, EDGE[0] + BLEND, u), s2 = sstep(EDGE[1] - BLEND, EDGE[1] + BLEND, u), s3 = sstep(EDGE[2] - BLEND, EDGE[2] + BLEND, u);
  const e = { urban: u, city: s3, resi: s2 * (1 - s3), suburb: s1 * (1 - s2), rural: 1 - s1 }; // 重みの合計は 1
  e.core = sstep(EDGE[2], 0.97, u); // 都心の中での中心寄り 0..1（高層ビルの出やすさ）
  for (const p of PROPS) { let v = 0; for (const b of BIOME_KEYS) v += e[b] * BIOMES[b][p]; e[p] = v; }
  return e;
}
/* 重みに比例した確率でバイオームを1つ選ぶ（混ざる区間では建物ごとに入り交じる） */
export function pickBiome(e, r) {
  let t = r();
  for (const b of BIOME_KEYS) { if (t < e[b]) return b; t -= e[b]; }
  return 'rural';
}
/* 重み付きの表から1つ選ぶ: table[バイオーム][種類] を重みで混ぜた確率で種類を返す */
export function pickKind(e, r, table) {
  const kinds = Object.keys(table.city);
  let sum = 0; const sc = kinds.map(k => { let v = 0; for (const b of BIOME_KEYS) v += e[b] * (table[b][k] || 0); sum += v; return v; });
  let t = r() * sum;
  for (let k = 0; k < kinds.length; k++) { if (t < sc[k]) return kinds[k]; t -= sc[k]; }
  return kinds[kinds.length - 1];
}
