import { W, state } from './state.js';
import { world, BIOME_KEYS } from './world.js';
import { stationAt } from './stations.js';
import { featureNear, nextFeature } from './features.js';
import { nextCurve, nextElev, V_MAX } from './course.js';
import { TOD, DAWN, DUSK, nextTimePoint, nextWeatherPoint } from './clock.js';
import { cruiseAt, brakeDist, jumpTo } from './journey.js';
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
/* 次の駅の手前: 向かっている駅の減速が始まる地点（あり得る最高速度 V_MAX で走ってきた場合）のさらに AHEAD ドット手前（state.dist の値）。
   すでに過ぎている（減速中・停車中を含む）なら、その次の駅 */
export function beforeStation() {
  const at = st => st.pos - brakeDist(V_MAX) - AHEAD;
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

/* 次のカーブ・高架の手前: 始点 a が窓の中央に来る BEFORE ドット手前（state.dist の値）。すでにその地点を過ぎたものは飛ばす。無ければ null */
export function beforeCourse(next) {
  const at = c => c.a - W / 2 - BEFORE;
  let c = next(state.dist + W / 2);
  while (c && state.dist >= at(c) - 1) c = next(c.a + 1);
  return c ? at(c) : null;
}

const FNAME = { tunnel: 'トンネル', bridge: '橋' };
function featInfo(c) {
  const f = featureNear(c);
  if (f) return `${FNAME[f.type]}${f.n} の中（出口まで ${Math.round(f.b - c)}）`;
  const n = nextFeature(c);
  return n ? `次は ${FNAME[n.type]}${n.n} まで ${Math.round(n.a - c)}` : '';
}
/* 次の夕方・朝・天気の変わり目の手前: 移り変わりが始まる地点が窓の中央に来る BEFORE ドット手前（state.dist の値）。固定は見ない本来の時刻・天気で探す */
export const beforeTime = hour => nextTimePoint(state.dist + W / 2 + BEFORE + 1, hour) - W / 2 - BEFORE;
export function beforeWeather() { const d = nextWeatherPoint(state.dist + W / 2 + BEFORE + 1); return d === null ? null : d - W / 2 - BEFORE; }
const clock = h => { const m = Math.floor(h * 60 + 1e-6); return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
function toneInfo() {
  const w = state.wx, tn = state.tone, f = v => v.toFixed(2);
  return `${clock(state.hour)}${state.todFix != null ? '（固定）' : ''} ／ cloud ${f(w.cloud)} rain ${f(w.rain)} snow ${f(w.snow)}${state.wxFix ? '（固定）' : ''}` +
    (tn ? ` ／ トーン ${tn.key}` + (state.toneTo ? ` → ${state.toneTo.key} ${Math.round(state.toneK * 100)}%` : '') : '');
}
function info() {
  const c = state.dist + W / 2, e = world(c), st = state.station, fi = featInfo(c);
  const ws = BIOME_KEYS.filter(k => e[k] >= 0.05).map(k => k + ' ' + e[k].toFixed(2)).join(' ');
  const sg = v => (v > 0 ? '+' : '') + v.toFixed(2);
  return `距離 ${Math.floor(state.dist)} ／ ${ws} ／ ${state.phase} ${Math.round(state.speed * 0.36)}km/h（目標 ${Math.round(cruiseAt(state.dist, st ? st.pos : Infinity) * 0.36)}）` +
    ` ／ curve ${sg(state.curve)} elev ${state.elev.toFixed(2)}` +
    (st ? ` ／ ${st.name} まで ${Math.max(0, Math.round(st.pos - state.dist))}` : '') + (fi ? ` ／ ${fi}` : '') + ` ／ 乗客 ${passengers.length}人 ／ ${toneInfo()}`;
}

/* 初期化。デバッグ表示が有効なら、毎フレーム呼ぶ関数 tick(now) を返す（表示の更新は 0.25 秒に1回） */
export function initDebug(render) {
  if (!new URLSearchParams(location.search).has('debug')) return null;
  const row = document.getElementById('debug'), rateSel = document.getElementById('dbg-rate'), out = document.getElementById('dbg-info');
  if (!row) return null;
  row.hidden = false;
  const show = () => { const s = info(); if (s !== out.textContent) out.textContent = s; };
  const jump = d => { jumpTo(d); if (!state.playing) render(); show(); };
  // 再生速度のボタン（停止 = 0。停止中も描画は続くので、移動のボタンの結果はその場で見える）
  const rateBtns = [...rateSel.querySelectorAll('button[data-rate]')];
  const setRate = n => {
    state.rate = n;
    for (const b of rateBtns) b.setAttribute('aria-pressed', String(+b.dataset.rate === n));
    if (n === 1) driveAudio(true); // 早送り・停止の間は常時音を動かしていないので、戻すときに今の速度へ合わせる
    syncAudio();
  };
  for (const b of rateBtns) b.addEventListener('click', () => setRate(+b.dataset.rate));
  document.getElementById('dbg-biome').addEventListener('click', () => jump(nextBiomePoint(state.dist + W / 2) - W / 2));
  document.getElementById('dbg-station').addEventListener('click', () => jump(beforeStation()));
  for (const type of ['tunnel', 'bridge']) {
    const b = document.getElementById('dbg-' + type);
    if (b) b.addEventListener('click', () => { const d = beforeFeature(type); if (d !== null) jump(d); });
  }
  for (const [id, next] of [['dbg-curve', nextCurve], ['dbg-elev', nextElev]]) {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', () => { const d = beforeCourse(next); if (d !== null) jump(d); });
  }
  // 時間帯・天気の固定（自動 = 走行距離から決まる値。固定を替えると、次の描画でフェードせずにその色調へ替わる。停止中でも替わる）
  const fixRow = (id, attr, set) => {
    const bs = [...document.querySelectorAll('#' + id + ' button[data-' + attr + ']')];
    for (const b of bs) b.addEventListener('click', () => {
      set(b.dataset[attr]);
      for (const o of bs) o.setAttribute('aria-pressed', String(o === b));
      if (!state.playing) render(); show();
    });
  };
  fixRow('dbg-tod', 'tod', v => { state.todFix = v === 'auto' ? null : TOD[v]; });
  fixRow('dbg-wx', 'wx', v => { state.wxFix = v === 'auto' ? null : v; });
  for (const [id, at] of [['dbg-dusk', () => beforeTime(DUSK[0])], ['dbg-dawn', () => beforeTime(DAWN[0])], ['dbg-wxnext', beforeWeather]]) {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', () => { const d = at(); if (d !== null) jump(d); });
  }
  let last = -1e9;
  show();
  return now => { if (now - last >= 250) { last = now; show(); } };
}
