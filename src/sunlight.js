import { W, state } from './state.js';
import { STYLE } from './palette.js';
import { hash32 } from './rng.js';
import { heading } from './course.js';
import { featureNear } from './features.js';
import { wallNear } from './closewalls.js';
import { trainNear, TRAIN_F } from './trains.js';
import { stationNear } from './stations.js';
import { tones } from './layers.js';
import { litInterior } from './interior.js';
import { roofSpan, PLAT_F } from './scenery/station.js';
import { TUN_F } from './scenery/tunnel.js';
import { WALL_F } from './scenery/closewall.js';

/* ---------- 車内の日差し（main.js の render() が、車内を重ねた後・乗客の前に毎フレーム呼ぶ） ----------
   晴れた昼、背中側（見ている窓の反対側）の窓から差し込んだ日の光が、向かいの座席・腰板・窓の柱・袖仕切りに落ちる。
   光の形は背中側の窓（見えている窓と同じ並び: 窓 x 50〜158 / 162〜270、扉の窓 8〜26。扉の間隔 PERIOD で車両の前後へくり返す）を、
   太陽の向きに平行移動したもの。そこに日なたの車内（interior.js の litInterior）を切り抜いて重ねる（窓の開口部は抜いてあるので光は落ちない）。
   向き: 太陽の方位と車両の向きの差 β（度。90 = 真横から、0 / 180 = 真正面 / 真後ろ。0〜180 の外は太陽が見ている窓の側）を
     β = 90 + 路線ごとのずれ + 時刻で回る分 − perHeading × heading(窓の中央) で決める。カーブで heading が変わると β が変わり、光が座席の上を横へ滑る
     （curve が正 = 見ている窓がカーブの外側のときは、車両が背中側（太陽の側）へ向きを変えるので β が減り、光は後ろ = 左へ、景色が流れるのと同じ向きに滑る）。
     横のずれは −cw × cot β（太陽が前寄りなら後ろ = 左へ）、下がる量は cw × tan(高度) / √sin β（斜めに差すほど向かいの壁までの道のりが長い。
     物理の 1 / sin β だと斜めのときに光が座席の下へ抜けてしまうので弱めてある）。
     形は少し傾けた平行四辺形にする（行ごとのずれ slant × 横のずれ）。
   強さ: トーン（tones.a / tones.b を state.toneK で混ぜる。夜の映り込みと同じ）の外光 sun と曇り具合から、× 太陽が背中側にある度合い（sin β）。
     夜・夕方の後半・曇り・雨・雪では 0 で、描かない（絵は日差しを入れる前と同じ）。
   さえぎるもの: トンネルの壁・駅の上屋・至近の建物・対向列車。それぞれの層の画面上の範囲（窓の座標）を光の出どころから除く
     （層と一緒に滑ってくるので、影の縁が光の帯を横切って消していく）。物理的には背中側の窓からの光だが、
     見えている窓がふさがれた所では光も消す、という演出（2026-11-17 の依頼の指定）。 */
export const SUN = {
  salt: 9701,          // hash32(seed, salt, 0): 路線ごとの太陽の方位のずれ
  az: [-28, 28],       // 直線（heading 0）・正午での、太陽の方位の真横からのずれ（度。路線ごと）
  azPerHour: 6,        // 時刻で太陽が回る量（度 / 時。午後ほど進行方向の後ろへ）
  perHeading: 0.5,     // heading 1 あたりの車両の向きの変化（度）。カーブ1つで向きが 25〜55° 変わる
  cw: 64,              // 背中側の窓から向かいの壁までの距離（ドット）
  elev: 48,            // 正午の太陽の高さ（度）。朝夕は低い（sin で）
  slant: 0.006,        // 平行四辺形の傾き（行ごとに 横のずれ × slant）
  side: [0.3, 0.62],   // sin β がこの範囲で 0 → 1（太陽が真正面・真後ろ・見ている窓の側へ回ると消える）
  sunTone: [0.38, 0.85], // トーンの外光 sun がこの範囲で 0 → 1（夕方の前半で薄れ、後半で消える）
  cloudPow: 2,         // 曇り具合 q に対して (1 − q)^cloudPow
  alpha: 0.82,         // いちばん強いときの日なたの車内の濃さ
  PERIOD: 287          // 背中側の窓の並びのくり返し（扉の間隔）
};
const PANES = [[8, 26, 32, 94], [50, 158, 28, 104], [162, 270, 28, 104]]; // 背中側の窓 [x0, x1, y0, y1]（1区画ぶん）
const Y0 = 20, Y1 = 150;   // 見えている車内の行（内部座標）
const clamp01 = v => Math.min(1, Math.max(0, v));
const ramp = (x, [a, b]) => clamp01((x - a) / (b - a));
const sstep = x => x * x * (3 - 2 * x);
const RAD = Math.PI / 180;

