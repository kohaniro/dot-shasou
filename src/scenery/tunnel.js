import { W, SH, state } from '../state.js';
import { hash32, rng, ri, vnoise } from '../rng.js';
import { R, P, rgb, shade, tint, mix, GRASS, GREENS, CONC, ROCK, MOUNT_FAR, HILL_BACK, CEDAR, TUN_DARK, TUN_LINING, TUN_LAMP, TUN_EXIT, TUN_SIGNAL, PORTAL } from '../palette.js';
import { distAt } from '../layers.js';
import { featuresIn, featureNear } from '../features.js';
import { hz } from './common.js';
import { toX } from './bridge.js';
import { forest } from './mountain.js';

/* ---------- トンネル ----------
   位置は features.js の区間 { type: 'tunnel', a, b, len, h, via }（線路際の走行距離）。絵はトンネルごとの「計画」
   （makePlan: 区間の h だけから決める。チャンクの乱数 r は使わない）を、各レイヤーが自分の視差で切り出して描く。

   壁の層（視差 TUN_F の層 tunnel。架線より手前）: 区間の中を不透明に覆う。こちらの線路の単線の坑で、窓のすぐ外が壁。
     1ドットごとに「地の色の種類（覆工・目地・ケーブル・しみ…）」×「明るさ 0〜7（照明・坑口の外光・車内の明かりの和を
     ベイヤーでディザ）」×「光の色味」の表から色を引く。坑口の外側には低い側壁、坑口は坑門の壁の厚みを外光で明るく。
   線路際（視差 1.0）: 坑口へ向かって森の斜面と擁壁が立ち上がり、坑口に隣の線路の坑門（斜めから見た面壁・アーチ・扁額）、
     区間の中はくぐる山の斜面で埋める（壁の層との視差の差ですき間から見える）。
   遠景・中景・近景: くぐる山を、既存の絵の「奥」に描き足す（destination-over。家や木は山の手前に残る）。
     窓の中央では全レイヤーが同じ地点を指すので、坑口が近づくと 遠景 → 中景 → 近景 → 線路際 の順に山が重なって迫る。 */
export const TUN_F = 1.7;
const PW = 22;       // 壁の層: 坑門の壁の厚み（層のドット）
const WING = 150;    // 壁の層: 坑口の外側の低い側壁の長さ（層のドット）
const CUT = 250;     // 線路際: 切り通しが立ち上がり始める距離
const FW = 24;       // 線路際: 隣の線路の坑門の幅
const HILL = {       // レイヤー id → くぐる山: base 地面の上端 / out 坑口の外側へすそが伸びる距離 / inn 坑口から内側、頂上までの距離 / top 高さ
  2: { base: 52, out: 1300, inn: 900, top: 34 },
  3: { base: 59, out: 700, inn: 500, top: 54 },
  4: { base: 68, out: 340, inn: 30, top: 78 }
};
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const LV = [0.085, 0.17, 0.29, 0.42, 0.56, 0.71, 0.86, 1]; // 明るさの段 → 闇から地の色へ寄せる割合
const clamp01 = v => Math.min(1, Math.max(0, v));
const sstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const mul = (a, b) => { const A = rgb(a), B = rgb(b); return '#' + A.map((v, k) => Math.round(v * B[k] / 255).toString(16).padStart(2, '0')).join(''); };

