import { W, SY, SH, state } from './state.js';
import { hash32 } from './rng.js';
import { STYLE, P, E, rgb } from './palette.js';
import { featureMix } from './features.js';

/* ---------- 天気の絵（雨・雪）----------
   色調・空・雲は tone.js と scenery/sky.js。ここは残りの2つ:
   1. チャンクの仕上げ bakeWeather（layers.js が、雨・雪のトーンでチャンクを描いた直後に呼ぶ。チャンクに焼き込む）:
      屋根・木・稜線など「上が空いている縁」に載る雪、濡れた屋根と地面のてり、夜の濡れた地面・雪面に映る灯り
   2. 毎フレーム描く動きのある層（main.js の render() が呼ぶ）: 窓の外の雨脚と舞う雪 drawFall、窓ガラスの水滴 drawGlassRain
      どれも state.t・state.dist・state.speed と位置のハッシュだけで決める（積算する状態を持たない。同じ時刻・地点なら同じ絵）。
      量は段階に丸めたトーンではなく、連続値 state.wx で動かす
   色はすべて P()（トーンと絵柄）か E()（絵柄だけ）を通す。半透明は STYLE.fade / STYLE.glass が真の絵柄だけで、
   色数の少ない絵柄では数を減らした不透明のドットにする */

/* ---------- 1. チャンクの仕上げ ---------- */
export const BAKE = {
  snow: '#f6f8fb', snowShade: '#dde5ee', // 積もった雪 / その下の段
  sheen: '#eaf1f6',                      // 濡れた面のてり（空の明るさを映す）
  capRun: 3,        // 雪・てりを載せる縁の、下に続く厚み（これより薄い物 = 電線・金網などには載せない）
  roofSheen: 0.3,   // 雨: 平らな上の縁のてりの濃さ
  groundSheen: 0.03, groundSheenA: 0.24, groundRows: 12, // 雨: 地面のてり（1ドットあたりの出やすさ / 濃さ / 地面の上端から何行まで）
  lampMin: 150,     // 灯りとみなす明るさ（外が暗いトーンでだけ使う）
  reflRain: 0.55, reflSnow: 0.3 // 夜: 灯りの映り込みの濃さ（濡れた地面 / 雪面）
};
const SALT_BAKE = 9350;
export function bakeWeather(g, L, i, tn) {
  if (!L.cap && !L.gy) return;
  const cw = L.cw, im = g.getImageData(0, 0, cw, SH), d = im.data, src = new Uint8ClampedArray(d);
  const snow = tn.snow, rain = tn.rain, soft = STYLE.fade, salt = hash32(state.seed, SALT_BAKE + L.id, i);
  const A = (x, y) => x >= 0 && x < cw && y >= 0 && y < SH ? src[(y * cw + x) * 4 + 3] : 0;
  const put = (x, y, c, k) => { // (x, y) を色 c へ k だけ寄せる（色数の少ない絵柄では k を出やすさとみなして、置くか置かないか）
    const o = (y * cw + x) * 4;
    if (!soft) { if (k < 1 && (hash32(salt, x, y) & 255) >= k * 256) return; k = 1; }
    d[o] += (c[0] - d[o]) * k; d[o + 1] += (c[1] - d[o + 1]) * k; d[o + 2] += (c[2] - d[o + 2]) * k;
  };
  const lumAt = o => 0.299 * src[o] + 0.587 * src[o + 1] + 0.114 * src[o + 2];
  const dark = tn.sun < 0.5 && tn.lit > 0.3; // 外が暗い: 明るいドットは灯り
  const isLamp = (x, y) => dark && lumAt((y * cw + x) * 4) > BAKE.lampMin;
  // 上の縁: 雪を載せる / 雨のてり
  if (L.cap) {
    const cSnow = rgb(P(BAKE.snow)), cShade = rgb(P(BAKE.snowShade)), cSheen = rgb(P(BAKE.sheen));
    const top = (x, y) => A(x, y) > 0 && A(x, y - 1) === 0;
    for (let x = 0; x < cw; x++) for (let y = 1; y < SH; y++) {
      if (!top(x, y)) continue;
      let run = 1; while (run < 6 && A(x, y + run) > 0) run++;
      const flatL = top(x - 1, y), flatR = top(x + 1, y), wide = A(x - 1, y) > 0 || A(x + 1, y) > 0;
      if (run < BAKE.capRun || !wide || isLamp(x, y)) continue;
      if (snow > 0) {
        if (snow < 0.75 && !(flatL || flatR) && (hash32(salt, x, y) & 3) === 0) continue; // 薄化粧: 斜めの縁はところどころ
        put(x, y, cSnow, snow < 0.75 ? 0.8 : 1);
        if (snow >= 0.75 && flatL && flatR && run >= 5) put(x, y + 1, (x + y) & 1 ? cSnow : cShade, 1); // しっかり: 平らな所は2段
      } else if (rain > 0 && flatL && flatR && soft) put(x, y, cSheen, BAKE.roofSheen * rain);
    }
  }
  if (L.gy) {
    const gy = L.gy;
    // 雨: 濡れた地面のてり（横に短い明るいすじ）
    if (rain > 0 && soft) {
      const cSheen = rgb(P(BAKE.sheen)), y1 = Math.min(SH, gy + 1 + BAKE.groundRows), p = BAKE.groundSheen * rain * 65536;
      for (let y = gy + 1; y < y1; y++) for (let x = 0; x < cw; x++) {
        const h = hash32(salt + 1, x, y); if ((h & 65535) >= p) continue;
        for (let k = 2 + ((h >>> 16) & 3); k >= 0; k--) if (x + k < cw && A(x + k, y) > 0 && !isLamp(x + k, y)) put(x + k, y, cSheen, BAKE.groundSheenA);
      }
    }
    // 夜: 地面のすぐ上の灯りが、濡れた地面には縦に長く、雪面にはぼんやり映る（上の 2 行ぶんを地面の 1 行へ縮めて映す）
    if (dark && L.refl) {
      const kk = rain > 0 ? BAKE.reflRain * (0.5 + 0.5 * rain) : BAKE.reflSnow * snow, rows = rain > 0 ? L.refl : Math.min(3, L.refl);
      for (let dd = 1; dd <= rows; dd++) {
        const y = gy + dd - 1; if (y >= SH) break;
        const jit = rain > 0 && (hash32(salt + 2, dd, 0) & 3) === 0 ? ((hash32(salt + 2, dd, 1) & 1) ? 1 : -1) : 0; // ゆらぎ
        for (let x = 0; x < cw; x++) {
          let sy = gy - (2 * dd - 1); if (sy < 0) break;
          if (!(A(x, sy) > 0 && isLamp(x, sy))) { sy--; if (sy < 0 || !(A(x, sy) > 0 && isLamp(x, sy))) continue; }
          const tx = x + jit; if (tx < 0 || tx >= cw || A(tx, y) === 0 || isLamp(tx, y)) continue;
          const o = (sy * cw + x) * 4;
          if (!soft && (dd & 1) === 0) continue;
          put(tx, y, [src[o], src[o + 1], src[o + 2]], soft ? kk * (1 - (dd - 1) / (rows + 1)) : 1);
        }
      }
    }
  }
  g.putImageData(im, 0, 0);
}

