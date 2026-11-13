import { state } from './state.js';
import { STYLES, setStyle } from './palette.js';
import { layers } from './scenery/index.js';
import { genPassengers } from './passengers.js';
import { jumpTo } from './journey.js';
import { ac, master, soundOn, volume, setSoundOn, setVolume, initAudio, syncAudio } from './audio.js';

const lineLabel = document.getElementById('line-label');

export function setSeed(n) {
  state.seed = n >>> 0;
  jumpTo(0); // 進行を出発地点（最初の駅へ向かって巡航中）に置き直す。state.dist = 0、継ぎ目の予約の破棄もここで
  layers.forEach(l => l.cache.clear());
  genPassengers();
  lineLabel.textContent = '路線 ' + String(state.seed).padStart(4, '0');
}
export function seedFromHash() { const m = /^#line-(\d{1,6})$/.exec(location.hash); return m ? parseInt(m[1], 10) : null; }
function newLine() {
  const n = 1000 + Math.floor(Math.random() * 9000);
  setSeed(n);
  try { location.hash = 'line-' + n; } catch (e) {}
}

/* ---------- controls ---------- */
const stage = document.getElementById('stage');
const btnSound = document.getElementById('btn-sound'), btnPause = document.getElementById('btn-pause');
const btnLine = document.getElementById('btn-line'), btnFull = document.getElementById('btn-full'), vol = document.getElementById('vol');
const styleSel = document.getElementById('style'), passSel = document.getElementById('pass');
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
export function setPlaying(p) {
  state.playing = p; state.last = performance.now();
  btnPause.setAttribute('aria-pressed', String(!p));
  btnPause.textContent = p ? '一時停止' : '再開する';
  syncAudio();
}
/* render / rebuild は main.js から受け取る（ui.js が main.js を import しないようにするため） */
export function initUI(render, rebuild) {
  { const v = store.get('shasou-vol'); if (v !== null && !isNaN(+v)) { setVolume(Math.min(1, Math.max(0, +v))); vol.value = Math.round(volume * 100); } }
  btnSound.addEventListener('click', () => {
    setSoundOn(!soundOn);
    if (soundOn && !ac) { try { initAudio(); } catch (e) { setSoundOn(false); btnSound.textContent = '音は使えません'; btnSound.disabled = true; return; } }
    btnSound.setAttribute('aria-pressed', String(soundOn));
    btnSound.textContent = soundOn ? '音を止める' : '音を出す';
    syncAudio();
  });
  vol.addEventListener('input', () => {
    setVolume(vol.value / 100);
    if (master) master.gain.setTargetAtTime(volume, ac.currentTime, 0.03);
    store.set('shasou-vol', String(volume));
  });
  btnPause.addEventListener('click', () => setPlaying(!state.playing));
  btnLine.addEventListener('click', () => { newLine(); if (!state.playing) render(); });
  if (!document.fullscreenEnabled || !stage.requestFullscreen) btnFull.hidden = true;
  btnFull.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else stage.requestFullscreen().catch(() => { btnFull.hidden = true; });
  });
  styleSel.addEventListener('change', () => {
    setStyle(styleSel.value); rebuild();
    store.set('shasou-style', styleSel.value);
    if (!state.playing) render();
  });
  passSel.addEventListener('change', () => {
    state.passMode = passSel.value;
    store.set('shasou-pass', passSel.value);
    if (!state.playing) render();
  });
  document.addEventListener('visibilitychange', () => { state.last = performance.now(); syncAudio(); });
  window.addEventListener('hashchange', () => { const n = seedFromHash(); if (n !== null && n !== state.seed) { setSeed(n); if (!state.playing) render(); } });

  /* 保存された設定の復元 */
  { const s0 = store.get('shasou-style'); if (s0 && STYLES[s0]) { setStyle(s0); styleSel.value = s0; } }
  { // 乗客の表示。古い保存値 '1' / '0' は 'on' / 'off' として読む
    const p0 = store.get('shasou-pass'), m = p0 === '1' ? 'on' : p0 === '0' ? 'off' : p0;
    if (m === 'on' || m === 'sil' || m === 'off') { state.passMode = m; passSel.value = m; }
  }
}
