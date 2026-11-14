import { W, state } from './state.js';
import { timeAt, weatherAt, phaseOf, DAWN, DUSK } from './clock.js';
import { rgb, STYLE, AIR } from './palette.js';
import { tones, viewOff } from './layers.js';
import { layers } from './scenery/index.js';
import { sky, skyB, buildSky } from './scenery/sky.js';

/* ---------- トーン（時間帯・天気による景色の色調）と、その切り替え ----------
   トーンは時刻と天気を段階に丸めたもの。景色のチャンクと空はトーンごとに描き分けるので、段階が替わるたびに作り直す。
   時刻の段階 step: 0 昼 → 1〜TOD_STEPS−1 夕方の移り変わり → TOD_STEPS 夜 → TOD_STEPS+1〜2×TOD_STEPS−1 朝の移り変わり → 0 昼
   天気の段階: 曇り具合 0〜CLOUD_STEPS、雨・雪の強さ 0〜FALL_STEPS
   トーン: { key, id（昼・晴 = 色を変えない）, step, hour, day, dusk, dawn, night, cloud, rain, snow, look, lit, sun, fn }
     hour 以下は段階を代表する値（clock.js の phaseOf と同じ意味の 0..1）。look は段階の見た目（下の「見た目のキー」）、
     lit は灯りの段階、sun は外の光の強さ。fn(c, depth) は palette.js の P() が使う色の変換 */
export const TOD_STEPS = 20, CLOUD_STEPS = 4, FALL_STEPS = 2;
const FADE = 1.8;       // クロスフェードの秒数（STYLES の fade が真の絵柄だけ。ほかは準備ができたら瞬時に切り替える）。早送り中（state.rate > 1）は準備もせず、その場で作り直す
const JUMP = 600;       // 1回の描画でこれより大きく進んだら（または戻ったら）瞬間移動とみなして、フェードせずに作り直す
const PER_FRAME = 1;    // 準備中、1フレームに作るチャンクの数
const PREP_MAX = 120;   // 準備がこのフレーム数を超えたら（作るより速く景色が流れている）、待たずに作り直す

/* ---------- 見た目のキー（時間帯ごとの色）----------
   夕方（昼 → 夜）と朝（夜 → 昼）それぞれに、移り変わりの中の位置 0..1 と、その時点の色を並べる。段階ごとの見た目は隣のキーを直線でつなぐ。
   朝と夕が同じ絵の逆再生にならないよう、別々の色を持つ: 夕方は 金色 → 茜 → 紫の残照 → 青い薄明、朝は 冷たい青緑 → もや越しの桃色 → 淡い金色。
     sky   空の帯 8 色（上 → 地平線。帯の高さは sky.js の BAND_H）
     mul   景色の色に掛ける光の色 / sat 彩度の倍率
     fog   遠い層をなじませる空気の色 / fa その強さ（遠景での割合。中景・近景は FOG_BY_DEPTH を掛ける）
     rk    青い色（水面・ガラス・かすみ）が空の色 sky[5] を映す強さ
     cl    雲の 本体 / 下の縁
     lit   灯りの段階 0..1（lights.js。窓ごとのしきい値を超えると灯る）/ star 星と月の出具合
     glow  地平線の光のにじみの色 / gk その強さ
     sun   外の光の強さ（1 昼 〜 0 夜。トンネルの坑口に差す外光、窓の映り込みに使う） */