/* ---------- 計画: トンネルごとに1度だけ作る ---------- */
let planSeed = null; const plans = new Map();
function planOf(f) {
  if (planSeed !== state.seed) { planSeed = state.seed; plans.clear(); }
  let p = plans.get(f.n);
  if (!p) { p = makePlan(f); plans.set(f.n, p); if (plans.size > 8) plans.delete(plans.keys().next().value); }
  return p;
}
function makePlan(f) {
  const r = rng(hash32(f.h, 81, 0)), age = r(), q1 = r(), q2 = r(), q3 = r();
  const lining = age > 0.68 ? 'brick' : age < 0.3 ? 'conc' : q1 < 0.5 ? 'shot' : 'conc';      // 覆工: 古いものはれんが
  const lamp = lining === 'brick' ? (q2 < 0.55 ? 'sodium' : 'fluo') : q2 < 0.3 ? 'sodium' : q2 < 0.7 ? 'fluo' : 'led';
  const pitch = Math.round((lamp === 'led' ? 215 + 40 * q3 : 235 + 95 * q3) * TUN_F);         // 照明の間隔（層のドット）
  const XA = toX(f.a, TUN_F), XB = toX(f.b, TUN_F);
  const portal = age > 0.68 ? (r() < 0.6 ? 'brick' : 'stone') : (r(), 'conc');
  const p = {
    f, h: f.h, a: f.a, b: f.b, via: f.via, age, lining, lamp, pitch, XA, XB, portal,
    l0: XA + 150 + Math.round(r() * pitch * 0.4),            // 最初の照明
    ly: lamp === 'sodium' ? 13 : lamp === 'fluo' ? 9 : 11,   // 灯具の高さ
    cn: ri(r, 2, 4), cy: ri(r, 24, 33),                      // ケーブルの本数と高さ
    pipe: r() < 0.5, band: r() < 0.4,                        // 太い管、白い線
    panel: ri(r, 52, 76),                                    // 覆工の継ぎ目の間隔
    wall: f.via === 'sea-edge' ? 'rock' : age > 0.68 ? 'stone' : 'conc', // 線路際の切り通しの足もと
    wallH: f.via === 'sea-edge' ? ri(r, 40, 54) : ri(r, 22, 34),
    plaque: r() < 0.8, ivy: age > 0.5 && r() < 0.7,
    hillK: f.via === 'sea-edge' ? 0.72 + 0.14 * r() : 0.86 + 0.14 * r(), // 遠景・中景の山の高さの倍率（岬は低め）
    slots: new Map(), tab: null
  };
  return p;
}
const tunnelsIn = (L, i, reach, pad = 0) => featuresIn(distAt(L, i, -pad) - reach, distAt(L, i, L.cw + pad) + reach).filter(f => f.type === 'tunnel').map(planOf);

