import { state } from './state.js';

/* ---------- audio (Web Audio 合成) ---------- */
export let ac = null, master = null, white = null, rumbleF = null, motor = null, soundOn = false, volume = 0.6;
export function setSoundOn(v) { soundOn = v; }
export function setVolume(v) { volume = v; }
export function initAudio() {
  ac = new (window.AudioContext || window.webkitAudioContext)();
  master = ac.createGain(); master.gain.value = volume; master.connect(ac.destination);
  const n = ac.sampleRate * 2;
  const brown = ac.createBuffer(1, n, ac.sampleRate), bd = brown.getChannelData(0);
  white = ac.createBuffer(1, n, ac.sampleRate); const wd = white.getChannelData(0);
  let lastV = 0;
  for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; wd[i] = w; lastV = (lastV + 0.02 * w) / 1.02; bd[i] = lastV * 3.5; }
  const bs = ac.createBufferSource(); bs.buffer = brown; bs.loop = true;
  rumbleF = ac.createBiquadFilter(); rumbleF.type = 'lowpass'; rumbleF.frequency.value = 420;
  const rg = ac.createGain(); rg.gain.value = 0.55;
  bs.connect(rumbleF); rumbleF.connect(rg); rg.connect(master); bs.start();
  const ws = ac.createBufferSource(); ws.buffer = white; ws.loop = true;
  const hf = ac.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 1800; hf.Q.value = 0.6;
  const hg = ac.createGain(); hg.gain.value = 0.02;
  ws.connect(hf); hf.connect(hg); hg.connect(master); ws.start();
  motor = ac.createOscillator(); motor.type = 'sawtooth'; motor.frequency.value = 92;
  const mf = ac.createBiquadFilter(); mf.type = 'lowpass'; mf.frequency.value = 260;
  const mg = ac.createGain(); mg.gain.value = 0.012;
  motor.connect(mf); mf.connect(mg); mg.connect(master); motor.start();
}
export function click(when, strength) {
  const src = ac.createBufferSource(); src.buffer = white;
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 850 + Math.random() * 200; bp.Q.value = 1.1;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.5 * strength, when); g.gain.exponentialRampToValueAtTime(0.001, when + 0.07);
  src.connect(bp); bp.connect(g); g.connect(master);
  src.start(when, Math.random() * 1.5, 0.09);
  const o = ac.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(115, when); o.frequency.exponentialRampToValueAtTime(52, when + 0.09);
  const og = ac.createGain();
  og.gain.setValueAtTime(0.55 * strength, when); og.gain.exponentialRampToValueAtTime(0.001, when + 0.13);
  o.connect(og); og.connect(master); o.start(when); o.stop(when + 0.15);
}
export function syncAudio() {
  if (!ac) return;
  if (soundOn && state.playing && !document.hidden) ac.resume().catch(() => {}); else ac.suspend().catch(() => {});
}
