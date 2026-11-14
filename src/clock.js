import { state } from './state.js';
import { hash32 } from './rng.js';

/* ---------- 時間帯と天気（シードと走行距離から決定的に決める。描画はしない） ----------
   どちらも走行距離 d の純粋な関数（state.t や実時計は見ない）。同じシード・同じ地点なら必ず同じ時刻・同じ天気。
   「いまの地点」は窓の中央 state.dist + W/2（layers.js の env() や駅と同じ基準）で引くこと。
   デバッグ用の固定: state.todFix（null = 自動 / 時刻の数値）、state.wxFix（null = 自動 / 'clear' | 'cloud' | 'rain' | 'snow'。'rain:0.5' のように強さも付けられる）が
   入っていれば、timeAt / weatherAt はそれを返す。 */

/* 時刻: 1日 = DAY_LEN ドット（巡航と停車をならして実時間 30〜40 分）。出発時刻はシードごと。
   進み方は一様でない: SPANS = [始まりの時刻, 終わりの時刻, 1日の距離に占める割合]。昼を長く、夜は短く、朝夕の移り変わりはじっくり */
export const DAY_LEN = 400000;
export const DAWN = [4.5, 7];     // 朝の移り変わり（夜 → 朝焼け → 昼）
export const DUSK = [16.5, 19.5]; // 夕方の移り変わり（昼 → 夕焼け → 夜）
const SPANS = [
  [DAWN[1], DUSK[0], 0.72],       // 昼 9.5 時間ぶん: 288000 ドット（約 25 分）
  [DUSK[0], DUSK[1], 0.05],       // 夕方: 20000 ドット（約 1 分半〜2 分）
  [DUSK[1], DAWN[0] + 24, 0.18],  // 夜 9 時間ぶん: 72000 ドット（約 6 分）
  [DAWN[0], DAWN[1], 0.05]        // 朝: 20000 ドット
];
export const TOD = { dawn: 5.5, noon: 12, dusk: 18, night: 0 }; // 朝焼け・夕焼けがいちばん濃い時刻など（固定・撮影用の名前）
const SALT_START = 9001; // hash32(seed, SALT_START, 0): 出発時刻

/* 天気: おおよそ WX_SEG ドットごとの区間（境目は ±WX_JIT ずれる）に、シードから 晴 / 曇 / 雨 / 雪 を割り当てる。
   内部では「崩れ具合」w（0 晴 / 1 曇 / 2 雨か雪）を境目の前後で直線的に動かす。w が 1 進むのに WX_RAMP ドット。
   cloud = min(1, w)、雨・雪 = w − 1 なので、晴 ↔ 雨・雪 は必ず曇りを通る（雨 ↔ 雪 も境目でいったん曇りに戻す） */
export const WX_SEG = 36000, WX_JIT = 9000, WX_RAMP = 3000;
export const WX_P = { clear: 0.6, cloud: 0.22, rain: 0.12, snow: 0.06 }; // 区間ごとの確率（合計 1）
export const WX_KINDS = ['clear', 'cloud', 'rain', 'snow'];
const SALT_WX = 9002, SALT_WXB = 9003; // 区間の天気、境目のずれ
const WET = { clear: 0, cloud: 1, rain: 2, snow: 2 };

const clamp01 = v => Math.min(1, Math.max(0, v));
const sstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const frac = v => v - Math.floor(v);
const u01 = (salt, k) => hash32(state.seed, salt, k) / 4294967296;

/* ---------- 時刻 ---------- */
const startU = () => u01(SALT_START, 0); // 出発地点が「1日の距離」のどこか（0 = 朝 7 時）
/* 固定を見ない本来の時刻 0..24 */
export function rawTimeAt(d) {
  let u = frac(d / DAY_LEN + startU());
  for (const [h0, h1, share] of SPANS) { if (u < share) return (h0 + (h1 - h0) * u / share) % 24; u -= share; }
  return SPANS[0][0];
}
/* 走行距離 d の時刻 0..24（連続値） */
export const timeAt = d => state.todFix != null ? ((state.todFix % 24) + 24) % 24 : rawTimeAt(d);
/* 時刻 → 絵づくり用の連続値（各 0..1）。
   night: 夜の度合い（夕方の後半で 0 → 1、朝の前半で 1 → 0）
   dusk / dawn: 夕焼け・朝焼けの度合い（TOD.dusk / TOD.dawn で 1 の山形）
   day: 昼らしさ（= (1 − night) × (1 − dusk − dawn)）。昼は day = 1 でほかは 0 */
