import { W, state } from './state.js';
import { featureMix } from './features.js';
import { crossingAt } from './crossings.js';

/* ---------- audio (Web Audio 合成) ---------- */
/* 音量の定数はここにまとめる（耳で確かめていないので、どれも控えめ。調整はこの表だけ触ればよい） */
export const VOL = {
  rumble: 0.55,     // 走行音（ブラウンノイズ）: 巡航時
  wind: 0.02,       // 風切り音: 巡航時
  motor: 0.012,     // モーター音: 巡航時
  motorAccel: 0.016,// 発車の加速中に足す分
  click: 1.0,       // 継ぎ目の音（全体の倍率）
  brake: 0.02,      // 減速終盤の摩擦音
  air: 0.05,        // 止まる瞬間の空気音
  doorAir: 0.035,   // ドア開閉の空気音
  thunk: 0.12,      // 戸当たりの音
  chime: 0.035,     // ドアチャイム「ピンポン」
  melody: 0.03,     // 発車の合図
  hum: 0.004,       // 空調のうなり（常時。止まると目立つ程度）
  tunnel: 0.5,      // トンネル: 低域の共鳴（こもった響き）。巡航時・トンネルの中
  tunnelEcho: 0.5,  // トンネル: 継ぎ目の音を反響バスへ送る量
  bridge: 0.8,      // 鉄橋: 金属的な鳴り「ゴーッ」。巡航時・橋の上
  bridgeRing: 0.35, // 鉄橋: 継ぎ目の音に足す金属の響き
  rain: 0.022,      // 雨: 窓・車体をたたく細かい雨の「サーッ」（強い雨・巡航時）
  rainRoof: 0.05,   // 雨: 屋根を打つ粒の「パラパラ」（強い雨・停車時）
  crossing: 0.09   // 踏切の警報音「カンカン」（踏切の真横で）
};
/* トンネルの中での変わり方（どれも featureMix().tunnel に比例して効く） */
export const TUNNEL = {
  rumbleBoost: 0.35, // 走行音を何割増しにするか
  rumbleCut: 0.2,    // 走行音のローパスを何割下げるか（こもらせる）
  windCut: 0.7,      // 風切り音を何割下げるか
  resFreq: 250,      // 低域の共鳴の中心（Hz）
  resQ: 2.5,
  echoDelay: 0.085,  // 反響の遅れ（秒）
  echoFb: 0.35,      // 反響のくり返しの強さ（1 未満。大きいほど長く残る）
  echoTone: 1200     // 反響のローパス（Hz。くり返すたびにこもる）
};
/* 鉄橋の上での変わり方（featureMix().bridge に比例して効く） */
export const BRIDGE = {
  freqs: [520, 780, 1130], // 鳴りの共鳴（Hz。白色ノイズのバンドパス）
  q: 9,
  ringFreq: 1900,    // 継ぎ目の金属の響きの中心（Hz）
  ringQ: 14,
  ringDur: 0.32      // その減衰の長さ（秒）
};
/* 雨音（どちらも state.wx.rain に連動し、トンネルの中では止む）。
   hiss: 白色ノイズを高域のバンドパスに通した連続音。走行中は風まじりで強く、明るくなる
   roof: 粒の当たる音をまばらに並べたループ（initAudio で作る）。停車中にはっきり聞こえ、走行音が上がると埋もれる */
export const RAIN = {
  curve: 1.2,                 // 強さ → 音量のカーブ（指数）
  hissFreq: [2600, 4200],     // hiss のバンドパスの中心（停車時 / 巡航時。Hz）
  hissQ: 0.5,
  hissStop: 0.4,              // 停車時の hiss（巡航時を 1 として）
  roofFreq: 1500, roofQ: 0.7, // roof のバンドパス
  roofRun: 0.35,              // 巡航時の roof（停車時を 1 として）
  drops: 150,                 // roof のループ（2 秒）に置く粒の数
  dropDur: [0.012, 0.045]     // 粒1つの減衰の長さ（秒）
};
/* 雪: 音を吸うので、走行音を少しだけ丸める（state.wx.snow に比例） */
export const SNOW = { rumbleCut: 0.12, rumbleSoft: 0.1, windCut: 0.3 };
/* 踏切の警報音（crossingAt() の符号つき距離 x = 席 − 踏切の中心 で鳴らす。式は crossingSound()）
   音源: 矩形波 + 少しずらした倍音（三角波）をローパスに通した持続音を、打つたびの短い減衰エンベロープで刻む */
