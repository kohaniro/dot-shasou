import { state } from './state.js';
import { rng, hash32 } from './rng.js';

/* ---------- 乗っている列車（車内）のバリエーション ----------
   路線（state.seed）ごとに決まる純粋な関数。専用の乱数 rng(hash32(seed, SALT_CAR, 0)) を要素ごとに1回ずつ、
   いつも同じ順・同じ回数で引く（要素を足すときは末尾に足す）。どの表も先頭が元の車内（青い座席・点の格子・丸いつり革・クリームの壁）。
   DOM に触れない（interior.js は import 時にキャンバスを作るので、表だけ Node から数えられるよう分けてある） */
const SALT_CAR = 9601; // 景色・駅・天気などの salt（10〜13, 31, 41〜47, 61〜105, 290〜340, 9001〜, 9101, 9102, 9200〜, 9301, 9350〜, 9400〜9501）と重ならない

/* 座席のモケット: base が基準色。classic だけ元の手で選んだ影・ハイライト（ほかは interior.js で shade / tint から作る） */
export const SEATS = [
  { name: '青', base: '#3f6f8f', classic: { d: '#2f556f', l: '#5587a6', ll: '#6a9bb8' } },
  { name: '緑', base: '#4d7a55', avoid: ['青緑'] },
  { name: 'えんじ', base: '#8a3c48', avoid: ['赤紫'] },
  { name: '黄土', base: '#b07c3a' },
  { name: '灰紫', base: '#6c6684', avoid: ['灰', '赤紫'] },
  { name: '紺', base: '#34466c' }
];
export const PATTERNS = ['点', '縞', '無地'];
/* 優先席（片端の2席。端から手すり x 111 / 207 までがちょうど2席）のモケット。引いた色が座席の avoid（似た色）にあれば次の色へ */
export const PRIORITY = [{ name: '灰', base: '#7c8088' }, { name: '赤紫', base: '#84506e' }, { name: '青緑', base: '#3f7a78' }];
export const STRAPS = ['丸', '三角', '角'];
export const RINGS = [{ name: '白', c: '#f4f4f0' }, { name: '黄', c: '#e9c445' }, { name: '灰', c: '#b4b9bc' }];
export const BELTS = [{ name: '生成り', c: '#d7d4c8', d: '#9a9c98' }, { name: '灰', c: '#9ba1a5', d: '#6c7275' }, { name: '紺', c: '#4a5a78', d: '#2f3a50' }];
export const WALLS = [
  { name: 'クリーム', c: '#d9d6cc', sh: '#b9b6ac', top: '#e8e6de' },
  { name: '白', c: '#e3e3df' },
  { name: '淡灰', c: '#cfd3d4' }
];
export const SLEEVES = ['低', '高', '丸'];

let cacheSeed = null, cache = null;
/* { seat, pattern, prio（null か { side: -1 左 | 1 右, ...PRIORITY の1つ }）, strap, ring, belt, wall, sleeve } */
export function carStyle(seed = state.seed) {
  if (seed === cacheSeed) return cache;
  const r = rng(hash32(seed, SALT_CAR, 0)), at = arr => arr[Math.floor(r() * arr.length)];
  const seat = at(SEATS), pattern = at(PATTERNS);
  const hasPrio = r() < 0.4, side = r() < 0.5 ? -1 : 1;
  let pi = Math.floor(r() * PRIORITY.length);
  while ((seat.avoid || []).includes(PRIORITY[pi].name)) pi = (pi + 1) % PRIORITY.length;
  const pc = PRIORITY[pi];
  const strap = at(STRAPS), ring = at(RINGS), belt = at(BELTS), wall = at(WALLS), sleeve = at(SLEEVES);
  cacheSeed = seed;
  cache = { seat, pattern, prio: hasPrio ? { side, ...pc } : null, strap, ring, belt, wall, sleeve };
  return cache;
}
/* デバッグの状態表示用の短い説明 */
export function carLabel(c = carStyle()) {
  return `${c.seat.name}・${c.pattern}` + (c.prio ? `（優先席 ${c.prio.side < 0 ? '左' : '右'}・${c.prio.name}）` : '') +
    ` / つり革 ${c.strap}・${c.ring.name}・${c.belt.name} / 壁 ${c.wall.name} / 袖 ${c.sleeve}`;
}