/* ---------- 2a. 窓の外の雨脚と舞う雪 ----------
   band: 0 奥（遠景と中景の間）/ 1 中ほど（近景と線路際の間）/ 2 手前（架線の手前）。奥は細かくゆっくり、手前は長く速い。
   雨脚は「落ちる速さ vy」と「列車の速さ × 視差 f」の合成の向きに傾く（走行中は斜め、停車中は真下）。
   雪は走行中は横へ流れ（速いほど横に長い残像）、停車中はゆれながら落ちる。
   n: 強さ 1 のときの本数 / len: 雨脚の長さ / a: 濃さ / sway: 雪の横ゆれの幅 / size: 雪片の大きさ */
export const RAIN_FX = {
  bands: [{ n: 64, len: 2, vy: 210, f: 0.3, a: 0.24 }, { n: 46, len: 4, vy: 300, f: 0.75, a: 0.28 }, { n: 30, len: 7, vy: 400, f: 1.5, a: 0.34 }],
  color: '#e6eef5', solid: '#9fb0bf', solidRate: 0.4
};
export const SNOW_FX = {
  bands: [{ n: 84, vy: 8, f: 0.2, a: 0.5, sway: 2, size: 1 }, { n: 68, vy: 13, f: 0.6, a: 0.8, sway: 3, size: 1 }, { n: 32, vy: 20, f: 1.4, a: 0.95, sway: 5, size: 2 }],
  color: '#ffffff', shade: '#8e9aaa', skyline: 50, solidRate: 0.5 // shade: 明るい空を背にした雪片の色（昼だけ。skyline より上で使う）
};
const FY0 = SY, FH = SH + 2;
export function drawFall(g, band) {
  const { rain, snow } = state.wx;
  if (!(rain > 0) && !(snow > 0)) return;
  const t = state.t, dist = state.dist, v = Math.max(0, state.speed), soft = STYLE.fade;
  if (rain > 0) {
    const B = RAIN_FX.bands[band], n = Math.ceil(B.n * Math.pow(rain, 0.8) * (soft ? 1 : RAIN_FX.solidRate)), span = FH + B.len, ww = W + 80;
    const slope = v * B.f / B.vy, shift = dist * B.f; // slope: 1 ドット上がるごとに右へずれる量（尾は進行方向の前 = 右上へ伸びる）
    g.fillStyle = P(soft ? RAIN_FX.color : RAIN_FX.solid); if (soft) g.globalAlpha = B.a;
    for (let k = 0; k < n; k++) {
      const h = hash32(k, 9400 + band, 1), yy = t * B.vy * (0.85 + ((h >>> 12) & 255) / 850) + (h & 4095) / 4096 * span, c = Math.floor(yy / span), y = Math.floor(yy - c * span) - B.len;
      let x = (hash32(k, 9410 + band, c) % ww - shift) % ww; if (x < 0) x += ww; x -= 40;
      if (slope < 0.15) { const y0 = Math.max(0, y - B.len + 1), y1 = Math.min(FH - 1, y); if (y1 >= y0) g.fillRect(Math.floor(x), FY0 + y0, 1, y1 - y0 + 1); continue; }
      for (let j = 0; j < B.len; j++) { const yj = y - j; if (yj >= 0 && yj < FH) g.fillRect(Math.floor(x + slope * j), FY0 + yj, 1, 1); }
    }
  }
  if (snow > 0) {
    const B = SNOW_FX.bands[band], n = Math.ceil(B.n * Math.pow(snow, 0.8) * (soft ? 1 : SNOW_FX.solidRate)), span = FH + 4, ww = W + 24;
    const wd = Math.max(1, Math.min(5, Math.round(v * B.f / 80))), shift = dist * B.f; // 速いほど横に長い残像
    const cW = P(SNOW_FX.color), cG = state.tone && state.tone.sun < 0.5 ? cW : P(SNOW_FX.shade); // 明るい空を背にすると灰色に、景色を背にすると白く見える
    if (soft) g.globalAlpha = B.a / Math.sqrt(wd);
    for (let k = 0; k < n; k++) {
      const h = hash32(k, 9420 + band, 2), yy = t * B.vy * (0.7 + (h & 255) / 425) + (h >>> 8) % span, c = Math.floor(yy / span), y = Math.floor(yy - c * span) - 2;
      const h2 = hash32(k, 9430 + band, c), sz = B.size > 1 && (h & 256) ? B.size : 1;
      let x = (h2 % ww - shift + B.sway * Math.sin(t * (0.6 + ((h2 >>> 10) & 63) / 60) + (h2 >>> 16) % 7)) % ww; if (x < 0) x += ww; x -= 12;
      const y0 = Math.max(0, y), y1 = Math.min(FH, y + sz);
      if (y1 > y0) { g.fillStyle = y < SNOW_FX.skyline - band * 3 ? cG : cW; g.fillRect(Math.floor(x), FY0 + y0, sz + wd - 1, y1 - y0); }
    }
  }
  g.globalAlpha = 1;
}

