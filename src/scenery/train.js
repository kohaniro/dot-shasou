import { W, SH } from '../state.js';
import { hash32 } from '../rng.js';
import { R, RE, shade, tint, mix, toneNow } from '../palette.js';
import { distAt } from '../layers.js';
import { trainsIn, trainNear, TRAIN, TRAIN_F, REACH_T } from '../trains.js';
import { SELF } from './closewall.js';

/* ---------- 対向列車（scenery/index.js の train、id 11、視差 TRAIN_F = 2.6） ----------
   隣の線路を逆向きに走る通勤電車。trains.js の表 { a, b, cars, len, h } を、相対速度ぶんの視差を持つ静止物として層に描く
   （時刻は使わない。自車が遅いと相手も遅く見える）。main.js の render() が trainClose のときだけ、架線と架線柱の後・手前の雨脚（fall(2)）の前に描く。
   x はレイヤー通し座標（pan 0）。先頭は左端 X0 = (a − W/2) × F + W/2 で、窓の右端から入ってくる。模様はすべて通し座標と h のハッシュで決める
   （チャンクの r は使わないので、チャンクの境目でつながる）。
   縦（景色内 y）: 屋根の上の機器とパンタグラフは y 14 から（架線のトロリ線 y 13 の下。架線はこの層より奥に描いてあり、屋根より上はこの層が透明なので、
   架線が屋根の上を通って見える）、屋根 17〜21、窓 27〜49、帯 52〜55、車体は窓の下端より下（y 80）まで。1行目（y 0）は透明（Layer.render が上へ引きのばすため）。
   色は自車の映り込み（closewall.js の SELF）と同じ車体・屋根・帯。1両 TRAIN.car = 298 ドット、扉4枚（扉の間隔 PD = 74）。
   1フレームの移動は F × 速さ / 60 ≈ 7〜14 ドット。くり返す縦の模様は扉の間隔 74（窓の柱・扉の縁もこの間隔。移動量の 5 倍以上なので、止まって見えたり
   逆走して見えたりしない）と、両開きの扉の2枚の窓（間隔 13。速い列車の移動量 12〜14 とほぼ同じなので、扉の中だけはコマ送りで区別がつかない。扉の縁と帯で動きは読める）だけ。
   細い縦のくり返し（雨どい・ビードの縦目地など）は描かない。列車らしさは横の帯（屋根・雨どい・窓の上下・帯・ビード）で出す。
   夜は窓が灯る（lit(): 車両ごとに hash32(h, 47, 両) としきい値。RE()）。前照灯・尾灯は昼も灯す（E 系）。 */
export { TRAIN_F };
const PD = 74, DW = 26;              // 扉の間隔、両開きの扉の幅
const D0 = 38;                       // 車端から最初の扉の中心まで（= 最後の扉の中心から車端まで）
const Y = {
  ac: 15, roof: 17, gutter: 21, top: 22, win: 27, winB: 50, band: 52, bandB: 56,
  door: 24, dWin: [28, 52], bead: [62, 70], lamp: [58, 62], skirt: 70
};
const BODY = SELF.BODY, ROOF = SELF.ROOF, BAND = SELF.BAND, GLASS = SELF.WIN, LIT = SELF.LIT;
const DOOR = shade(BODY, 0.06), EDGE = shade(BODY, 0.32), LT = tint(BODY, 0.35);
const SEEN = '#8ea4b3';   // 窓の向こう（反対側の窓越しの外の明るさ）
const CEIL = '#3a4249', SEAT = '#35506b', HEAD = '#262b30', HEAD_N = '#7d7766';
const HEADLIGHT = '#fff4cf', TAIL = '#ff3b2e', LED = '#ffad3a';
const hv = (h, s, k) => hash32(h, s, k) / 4294967296;

/* 窓の中央の走行距離 d の近くに対向列車があるか（この層を描くかどうか） */
export function trainClose(d) { return !!trainNear(d, REACH_T); }

/* 夜の灯り: 車両 k の室内灯がいま灯っているか（灯っていれば個体差 v、消えていれば −1） */
function lit(h, k) {
  const t = toneNow(); if (!t || t.lit <= 0) return -1;
  const q = hash32(h, 47, k);
  return t.lit > 0.05 + 0.25 * (q & 4095) / 4096 ? (q >>> 24) / 256 : -1;
}