export function phaseOf(hour) {
  const h = ((hour % 24) + 24) % 24;
  const night = h >= DUSK[0] ? sstep(TOD.dusk, DUSK[1], h) : 1 - sstep(DAWN[0], 6, h);
  const dusk = h >= DUSK[0] && h <= DUSK[1] ? sstep(DUSK[0], TOD.dusk, h) * (1 - sstep(TOD.dusk, DUSK[1], h)) : 0;
  const dawn = h >= DAWN[0] && h <= DAWN[1] ? sstep(DAWN[0], TOD.dawn, h) * (1 - sstep(TOD.dawn, DAWN[1], h)) : 0;
  return { hour: h, day: (1 - night) * (1 - dusk - dawn), dusk, dawn, night };
}
export const dayPhase = d => phaseOf(timeAt(d));
/* d より先で、本来の時刻が hour になる最初の地点（固定は見ない） */
export function nextTimePoint(d, hour) {
  const h = ((hour % 24) + 24) % 24; let u = 0, acc = 0;
  for (const [h0, h1, share] of SPANS) {
    const hh = h < h0 ? h + 24 : h;
    if (hh >= h0 && hh < h1) { u = acc + share * (hh - h0) / (h1 - h0); break; }
    acc += share;
  }
  const n = Math.floor(d / DAY_LEN - (u - startU())) + 1;
  return (u - startU() + n) * DAY_LEN;
}

/* ---------- 天気 ---------- */
/* 区間 k は [wxEdge(k), wxEdge(k + 1))。ずれは WX_SEG の半分より小さいので順序は入れ替わらない */
export const wxEdge = k => Math.round(k * WX_SEG + (u01(SALT_WXB, k) * 2 - 1) * WX_JIT);
export function wxKind(k) {
  let v = u01(SALT_WX, k);
  for (const key of WX_KINDS) { if (v < WX_P[key]) return key; v -= WX_P[key]; }
  return 'clear';
}
/* d を含む区間の番号 */
export function wxSeg(d) {
  let k = Math.floor(d / WX_SEG);
  if (d < wxEdge(k)) k--; else if (d >= wxEdge(k + 1)) k++;
  return k;
}
const FIXED = { clear: { cloud: 0, rain: 0, snow: 0 }, cloud: { cloud: 1, rain: 0, snow: 0 }, rain: { cloud: 1, rain: 1, snow: 0 }, snow: { cloud: 1, rain: 0, snow: 1 } };
/* 固定の指定 → 天気。'rain:0.5' のように強さ（0..1）を付けられる（'cloud:0.5' は曇り具合、'rain:' / 'snow:' は降りの強さで、雲は 1） */
const fixMemo = new Map();
function fixedWx(s) {
  let w = FIXED[s] || fixMemo.get(s);
  if (!w) {
    const [kind, v] = String(s).split(':'), k = clamp01(Number(v));
    w = !FIXED[kind] || !(k >= 0) ? FIXED.clear : kind === 'cloud' ? { cloud: k, rain: 0, snow: 0 } : kind === 'rain' ? { cloud: 1, rain: k, snow: 0 } : kind === 'snow' ? { cloud: 1, rain: 0, snow: k } : FIXED.clear;
    fixMemo.set(s, w);
  }
  return w;
}
/* 固定を見ない本来の天気 */
export function rawWeatherAt(d) {
  const k = wxSeg(d), cur = wxKind(k);
  let w = WET[cur], wet = cur; // wet: 降るなら雨か雪か
  for (const [edge, other] of [[wxEdge(k), wxKind(k - 1)], [wxEdge(k + 1), wxKind(k + 1)]]) {
    if (other === cur) continue;
    const u = Math.abs(d - edge), dw = Math.abs(WET[cur] - WET[other]);
    if (dw === 0) { if (u < WX_RAMP) w = 1 + u / WX_RAMP; continue; }  // 雨 ↔ 雪: 境目で曇りまで戻す
    const half = dw * WX_RAMP / 2;
    if (u < half) { w = WET[other] + (WET[cur] - WET[other]) * (0.5 + u / (2 * half)); if (WET[other] === 2) wet = other; }
  }
  const p = clamp01(w - 1);
  return { cloud: clamp01(w), rain: wet === 'rain' ? p : 0, snow: wet === 'snow' ? p : 0 };
}
/* 走行距離 d の天気 { cloud, rain, snow }（各 0..1 の連続値。雨・雪が 0 より大きいとき cloud は 1） */
export const weatherAt = d => state.wxFix ? fixedWx(state.wxFix) : rawWeatherAt(d);
/* d より先で、天気が替わり始める最初の地点（隣と天気の違う境目の、移り変わりの始まり。固定は見ない） */
export function nextWeatherPoint(d) {
  for (let k = wxSeg(d) + 1, n = 0; n < 400; k++, n++) {
    const a = wxKind(k - 1), b = wxKind(k); if (a === b) continue;
    const at = wxEdge(k) - (Math.abs(WET[a] - WET[b]) || 2) * WX_RAMP / 2;
    if (at > d) return at;
  }
  return null;
}