const cols = s => s.split(' ').map(h => rgb('#' + h));
const key = (at, sky, mul, sat, fog, fa, rk, cl, lit, star, glow, gk, sun) => ({ at, sky: cols(sky), mul, sat, fog: rgb('#' + fog), fa, rk, cl: cols(cl), lit, star, glow: rgb('#' + glow), gk, sun });
const DAY = key(0, '4f93cf 62a3d8 7bb4e0 98c6e8 b7d8ef c5e0f2 d3e8f4 d3e8f4', [1, 1, 1], 1, 'd3e8f4', 0, 0, 'f4f8fb d2e0ec', 0, 0, 'ffffff', 0, 1);
const NIGHT = key(1, '070b1e 0a1028 0d1632 111c3c 152444 1a2b4c 203352 23375a', [0.24, 0.3, 0.5], 0.62, '1a2644', 0.5, 0.6, '1d2847 131a33', 1, 1, '2a3a5a', 0, 0);
const DUSK_KEYS = [DAY,
  key(0.2, '4d8ec8 669fd0 86b2d6 a8c5da cbd7d6 e6dfc2 f3e1b0 f5dfa8', [1.03, 0.97, 0.87], 1.02, 'f3e2b4', 0.1, 0.25, 'fbf3e2 d6d6da', 0, 0, 'fff3cc', 0.3, 0.95),
  key(0.38, '4779b2 688bbb 8d9ec0 b4b0b6 dcc09c f3cb82 fbcf6c fcc85e', [1.06, 0.88, 0.64], 1.06, 'f6c878', 0.24, 0.55, 'fde2b4 d4ac9c', 0.1, 0, 'fff2b4', 0.75, 0.8),
  key(0.5, '324d8c 57589a 87659c ba7390 e28874 f6a058 fbb948 fcc046', [0.8, 0.55, 0.5], 0.95, 'ea8c5e', 0.36, 0.75, 'd48c88 ffc47a', 0.38, 0, 'ffe38c', 0.85, 0.55),
  key(0.62, '1d2c62 303676 513f7c 7c4c7c aa5c6e d07658 e6964c e89e4a', [0.5, 0.41, 0.55], 0.85, '8c5a76', 0.4, 0.75, '77577e e27e68', 0.7, 0.05, 'f8b060', 0.5, 0.3),
  key(0.78, '101a44 162352 1d2d62 293a72 414678 664d74 885664 8f5c5c', [0.3, 0.34, 0.55], 0.74, '3a3e6e', 0.46, 0.7, '2b3260 4c4470', 0.94, 0.5, 'b46a70', 0.25, 0.12),
  NIGHT];
const DAWN_KEYS = [{ ...NIGHT, at: 0 },
  key(0.2, '0a1229 0f1b39 15284b 1f385d 2e5070 446f80 5c8a8c 68968f', [0.27, 0.34, 0.47], 0.6, '36566c', 0.55, 0.65, '1d2d4a 2d4c62', 0.8, 0.5, '80b4aa', 0.3, 0.12),
  key(0.4, '263e6c 3b5284 596a9a 7e86ac aa9db4 d5b2ae f0c2a6 f6caa4', [0.6, 0.57, 0.7], 0.7, 'b9a5b5', 0.58, 0.65, '8a86a8 f2baa8', 0.3, 0, 'ffdac4', 0.7, 0.4),
  key(0.6, '4676ae 648ebe 87a8ca adbed0 d1cfcd ecdbbe f8e3b2 fbe7ae', [0.93, 0.85, 0.83], 0.85, 'ecdcc8', 0.44, 0.45, 'f6e6d6 d8c0b8', 0, 0, 'fff5d2', 0.75, 0.75),
  key(0.8, '4e8bc5 649dd1 80b1db a0c5e3 c0d7e9 d6e3e7 e6ebdd eaedd9', [1, 0.97, 0.94], 0.95, 'e2e8e0', 0.22, 0.2, 'f6f5f1 d4dce4', 0, 0, 'fffbe8', 0.3, 0.95),
  { ...DAY, at: 1 }];