/* ---------- 描画 ---------- */
export function drawTrain(g, i, r, L) {
  const cw = L.cw, ox = i * cw;
  const clip = (x, w) => { const a = Math.max(x, ox), b = Math.min(x + w, ox + cw); return b > a ? [a - ox, b - a] : null; };
  const T = (x, y, w, h, c) => { const s = clip(x, w); if (s) R(g, s[0], y, s[1], h, c); };
  const TE = (x, y, w, h, c) => { const s = clip(x, w); if (s) RE(g, s[0], y, s[1], h, c); };
  for (const t of trainsIn(distAt(L, i, 0) - 40, distAt(L, i, cw) + 40)) {
    const X0 = Math.round((t.a - W / 2) * TRAIN_F + W / 2);
    if (X0 + t.len + 20 < ox || X0 - 20 > ox + cw) continue;
    for (let k = 0; k < t.cars; k++) {
      const x = X0 + k * (TRAIN.car + TRAIN.gap);
      if (x + TRAIN.car + 20 < ox || x - 20 > ox + cw) continue;
      car(T, TE, g, t, k, x, ox, cw);
      if (k < t.cars - 1) gangway(T, x + TRAIN.car);
    }
  }
}

/* 連結部: すき間の真ん中にほろ（屋根より下だけ。上は透けて奥の景色が見える） */
function gangway(T, x) {
  const g = TRAIN.gap;
  T(x + 1, Y.top, g - 2, SH - Y.top, '#33373a');
  T(x + 1, Y.top, g - 2, 1, '#4a4f52');
  T(x + 1, Y.band + 1, g - 2, 1, '#2a2d30');
  T(x, Y.skirt, g, SH - Y.skirt, '#2a2c2e'); // 下の連結器まわり
}

/* 1両。k = 0 が先頭（左端が前面）、k = cars − 1 が最後尾（右端に尾灯） */
function car(T, TE, g, t, k, x, ox, cw) {
  const L = TRAIN.car, head = k === 0, tail = k === t.cars - 1, lv = lit(t.h, k);
  // 前面の傾き: 先頭の左端・最後尾の右端は、上ほど内へ（y < 34 で 1 行につき 0.5 ドット）
  const lean = y => y < 34 ? Math.round((34 - y) / 2) : 0;
  const span = y => {
    let a = x, b = x + L;
    if (head) a += lean(y); else if (y < Y.roof + 2) a += Y.roof + 2 - y; // 中間の車端は屋根の角だけ丸める
    if (tail) b -= lean(y); else if (y < Y.roof + 2) b -= Y.roof + 2 - y;
    return [a, b];
  };
  const row = (y, h, c) => { for (let yy = y; yy < y + h; yy++) { const [a, b] = span(yy); T(a, yy, b - a, 1, c); } };
  // 屋根の上: 冷房装置（1両に1つ、中ほど）とパンタグラフ（偶数番目でない車両の1つおき）
  const acx = x + 98 + Math.floor(hv(t.h, 41, k) * 40);
  T(acx, Y.ac, 70, 2, '#b4b9bb'); T(acx, Y.ac, 70, 1, '#cfd3d4'); T(acx + 2, Y.ac + 1, 66, 1, '#8f9597');
  if (t.cars >= 2 && k % 2 === 1) pantograph(T, x + (hv(t.h, 42, k) < 0.5 ? 36 : L - 66));
  // 屋根・雨どい・上の車体
  row(Y.roof, 1, tint(ROOF, 0.3));
  row(Y.roof + 1, Y.gutter - Y.roof - 1, ROOF);
  row(Y.gutter, 1, shade(ROOF, 0.35));
  row(Y.top, 1, LT);
  row(Y.top + 1, SH - Y.top - 1, BODY);
  // 横のビード（ステンレスの車体の段）と腰の影
  for (const y of Y.bead) { row(y, 1, shade(BODY, 0.1)); row(y + 1, 1, tint(BODY, 0.25)); }
  row(Y.skirt + 4, SH - Y.skirt - 4, shade(BODY, 0.08));
  // 帯（扉の上は通さない。扉の中は扉の側で描く）
  row(Y.band, Y.bandB - Y.band - 1, BAND); row(Y.bandB - 1, 1, shade(BAND, 0.35));
  // 窓（扉の間の区画に2枚ずつ、両端の区画に1枚。先頭・最後尾の前面側は乗務員室の窓）
  const doors = [0, 1, 2, 3].map(j => x + D0 + j * PD - (DW >> 1));
  const ww = (PD - DW - 6) >> 1;
  for (let j = 0; j < 3; j++) { const s = doors[j] + DW; win(T, TE, t, k, j * 2, s + 2, ww, lv); win(T, TE, t, k, j * 2 + 1, s + 4 + ww, ww, lv); }
  if (head) cab(T, TE, x, -1, lv); else win(T, TE, t, k, 6, x + 6, D0 - (DW >> 1) - 10, lv);
  if (tail) cab(T, TE, x + L, 1, lv); else win(T, TE, t, k, 7, x + L - D0 + (DW >> 1) + 4, D0 - (DW >> 1) - 10, lv);
  for (let j = 0; j < 4; j++) door(T, TE, doors[j], lv);
  // 車端の縁（中間の車端は影の線。前面は下の front()）
  if (!head) T(x, Y.top, 1, SH - Y.top, EDGE);
  if (!tail) T(x + L - 1, Y.top, 1, SH - Y.top, EDGE);
  if (head) front(T, TE, g, x, -1);
  if (tail) front(T, TE, g, x + L, 1);
  // 行先表示（先頭の車両の、2つ目の扉の上）
  if (head) { T(doors[1] - 2, Y.top + 1, DW + 4, 4, '#2b2e30'); TE(doors[1], Y.top + 2, DW, 2, LED); }
}