/* トーン tn での日差しの強さ 0..1 */
const sunOf = tn => tn ? sstep(ramp(tn.sun, SUN.sunTone)) * Math.pow(1 - tn.cloud, SUN.cloudPow) : 0;
/* いまの強さ（クロスフェード中は2つのトーンの間） */
export function sunStrength() {
  const k = state.toneTo ? Math.min(1, state.toneK) : 0;
  return sunOf(tones.a) * (1 - k) + (state.toneTo ? sunOf(tones.b) * k : 0);
}
/* 地点 c（窓の中央）・時刻 hour での光の向き: { beta（度）, side（0..1）, dx（横のずれ）, dy（下がる量） } */
export function sunGeom(c, hour) {
  const off = SUN.az[0] + (SUN.az[1] - SUN.az[0]) * hash32(state.seed, SUN.salt, 0) / 4294967296;
  const beta = 90 + off + SUN.azPerHour * (hour - 12) - SUN.perHeading * heading(c);
  const sb = Math.sin(beta * RAD), side = sstep(ramp(sb, SUN.side));
  const el = SUN.elev * clamp01(Math.sin(Math.PI * (hour - 6) / 12)) * RAD, s = Math.max(0.2, sb);
  return { beta, side, dx: -SUN.cw * Math.cos(beta * RAD) / s, dy: SUN.cw * Math.tan(el) / Math.sqrt(s) };
}
/* 光をさえぎる層の画面上の範囲 [x0, x1] の配列（窓の座標。層の通し座標から） */
const sx = (d, f, dist) => W / 2 + (d - dist - W / 2) * f;
function blockers(dist) {
  const c = dist + W / 2, out = [];
  const f = featureNear(c, 400);
  if (f && f.type === 'tunnel') out.push([sx(f.a, TUN_F, dist), sx(f.b, TUN_F, dist)]);
  const w = wallNear(c, 400);
  if (w) out.push([sx(w.a, WALL_F, dist), sx(w.b, WALL_F, dist)]);
  const t = trainNear(c, 200);
  if (t) out.push([sx(t.a, TRAIN_F, dist), sx(t.b, TRAIN_F, dist)]);
  const st = stationNear(c, 400), rf = st && roofSpan(st);
  if (rf) { const o = Math.floor(dist * PLAT_F); out.push([rf[0] - o, rf[1] - o]); }
  return out;
}
/* 区間 [a, b) から blk の範囲を除いた区間の配列 */
function cut(a, b, blk) {
  let parts = [[a, b]];
  for (const [p, q] of blk) {
    const next = [];
    for (const [u, v] of parts) { if (q <= u || p >= v) next.push([u, v]); else { if (p > u) next.push([u, p]); if (q < v) next.push([q, v]); } }
    parts = next;
  }
  return parts;
}

/* 日差しを描く。g は main.js の画面（内部座標）。強さが 0 のとき・光が窓の側から外れているときは何もしない */
export function drawSunlight(g) {
  let k = sunStrength();
  if (k <= 0) return;
  const { dist } = state, geo = sunGeom(dist + W / 2, state.hour);
  k *= geo.side;
  if (k <= 0.004) return;
  let a = k * SUN.alpha;
  if (!STYLE.fade) { if (a < SUN.alpha / 2) return; a = 1; } // 色数の少ない絵柄は中間色を出さない（トーンと同じく、薄めずに出すか消すか）
  const blk = blockers(dist), P = SUN.PERIOD;
  // 行ごとの光の区間（画面 x の整数の [x0, x1)）を求め、同じ区間が続く行はまとめて写す
  let prevKey = '', prevSpans = [], from = Y0;
  const flush = (y) => { for (const [x0, x1] of prevSpans) g.drawImage(litInterior, x0, from, x1 - x0, y - from, x0, from, x1 - x0, y - from); };
  g.globalAlpha = a;
  for (let y = Y0; y <= Y1; y++) {
    const spans = [];
    if (y < Y1) {
      const ys = y - geo.dy, shift = geo.dx * (1 + SUN.slant * (y - 112));
      const n0 = Math.floor((-shift - 280) / P), n1 = Math.ceil((W - shift) / P);
      for (let n = n0; n <= n1; n++) for (const [x0, x1, y0, y1] of PANES) {
        if (ys < y0 || ys >= y1) continue;
        for (const [u, v] of cut(x0 + n * P, x1 + n * P, blk)) {
          const p = Math.max(0, Math.round(u + shift)), q = Math.min(W, Math.round(v + shift));
          if (q > p) spans.push([p, q]);
        }
      }
    }
    const key = spans.join(';');
    if (key !== prevKey) { flush(y); prevKey = key; prevSpans = spans; from = y; }
  }
  g.globalAlpha = 1;
}