/* ---------- 壁の層: 照明と、照明の合間の小物（k 番目の照明と、その次の照明との間の枠） ---------- */
function slotOf(p, k) {
  let s = p.slots.get(k);
  if (s) return s;
  const hh = hash32(p.h, 82, k), X = p.l0 + k * p.pitch, q = (hh >>> 8) % 100;
  const I = q < p.age * 13 ? 0 : q < p.age * 22 ? 0.42 : 1.25;  // 古いトンネルは球切れ・暗い灯がまじる
  const ix = X + (p.pitch >> 1) + ((hh >>> 16) % 81) - 40, t = hash32(p.h, 83, k) % 100, seed = hash32(p.h, 84, k);
  const deep = ix > p.XA + 500 && ix < p.XB - 500;
  const kind = t < 15 ? 'niche' : t < 27 ? 'post' : t < 36 ? 'exit' : t < 45 ? 'box' : t < 51 ? 'signal' : t < 57 && deep ? 'bay' : t < 74 ? 'seep' : null;
  s = { X, I, item: kind && ix < p.XB - 120 ? { t: kind, X: ix, seed } : null };
  p.slots.set(k, s); if (p.slots.size > 64) p.slots.delete(p.slots.keys().next().value);
  return s;
}
/* 地の色の種類 */
const K = { base: 0, light: 1, dark: 2, wet: 3, lime: 4, cable: 5, ledge: 6, ballast: 7, steel: 8, plate: 9, hollow: 10, door: 11 };
function tables(p) {
  if (p.tab) return p.tab;
  const [b, l, d] = TUN_LINING[p.lining];
  const alb = [b, l, d, shade(b, 0.42), mix(b, '#d8d4c4', 0.5), '#2a2c30', tint(b, 0.25), '#5b5850', '#7a7f80', '#f2f2ea', shade(b, 0.62), '#74808a'];
  const lights = [TUN_LAMP[p.lamp][0], null, TUN_EXIT, TUN_SIGNAL]; // 光の色味: 0 照明 / 1 外光・車内の明かり（色を付けない）/ 2 非常口 / 3 標識灯
  p.tab = lights.map(lc => alb.map(a => { const lit = lc ? mul(tint(a, 0.3), lc) : a; return LV.map(v => mix(TUN_DARK, lit, v)); }));
  return p.tab;
}
/* 壁の地（覆工の目地、ケーブル、管、しみ、足もとの通路とバラスト）。X は層の通し座標 */
function texKind(p, X, y) {
  const u = X - p.XA;
  if (y >= 73) return (hash32(p.h, 85, X * 131 + y) & 7) === 0 ? K.dark : K.ballast;
  if (y >= 69) return y === 69 ? K.ledge : u % 90 < 2 ? K.dark : K.base;
  const cy = y - p.cy;
  if (cy >= 0 && cy < p.cn * 3 && cy % 3 === 0) return K.cable;
  if (u % 56 === 20 && cy >= -2 && cy <= p.cn * 3) return K.steel; // ケーブルの受け金具
  if (p.pipe && (y === 60 || y === 61)) return y === 60 ? K.steel : K.cable;
  if (p.band && y === 53 && u % 14 < 10) return K.lime;
  // 漏水の跡: ところどころの帯で、筋になって垂れる
  if (vnoise(X / 41 + (p.h & 1023), 86) > 0.95 - 0.4 * p.age) {
    const hc = hash32(p.h, 87, X);
    if ((hc & 3) < 2 && y > (hc >>> 2) % 22 && y < 26 + (hc >>> 8) % 46) return (hc & 48) === 0 && p.age > 0.45 ? K.lime : K.wet;
  }
  if (p.lining === 'brick') {
    const row = Math.floor(y / 3);
    if (y % 3 === 2 || (u + (row & 1) * 4) % 8 === 0) return K.dark;
    const v = hash32(p.h, 88, (u + (row & 1) * 4 >> 3) * 97 + row) % 6;
    return v === 0 ? K.light : v === 1 ? K.wet : K.base;
  }
  if (p.lining === 'shot') { // 吹き付け: でこぼこのむら
    const v = hash32(p.h, 88, (X >> 2) * 97 + (y >> 1)) % 7, w = vnoise(X / 23 + y / 9, 89);
    return v === 0 ? K.light : v === 1 || w > 0.78 ? K.dark : K.base;
  }
  const m = u % p.panel; // コンクリート: 覆工の継ぎ目、打ち継ぎ、セパ穴
  if (m === 0 || (m === 1 && (y & 1))) return K.dark;
  if (y === 40) return K.dark;
  if (m % 17 === 8 && y % 19 === 10) return K.dark;
  const v = hash32(p.h, 88, (X >> 3) * 97 + (y >> 2)) % 9;
  return v === 0 ? K.light : v === 1 && p.age > 0.2 ? K.wet : K.base;
}
/* 小物が壁の地を置き換えるところ（-1 = そのまま） */
function itemKind(it, X, y) {
  const dx = X - it.X, ax = dx < 0 ? -dx : dx;
  if (it.t === 'niche') { // 待避所: 浅いくぼみ。上に白い標識
    if (ax > 19) return -1;
    if (y >= 19 && y <= 23 && ax <= 4) return K.plate;
    if (y < 28 || y > 68) return -1;
    const hw = y < 34 ? 11 + (y - 28) : 17;
    if (ax > hw + 2) return -1;
    if (ax > hw) return K.light;
    return y === 68 ? K.ledge : dx <= -hw + 1 ? K.base : K.hollow;
  }
  if (it.t === 'bay') { // 明かりのついた横坑の入口: 扉と消火栓
    if (ax > 25 || y < 22 || y > 68) return -1;
    if (ax > 23 || y < 24) return K.dark;
    if (dx >= -15 && dx <= -6 && y >= 40) return dx === -15 || dx === -6 || y === 40 ? K.dark : K.door;
    return y === 68 ? K.ledge : K.light;
  }
  if (it.t === 'post') { // 距離標
    if (dx === 0 && y > 50 && y < 69) return K.steel;
    if (ax > 4 || y < 38 || y > 50) return -1;
    if (ax <= 2 && ((y >= 40 && y <= 42) || (y >= 45 && y <= 48))) return hash32(it.seed, y, dx) & 1 ? K.cable : K.plate;
    return K.plate;
  }
  if (it.t === 'box') { // 配電箱と、上のケーブルへ伸びる管
    if (ax <= 4 && y >= 43 && y <= 55) return ax === 4 || y === 43 || y === 55 ? K.dark : K.steel;
    if (dx === 0 && y < 43 && y > 30) return K.cable;
    return -1;
  }
  if (it.t === 'seep') { // 大きな漏水の跡
    const y0 = 4 + (it.seed % 16), w = 2 + (hash32(it.seed, 1, y >> 3) % 4) + (y > 50 ? 1 : 0);
    if (ax > w || y < y0 || y > 68) return -1;
    return ax === w ? K.lime : K.wet;
  }
  return -1;
}
/* 灯具など、自分で光るもの */
function fixtures(g, L, ox, p, k0, k1) {
  const T = (x, y, w, h, c) => { const xa = Math.max(x, p.XA, ox), xb = Math.min(x + w, p.XB, ox + L.cw); if (xb > xa) R(g, xa - ox, y, xb - xa, h, c); };
  const [lc, core] = TUN_LAMP[p.lamp], halo = mix(TUN_DARK, lc, 0.62), dead = '#34373a';
  for (let k = k0; k <= k1; k++) {
    const s = slotOf(p, k), x = s.X, y = p.ly;
    if (x < p.XB - 110) {
      const on = s.I > 0, c1 = on ? (s.I < 1 ? mix(lc, TUN_DARK, 0.25) : core) : dead, c2 = on ? (s.I < 1 ? halo : lc) : dead;
      if (p.lamp === 'fluo') { // 蛍光灯: 横長の管
        T(x - 10, y - 2, 20, 1, '#4a4e50');
        if (on) T(x - 10, y - 1, 20, 3, halo);
        T(x - 9, y - 1, 18, 2, c2); T(x - 8, y - 1, 16, 1, c1);
      } else if (p.lamp === 'sodium') { // ナトリウム灯: 箱形の灯具
        T(x - 4, y - 3, 8, 1, '#4a4640');
        if (on) { T(x - 5, y - 2, 10, 5, halo); T(x - 6, y - 1, 12, 3, halo); }
        T(x - 4, y - 2, 8, 4, c2); T(x - 3, y - 1, 6, 2, c1);
      } else { // LED: 小さく白い
        T(x - 3, y - 3, 6, 1, '#4a4e50');
        if (on) { T(x - 4, y - 2, 8, 4, halo); }
        T(x - 3, y - 2, 6, 3, c2); T(x - 2, y - 1, 4, 1, c1);
      }
    }
    const it = s.item; if (!it) continue;
    if (it.t === 'exit') { // 非常口の緑の灯
      T(it.X - 6, 33, 12, 8, mix(TUN_DARK, TUN_EXIT, 0.5)); T(it.X - 5, 34, 10, 6, TUN_EXIT);
      T(it.X - 3, 35, 2, 4, '#effff6'); T(it.X - 1, 36, 3, 1, '#effff6'); T(it.X + 2, 35, 2, 4, '#effff6');
    } else if (it.t === 'signal') { // 青白い標識灯
      T(it.X - 2, 43, 5, 5, mix(TUN_DARK, TUN_SIGNAL, 0.55)); T(it.X - 1, 44, 3, 3, TUN_SIGNAL); T(it.X, 45, 1, 1, '#ffffff');
      T(it.X, 48, 1, 21, '#2a2c30');
    } else if (it.t === 'box') T(it.X - 2, 46, 1, 1, (it.seed & 1) ? '#ff5a48' : '#5fe08a'); // 表示灯
    else if (it.t === 'bay') { // 横坑の蛍光灯と消火栓の赤
      T(it.X - 8, 26, 16, 2, '#ffffff'); T(it.X - 9, 28, 18, 1, '#cfd6d2');
      T(it.X + 7, 48, 7, 10, '#b8402f'); T(it.X + 8, 49, 5, 3, '#e8e4d8'); T(it.X + 9, 44, 3, 3, '#ff5a48');
    } else if (it.t === 'niche') T(it.X - 1, 20, 3, 3, '#3f7fb5'); // 待避所の標識の青
  }
}
function wallChunk(g, L, ox, p) {
  const cw = L.cw, { XA, XB } = p, T = tables(p);
  const x0 = Math.max(0, XA - ox), x1 = Math.min(cw, XB - ox);
  if (x1 > x0) {
    // このチャンクに届く光源と小物
    const k0 = Math.max(0, Math.floor((ox - 320 - p.l0) / p.pitch)), k1 = Math.max(-1, Math.floor((ox + cw + 320 - p.l0) / p.pitch));
    const src = [], its = [], lampRx = p.lamp === 'fluo' ? 58 : p.lamp === 'led' ? 40 : 46;
    for (let k = k0; k <= k1; k++) {
      const s = slotOf(p, k);
      if (s.I > 0 && s.X < XB - 110) src.push({ X: s.X, y: p.ly + 9, I: s.I, rx: lampRx, ry: 33, tab: 0 });
      const it = s.item; if (!it) continue;
      if (it.X > ox - 40 && it.X < ox + cw + 40) its.push(it);
      if (it.t === 'exit') src.push({ X: it.X, y: 38, I: 0.55, rx: 20, ry: 16, tab: 2 });
      else if (it.t === 'signal') src.push({ X: it.X, y: 45, I: 0.4, rx: 13, ry: 12, tab: 3 });
      else if (it.t === 'bay') src.push({ X: it.X, y: 30, I: 1.1, rx: 22, ry: 36, tab: 1 });
    }
    const row = new Array(cw), acc = [0, 0, 0, 0];
    for (let y = 0; y < SH; y++) {
      const amb = 0.075 * sstep(10, 26, y) * (1 - sstep(60, 72, y)); // 車内の明かりが壁に落ちる帯
      const by = (y & 3) << 2;
      for (let x = x0; x < x1; x++) {
        const X = ox + x, up = Math.min(X - XA, XB - 1 - X);
        let kind = -1;
        for (let n = 0; n < its.length && kind < 0; n++) kind = itemKind(its[n], X, y);
        if (kind < 0) kind = texKind(p, X, y);
        // 坑口からの外光: 坑門の壁の厚みは明るく、その奥へすっと落ちる
        acc[0] = 0; acc[2] = 0; acc[3] = 0;
        acc[1] = (up < PW + 340 ? Math.exp(-Math.max(0, up - PW) / 62) : 0) + amb; // 外光と、車内の明かり
        for (let n = 0; n < src.length; n++) {
          const s = src[n], dx = (X - s.X) / s.rx; if (dx > 4 || dx < -4) continue;
          const dy = (y - s.y) / s.ry, v = s.I * (1.06 / (1 + dx * dx + dy * dy) - 0.06); if (v > 0) acc[s.tab] += v;
        }
        // 色味の違う光が重なるところは、強さの割合でディザして混ぜる
        let sum = acc[0] + acc[1] + acc[2] + acc[3], tab = 1;
        if (sum > 0.004) { let t = (BAYER[((X + 2) & 3) + (((y + 1) & 3) << 2)] + 0.5) / 16 * sum; for (tab = 0; tab < 3; tab++) { t -= acc[tab]; if (t < 0) break; } }
        if (kind === K.plate) sum = sum * 1.5 + 0.1; // 標識の板は光をよく返す
        const v7 = Math.min(1, sum) * 7; let lv = v7 | 0;
        if (lv < 7 && v7 - lv > (BAYER[(X & 3) + by] + 0.5) / 16) lv++;
        row[x] = T[tab][kind][lv];
      }
      let run = x0, prev = row[x0];
      for (let x = x0 + 1; x <= x1; x++) if (x === x1 || row[x] !== prev) { R(g, run, y, x - run, 1, prev); run = x; prev = row[x]; }
    }
    fixtures(g, L, ox, p, k0, k1);
  }
  // 坑門の壁の厚み: 外光を受けた坑門の材（外の角は明るく、奥の角はかげ）
  const [pc, pl, pd] = PORTAL[p.portal];
  for (const [X0, dir] of [[XA, 1], [XB - 1, -1]]) for (let k = 0; k < PW; k++) {
    const x = X0 + dir * k - ox; if (x < 0 || x >= cw) continue;
    R(g, x, 0, 1, SH, k < 2 ? pl : k === PW - 1 ? shade(pd, 0.3) : k > PW - 5 ? shade(pc, 0.1 + 0.06 * (k - PW + 5)) : pc);
    if (k >= 2 && k < PW - 1) for (let y = 0; y < SH; y++) {
      const hit = p.portal === 'brick' ? y % 3 === 2 || (k + ((y / 3 | 0) & 1) * 4) % 8 === 0 : p.portal === 'stone' ? y % 6 === 5 || (k + ((y / 6 | 0) & 1) * 5) % 10 === 0 : y % 20 === 19 || hash32(p.h, 106, k * 97 + y) % 41 === 0;
      if (hit) R(g, x, y, 1, 1, pd);
    }
  }
  // 坑口の外側: こちらの線路のコンクリートの低い側壁が、坑門へ向かって少し高くなる
  const wc = '#a9a89e', wl = tint(wc, 0.3), wd = shade(wc, 0.18);
  for (const [X0, dir] of [[XA - 1, -1], [XB, 1]]) for (let k = 0; k < WING; k++) {
    const x = X0 + dir * k - ox; if (x < 0 || x >= cw) continue;
    const top = 79 - Math.round(13 * sstep(WING, 20, k));
    if (top >= SH) continue;
    R(g, x, top, 1, SH - top, k % 30 === 29 ? wd : wc); R(g, x, top, 1, 1, wl); R(g, x, top + 1, 1, 1, tint(wc, 0.1));
    if (k % 30 === 14 && top < 74) R(g, x, top + 5, 1, 1, wd);
  }
}
export function drawTunnel(g, i, r, L) {
  for (const p of tunnelsIn(L, i, 130)) wallChunk(g, L, i * L.cw, p);
}