/* 客室の窓1枚: 窓の向こうは反対側の窓越しに明るく、上に荷棚、下に座席の背、人影 0〜2 */
function win(T, TE, t, k, j, x, w, lv) {
  const y0 = Y.win, y1 = Y.winB, q = hash32(t.h, 43, k * 16 + j);
  T(x - 1, y0 - 1, w + 2, y1 - y0 + 2, shade(BODY, 0.45)); // 窓枠のゴム
  const F = lv >= 0 ? TE : T, inner = lv >= 0 ? LIT : mix(GLASS, SEEN, 0.55);
  F(x, y0, w, y1 - y0, inner);
  F(x, y0, w, 4, lv >= 0 ? mix(LIT, CEIL, 0.25) : CEIL);                     // 天井・荷棚
  F(x, y1 - 6, w, 6, lv >= 0 ? mix(LIT, SEAT, 0.45) : shade(SEAT, 0.2));     // 座席の背
  // 人影（座った人の頭と肩 / 立っている人）。位置は h のハッシュ（くり返さない）
  const hc = lv >= 0 ? HEAD_N : mix(HEAD, inner, 0.3);
  const person = (px, y) => { // 頭（角を落とす）と、なで肩の上半身。y は頭のてっぺん
    F(px + 2, y, 3, 1, hc); F(px + 1, y + 1, 5, 4, hc); F(px + 2, y + 5, 3, 1, hc);
    F(px, y + 6, 7, 1, hc); F(px - 1, y + 7, 9, y1 - y - 7, hc);
  };
  for (let n = 0; n < (q & 3) && n < 2; n++) {
    const px = x + 2 + Math.floor(((q >>> (4 + n * 7)) & 127) / 128 * Math.max(1, w - 10)), stand = (q >>> (18 + n)) & 1;
    person(px, stand ? y0 + 5 : y1 - 15);
  }
  if (lv < 0) { T(x, y0 + 4, w, 1, tint(inner, 0.3)); T(x + w - 3, y0 + 5, 2, y1 - y0 - 11, tint(inner, 0.18)); } // 昼のガラスの映り
}

/* 両開きの扉: 戸袋の縁、2枚の扉の窓、扉の合わせ目 */
function door(T, TE, x, lv) {
  const y0 = Y.door, hw = DW >> 1;
  T(x - 1, y0 - 1, DW + 2, SH - y0 + 1, EDGE);
  T(x, y0, DW, SH - y0, DOOR);
  T(x, y0, DW, 1, tint(DOOR, 0.3));
  for (const s of [0, hw]) {
    const wx = x + s + 3, wy = Y.dWin[0], w = hw - 6, h = Y.dWin[1] - Y.dWin[0];
    T(wx - 1, wy - 1, w + 2, h + 2, shade(BODY, 0.45));
    if (lv >= 0) { TE(wx, wy, w, h, LIT); TE(wx, wy, w, 3, mix(LIT, CEIL, 0.25)); }
    else { T(wx, wy, w, h, mix(GLASS, SEEN, 0.5)); T(wx, wy, w, 3, CEIL); T(wx, wy + 3, w, 1, tint(SEEN, 0.2)); }
  }
  T(x + hw - 1, y0, 2, SH - y0, shade(DOOR, 0.3));                 // 合わせ目
  T(x, Y.band, DW, Y.bandB - Y.band - 1, mix(DOOR, BAND, 0.25));   // 扉の帯は薄く
}