export const CROSSING = {
  freq: 750,        // 基本の音程（Hz）
  partials: [[2.76, 0.35], [4.07, 0.15]], // 金属らしさの倍音 [基本に対する比, 音量比]（三角波）
  rate: 2.5,        // 打つ回数（毎秒。2.5 で毎分 150 回）
  decay: 0.2,       // 打ってから消えるまで（秒。約 −40dB）
  tone: 3200,       // 全体のローパス（Hz。車内で聞くので少し丸める）
  r0: 250,          // 音量が半分になる距離（ドット。1ドット≒10cm で約 25m）
  range: 1500,      // これより遠くでは 0（crossings.js の XING_HEAR と同じ値にする）
  side: 60,         // 踏切の鳴る所と席の横のずれ（ドット。ドップラーの角度に使う）
  c: 3400,          // 音速（ドット/秒）
  ahead: 0.3        // 打撃を何秒先まで予約するか（driveAudio の間隔 0.1 秒より長く）
};
/* 踏切の音の係数（純粋な関数）。x: 席 − 踏切の中心（ドット）、v: 速度（ドット/秒）
   gain: 1/(1+(x/r0)²) を範囲の端で 0 になるよう引き下げて正規化（真横で 1）
   freq: ドップラー f·(1 + v·(−x)/√(x²+y²)/c)。近づくとき高く、通過で連続に下がる */
export function crossingSound(x, v) {
  const { r0, range: R, side: y, c, freq } = CROSSING;
  const k = q => 1 / (1 + (q / r0) * (q / r0)), e = k(R);
  const gain = Math.abs(x) >= R ? 0 : Math.max(0, (k(x) - e) / (1 - e));
  return { gain, freq: freq * (1 + v * (-x) / Math.hypot(x, y) / c) };
}
const V_CRUISE = 240;

