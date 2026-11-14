import { W, SH, state } from '../state.js';
import { STYLE, R, shade, tint } from '../palette.js';
import { stationNear } from '../stations.js';
import { lineColor } from './station.js';
import { bridgeNear } from './bridge.js';
import { tunnelNear } from './tunnel.js';

/* ---------- カーブで見える自分の列車（前方の車両の側面） ----------
   窓がカーブの内側（curve が負）で、きつい所のあいだだけ、画面の右端（進行方向）から前方の車両がせり出す。
   絵は1枚（横 SW ドット。左端が先頭車の前の端、右へ行くほど近い車両で大きい）を一度だけ作り、
   curve に応じて右端から横へずらして出す（−curve が C0 で出始め、C1 で REACH ドット出る）。
   main.js の render() が、景色の層・ホーム・トラス・トンネルの壁の後、ガラスの映り込みの前に描く（Layer ではない）。
   トンネル・橋・駅の近くでは出さない（カーブはどれからも 200〜300 ドット離して置かれ、カーブの端では curve が 0 なので、急に消えることはない）。 */
const SW = 124;            // 絵の幅
const REACH = 118;         // 最も出たときの幅（画面の右端から）
const C0 = 0.55, C1 = 0.95;
const HY = 47;             // 目の高さ（消える先）
const K0 = 0.5, K1 = 2.7;  // 大きさの倍率: 左端（遠い）〜 右端（近い）
const CAR = 200, TOTAL = 372; // 車両の長さ（ドット）と、絵に入る列車の長さ
const LEAD = 46;           // 先頭車の前に見せる線路の長さ（ドット）
const clamp01 = v => Math.min(1, Math.max(0, v));
const sstep = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
const kAt = xs => K0 + (K1 - K0) * Math.pow(xs / (SW - 1), 1.6);

const SILVER = '#c9cdd0', SILVER_L = '#dfe3e5', SILVER_D = '#a7acae', ROOF = '#8d9396', ROOF_D = '#6c7275';
const BALLAST = '#8f897d', RAILC = '#5d6266';
const GLASS = '#3d4f63', GLASS_L = '#5b7389', UNDER = '#3a3e41', BOX = '#565a5d', WHEEL = '#22262b', HORO = '#2a2d31';

let sprite = null, keySeed = null, keyStyle = null;
function build() {
  const c = document.createElement('canvas'); c.width = SW; c.height = SH;
  const g = c.getContext('2d'), line = lineColor();
  // 列ごとの「先頭からの距離」: 遠いほど1ドットに入る長さが大きい（1/倍率に比例）
  const inv = []; let sum = 0;
  for (let xs = 0; xs < SW; xs++) { inv.push(sum); sum += 1 / kAt(xs); }
  for (let xs = 0; xs < SW; xs++) {
    const k = kAt(xs), m = (TOTAL + LEAD) * inv[xs] / sum - LEAD, m1 = (TOTAL + LEAD) * (inv[xs] + 1 / k) / sum - LEAD; // この列が受け持つ範囲 [m, m1)。負は先頭車より前
    const p = m % CAR, span = m1 - m, hit = (a, b) => p + span > a && p < b;              // 車両の中の位置（前の端から）
    const yt = HY - 18 * k, H = 33 * k, Y = v => Math.round(yt + v * H), V = (v0, v1, col) => R(g, xs, Y(v0), 1, Math.max(1, Y(v1) - Y(v0)), col);
    V(1.2, 1.4, BALLAST); R(g, xs, Y(1.2), 1, 1, RAILC); if (xs % 3 === 0) R(g, xs, Y(1.2) + 1, 1, 1, shade(BALLAST, 0.25)); // 道床とレール、まくらぎ
    if (m1 <= 0) continue;
    const front = m <= 0;
    if (hit(CAR - 5, CAR) && m > 4) { V(0.06, 1.04, HORO); V(0.06, 0.1, ROOF_D); continue; } // 連結部（ほろ）
    // 屋根と冷房装置
    V(0, 0.07, ROOF); if (hit(58, 92) || hit(108, 142)) V(-0.05, 0.01, SILVER_D);
    R(g, xs, Y(0), 1, 1, tint(ROOF, 0.25));
    // 車体
    V(0.07, 1, SILVER); R(g, xs, Y(0.07), 1, 1, SILVER_L);
    V(0.115, 0.14, line);                                   // 幕板の細い帯
    V(0.56, 0.635, line); R(g, xs, Y(0.635), 1, 1, shade(line, 0.25)); // 窓の下の帯
    for (const v of [0.74, 0.85]) R(g, xs, Y(v), 1, 1, SILVER_D); // 腰板のビード
    R(g, xs, Y(1) - 1, 1, 1, shade(SILVER_D, 0.2));
    // 扉（1両に4つ）と窓
    let door = false, glass = false;
    for (const dc of [26, 75, 125, 174]) {
      if (hit(dc - 7, dc + 7)) { door = true; glass = hit(dc - 5, dc - 1) || hit(dc + 1, dc + 5); if ((p <= dc - 7 && p + span > dc - 7) || (p < dc + 7 && p + span >= dc + 7) || (span < 2 && hit(dc - 0.5, dc + 0.5))) V(0.17, 1, SILVER_D); }
    }
    if (!door) glass = (hit(37, 64) || hit(86, 114) || hit(136, 163) || hit(4, 15) || hit(185, 192)) && !(span < 3 && (hit(50, 51.5) || hit(99.5, 101) || hit(149, 150.5)));
    if (glass) {
      const v0 = door ? 0.24 : 0.22, v1 = door ? 0.5 : 0.52;
      V(v0, v1, GLASS); V(v0, v0 + 0.09, GLASS_L); R(g, xs, Y(v0) - 1, 1, 1, SILVER_D);
    }
    // 床下: 機器箱と台車
    V(1, 1.2, UNDER);
    if (hit(62, 94) || hit(104, 140)) V(1.02, 1.15, BOX);
    if (hit(20, 28) || hit(36, 44) || hit(156, 164) || hit(172, 180)) V(1.06, 1.24, WHEEL);
    if (front) V(0.03, 1.05, shade(SILVER_D, 0.3)); // 先頭車の前の端
  }
  return c;
}
/* g は画面の座標系（main.js の cx）。dist は state.dist、cv は窓の中央の curve、oy は景色の層の上端の画面 y（揺れ・カント込み） */
export function drawSelfTrain(g, dist, cv, oy) {
  const out = sstep((-cv - C0) / (C1 - C0)) * REACH;
  if (out < 0.5) return;
  const d = dist + W / 2;
  if (tunnelNear(d) || bridgeNear(d) || stationNear(d, 160)) return;
  if (!sprite || keySeed !== state.seed || keyStyle !== STYLE) { sprite = build(); keySeed = state.seed; keyStyle = STYLE; } // 帯の色は路線ごと、色は絵柄ごと
  g.drawImage(sprite, W - Math.round(out * 2) / 2, oy);
}