/* 乗務員室: 前面側の区画に運転台の側窓と手すり（扉の割りの都合で乗務員扉は描かない）。e は前面の x、dir は外向き（−1 = 左） */
function cab(T, TE, e, dir, lv) {
  const wx = dir < 0 ? e + 10 : e - 10 - 9;
  T(wx - 1, Y.win - 1, 11, 20, shade(BODY, 0.45));
  if (lv >= 0) TE(wx, Y.win, 9, 18, mix(LIT, CEIL, 0.5)); else { T(wx, Y.win, 9, 18, mix(GLASS, SEEN, 0.3)); T(wx, Y.win, 9, 3, CEIL); }
  T(dir < 0 ? e + 3 : e - 6, Y.win + 22, 3, 12, shade(BODY, 0.2)); // 乗務員室の手すり
}

/* 前面（先頭の左端・最後尾の右端）: 傾いた前面ガラスの縁、前照灯か尾灯、下のスカート。e は車端の x、dir は外向き */
function front(T, TE, g, e, dir) {
  const lean = y => y < 34 ? Math.round((34 - y) / 2) : 0;
  // 前面ガラス（斜めから見えるぶん、縁に沿って幅 3）と、その下の前面の縁
  for (let y = Y.roof; y < SH; y++) {
    const xe = dir < 0 ? e + lean(y) : e - lean(y) - 1;
    if (y >= Y.top && y < 46) T(dir < 0 ? xe : xe - 2, y, 3, 1, y < 25 ? '#5a6268' : '#1f262c');
    else T(xe, y, 1, 1, y < Y.top ? shade(ROOF, 0.3) : EDGE);
  }
  // 灯り（前照灯は白、尾灯は赤。昼も灯す）
  const lx = dir < 0 ? e : e - 4, [ly0, ly1] = Y.lamp;
  T(lx - (dir < 0 ? 0 : 1), ly0 - 1, 5, ly1 - ly0 + 2, '#2a2d30');
  TE(lx + (dir < 0 ? 0 : 0), ly0, 4, ly1 - ly0, dir < 0 ? HEADLIGHT : TAIL);
  // 夜: 灯りのにじみ（外側へ）
  const tn = toneNow(), n = tn ? tn.lit : 0;
  if (n > 0) {
    const a = g.globalAlpha, ox = dir < 0 ? lx - 8 : lx + 4;
    g.globalAlpha = a * 0.35 * n; TE(ox, ly0 - 2, 8, ly1 - ly0 + 4, dir < 0 ? HEADLIGHT : TAIL);
    g.globalAlpha = a * 0.18 * n; TE(dir < 0 ? ox - 8 : ox + 8, ly0 - 3, 8, ly1 - ly0 + 6, dir < 0 ? HEADLIGHT : TAIL);
    g.globalAlpha = a;
  }
  // スカート（下の排障器。前面より少し前へ出る）
  T(dir < 0 ? e - 2 : e - 2, Y.skirt + 2, 4, SH - Y.skirt - 2, '#2b2e31');
  T(dir < 0 ? e - 2 : e - 2, Y.skirt + 2, 4, 1, '#4a4e51');
}

/* パンタグラフ（シングルアーム。たたみ気味で、すり板がトロリ線のすぐ下 y 14 に当たる） */
function pantograph(T, x) {
  const c = '#4b5254', d = '#33393b';
  T(x, Y.roof - 1, 30, 1, d);              // 台枠
  T(x + 4, Y.roof - 2, 2, 1, c); T(x + 6, Y.roof - 3, 6, 1, c);   // 下わく → 上わく（斜め）
  T(x + 12, Y.roof - 3, 10, 1, c);
  T(x + 16, 14, 12, 1, '#6c7375');          // すり板
}