export let ac = null, master = null, white = null, rumbleF = null, motor = null, soundOn = false, volume = 0.6;
let xingG = null, xingEnv = null, xingOsc = [], xingNext = 0;
let rainG = null, rainF = null, roofG = null, rumbleG = null, windG = null, motorG = null, motorF = null, brakeG = null, brakeF = null, tunG = null, bridgeG = null, echoIn = null;
export function setSoundOn(v) { soundOn = v; }
export function setVolume(v) { volume = v; }
const loopNoise = buf => { const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; return s; };
export function initAudio() {
  ac = new (window.AudioContext || window.webkitAudioContext)();
  master = ac.createGain(); master.gain.value = volume; master.connect(ac.destination);
  const n = ac.sampleRate * 2;
  const brown = ac.createBuffer(1, n, ac.sampleRate), bd = brown.getChannelData(0);
  white = ac.createBuffer(1, n, ac.sampleRate); const wd = white.getChannelData(0);
  let lastV = 0;
  for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; wd[i] = w; lastV = (lastV + 0.02 * w) / 1.02; bd[i] = lastV * 3.5; }
  const bs = loopNoise(brown);
  rumbleF = ac.createBiquadFilter(); rumbleF.type = 'lowpass'; rumbleF.frequency.value = 420;
  rumbleG = ac.createGain(); rumbleG.gain.value = 0;
  bs.connect(rumbleF); rumbleF.connect(rumbleG); rumbleG.connect(master); bs.start();
  const ws = loopNoise(white);
  const hf = ac.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 1800; hf.Q.value = 0.6;
  windG = ac.createGain(); windG.gain.value = 0;
  ws.connect(hf); hf.connect(windG); windG.connect(master); ws.start();
  motor = ac.createOscillator(); motor.type = 'sawtooth'; motor.frequency.value = 92;
  motorF = ac.createBiquadFilter(); motorF.type = 'lowpass'; motorF.frequency.value = 260;
  motorG = ac.createGain(); motorG.gain.value = 0;
  motor.connect(motorF); motorF.connect(motorG); motorG.connect(master); motor.start();
  // 減速終盤の摩擦音（細いバンドパスのノイズ。音量は driveAudio で動かす）
  const fs = loopNoise(white);
  brakeF = ac.createBiquadFilter(); brakeF.type = 'bandpass'; brakeF.frequency.value = 2600; brakeF.Q.value = 7;
  brakeG = ac.createGain(); brakeG.gain.value = 0;
  fs.connect(brakeF); brakeF.connect(brakeG); brakeG.connect(master); fs.start();
  // 空調のうなり（低い正弦波 + こもったノイズ。常時）
  const hum = ac.createOscillator(); hum.type = 'sine'; hum.frequency.value = 118;
  const hs = loopNoise(brown), hl = ac.createBiquadFilter(); hl.type = 'lowpass'; hl.frequency.value = 300;
  const hg = ac.createGain(), hng = ac.createGain(); hg.gain.value = VOL.hum; hng.gain.value = VOL.hum * 6;
  hum.connect(hg); hg.connect(master); hs.connect(hl); hl.connect(hng); hng.connect(master); hum.start(); hs.start();
  // トンネル: 走行音と同じブラウンノイズを低域のバンドパスに通した共鳴（音量は driveAudio で動かす）
  const ts = loopNoise(brown), tf = ac.createBiquadFilter(); tf.type = 'bandpass'; tf.frequency.value = TUNNEL.resFreq; tf.Q.value = TUNNEL.resQ;
  tunG = ac.createGain(); tunG.gain.value = 0;
  ts.connect(tf); tf.connect(tunG); tunG.connect(master); ts.start();
  // トンネル: 継ぎ目の音の反響バス（echoIn → 遅延 → ローパス → master、ローパス → フィードバック → 遅延）。click() がトンネルの中でだけ送る
  echoIn = ac.createGain(); echoIn.gain.value = 1;
  const ed = ac.createDelay(0.5); ed.delayTime.value = TUNNEL.echoDelay;
  const el = ac.createBiquadFilter(); el.type = 'lowpass'; el.frequency.value = TUNNEL.echoTone;
  const ef = ac.createGain(); ef.gain.value = Math.min(0.9, TUNNEL.echoFb);
  echoIn.connect(ed); ed.connect(el); el.connect(master); el.connect(ef); ef.connect(ed);
  // 鉄橋: 白色ノイズを共鳴の強いバンドパス数本に通した鳴り（音量は driveAudio で動かす）
  const gs = loopNoise(white);
  bridgeG = ac.createGain(); bridgeG.gain.value = 0;
  for (const f of BRIDGE.freqs) { const b = ac.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = BRIDGE.q; gs.connect(b); b.connect(bridgeG); }
  bridgeG.connect(master); gs.start();
  // 雨: 連続音（hiss）と、屋根を打つ粒のループ（roof）。音量は driveAudio で動かす
  const rs = loopNoise(white);
  rainF = ac.createBiquadFilter(); rainF.type = 'bandpass'; rainF.frequency.value = RAIN.hissFreq[0]; rainF.Q.value = RAIN.hissQ;
  rainG = ac.createGain(); rainG.gain.value = 0;
  rs.connect(rainF); rainF.connect(rainG); rainG.connect(master); rs.start();
  const patter = ac.createBuffer(1, n, ac.sampleRate), pd = patter.getChannelData(0);
  for (let k = 0; k < RAIN.drops; k++) { // 粒: 減衰する短いノイズ。大きさ・長さはまちまち
    const at = Math.floor(Math.random() * n), dur = RAIN.dropDur[0] + Math.random() * (RAIN.dropDur[1] - RAIN.dropDur[0]), len = Math.floor(dur * ac.sampleRate), amp = 0.25 + 0.75 * Math.random() * Math.random();
    for (let j = 0; j < len; j++) pd[(at + j) % n] += (Math.random() * 2 - 1) * amp * Math.exp(-5 * j / len);
  }
  const ps = loopNoise(patter), pf = ac.createBiquadFilter(); pf.type = 'bandpass'; pf.frequency.value = RAIN.roofFreq; pf.Q.value = RAIN.roofQ;
  roofG = ac.createGain(); roofG.gain.value = 0;
  ps.connect(pf); pf.connect(roofG); roofG.connect(master); ps.start();
  // 踏切の鐘: 持続する発振器 → 打撃のエンベロープ（xingEnv）→ ローパス → 音量（xingG。driveAudio で距離に合わせる）
  xingEnv = ac.createGain(); xingEnv.gain.value = 0;
  const xf = ac.createBiquadFilter(); xf.type = 'lowpass'; xf.frequency.value = CROSSING.tone; xf.Q.value = 0.7;
  xingG = ac.createGain(); xingG.gain.value = 0;
  xingEnv.connect(xf); xf.connect(xingG); xingG.connect(master);
  xingOsc = [[1, 1, 'square'], ...CROSSING.partials.map(([m, a]) => [m, a, 'triangle'])].map(([m, a, type]) => {
    const o = ac.createOscillator(); o.type = type; o.frequency.value = CROSSING.freq * m;
    const g = ac.createGain(); g.gain.value = a * (type === 'square' ? 0.5 : 1);
    o.connect(g); g.connect(xingEnv); o.start(); return { o, m };
  });
  driveAudio(true);
}
const running = () => soundOn && ac && ac.state === 'running' && state.rate === 1; // 早送り中は鳴らさない

