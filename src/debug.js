import { W, state } from './state.js';
import { world, BIOME_KEYS } from './world.js';
import { stationAt } from './stations.js';
import { featureNear, nextFeature } from './features.js';
import { nextElev } from './course.js';
import { crossingNear, nextCrossing } from './crossings.js';
import { wallNear, nextWall } from './closewalls.js';
import { trainNear, nextTrain } from './trains.js';
import { TOD, DAWN, DUSK, nextTimePoint, nextWeatherPoint } from './clock.js';
import { cruiseAt, stopDistIn, jumpTo } from './journey.js';
import { passengers } from './passengers.js';
import { carLabel } from './carstyle.js';
import { driveAudio, syncAudio } from './audio.js';

/* ---------- デバッグ用の操作（早送り・ジャンプ）と状態の表示 ----------
   操作の行の「デバッグ」ボタンで出し入れする。URL のクエリに debug があれば最初から出す（例: /?debug#line-1234）。
   出し入れに合わせて URL の ?debug も書き換える（再読み込みしても同じ状態）。隠すときは速度・時間帯・天気の固定を自動に戻す。
   「いまの地点」は窓の中央に見えている地点 state.dist + W/2（駅の pos + W/2、layers.js の env() と同じ基準） */
const STEP = 50, FAR = 400000, FULL = 0.8, STOP_IN = 15;
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
/* 次の駅の手前: 向かっている駅へ減速している途中の、止まるまで残り STOP_IN 秒の地点（state.dist の値）。
   すでに過ぎている（停車中を含む）なら、その次の駅 */