const FOG_BY_DEPTH = [0.1, 0.3, 0.62, 1, 0, 0.1]; // AIR の順: 手前 / 近景 / 中景 / 遠景 /（雲）/ 駅のホーム
const lerp = (a, b, t) => typeof a === 'number' ? a + (b - a) * t : a.map((v, k) => lerp(v, b[k], t));
function lookIn(keys, u) {
  let k = 1; while (k < keys.length - 1 && u > keys[k].at) k++;
  const A = keys[k - 1], B = keys[k], t = (u - A.at) / (B.at - A.at), o = {};
  for (const f in A) o[f] = lerp(A[f], B[f], t);
  return o;
}
/* 時刻の段階 step の見た目 */
const lookOf = s => s === 0 ? DAY : s === TOD_STEPS ? NIGHT : s < TOD_STEPS ? lookIn(DUSK_KEYS, s / TOD_STEPS) : lookIn(DAWN_KEYS, (s - TOD_STEPS) / TOD_STEPS);

const hx = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
const hex = c => '#' + hx(c[0]) + hx(c[1]) + hx(c[2]);
/* ---------- 天気の色 ----------
   景色の色は「昼の色 → 天気（weatherRGB）→ 時間帯（toneColor）」の順に変える。天気は昼の色のうえで決めるので、夕方・夜にもそのまま乗る。
   曇り: 影が消えてコントラストと彩度が落ちる。ただし緑は彩度を残して深くし、遠い層ほど白くかすませる（ただの灰色がけにしない）
   雨:   さらに暗く、青みの灰色へ。遠景は雨にけむる。地面（palette.js の setGround より下の矩形）は濡れて一段暗い
   雪:   明るい灰白。地面は雪の色へ（水面は残す）、木や草は白をかぶる。遠景は白くかすむ */
export const WX_LOOK = {
  desat: [0.36, 0.08, 0.1],     // 彩度を落とす割合（曇り 1 / 雨 1 / 雪 1 のとき。足し合わせる）
  greenKeep: 0.8,               // 緑はそのうちどれだけ彩度を残すか
  greenDeep: [0.16, 0.08],      // 緑を深くする（曇り / 雨）
  flat: [0.14, 0.05], pivot: [138, 178], // コントラストを寄せる割合（曇り / 雪）と、寄せる先の明るさ（ふだん / 雪）
  dim: [0.07, 0.15, -0.03],     // 暗くする割合（曇り / 雨 / 雪。負は明るく）
  wet: 0.2,                     // 雨: 濡れた地面をさらに暗くする割合
  snowGround: 0.86, snowGreen: 0.3, snowAll: 0.1, // 雪: 地面 / 木や草 / そのほか を雪の色へ寄せる割合
  haze: [0, 0.06, 0.3, 0.72, 0, 0],               // かすみ: 奥行き（AIR の順）ごとの効き
  hazeBy: [0.3, 0.5, 0.6],                        // かすみの濃さ（曇り / 雨 / 雪）
  hazeC: [[200, 207, 212], [166, 176, 185], [229, 233, 237]], // かすみの色（曇り / 雨 / 雪。昼の色で）
  snowC: [240, 244, 248], snowWater: [138, 152, 168],
  lit: [0.06, 0.2, 0.16],       // 灯りの段階の持ち上げ（曇り / 雨 / 雪。暗い昼は灯りが少し早く灯る）
  sun: [0.12, 0.2, 0.04]        // 外の光の弱まり
};
const lumOf = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const c01 = v => Math.min(1, Math.max(0, v));
function weatherRGB(c, tn, depth = 0, ground = false) {
  if (!tn.cloud) return c;
  const q = tn.cloud, rn = tn.rain, sn = tn.snow, X = WX_LOOK;
  let [r, g, b] = c;
  const green = c01((g - Math.max(r, b)) / 36), blue = c01((b - r - 16) / 72);
  // 彩度（緑は残す。水面は空の灰色を映すので余計に落とす）
  let l = lumOf(c);
  const des = Math.min(0.9, (X.desat[0] * q + X.desat[1] * rn + X.desat[2] * sn) * (1 - X.greenKeep * green) + 0.25 * q * blue);
  r += (l - r) * des; g += (l - g) * des; b += (l - b) * des;
  // 緑は深く（黄みを抜いて、少し暗く）
  const deep = green * (X.greenDeep[0] * q + X.greenDeep[1] * rn);
  r *= 1 - deep * 1.1; g *= 1 - deep * 0.5; b *= 1 - deep * 0.6;
  // 影が消える: 明るい面は少し沈み、暗い面は少し浮く
  const flat = X.flat[0] * q + X.flat[1] * sn, pv = X.pivot[0] + (X.pivot[1] - X.pivot[0]) * sn;
  r += (pv - r) * flat; g += (pv - g) * flat; b += (pv - b) * flat;
  // 明るさと色み（青みの灰色へ）
  const dim = 1 - X.dim[0] * q - X.dim[1] * rn - X.dim[2] * sn;
  r *= dim * (1 - 0.02 * q); g *= dim; b *= dim * (1 + 0.025 * q);
  if (ground && rn) { const k = X.wet * rn * (1 - blue); r *= 1 - k; g *= 1 - 0.92 * k; b *= 1 - 0.78 * k; } // 濡れた地面
  if (sn) { // 雪: 地面は雪の色へ（水面は残す）、木や草は白をかぶる
    const k = (ground ? sn * X.snowGround : sn * (X.snowAll + X.snowGreen * green)) * (1 - blue), S = X.snowC, W = X.snowWater, kw = 0.5 * blue * sn;
    r += (S[0] - r) * k; g += (S[1] - g) * k; b += (S[2] - b) * k;
    r += (W[0] - r) * kw; g += (W[1] - g) * kw; b += (W[2] - b) * kw; // 水面は雪をかぶらず、鉛色に沈む
  }
  const hz = X.haze[depth] * Math.min(1, X.hazeBy[0] * q + X.hazeBy[1] * rn + X.hazeBy[2] * sn) * (1 - 0.5 * blue * sn); // 遠い層ほどかすむ
  if (hz > 0) { const H = tn.look.haze; r += (H[0] - r) * hz; g += (H[1] - g) * hz; b += (H[2] - b) * hz; }
  return [r, g, b];
}
/* 曇り空の帯 8 色: その時刻の空 sky を平らにして色を抜いたもの（昼は灰色、夕方はくすんだ桃色、夜は街の灯りを映してほの明るい）。
   雨は暗く、雪は明るい灰白に */
