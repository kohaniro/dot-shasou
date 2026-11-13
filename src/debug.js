import { W, state } from './state.js';
import { world, BIOME_KEYS } from './world.js';
import { stationAt } from './stations.js';
import { featureNear, nextFeature } from './features.js';
import { cruise, brakeDist, jumpTo } from './journey.js';
import { passengers } from './passengers.js';
import { driveAudio, syncAudio } from './audio.js';

/* ---------- デバッグ用の操作（早送り・ジャンプ）と状態の表示 ----------
   URL のクエリに debug があるときだけ出す（例: /?debug#line-1234）。無ければ何もせず null を返す。
   「いまの地点」は窓の中央に見えている地点 state.dist + W/2（駅の pos + W/2、layers.js の env() と同じ基準） */
const STEP = 50, FAR = 400000, FULL = 0.8, AHEAD = 400;
const top = e => BIOME_KEYS.reduce((a, k) => e[k] > e[a] ? k : a, BIOME_KEYS[0]);

/* 次のバイオームの地点（窓の中央の座標）: 最大のバイオームが替わり、その重みが FULL 以上になった最初の地点。
   そこまで上がらずに別のバイオームへ替わるなら、重みが極大だった地点 */
export function nextBiomePoint(c0) {
  const cur = top(world(c0));
  let nb = null, best = -1, bestD = c0;
  for (let d = c0 + STEP; d < c0 + FAR; d += STEP) {
    const e = world(d), b = top(e);
    if (!nb) { if (b === cur) continue; nb = b; }
    if (b !== nb) break;
    if (e[nb] > best) { best = e[nb]; bestD = d; }
    if (best >= FULL) break;
  }
  return bestD;
}
/* 次の駅の手前: 向かっている駅の減速が始まる地点のさらに AHEAD ドット手前（state.dist の値）。
   すでに過ぎている（減速中・停車中を含む）なら、その次の駅 */
export function beforeStation() {
  const at = st => st.pos - brakeDist(cruise(state.t)) - AHEAD;
  let st = state.station;
  if (state.phase === 'brake' || state.phase === 'stop' || state.dist >= at(st)) st = stationAt(st.k + 1);
  return at(st);
}

/* 次のトンネル・橋の手前: 入口 a が窓の中央に来る BEFORE ドット手前（state.dist の値）。
   いま中にいる区間と、すでにその地点を過ぎた区間は飛ばして次へ。見つからなければ null */
const BEFORE = 500;
export function beforeFeature(type) {
  const at = f => f.a - W / 2 - BEFORE;
  let f = nextFeature(state.dist + W / 2, type);
  while (f && state.dist >= at(f) - 1) f = nextFeature(f.b + 1, type);
  return f ? at(f) : null;
}

const FNAME = { tunnel: 'トンネル', bridge: '橋' };
function featInfo(c) {
  const f = featureNear(c);
  if (f) return `${FNAME[f.type]}${f.n} の中（出口まで ${Math.round(f.b - c)}）`;
  const n = nextFeature(c);
  return n ? `次は ${FNAME[n.type]}${n.n} まで ${Math.round(n.a - c)}` : '';
}
function info() {
  const c = state.dist + W / 2, e = world(c), st = state.station, fi = featInfo(c);
  const ws = BIOME_KEYS.filter(k => e[k] >= 0.05).map(k => k + ' ' + e[k].toFixed(2)).join(' ');
  return `距離 ${Math.floor(state.dist)} ／ ${ws} ／ ${state.phase} ${Math.round(state.speed * 0.36)}km/h` +
    (st ? ` ／ ${st.name} まで ${Math.max(0, Math.round(st.pos - state.dist))}` : '') + (fi ? ` ／ ${fi}` : '') + ` ／ 乗客 ${passengers.length}人`;
}

/* 初期化。デバッグ表示が有効なら、毎フレーム呼ぶ関数 tick(now) を返す（表示の更新は 0.25 秒に1回） */
export function initDebug(render) {
  if (!new URLSearchParams(location.search).has('debug')) return null;
  const row = document.getElementById('debug'), rateSel = document.getElementById('dbg-rate'), out = document.getElementById('dbg-info');
  if (!row) return null;
  row.hidden = false;
  const show = () => { const s = info(); if (s !== out.textContent) out.textContent = s; };
  const jump = d => { jumpTo(d); if (!state.playing) render(); show(); };
  rateSel.addEventListener('change', () => {
    state.rate = Math.max(1, parseInt(rateSel.value, 10) || 1);
    if (state.rate === 1) driveAudio(true); // 早送り中は常時音を動かしていないので、戻すときに今の速度へ合わせる
    syncAudio();
  });
  document.getElementById('dbg-biome').addEventListener('click', () => jump(nextBiomePoint(state.dist + W / 2) - W / 2));
  document.getElementById('dbg-station').addEventListener('click', () => jump(beforeStation()));
  for (const type of ['tunnel', 'bridge']) {
    const b = document.getElementById('dbg-' + type);
    if (b) b.addEventListener('click', () => { const d = beforeFeature(type); if (d !== null) jump(d); });
  }
  let last = -1e9;
  show();
  return now => { if (now - last >= 250) { last = now; show(); } };
}