export function beforeStation() {
  const at = st => Math.max(0, st.pos - stopDistIn(STOP_IN));
  let st = state.station;
  if (state.phase === 'stop' || state.dist >= at(st) - 1) st = stationAt(st.k + 1);
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

/* 次の高架・踏切などの手前: 始点 a が窓の中央に来る BEFORE ドット手前（state.dist の値）。すでにその地点を過ぎたものは飛ばす。無ければ null */
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
function xingInfo(c) {
  const x = crossingNear(c);
  if (x) return `踏切${x.n} の上`;
  const n = nextCrossing(c);
  return n ? `踏切${n.n} まで ${Math.round(n.a - c)}` : '';
}
function wallInfo(c) {
  const x = wallNear(c);
  if (x) return `至近の建物${x.n} の前`;
  const n = nextWall(c);
  return n ? `至近の建物${n.n} まで ${Math.round(n.a - c)}` : '';
}
function trainInfo(c) {
  const x = trainNear(c);
  if (x) return `対向列車${x.n} の前`;
  const n = nextTrain(c);
  return n ? `対向列車${n.n} まで ${Math.round(n.a - c)}` : '';
}
/* 次の夕方・朝・天気の変わり目の手前: 移り変わりが始まる地点が窓の中央に来る BEFORE ドット手前（state.dist の値）。固定は見ない本来の時刻・天気で探す */
export const beforeTime = hour => nextTimePoint(state.dist + W / 2 + BEFORE + 1, hour) - W / 2 - BEFORE;
export function beforeWeather() { const d = nextWeatherPoint(state.dist + W / 2 + BEFORE + 1); return d === null ? null : d - W / 2 - BEFORE; }
const clock = h => { const m = Math.floor(h * 60 + 1e-6); return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
/* トーンの key（段階.曇り.雨雪の種類と強さ、tone.js）を読める形に。段階は 0 昼 → 1〜19 夕 → 20 夜 → 21〜39 朝 */
function toneName(k) {
  const [s, c, f] = k.split('.'), st = +s;
  const tod = st === 0 ? '昼' : st < 20 ? '夕' + st : st === 20 ? '夜' : '朝' + (st - 20);
  return tod + '・曇' + c + (/^[rs]/.test(f) ? '・' + (f[0] === 's' ? '雪' : '雨') + f.slice(1) : '');
}
function toneInfo() {
  const w = state.wx, tn = state.tone, f = v => v.toFixed(2);
  return `時刻 ${clock(state.hour)}${state.todFix != null ? '（固定）' : ''} ／ 雲 ${f(w.cloud)} 雨 ${f(w.rain)} 雪 ${f(w.snow)}${state.wxFix ? '（固定）' : ''}` +
    (tn ? ` ／ 色調 ${toneName(tn.key)}` + (state.toneTo ? ` → ${toneName(state.toneTo.key)} ${Math.round(state.toneK * 100)}%` : '') : '');
}
const BNAME = { city: '都心', resi: '住宅街', suburb: '郊外', rural: '田園', mount: '山間', sea: '海沿い' };
const PNAME = { run: '巡航', brake: '減速', stop: '停車', depart: '発車' };
function info() {
  const c = state.dist + W / 2, e = world(c), st = state.station, fi = featInfo(c), xi = xingInfo(c), wi = wallInfo(c), ti = trainInfo(c);
  const ws = BIOME_KEYS.filter(k => e[k] >= 0.05).map(k => (BNAME[k] || k) + ' ' + e[k].toFixed(2)).join(' ');
  return `距離 ${Math.floor(state.dist)} ／ ${ws} ／ ${PNAME[state.phase] || state.phase} ${Math.round(state.speed * 0.36)}km/h（目標 ${Math.round(cruiseAt(state.dist, st ? st.pos : Infinity) * 0.36)}）` +
    ` ／ 高架 ${state.elev.toFixed(2)}` +
    (st ? ` ／ ${st.name} まで ${Math.max(0, Math.round(st.pos - state.dist))}` : '') + (fi ? ` ／ ${fi}` : '') + (xi ? ` ／ ${xi}` : '') + (wi ? ` ／ ${wi}` : '') + (ti ? ` ／ ${ti}` : '') + ` ／ 乗客 ${passengers.length}人 ／ 車両 ${carLabel()} ／ ${toneInfo()}`;
}

/* 初期化。毎フレーム呼ぶ関数 tick(now) を返す（表示している間だけ、0.25 秒に1回表示を更新する） */
export function initDebug(render) {
  const row = document.getElementById('debug'), rateSel = document.getElementById('dbg-rate'), out = document.getElementById('dbg-info');
  const btn = document.getElementById('btn-debug');
  if (!row) return null;
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
  for (const [id, next] of [['dbg-elev', nextElev], ['dbg-xing', nextCrossing], ['dbg-wall', nextWall], ['dbg-train', nextTrain]]) {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', () => { const d = beforeCourse(next); if (d !== null) jump(d); });
  }
  // 時間帯・天気の固定（自動 = 走行距離から決まる値。固定を替えると、次の描画でフェードせずにその色調へ替わる。停止中でも替わる）
  const fixRow = (id, attr, set) => {
    const bs = [...document.querySelectorAll('#' + id + ' button[data-' + attr + ']')];
    const choose = b => { set(b.dataset[attr]); for (const o of bs) o.setAttribute('aria-pressed', String(o === b)); };
    for (const b of bs) b.addEventListener('click', () => { choose(b); if (!state.playing) render(); show(); });
    return () => { const a = bs.find(b => b.dataset[attr] === 'auto'); if (a) choose(a); }; // 自動に戻す
  };
  const resetTod = fixRow('dbg-tod', 'tod', v => { state.todFix = v === 'auto' ? null : TOD[v]; });
  const resetWx = fixRow('dbg-wx', 'wx', v => { state.wxFix = v === 'auto' ? null : v; });
  for (const [id, at] of [['dbg-dusk', () => beforeTime(DUSK[0])], ['dbg-dawn', () => beforeTime(DAWN[0])], ['dbg-wxnext', beforeWeather]]) {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', () => { const d = at(); if (d !== null) jump(d); });
  }
  // 出し入れ。隠すときは早送り・停止と時間帯・天気の固定を戻す（見えない設定が残らないように）
  const setShown = on => {
    row.hidden = !on;
    if (btn) btn.setAttribute('aria-pressed', String(on));
    if (!on) {
      if (state.rate !== 1) setRate(1);
      const fixed = state.todFix != null || state.wxFix != null;
      resetTod(); resetWx();
      if (fixed && !state.playing) render();
    } else show();
    try { // ?debug を付け外しする（ほかのクエリと #line-xxxx はそのまま）
      const q = location.search.slice(1).split('&').filter(p => p && p.split('=')[0] !== 'debug');
      if (on) q.push('debug');
      history.replaceState(history.state, '', location.pathname + (q.length ? '?' + q.join('&') : '') + location.hash);
    } catch (e) {}
  };
  if (btn) btn.addEventListener('click', () => setShown(row.hidden));
  const on0 = new URLSearchParams(location.search).has('debug');
  row.hidden = !on0;
  if (btn) btn.setAttribute('aria-pressed', String(on0));
  let last = -1e9;
  if (on0) show();
  return now => { if (!row.hidden && now - last >= 250) { last = now; show(); } };
}