/* 速度・加速度・進行に合わせて常時音を動かす（main.js から 0.1 秒ごと）。ac が無ければ何もしない */
export function driveAudio(now = false) {
  if (!ac || !rumbleG) return;
  try {
    const v = Math.max(0, state.speed), vn = Math.min(1.1, v / V_CRUISE), T = ac.currentTime, tc = now ? 0.01 : 0.15;
    const acc = state.phase === 'depart' ? Math.min(1, Math.max(0, state.accel / 8)) : 0;
    const { tunnel: tu, bridge: br } = featureMix(state.dist + W / 2); // 席の位置がトンネル・橋の中か（0..1）
    const wx = state.wx || {}, rn = Math.pow(Math.max(0, wx.rain || 0), RAIN.curve) * (1 - tu), sn = Math.max(0, wx.snow || 0) * (1 - tu), v1 = Math.min(1, vn);
    rumbleG.gain.setTargetAtTime(VOL.rumble * Math.pow(vn, 1.3) * (1 + TUNNEL.rumbleBoost * tu) * (1 - SNOW.rumbleSoft * sn), T, tc);
    rumbleF.frequency.setTargetAtTime((180 + v) * (1 - TUNNEL.rumbleCut * tu) * (1 - SNOW.rumbleCut * sn), T, tc);
    windG.gain.setTargetAtTime(VOL.wind * vn * vn * (1 - TUNNEL.windCut * tu) * (1 - SNOW.windCut * sn), T, tc);
    // 雨音: 走行中は風まじりの連続音が強く明るく、停車中は屋根を打つ粒がはっきり。トンネルの中では止む
    if (rainG) {
      rainG.gain.setTargetAtTime(VOL.rain * rn * (RAIN.hissStop + (1 - RAIN.hissStop) * v1), T, tc);
      rainF.frequency.setTargetAtTime(RAIN.hissFreq[0] + (RAIN.hissFreq[1] - RAIN.hissFreq[0]) * v1, T, tc);
      roofG.gain.setTargetAtTime(VOL.rainRoof * rn * (1 - (1 - RAIN.roofRun) * v1), T, tc);
    }
    // 速度に比例させるので、停車中はどちらも 0
    tunG.gain.setTargetAtTime(VOL.tunnel * Math.pow(vn, 1.3) * tu, T, tc);
    bridgeG.gain.setTargetAtTime(VOL.bridge * Math.pow(vn, 1.3) * br, T, tc);
    motor.frequency.setTargetAtTime(Math.max(20, 18 + v * (0.385 + 0.06 * acc)), T, tc);
    motorF.frequency.setTargetAtTime(260 + 260 * acc, T, tc);
    motorG.gain.setTargetAtTime(VOL.motor * Math.min(1, vn * 2.5) + VOL.motorAccel * acc * Math.min(1, v / 20 + 0.3), T, tc);
    // 摩擦音: 減速中、速度 60 を切ってから強まり、止まる直前で消える
    const x = state.phase === 'brake' && v > 1.5 ? Math.max(0, 1 - v / 60) : 0;
    brakeG.gain.setTargetAtTime(VOL.brake * x * x * Math.min(1, v / 6), T, tc);
    brakeF.frequency.setTargetAtTime(2300 + 900 * x, T, tc);
    driveCrossing(v, tu, T, tc);
  } catch (e) { console.warn('driveAudio', e); }
}

/* 踏切の警報音: 距離で音量、ドップラーで音程を動かし、打撃を ahead 秒先まで等間隔に予約する。
   早送り中・音が止まっている間・トンネルの中・範囲の外では鳴らさない（打撃の位相もそこで切る） */
function driveCrossing(v, tu, T, tc) {
  if (!xingG) return;
  const xc = running() && tu < 1 ? crossingAt(state.dist + W / 2) : null;
  const { gain: g0, freq } = xc ? crossingSound(xc.x, v) : { gain: 0, freq: CROSSING.freq };
  const gain = g0 * Math.max(0, 1 - state.elev * 4); // 高架・勾配の上では鳴らさない（踏切は地上にしか無い）
  xingG.gain.setTargetAtTime(VOL.crossing * gain * (1 - tu), T, tc);
  if (gain <= 0) { xingNext = 0; return; }
  for (const { o, m } of xingOsc) o.frequency.setTargetAtTime(freq * m, T, tc);
  const P = 1 / CROSSING.rate, tau = CROSSING.decay / 4.6; // 4.6τ で約 −40dB
  if (xingNext < T + 0.01) xingNext = T + 0.02; // 鳴り始め・中断の後は今から刻み直す
  for (; xingNext < T + CROSSING.ahead; xingNext += P) {
    const t = xingNext, e = xingEnv.gain;
    e.setValueAtTime(0, t); e.linearRampToValueAtTime(1, t + 0.003); e.setTargetAtTime(0, t + 0.003, tau);
  }
}

