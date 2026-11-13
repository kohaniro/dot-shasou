import { RAIL, state } from './state.js';
import { nextStation, stationAt } from './stations.js';
import { sfx } from './audio.js';

/* ---------- 進行（巡航 → 減速 → 停車・ドア開閉 → 発車） ----------
   state.phase: 'run'（巡航）| 'brake'（駅へ減速中）| 'stop'（停車中）| 'depart'（発車して加速中）
   state.station: 向かっている駅（停車中はその駅。発車した瞬間に次の駅へ替わる）
   state.stopT: 停車してからの秒数（stop 以外では 0）
   state.door: ドアの開き 0（閉）〜1（全開）。イージング済み
   state.accel: 直前フレームの加速度（ドット/秒²） */
export const A_BRAKE = 7;    // 常用減速度 ドット/秒²（≒2.5km/h/s）
export const A_ACCEL = 8;    // 起動加速度
const V_SOFT = 25;           // これより遅いと減速度をゆるめる（停止寸前の衝動を和らげる）
const SOFT_MIN = 0.55;       // 停止の瞬間の減速度（A_BRAKE に対する比）
const JERK_T = 1.2;          // 発車時、加速度が立ち上がるまでの秒数
const MERGE = 20;            // 巡航速度との差がこれ以下になると加速をゆるめて合流する

export const cruise = t => 240 * (0.9 + 0.08 * Math.sin(t * 0.07) + 0.03 * Math.sin(t * 0.23 + 1));

/* 停車中のできごと（停車してからの秒数） */
export const T_OPEN = 1.0, T_DOOR = 2.0, T_SIGNAL = 2.2, T_AFTER = 1.5;
export function timeline(st) {
  const opened = T_OPEN + T_DOOR, signal = opened + st.dwell, close = signal + T_SIGNAL, closed = close + T_DOOR;
  return { open: T_OPEN, opened, signal, close, closed, depart: closed + T_AFTER };
}
const ease = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
function doorAt(tl, t) { return t < tl.close ? ease((t - tl.open) / T_DOOR) : 1 - ease((t - tl.close) / T_DOOR); }

/* 減速の曲線を「止まるまでの残り時間 τ」で表にする: 残り距離 S(τ)、速度 V(τ)。
   位置を τ から直接決めるので、フレームの刻みによらず pos ちょうどで止まる */
const H = 0.005, BS = [0], BV = [0];
{
  let s = 0, v = 0;
  while (v < 320) {
    const a = A_BRAKE * (v >= V_SOFT ? 1 : SOFT_MIN + (1 - SOFT_MIN) * v / V_SOFT);
    const v2 = v + a * H; s += (v + v2) / 2 * H; v = v2;
    BS.push(s); BV.push(v);
  }
}
const lerpAt = (arr, tau) => { const f = tau / H, i = Math.min(arr.length - 2, Math.floor(f)); return arr[i] + (arr[i + 1] - arr[i]) * (f - i); };
const search = (arr, x) => { let lo = 0, hi = arr.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m; else hi = m; } return (lo + (x - arr[lo]) / ((arr[hi] - arr[lo]) || 1)) * H; };
const tauOfS = s => search(BS, Math.max(0, s));
/* 速度 v から止まるのに要る距離 */
export const brakeDist = v => lerpAt(BS, search(BV, Math.max(0, v)));

let tau = 0, departT = 0;

function stopAt(st, t0) {
  state.phase = 'stop'; state.station = st; state.dist = st.pos; state.speed = 0; state.stopT = t0;
  state.door = doorAt(timeline(st), t0);
}
function toBrake(st, s) {
  state.phase = 'brake'; state.station = st; tau = tauOfS(s);
  state.speed = lerpAt(BV, tau); state.dist = st.pos - lerpAt(BS, tau);
}

/* 地点 d の状態に置き直す（路線の切り替え、撮影での瞬間移動）。stopT を渡すと、駅の pos ちょうどなら停車中のその時刻にする */
export function seekJourney(d, stopT = 0) {
  state.stopT = 0; state.door = 0; state.accel = 0; tau = 0; departT = 0;
  const st = nextStation(d), s = st.pos - d, vc = cruise(state.t);
  if (Math.abs(s) < 0.5) { stopAt(st, stopT); return; }
  state.dist = d;
  if (brakeDist(vc) >= s) { toBrake(st, s); return; }
  state.station = st;
  // 前の駅を出たばかりなら、加速中の速さにそろえる（一定加速度とみなした近似）
  const back = st.k > 1 ? d - stationAt(st.k - 1).pos : Infinity;
  const v = Math.sqrt(2 * A_ACCEL * Math.max(0, back));
  if (v < vc - 0.3) { state.phase = 'depart'; state.speed = v; departT = JERK_T; }
  else { state.phase = 'run'; state.speed = vc; }
}

/* 地点 d へ飛ぶ: 進行を置き直し、継ぎ目の予約（音と揺れ）を捨てて、次の継ぎ目を飛んだ先に合わせる。
   継ぎ目は 120 + RAIL × n の地点にある（出発地点 d = 0 では次の継ぎ目が 120） */
export function jumpTo(d, stopT = 0) {
  seekJourney(d, stopT);
  state.nextJoint = 120 + RAIL * (Math.floor((state.dist - 120) / RAIL) + 1);
  state.bobs.length = 0; state.hits.length = 0;
}

/* 1フレーム進める。state.speed と state.dist はここで決める */
export function stepJourney(dt) {
  const v0 = state.speed;
  if (state.phase === 'stop') {
    const st = state.station, tl = timeline(st), t0 = state.stopT, t1 = t0 + dt;
    const hit = th => t0 < th && t1 >= th;
    if (hit(tl.open)) { sfx('chime'); sfx('doorOpen'); }
    if (hit(tl.opened)) sfx('thunk', 0.6);
    if (hit(tl.signal)) sfx('melody');
    if (hit(tl.close)) { sfx('chime'); sfx('doorClose'); }
    if (hit(tl.closed)) sfx('thunk', 1);
    state.stopT = t1; state.door = doorAt(tl, t1); state.speed = 0;
    if (t1 >= tl.depart) {
      state.phase = 'depart'; state.stopT = 0; state.door = 0; departT = 0;
      state.station = nextStation(st.pos + 1);
    }
  } else if (state.phase === 'brake') {
    tau = Math.max(0, tau - dt);
    if (tau === 0) { stopAt(state.station, 0); sfx('air'); }
    else { state.speed = lerpAt(BV, tau); state.dist = state.station.pos - lerpAt(BS, tau); }
  } else {
    const vc = cruise(state.t);
    let v;
    if (state.phase === 'depart') {
      departT += dt;
      const a = A_ACCEL * Math.min(1, departT / JERK_T) * Math.min(1, Math.max(0, (vc - v0) / MERGE));
      v = v0 + a * dt;
      if (vc - v <= 0.3) { v = vc; state.phase = 'run'; }
    } else v = vc;
    const st = state.station, s = st.pos - state.dist;
    // このフレームで止まるのに要る距離に届くなら、減速の曲線に乗り換える
    if (brakeDist(v) >= s - v * dt) toBrake(st, Math.max(0, s - v * dt));
    else { state.speed = v; state.dist += v * dt; }
  }
  state.accel = dt > 0 ? (state.speed - v0) / dt : 0;
}