/* ---------- 遠景・中景・近景: くぐる山 ---------- */
function hillAt(L, ps, X, d) {
  const o = HILL[L.id], id = L.id; let h = 0;
  for (const p of ps) {
    const u = Math.max(p.a - d, d - p.b); if (u >= o.out) continue;
    const k = sstep(o.out, -o.inn, u);
    const v = id === 2 ? p.hillK * k * (o.top * (0.74 + 0.26 * vnoise(X / 37, 93)) + 2.5 * vnoise(X / 7, 94))
      : id === 3 ? p.hillK * k * (o.top * (0.78 + 0.22 * vnoise(X / 61, 95)) + 3 * vnoise(X / 13, 96))
      : k * o.top * (0.9 + 0.1 * vnoise(X / 41, 97));
    if (v > h) h = v;
  }
  return h;
}
export function tunnelHill(g, L, i) {
  const o = HILL[L.id], cw = L.cw, PAD = L.id === 4 ? 12 : 8, ps = tunnelsIn(L, i, o.out, PAD);
  if (!ps.length) return;
  const H = []; let top = 0;
  for (let x = -PAD; x < cw + PAD; x++) { const h = hillAt(L, ps, i * cw + x, distAt(L, i, x)); H.push(h); if (h > top) top = h; }
  if (top < 1) return;
  const c = document.createElement('canvas'); c.width = cw; c.height = SH;
  const og = c.getContext('2d');
  if (L.id === 2) farHill(og, L, i, o.base, H, PAD);
  else if (L.id === 3) forest(og, L, i, o.base, H, PAD, { cell: 4, rs: 3, big: false, salt: 640, haze: 0.2, patch: 46, cedar: 0.56, minH: 2 });
  else forest(og, L, i, o.base, H, PAD, { cell: 7, rs: 5, big: true, salt: 740, haze: 0.04, patch: 60, cedar: 0.5, minH: 3 });
  g.globalCompositeOperation = 'destination-over'; g.drawImage(c, 0, 0); g.globalCompositeOperation = 'source-over';
}
function farHill(g, L, i, base, H, PAD) { // 遠景: 淡い奥の峰と、手前の濃い緑の山（mountain.js の farRidge と同じ調子）
  const cw = L.cw, c = hz(MOUNT_FAR, 0.26), cl = tint(c, 0.13), cd = shade(c, 0.15), back = hz(HILL_BACK, 0.46), backL = tint(back, 0.12);
  for (let x = 0; x < cw; x++) {
    const X = i * cw + x, h0 = H[x + PAD]; if (h0 < 0.5) continue;
    const hb = Math.round(h0 * (1.05 + 0.3 * vnoise(X / 53, 98)) + 2 * vnoise(X / 11, 99));
    R(g, x, base - hb, 1, hb, back); R(g, x, base - hb, 1, 1, backL);
    const h = Math.round(h0), top = base - h, dh = H[x + PAD + 1] - H[x + PAD - 1];
    if (h < 1) continue;
    R(g, x, top, 1, h, c);
    if (dh > 0.2) R(g, x, top, 1, Math.min(h, 1 + Math.round(Math.min(1, dh) * h * 0.4)), cl);
    else if (dh < -0.2) R(g, x, top + 1, 1, Math.min(h - 1, 1 + Math.round(Math.min(1, -dh) * h * 0.5)), cd);
    if (vnoise(X / 4, 100) > 0.8) R(g, x, top + 3, 1, (h >> 1) - 2, cd);
  }
}