/* 継ぎ目の音。mix は featureMix() の { tunnel, bridge }（省略可）: トンネルでは反響、橋では金属の響きを足す */
export function click(when, strength, mix = null) {
  strength *= VOL.click;
  const tu = mix ? mix.tunnel : 0, br = mix ? mix.bridge : 0;
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
  if (tu > 0 && echoIn) { // 反響バスへ（単発の音が終われば send も切れて回収される）
    const send = ac.createGain(); send.gain.value = VOL.tunnelEcho * tu;
    g.connect(send); og.connect(send); send.connect(echoIn);
  }
  if (br > 0) { // 金属の響き: 高めの細いバンドパスで、減衰を長く
    const rs = ac.createBufferSource(); rs.buffer = white;
    const rf = ac.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = BRIDGE.ringFreq * (0.94 + Math.random() * 0.12); rf.Q.value = BRIDGE.ringQ;
    const rg = ac.createGain();
    rg.gain.setValueAtTime(Math.max(0.0011, VOL.bridgeRing * strength * br), when); rg.gain.exponentialRampToValueAtTime(0.001, when + BRIDGE.ringDur);
    rs.connect(rf); rf.connect(rg); rg.connect(master);
    rs.start(when, Math.random() * 1.5, BRIDGE.ringDur + 0.02);
  }
}

/* ---------- 単発の効果音 ---------- */
function noiseBurst(when, dur, type, freq, q, peak, attack) {
  const src = ac.createBufferSource(); src.buffer = white;
  const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, when); g.gain.linearRampToValueAtTime(peak, when + attack); g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(when, Math.random() * 0.5, dur + 0.05);
  return f;
}
function tone(when, freq, dur, peak, type = 'sine') {
  const o = ac.createOscillator(); o.type = type; o.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, when); g.gain.linearRampToValueAtTime(peak, when + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  o.connect(g); g.connect(master); o.start(when); o.stop(when + dur + 0.02);
}
const SFX = {
  // 止まる瞬間の小さな空気音（プシュッ）
  air(T) { const f = noiseBurst(T, 0.7, 'lowpass', 2400, 0.7, VOL.air, 0.02); f.frequency.exponentialRampToValueAtTime(700, T + 0.7); },
  // ドア開閉の空気音（シューッ）
  doorOpen(T) { noiseBurst(T + 0.05, 1.3, 'bandpass', 3200, 0.9, VOL.doorAir, 0.08); },
  doorClose(T) { noiseBurst(T + 0.05, 1.5, 'bandpass', 2800, 0.9, VOL.doorAir, 0.1); },
  // 戸当たり（低い「トン」）
  thunk(T, s = 1) {
    const o = ac.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(140, T); o.frequency.exponentialRampToValueAtTime(60, T + 0.12);
    const g = ac.createGain(); g.gain.setValueAtTime(VOL.thunk * s, T); g.gain.exponentialRampToValueAtTime(0.0001, T + 0.18);
    o.connect(g); g.connect(master); o.start(T); o.stop(T + 0.2);
    noiseBurst(T, 0.06, 'lowpass', 900, 0.7, VOL.thunk * 0.4 * s, 0.003);
  },
  // ドアチャイム「ピンポン」
  chime(T) { tone(T, 1318.5, 0.9, VOL.chime); tone(T + 0.38, 1046.5, 1.2, VOL.chime); },
  // 発車の合図（短いメロディ）
  melody(T) {
    const N = [[659.3, 0], [784.0, 0.22], [1046.5, 0.44], [987.8, 0.66], [784.0, 0.88], [880.0, 1.1], [1046.5, 1.32]];
    for (const [f, dt] of N) tone(T + dt, f, dt === 1.32 ? 0.8 : 0.32, VOL.melody, 'triangle');
  }
};
/* 効果音を鳴らす。音が止まっている／ac が無い／suspend 中は何もしない（例外も出さない） */
export function sfx(name, arg) {
  if (!running() || !SFX[name]) return;
  try { SFX[name](ac.currentTime + 0.02, arg); } catch (e) { console.warn('sfx ' + name, e); }
}

export function syncAudio() {
  if (!ac) return;
  if (soundOn && state.playing && !document.hidden && state.rate === 1) ac.resume().catch(() => {}); else ac.suspend().catch(() => {});
}