/* ---------- 2b. 窓ガラスの水滴 ----------
   ガラスの面にあるので視差なし。車内の絵（窓を抜いた別キャンバス）と乗客はこの後に重ねるので、窓の開口部の中にだけ見える。
   水滴の枠 n 個が、それぞれ life 秒の周期で「付く → しばらく止まる → 流れる → 消える」をくり返す（周期ごとに位置を選び直す）。
   雨の強さ（state.wx.rain）より大きいしきい値の枠は休む。粒のまま動かないものと、流れるものがある。
   流れる向きは今の速度で決まる: 走行中は風で斜め後ろ（景色の流れる向き = 左）へ、遅くなるほど筋が立ち、停車中はほぼ真下へ、
   ひっかかりながら伝う。後ろに細い跡を引く。
   トンネルの中では新しく付かない（付いた地点を今の速度で逆算し、そこがトンネルの中なら出さない）。すでに付いた粒は流れ続ける */
export const GLASS_FX = {
  n: 130, life: [5, 12],     // 枠の数（窓の外の壁に隠れる分も含む）、周期の幅（秒）
  runner: 0.5,               // 流れる水滴の割合
  wait: [0.4, 2.6],          // 流れだすまでの秒数
  windX: 42, fallMin: 5, fallStop: 13, // 巡航時に横へ流れる速さ / 巡航時・停車時に下へ伝う速さ（ドット/秒）
  trail: [8, 26],            // 跡の長さ（巡航時 / 停車時。ドット）
  hi: '#f2f7fb', lo: '#18202c', aHi: 0.62, aLo: 0.28, aTrail: 0.42, // 光る側 / かげの側 の色と濃さ、跡の濃さ
  solidRate: 0.35            // 半透明を使わない絵柄で出す割合
};
const V_REF = 240;
export function drawGlassRain(g, doorOpen = false) {
  const rain = state.wx.rain;
  if (!(rain > 0)) return;
  const F = GLASS_FX, t = state.t, v = Math.max(0, state.speed), u = Math.min(1.1, v / V_REF), u1 = Math.min(1, u), here = state.dist + W / 2, soft = STYLE.glass;
  const vx = -F.windX * u * (0.25 + 0.75 * u), vy = F.fallMin + (F.fallStop - F.fallMin) * (1 - u1), mag = Math.hypot(vx, vy), ux = vx / mag, uy = vy / mag;
  const trailMax = F.trail[0] + (F.trail[1] - F.trail[0]) * (1 - u1);
  const tun = d => featureMix(d).tunnel > 0.5;
  const anyTunnel = tun(here) || tun(here - v * F.life[1] / 2) || tun(here - v * F.life[1]); // 近くにトンネルが無ければ、粒ごとには調べない
  const hi = E(F.hi), lo = E(F.lo);
  const dot = (x, y, w, c, a) => { if (y < SY || y > SY + SH + 1) return; if (soft) g.globalAlpha = a; g.fillStyle = c; g.fillRect(x, y, w, 1); };
  for (let k = 0; k < F.n; k++) {
    const hk = hash32(k, 9500, 0), T = F.life[0] + (hk & 1023) / 1023 * (F.life[1] - F.life[0]), tt = t + ((hk >>> 10) & 1023) / 1023 * T;
    const c = Math.floor(tt / T), age = tt - c * T, h = hash32(k, 9501, c);
    if ((h & 255) / 256 >= rain) continue;
    if (!soft && (hk >>> 22) % 100 >= F.solidRate * 100) continue;
    if (anyTunnel && tun(here - v * age)) continue;
    const x0 = 2 + (h >>> 8) % 316, y0 = SY + 1 + (h >>> 17) % 78, big = ((h >>> 25) & 7) < 2;
    const a = Math.min(1, age / 0.25) * Math.min(1, (T - age) / 0.8);
    const run = (hk >>> 20 & 255) / 256 < F.runner ? age - (F.wait[0] + ((h >>> 28) & 15) / 15 * (F.wait[1] - F.wait[0])) : -1;
    let x = x0, y = y0;
    if (run > 0) {
      // 進んだ長さ p（ドット）: 遅いときは、ひっかかっては進む
      const sp = 0.7 + ((hk >>> 5) & 31) / 40, s = run + (1 - u1) * 0.62 * Math.sin(run * 2.1 + k) / 2.1, p = mag * sp * s;
      const wob = yy => (1 - u1) * Math.round(0.9 * Math.sin(yy * 0.33 + k)); // 伝うときの小さな蛇行
      y = Math.floor(y0 + uy * p); x = Math.floor(x0 + ux * p + wob(y));
      if (y > SY + SH + 1 || x < -2) continue;
      if (doorOpen && (x < 34 || x > 285)) continue;
      const len = Math.min(p, trailMax * (0.7 + ((h >>> 3) & 7) / 12)), nT = soft ? Math.floor(len) : Math.min(2, Math.floor(len));
      for (let j = 1; j <= nT; j++) { const ty = Math.floor(y0 + uy * (p - j)); dot(Math.floor(x0 + ux * (p - j) + wob(ty)), ty, 1, hi, a * F.aTrail * (1 - j / (nT + 1))); }
    } else if (doorOpen && (x < 34 || x > 285)) continue;
    dot(x, y, big ? 2 : 1, hi, a * F.aHi);
    if (soft) { dot(x, y + 1, big ? 2 : 1, lo, a * F.aLo); if (big) dot(x, y - 1, 1, hi, a * F.aHi * 0.45); }
  }
  g.globalAlpha = 1;
}
