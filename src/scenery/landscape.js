import { SH } from '../state.js';
import { ri, pick } from '../rng.js';
import { R, ROOF, HOUSE_WALL, GREENS } from '../palette.js';
import { pickBiome } from '../world.js';
import { env } from '../layers.js';
import { hz, tree, bush, utilityPole, midTree } from './common.js';
import { farTower, midBlock, nearCity } from './city.js';
import { nearResi, nearSuburb, midHouse, vegGround, lotGround } from './suburb.js';
import { nearRural, paddyGround, hills, midFarm, midGreenhouses, midGrove, midPylon } from './rural.js';
import { seaFar, farWet, seaMidWater, seaMid, seaNearWater, seaNear, seaGroundMid, seaGroundNear } from './sea.js';
import { farRange, farRidge, midSlope, midMount, mountGround, nearBank, nearMount } from './mountain.js';

/* ---------- 遠景・中景・近景: world() の連続値を見て、各バイオームの部品を並べる ---------- */

/* 地面を区画に分け、world の割合（paddy / veg / lot、残りは街）で種類を決めて塗る。
   区画ごとに決めるので、バイオームの境目では田畑と街の地面が入り交じる */
function ground(g, i, r, L, y0, S) {
  const cw = L.cw;
  for (let x = 0; x < cw;) {
    let w = ri(r, S.min, S.max); if (cw - x - w < 14) w = cw - x;
    const e = env(L, i, x + (w >> 1)), t = r();
    if (t < e.paddy) paddyGround(g, r, x, w, y0, S.rows, S.far);
    else if (t < e.paddy + e.veg) vegGround(g, r, x, w, y0, S.far);
    else if (t < e.paddy + e.veg + e.lot) lotGround(g, r, x, w, y0, S.far);
    else if (e.sea > 0 && S.sea) S.sea(g, r, x, w, y0, L, i); // 海沿い: 砂と草の地面
    else if (t < e.paddy + e.veg + e.lot + e.mount) mountGround(g, r, x, w, y0, S.far); // 山間: 草地
    else S.town(g, r, x, w, y0, e);
    x += w;
  }
}

/* ---------- far: ビル群のシルエット ↔ 山並み ---------- */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export function drawFar(g, i, r, L) {
  const cw = L.cw, base = 52, town = hz('#8fa3b3', 0.35), field = hz('#86b04a', 0.3), wood = hz(GREENS[2], 0.35);
  farRange(g, L, i, base); // 山間: 奥の高い山並み（山間でないチャンクでは何もしない。乱数は使わない）
  hills(g, r, L, i, base);
  for (let x = 0; x < cw; x++) { // 地面: 街の灰色と田畑の緑を、開けた土地の割合でディザして混ぜる
    const e = env(L, i, x), open = (e.paddy + e.veg + e.lot) * 16;
    R(g, x, base, 1, SH - base, town);
    if (open > 0.5) for (let y = base; y < 60; y++) if (BAYER[(x & 3) + ((y & 3) << 2)] < open) R(g, x, y, 1, 1, field);
  }
  seaFar(g, i, L, base); // 海沿い: 水平線と沖（海沿いでないチャンクでは何もしない）
  farRidge(g, L, i, base); // 山間: 手前の濃い尾根と山すそ
  let x = 0;
  while (x < cw) {
    const e = env(L, i, x), d = e.urban, wet = e.sea > 0 && farWet(L, i, x, e); // 海の上には建物・林を描かない
    if (r() < 0.05 + 0.9 * (1 - e.build)) { // すき間: 田園に近いほど広く、遠くの林が見える
      const gw = ri(r, 2, 8);
      if (r() < e.tree * 0.5 && !wet) { R(g, x, base - 1, gw, 2, wood); R(g, x + 1, base - 2, gw - 2, 1, wood); }
      x += gw; continue;
    }
    const w = Math.min(ri(r, 5, 14), cw - x);
    let h = Math.round((2 + d * d * 26) * (0.4 + r() * 0.9));
    if (d > 0.7 && r() < 0.14) h += ri(r, 8, 16);
    if (!wet) farTower(g, r, x, base, w, h);
    x += w + (r() < 0.4 ? 1 : 0);
  }
}