function overcast(sky, tn) {
  const M = [0, 1, 2].map(k => sky.reduce((a, c) => a + c[k], 0) / sky.length), warm = Math.min(1, tn.dusk + tn.dawn);
  return sky.map((c, k) => {
    let v = lerp(c, M, 0.5);
    const l = lumOf(v), ds = 0.84 - 0.34 * warm - 0.3 * tn.night + 0.08 * tn.snow * (1 - warm), up = k / (sky.length - 1);
    v = [v[0] + (l - v[0]) * ds, v[1] + (l - v[1]) * ds, v[2] + (l * 1.03 - v[2]) * ds];
    const dim = 0.96 - (0.2 + 0.06 * (1 - up)) * tn.rain;
    v = v.map(x => x * dim * (1 + 0.16 * tn.snow) + 9 * tn.snow);
    const city = tn.night * (0.55 + 0.45 * tn.snow); // 夜: 雲底が街の灯りでほの明るい（地平線ほど）
    return [v[0] + city * (9 + 17 * up), v[1] + city * (6 + 11 * up), v[2] + city * (7 + 9 * up)];
  });
}
/* トーン tn の見た目（時刻の見た目に天気をかけたもの）。sky.js・lights.js・main.js は tn.look / tn.lit / tn.sun を読む。
   天気で足すキー: cl[2]（雲の底の暗い色）、haze（かすみの色。昼の色で）。曇り具合 q は 0.25 刻み:
   空の色は q = 1 で曇り空の色になる（途中は青空が残り、雲の量で曇っていく。雲を増やすのは sky.js の drawClouds） */