/* ---------- 線路際（視差 1.0）: 切り通し・隣の線路の坑門・くぐる山 ---------- */
const TRACK_WOOD = { cell: 7, rs: 5, big: true, salt: 780, haze: 0, patch: 60, cedar: 0.55, minH: 3 };
export function tunnelTrack(g, L, i) {
  const cw = L.cw, ox = i * cw, ps = tunnelsIn(L, i, CUT + 40);
  if (!ps.length) return;
  const PAD = 12, Hin = [], Hout = []; // 層の通し座標 X = 走行距離 d（視差 1.0）
  for (let x = -PAD; x < cw + PAD; x++) {
    const d = ox + x; let hi = 0, ho = 0;
    for (const p of ps) {
      const u = Math.max(p.a - d, d - p.b);
      if (u <= 0) hi = SH;
      else if (u < CUT) ho = Math.max(ho, u < FW + 6 ? 79 : 79 * sstep(CUT, FW, u) * (0.88 + 0.12 * vnoise(d / 23, 101)));
    }
    Hin.push(hi); Hout.push(ho);
  }
  // 区間の中: もとの絵を消して、くぐる山の斜面で埋める
  for (const p of ps) { const c0 = Math.max(ox, p.a), c1 = Math.min(ox + cw, p.b + 1); if (c1 > c0) g.clearRect(c0 - ox, 0, c1 - c0, SH); }
  forest(g, L, i, SH, Hin, PAD, TRACK_WOOD);
  // 坑口の手前: 森の斜面が立ち上がる
  forest(g, L, i, 75, Hout, PAD, TRACK_WOOD);
  for (const p of ps) {
    cutWall(g, ox, cw, p);
    for (const dir of [1, -1]) portalFace(g, ox, cw, p, dir);
  }
}
/* 切り通しの足もと: 擁壁（コンクリート / 石積み）か、海沿いは岩の崖。坑口へ向かって高くなる */
function cutWall(g, ox, cw, p) {
  const c = p.wall === 'conc' ? CONC : ROCK, joint = shade(c, p.wall === 'conc' ? 0.16 : 0.32);
  for (let x = 0; x < cw; x++) {
    const d = ox + x, u = Math.max(p.a - d, d - p.b); if (u <= 0 || u >= CUT) continue;
    const k = sstep(CUT - 20, FW, u), hc = hash32(p.h, 102, d);
    let hw = Math.round(p.wallH * k); if (hw < 2) continue;
    if (p.wall === 'rock') hw += (hash32(p.h, 103, d >> 2) % 3) + (hc & 1);
    const top = 77 - hw;
    for (let y = top; y < SH; y++) {
      let col;
      if (p.wall === 'conc') col = y === top ? tint(c, 0.3) : d % 19 === 0 ? joint : y === top + 1 ? shade(c, 0.06) : (d % 9 === 4 && (y - top) % 9 === 6) ? shade(c, 0.5) : (hash32(p.h, 104, d * 7 + (y >> 2)) % 13 === 0 ? shade(c, 0.08) : c);
      else if (p.wall === 'stone') { const row = (y / 3) | 0; col = y % 3 === 2 || (d + (row & 1) * 3) % 6 === 0 ? joint : [tint(c, 0.14), c, shade(c, 0.1), '#9a9382'][hash32(p.h, 104, ((d + (row & 1) * 3) / 6 | 0) * 31 + row) & 3]; }
      else { const v = hash32(p.h, 104, ((d + y) >> 2) * 31 + (y >> 1)) % 7; col = y === top ? tint(c, 0.25) : (d + y * 2) % 23 === 0 || v === 0 ? shade(c, 0.3) : v < 3 ? tint(c, 0.12) : v === 3 ? '#9a9382' : c; } // 岩: 斜めの節理
      R(g, x, y, 1, 1, col);
    }
    if ((hc & 7) < 3) R(g, x, top - 1 - ((hc >> 3) & 1), 1, 1 + ((hc >> 3) & 1), (hc & 16) ? GRASS[0] : GREENS[1]); // 壁の上にかぶさる草
    if (p.wall !== 'conc' && (hc >>> 5) % 11 === 0) R(g, x, top + 2 + ((hc >>> 9) % Math.max(1, hw - 3)), 1, 1, GRASS[1]);
  }
}
/* 隣の線路の坑門を斜めから見たところ: 面壁、笠石、アーチ環、扁額、奥へ続く照明。dir = 1 入口側 / -1 出口側（左右を返す） */
function portalFace(g, ox, cw, p, dir) {
  const x0 = dir > 0 ? p.a - FW : p.b + FW; // 外側の端
  if (x0 < ox - FW - 4 || x0 > ox + cw + FW + 4) return;
  const T = (u, y, w, h, c) => R(g, (dir > 0 ? x0 + u : x0 - u - w + 1) - ox, y, w, h, c);
  const [pc, pl, pd] = PORTAL[p.portal], lc = TUN_LAMP[p.lamp], top = 9, cu = 12;
  T(0, top, FW, SH - top, pc);
  for (let y = top; y < SH; y++) for (let u = 0; u < FW; u++) { // 面壁の目地
    if (p.portal === 'conc') { if ((y - top) % 16 === 15 || u === 12 && y < 26) T(u, y, 1, 1, pd); }
    else if (p.portal === 'brick') { const row = (y / 2) | 0; if ((y & 1) || (u + (row & 1) * 3) % 6 === 0) T(u, y, 1, 1, (y & 1) ? pd : shade(pc, 0.12)); }
    else { const row = (y / 4) | 0; if (y % 4 === 3 || (u + (row & 1) * 4) % 8 === 0) T(u, y, 1, 1, pd); }
  }
  T(0, top, 2, SH - top, tint(pc, 0.2)); T(FW - 1, top, 1, SH - top, pd); // 外の角は明るく、山側はかげ
  T(-1, top - 2, FW + 2, 2, pl); T(-1, top, FW + 2, 1, pd);              // 笠石
  for (let y = 27; y < SH; y++) { // アーチ: 環 → 坑内
    const ro = y < 44 ? Math.round(9 * Math.sqrt(1 - ((44 - y) / 17) ** 2)) : 9, ri2 = y < 44 ? (y < 30 ? 0 : Math.round(7 * Math.sqrt(1 - ((44 - y) / 14.5) ** 2))) : 7;
    T(cu - ro, y, 2 * ro, 1, (y & 3) === 0 && y < 46 ? pd : pl);
    if (ri2 > 0) { T(cu - ri2, y, 2 * ri2, 1, '#10131a'); T(cu - ri2, y, 1, 1, mix('#10131a', pl, 0.3)); }
  }
  T(cu - 7, 76, 14, 4, '#2b2d30'); T(cu - 4, 77, 8, 1, '#4a4c4c');     // 坑内へ入る線路
  T(cu - 1, 48, 2, 2, lc[1]); T(cu + 2, 52, 1, 1, lc[0]); T(cu + 4, 55, 1, 1, mix('#10131a', lc[0], 0.5)); // 奥へ続く照明
  if (p.plaque) { T(cu - 4, 17, 8, 5, '#3c4244'); T(cu - 4, 17, 8, 1, pl); T(cu - 4, 21, 8, 1, pl); T(cu - 2, 19, 1, 1, '#c9c2a0'); T(cu, 19, 1, 1, '#c9c2a0'); T(cu + 2, 19, 1, 1, '#c9c2a0'); } // 扁額
  for (let u = 0; u < FW; u++) { // 雨だれと、古い坑門のつた
    const hc = hash32(p.h, 105 + dir, u);
    if ((hc & 7) === 0) T(u, top + 1, 1, 2 + (hc >>> 3) % 9, shade(pc, 0.14));
    if (p.ivy && (hc >>> 8) % 3 === 0) T(u, top - 1, 1, 2 + (hc >>> 12) % (u < 5 || u > 19 ? 22 : 6), GREENS[(hc >>> 20) % 3]);
  }
}