/* ---------- mid ---------- */
function midTown(g, r, x, w, y0, e) { // 街の地面: 低い屋根の連なり
  R(g, x, y0, w, SH - y0, hz('#8a938f', 0.35));
  for (let k = Math.round(w * 0.16 * e.roofs); k > 0; k--) {
    const c = hz(pick(r, ROOF.concat(HOUSE_WALL)), 0.5), rw = ri(r, 4, 9);
    R(g, x + ri(r, 0, Math.max(0, w - rw)), y0 + ri(r, 0, 7), rw, ri(r, 1, 2), c);
  }
}
const MID = { min: 30, max: 80, rows: [2, 3, 4], far: 0.3, town: midTown, sea: seaGroundMid };
/* 建物のないところ。田園・郊外では、農家・ビニールハウス・鎮守の森・鉄塔がぽつぽつ現れる。戻り値は使った幅 */
function midGap(g, r, x, b, rem, e) {
  const t = r(), f = e.rural + 0.3 * e.suburb;
  if (rem > 44) {
    if (t < 0.05 * f) return midFarm(g, r, x, b);
    if (t < 0.09 * f) return midGreenhouses(g, r, x, b, rem);
    if (t < 0.12 * f) return midGrove(g, r, x, b);
    if (t < 0.135 * f) return midPylon(g, x, b);
  }
  const gw = Math.min(ri(r, 3, 10), rem);
  if (gw > 6 && r() < e.tree * 0.5) midTree(g, r, x, b);
  return gw;
}
export function drawMid(g, i, r, L) {
  const cw = L.cw, base = 59;
  ground(g, i, r, L, base, MID);
  seaMidWater(g, i, L, base);
  midSlope(g, L, i, base); // 山間: 森の斜面と渓流
  let x = 0;
  while (x < cw) {
    const e = env(L, i, x), rem = cw - x;
    if (e.sea > 0) { const sw = seaMid(g, r, x, base, rem, e, L, i); if (sw) { x += sw; continue; } }
    if (e.mount > 0 && r() < e.mount) { x += midMount(g, r, x, base, rem, L, i); continue; }
    if (r() >= e.build) { x += midGap(g, r, x, base, rem, e); continue; }
    const b = pickBiome(e, r); let w;
    if (b === 'city' || (b === 'resi' && r() < 0.4)) { // ビル・マンション: 高さは world の height から
      w = Math.min(ri(r, 9, 24), rem);
      midBlock(g, r, x, base, w, Math.round((4 + e.height * 44) * (0.5 + r() * 0.8)));
    } else { w = Math.min(ri(r, 6, 10), rem); if (w > 4) midHouse(g, r, x + 1, base, w - 2); }
    x += w + (r() < 0.4 ? ri(r, 1, 2) : 0);
  }
}

/* ---------- near ---------- */
function nearTown(g, r, x, w, y0) { R(g, x, y0, w, SH - y0, '#8e9190'); }
const NEAR = { min: 40, max: 110, rows: [4, 9], far: 0, town: nearTown, sea: seaGroundNear };
const NEAR_BUILD = { city: nearCity, resi: nearResi, suburb: nearSuburb, rural: nearRural, mount: nearRural, sea: nearRural };
/* 建物のすき間: 街では木か電柱、郊外は木ややぶが増え、田園はほとんど何も置かない（奥まで見通せる） */
function gapStuff(g, r, x, b, gw, e) {
  const bio = pickBiome(e, r), t = r();
  if (bio === 'rural' || bio === 'sea' || bio === 'mount') { if (t < 0.04 && gw >= 12) tree(g, r, x, b, 2); else if (t < 0.1) utilityPole(g, x + (gw >> 1), b); }
  else if (bio === 'suburb') {
    if (t < 0.3 && gw >= 12) tree(g, r, x, b, 2);
    else if (t < 0.5 && gw >= 8) tree(g, r, x, b, 1);
    else if (t < 0.62) utilityPole(g, x + (gw >> 1), b);
    else if (t < 0.74 && gw >= 8) bush(g, r, x, b);
  }
  else if (gw >= 12 && t < 0.7) tree(g, r, x, b, 2);
  else if (gw >= 8 && t < 0.88) tree(g, r, x, b, 1);
  else if (bio !== 'city') utilityPole(g, x + (gw >> 1), b);
}
export function drawNear(g, i, r, L) {
  const cw = L.cw, base = 68;
  ground(g, i, r, L, base, NEAR);
  seaNearWater(g, i, L, base);
  nearBank(g, L, i, base); // 山間: 迫る斜面
  let x = 0;
  while (x < cw) {
    const e = env(L, i, x), rem = cw - x;
    if (rem < 9) break;
    if (e.sea > 0) { const sw = seaNear(g, r, x, base, rem, e, L, i); if (sw) { x += sw; continue; } }
    if (e.mount > 0 && r() < e.mount) { x += nearMount(g, r, x, base, rem, L, i); continue; }
    if (r() >= e.build) { const gw = Math.min(ri(r, 5, 14), rem); gapStuff(g, r, x, base, gw, e); x += gw; continue; }
    const w = NEAR_BUILD[pickBiome(e, r)](g, r, x, base, rem, e);
    x += w + (r() < 0.35 ? ri(r, 1, 2) : 0);
  }
}