function makeLook(tn) {
  const K = lookOf(tn.step);
  if (!tn.cloud) return K;
  const o = { ...K }, q = tn.cloud, rn = tn.rain, sn = tn.snow, X = WX_LOOK;
  const ov = overcast(K.sky, tn), cov = q >= 1 ? 1 : 0.75 * q * q;
  o.sky = K.sky.map((c, k) => lerp(c, ov[k], cov));
  const body = ov[4].map(v => v * 1.035 + 3), edge = ov[3].map(v => v * (0.955 - 0.03 * rn)), belly = ov[2].map(v => v * (0.9 - 0.05 * rn)); // 一面の雲では、空の色に近い3色（むらが見える程度）
  o.cl = [lerp(K.cl[0], body, q), lerp(K.cl[1], edge, q), lerp(K.cl[1].map(v => v * 0.92), belly, q)];
  o.haze = lerp(lerp(X.hazeC[0], X.hazeC[1], rn), X.hazeC[2], sn);
  o.fog = lerp(K.fog, o.sky[6], 0.7 * q);
  o.mul = lerp(K.mul, [1, 1, 1], tn.night * (0.03 * q + 0.14 * sn)); // 雪の夜は、灯りが雪面を照らして明るい
  o.star = K.star * (1 - q) * (1 - q); o.gk = K.gk * (1 - 0.85 * q);
  const l = lumOf(K.glow); o.glow = K.glow.map(v => v + (l - v) * 0.5 * q);
  o.lit = K.lit + (1 - K.lit) * (X.lit[0] * q + X.lit[1] * rn + X.lit[2] * sn);
  o.sun = K.sun * (1 - X.sun[0] * q - X.sun[1] * rn - X.sun[2] * sn);
  return o;
}

/* トーンの色変換: 景色の色 c（'#rrggbb'）を、トーン tn の時間帯・天気の色へ。depth は palette.js の AIR（遠い層ほど空気の色になじむ）、
   ground は地面の矩形か（palette.js の setGround。雨・雪のときだけ真で来る）。昼・晴（tn.id）では呼ばれない。結果は palette.js が「トーンの key × depth」ごとに覚えるので、同じ引数には同じ色を返すこと */
const CL0 = 221, CL1 = 247, CL2 = 186; // 雲の色（下の縁 / 本体 / 底の暗い色。底は曇り・雨・雪の雲だけが使う）の明るさ
function toneColor(c, tn, depth, ground) {
  const K = tn.look, c0 = rgb(c);
  if (depth === AIR.cloud) { // 雲: 明るさで 下の縁 ↔ 本体 の色へ置きかえる
    const l = 0.299 * c0[0] + 0.587 * c0[1] + 0.114 * c0[2];
    if (l < CL0 && K.cl[2]) return hex(lerp(K.cl[2], K.cl[1], c01((l - CL2) / (CL0 - CL2))));
    return hex(lerp(K.cl[1], K.cl[0], Math.min(1, Math.max(0, (l - CL0) / (CL1 - CL0)))));
  }
  const w = weatherRGB(c0, tn, depth, ground); let [r, g, b] = w;
  if (tn.step === 0) return hex(w);
  const l = 0.299 * r + 0.587 * g + 0.114 * b, blue = Math.min(1, Math.max(0, (b - r - 16) / 72)); // blue: 空を映す色か（水面・ガラス・かすみ）
  r = (l + (r - l) * K.sat) * K.mul[0]; g = (l + (g - l) * K.sat) * K.mul[1]; b = (l + (b - l) * K.sat) * K.mul[2];
  const f = K.fa * FOG_BY_DEPTH[depth];
  r += (K.fog[0] - r) * f; g += (K.fog[1] - g) * f; b += (K.fog[2] - b) * f;
  if (blue > 0 && K.rk > 0) {
    const k = blue * K.rk, s = 0.5 + 0.6 * l / 255, ref = K.sky[5];
    r += (ref[0] * s - r) * k; g += (ref[1] * s - g) * k; b += (ref[2] * s - b) * k;
  }
  if (depth === AIR.lit && K.lit > 0) { // 駅のホーム: 灯りがともるにつれて、蛍光灯に照らされた色へ
    const k = Math.min(1, K.lit * 1.25) * 0.9;
    r += (w[0] * 0.8 - r) * k; g += (w[1] * 0.85 - g) * k; b += (w[2] * 0.83 - b) * k;
  }
  return hex([r, g, b]);
}