/* ---------- main.js の render() 用 ---------- */
/* 窓の中央の走行距離 d の近くにトンネルがあるか（壁の層を描くかどうか） */
export function tunnelNear(d) { const f = featureNear(d, 240); return !!f && f.type === 'tunnel'; }
/* 画面の端から端までがトンネルの壁で隠れているか（奥のレイヤーの描画を省いてよいか）。dist は state.dist */
export function tunnelCovers(dist) {
  const f = featureNear(dist + W / 2, 0);
  if (!f || f.type !== 'tunnel') return false;
  const wx = Math.floor(dist * TUN_F);
  return toX(f.a, TUN_F) <= wx && toX(f.b, TUN_F) >= wx + W;
}
/* 架線柱（視差 1.2 の通し座標 x）がトンネルの山の中に当たるか */
export function poleInTunnel(x) {
  const d = (x - W / 2) / 1.2 + W / 2, f = featureNear(d, 30);
  return !!f && f.type === 'tunnel';
}
/* 窓への映り込み: トンネルの中では、暗い窓ガラスに車内の天井の照明の列と、こちら側の壁の明るみがうっすら映る。
   壁が画面を覆うにつれて濃くなる（坑口では外光に負けて見えない）。絵柄の glass フラグは呼ぶ側で見る */
export function tunnelGlass(g, dist) {
  const f = featureNear(dist + W / 2, 100);
  if (!f || f.type !== 'tunnel') return;
  const wx = Math.floor(dist * TUN_F), k = clamp01((Math.min(wx + W, toX(f.b, TUN_F) - 80) - Math.max(wx, toX(f.a, TUN_F) + 80)) / W);
  if (k <= 0) return;
  g.fillStyle = P('#eef4ff');
  for (const [a, y, h] of [[0.24, 33, 1], [0.09, 34, 1], [0.035, 86, 18]]) {
    g.globalAlpha = a * k;
    if (h > 1) { g.fillRect(50, y, 108, h); g.fillRect(162, y, 108, h); continue; }
    for (const x0 of [50, 162]) { g.fillRect(x0 + 7, y, 44, h); g.fillRect(x0 + 57, y, 44, h); }
    g.fillRect(11, y + 5, 12, h); g.fillRect(297, y + 5, 12, h);
  }
  g.globalAlpha = 1;
}