/* ---------- 段階に丸める ---------- */
export function todStep(hour) {
  if (hour >= DUSK[0] && hour < DUSK[1]) return Math.round((hour - DUSK[0]) / (DUSK[1] - DUSK[0]) * TOD_STEPS);
  if (hour >= DAWN[0] && hour < DAWN[1]) { const n = Math.round((hour - DAWN[0]) / (DAWN[1] - DAWN[0]) * TOD_STEPS); return n === TOD_STEPS ? 0 : TOD_STEPS + n; }
  return hour >= DAWN[1] && hour < DUSK[0] ? 0 : TOD_STEPS;
}
/* 段階を代表する時刻 */
export const stepHour = s => s === 0 ? 12 : s < TOD_STEPS ? DUSK[0] + s / TOD_STEPS * (DUSK[1] - DUSK[0]) : s === TOD_STEPS ? 0 : DAWN[0] + (s - TOD_STEPS) / TOD_STEPS * (DAWN[1] - DAWN[0]);
const made = new Map(); // key → トーン
/* 時刻 hour と天気 wx（{ cloud, rain, snow }）のトーン。同じ段階なら同じオブジェクトを返す */
export function toneOf(hour, wx) {
  const s = todStep(hour), cq = Math.round(wx.cloud * CLOUD_STEPS), fall = Math.max(wx.rain, wx.snow), fq = Math.round(fall * FALL_STEPS);
  const kind = fq === 0 ? '' : wx.snow > wx.rain ? 's' : 'r', key = s + '.' + cq + '.' + kind + fq;
  let tn = made.get(key);
  if (!tn) {
    tn = { key, id: s === 0 && cq === 0 && fq === 0, step: s, ...phaseOf(stepHour(s)), cloud: cq / CLOUD_STEPS, rain: kind === 'r' ? fq / FALL_STEPS : 0, snow: kind === 's' ? fq / FALL_STEPS : 0 };
    tn.look = makeLook(tn); tn.lit = tn.look.lit; tn.sun = tn.look.sun;
    tn.fn = (c, depth, ground) => toneColor(c, tn, depth, ground);
    if (made.size > 400) made.clear();
    made.set(key, tn);
  }
  return tn;
}
/* 走行距離 d（窓の中央の地点）のトーン */
export const toneAt = d => toneOf(timeAt(d), weatherAt(d));

/* ---------- 切り替え ----------
   tones.a（layers.js）: いま見せているトーン。Layer の cache と空 sky はこのトーンで描いてある。
   tones.b: 次のトーン。Layer の cacheB と skyB。準備中（mode 'prep'。見えている範囲のチャンクを1フレームに少しずつ作る）と
   クロスフェード中（mode 'fade'。state.toneK = 0→1。render() が a の絵の上に b の絵を toneK の濃さで重ねる）だけある。
   フェードが済んだら b を a に入れ替え、古いチャンクを捨てる。 */
let mode = 'idle', prepN = 0, lastSeed = null, lastFix = '', lastDist = 0;
const publish = () => { state.tone = tones.a; state.toneTo = mode === 'fade' ? tones.b : null; if (mode !== 'fade') state.toneK = 0; };
function cancel() { if (tones.b) for (const L of layers) L.cacheB.clear(); tones.b = null; mode = 'idle'; }
/* トーン tn に即座に切り替える（フェードなし）。force: 同じトーンでも空を描き直す */
function snap(tn, force) {
  cancel();
  if (force || !tones.a || tones.a.key !== tn.key) {
    if (tones.a && tones.a.key !== tn.key) for (const L of layers) L.clear();
    tones.a = tn; buildSky(tn, sky);
  }
}
function swap() { // b を a へ
  for (const L of layers) { L.cache = L.cacheB; L.cacheB = new Map(); }
  sky.getContext('2d').drawImage(skyB, 0, 0);
  tones.a = tones.b; tones.b = null; mode = 'idle';
}
/* 準備: いま見えている範囲のチャンクのうち、まだ無いものを n 枚まで作る。全部そろっていれば true */
function prepare(n) {
  for (const L of layers) {
    const wx = Math.floor(viewOff(L)), i1 = Math.floor((wx + W - 1) / L.cw);
    for (let i = Math.floor(wx / L.cw); i <= i1; i++) if (!L.cacheB.has(i)) { if (n-- <= 0) return false; L.chunk(i, true); }
  }
  return true;
}

/* 描画の前に呼ぶ（main.js の render()）。窓の中央の地点の時刻・天気を state に書き、
   瞬間移動・シードの変更・固定の変更・state.toneSnap のときは、その地点のトーンへ即座に切り替える */
export function syncTone() {
  const c = state.dist + W / 2, fix = state.todFix + '/' + state.wxFix;
  state.hour = timeAt(c); state.wx = weatherAt(c);
  const step = state.dist - lastDist;
  if (state.toneSnap || !tones.a || state.seed !== lastSeed || fix !== lastFix || step > JUMP || step < -1) snap(toneAt(c), false);
  state.toneSnap = false; lastSeed = state.seed; lastFix = fix; lastDist = state.dist;
  publish();
}
/* 毎フレーム呼ぶ（main.js の frame()。停止中も）。dt は実時間の秒。段階が替わっていたら、準備 → クロスフェード → 入れ替え を進める */
export function stepTone(dt) {
  syncTone();
  const target = toneAt(state.dist + W / 2);
  if (state.rate > 1) { // 早送り（デバッグ）: 小分けの準備が景色の流れに追いつかないので、その場で作り直す
    if (target.key !== tones.a.key || tones.b) { snap(target, false); publish(); }
    return;
  }
  if (mode === 'idle') {
    if (target.key === tones.a.key) return;
    tones.b = target; buildSky(target, skyB); mode = 'prep'; prepN = 0;
  }
  if (mode === 'prep') {
    if (target.key === tones.a.key) { cancel(); publish(); return; } // 準備している間に元の段階へ戻った
    if (++prepN > PREP_MAX) { snap(target, false); publish(); return; }
    if (!prepare(PER_FRAME)) return;
    if (STYLE.fade) { mode = 'fade'; state.toneK = 0; }
    else swap();
  } else {
    state.toneK += dt / FADE;
    if (state.toneK >= 1) swap();
  }
  publish();
}
/* 絵柄を替えたとき・起動時: いまの地点のトーンで空を描き直す（チャンクと色のキャッシュは呼ぶ側で捨てておく） */
export function resetTone() {
  snap(toneAt(state.dist + W / 2), true);
  lastSeed = state.seed; lastFix = state.todFix + '/' + state.wxFix; lastDist = state.dist; state.toneSnap = false;
  publish();
}
/* 走行距離 dist（state.dist の値）のトーンへ即座に切り替える（撮影用: state.dist と違う地点の絵をチャンクから直接組むとき）。
   次の描画でいまの地点のトーンへ戻るよう、state.toneSnap を立てておく */
export function snapToneAt(dist) { snap(toneAt(dist + W / 2), false); state.toneSnap = true; publish(); }
