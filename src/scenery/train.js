import { W, SH } from '../state.js';
import { hash32 } from '../rng.js';
import { R, RE, shade, tint, mix, toneNow } from '../palette.js';
import { distAt } from '../layers.js';
import { trainsIn, trainNear, TRAIN, TRAIN_F, REACH_T } from '../trains.js';
import { SELF } from './closewall.js';

/* ---------- 対向列車（scenery/index.js の train、id 11、視差 TRAIN_F = 3.0） ----------
   隣の線路を逆向きに走る通勤電車。trains.js の表 { a, b, cars, len, h } を、相対速度ぶんの視差を持つ静止物として層に描く
   （時刻は使わない。自車が遅いと相手も遅く見える）。main.js の render() が trainClose のときだけ、架線と架線柱の後・手前の雨脚（fall(2)）の前に描く。
   x はレイヤー通し座標（pan 0）。先頭は左端 X0 = (a − W/2) × F + W/2 で、窓の右端から入ってくる。模様はすべて通し座標と h のハッシュで決める
   （チャンクの r は使わないので、チャンクの境目でつながる）。
   縦（景色内 y）: 2m ほど先を通る車両なので、窓には車体の全体は入らない。屋根・屋根の機器・パンタグラフは窓の上の外（描かない）で、
   y 0〜13 が雨どいと幕板、客室の窓 14〜51（自分の窓の中ほど）、帯 54〜60、その下は腰板で、裾は窓の下端（車内込みでは y 78）より下。
   y 0 の行は車体の色だけ（Layer.render が上へ引きのばすため）。架線は屋根の上で窓の外になり、架線柱も車体に隠れる。
   連結部はすき間 12 の真ん中にほろ 4 で、両側の 4 ドットから奥の景色が細く見える。
   色は自車の映り込み（closewall.js の SELF）と同じ車体・帯。1両 TRAIN.car = 480 ドット、扉4枚（扉の間隔 PD = 120）。
   1フレームの移動は F × 速さ / 60 ≈ 8〜16 ドット。くり返す縦の模様の間隔は、移動量の 1 倍・2 倍の帯（8〜32）を避けて 34 以上:
   扉の間隔 120、客室の窓の間隔 40（窓 34 ＋ 柱 6）、窓 → 扉の窓 43、扉の窓 → 窓 37、車端の窓 → 扉の窓 39、連結部をはさむ窓 52。
   両開きの扉の窓は2枚（間隔 21）にせず、合わせ目をはさんで1枚のガラスに見せる（幅 28・客室の窓より上下に長く、扉の板は少し暗い）。
   細い縦のくり返し（雨どい・ビードの縦目地など）は描かない。列車らしさは横の帯（雨どい・窓の上下・帯・ビード）で出す。
   夜は全車両の窓が灯る（lit(): 編成で1つ。トーンの lit が 0.05 を超えたら灯り、明るさの個体差は hash32(h, 47, 0)。RE()）。前照灯・尾灯は昼も灯す（E 系）。 */
export { TRAIN_F };
const PD = 120, DW = 42;             // 扉の間隔、両開きの扉の幅
const D0 = 60;                       // 車端から最初の扉の中心まで（= 最後の扉の中心から車端まで）。1両 = 2 × D0 + 3 × PD = 480
const Y = {
  eave: 3, top: 4, win: 14, winB: 51, band: 54, bandB: 61,  // 雨どい（これより上は幕板の上の丸み）、幕板の上端、窓、帯
  door: 9, dWin: [13, 53], bead: 70, lamp: [64, 70],         // 扉の上端、扉の窓の上下、ビード、前照灯・尾灯
  lean: 25, glass: 44                                        // 前面が傾く範囲（これより上）、前面ガラスの下端
};
const BODY = SELF.BODY, ROOF = SELF.ROOF, BAND = SELF.BAND, GLASS = SELF.WIN, LIT = SELF.LIT;
const DOOR = shade(BODY, 0.06), EDGE = shade(BODY, 0.32), LT = tint(BODY, 0.35);
const SEEN = '#8ea4b3';   // 窓の向こう（反対側の窓越しの外の明るさ）
const CEIL = '#3a4249', SEAT = '#35506b', HEAD = '#262b30', HEAD_N = '#7d7766';
const HEADLIGHT = '#fff4cf', TAIL = '#ff3b2e', LED = '#ffad3a';

/* 窓の中央の走行距離 d の近くに対向列車があるか（この層を描くかどうか） */
export function trainClose(d) { return !!trainNear(d, REACH_T); }

/* 夜の灯り: 車両 k の室内灯がいま灯っているか（灯っていれば個体差 v、消えていれば −1） */
function lit(h, k) { // 灯りは編成で1つ（ユーザーの方針: 車両ごとに点いたり消えたりしない）。夕方の早い段階から全車両が灯る。k は使わない
  const t = toneNow(); if (!t || t.lit <= 0.05) return -1;
  return (hash32(h, 47, 0) >>> 24) / 256;
}

/* ---------- 描画 ---------- */
export function drawTrain(g, i, r, L) {
  const cw = L.cw, ox = i * cw;
  const clip = (x, w) => { const a = Math.max(x, ox), b = Math.min(x + w, ox + cw); return b > a ? [a - ox, b - a] : null; };
  const T = (x, y, w, h, c) => { const s = clip(x, w); if (s) R(g, s[0], y, s[1], h, c); };
  const TE = (x, y, w, h, c) => { const s = clip(x, w); if (s) RE(g, s[0], y, s[1], h, c); };
  for (const t of trainsIn(distAt(L, i, 0) - 40, distAt(L, i, cw) + 40)) {
    const X0 = Math.round((t.a - W / 2) * TRAIN_F + W / 2);
    if (X0 + t.len + 32 < ox || X0 - 32 > ox + cw) continue;
    for (let k = 0; k < t.cars; k++) {
      const x = X0 + k * (TRAIN.car + TRAIN.gap);
      if (x + TRAIN.car + 32 < ox || x - 32 > ox + cw) continue;
      car(T, TE, g, t, k, x, ox, cw);
      if (k < t.cars - 1) gangway(T, x + TRAIN.car);
    }
  }
}

/* 連結部: すき間の真ん中にほろ（両側と上は透けて奥の景色が細く見える） */
function gangway(T, x) {
  const hx = x + (TRAIN.gap >> 1) - 2;
  T(hx, Y.win - 4, 4, SH - Y.win + 4, '#33373a');
  T(hx, Y.win - 4, 4, 1, '#4a4f52');
  T(hx, Y.band + 1, 4, 1, '#2a2d30');
  T(x + 2, Y.bead + 2, TRAIN.gap - 4, SH - Y.bead - 2, '#2a2c2e'); // 下の連結器まわり
}

/* 1両。k = 0 が先頭（左端が前面）、k = cars − 1 が最後尾（右端に尾灯） */
function car(T, TE, g, t, k, x, ox, cw) {
  const L = TRAIN.car, head = k === 0, tail = k === t.cars - 1, lv = lit(t.h, k);
  // 前面の傾き: 先頭の左端・最後尾の右端は、上ほど内へ（y < Y.lean で 1 行につき 0.5 ドット）
  const lean = y => y < Y.lean ? Math.round((Y.lean - y) / 2) : 0;
  const span = y => [x + (head ? lean(y) : 0), x + L - (tail ? lean(y) : 0)];
  const row = (y, h, c) => { for (let yy = y; yy < y + h; yy++) { const [a, b] = span(yy); T(a, yy, b - a, 1, c); } };
  // 幕板の上の丸み（y 0 は車体の色1色）・雨どい・上の車体
  row(0, Y.eave, shade(BODY, 0.12));
  row(Y.eave, 1, shade(ROOF, 0.35));
  row(Y.top, 1, LT);
  row(Y.top + 1, SH - Y.top - 1, BODY);
  // 横のビード（ステンレスの車体の段）と腰の影
  row(Y.bead, 1, shade(BODY, 0.1)); row(Y.bead + 1, 1, tint(BODY, 0.25));
  row(Y.bead + 4, SH - Y.bead - 4, shade(BODY, 0.08));
  // 帯（扉の上は通さない。扉の中は扉の側で描く）
  row(Y.band, Y.bandB - Y.band - 1, BAND); row(Y.bandB - 1, 1, shade(BAND, 0.35));
  // 窓（扉の間の区画に2枚ずつ、両端の区画に1枚。先頭・最後尾の前面側は乗務員室の窓）
  const doors = [0, 1, 2, 3].map(j => x + D0 + j * PD - (DW >> 1));
  const ww = (PD - DW - 10) >> 1;      // 34。2枚の間の柱 6 で、窓の間隔 40 を速い列車の移動量の2倍（〜32）より上に
  for (let j = 0; j < 3; j++) { const s = doors[j] + DW; win(T, TE, t, k, j * 2, s + 2, ww, lv); win(T, TE, t, k, j * 2 + 1, s + 8 + ww, ww, lv); }
  const ew = D0 - (DW >> 1) - 11;      // 両端の区画の窓 28
  if (head) cab(T, TE, x, -1, lv); else win(T, TE, t, k, 6, x + 7, ew, lv);
  if (tail) cab(T, TE, x + L, 1, lv); else win(T, TE, t, k, 7, x + L - D0 + (DW >> 1) + 4, ew, lv);
  for (let j = 0; j < 4; j++) door(T, TE, doors[j], lv);
  // 車端の縁（中間の車端は影の線。前面は下の front()）
  if (!head) T(x, 0, 1, SH, EDGE);
  if (!tail) T(x + L - 1, 0, 1, SH, EDGE);
  if (head) front(T, TE, g, x, -1);
  if (tail) front(T, TE, g, x + L, 1);
  // 行先表示（先頭の車両の、2つ目の扉の上）
  if (head) { T(doors[1] - 2, Y.top + 1, DW + 4, 6, '#2b2e30'); TE(doors[1] + 2, Y.top + 2, DW - 4, 4, LED); }
}

/* 客室の窓1枚: 窓の向こうは反対側の窓越しに明るく、上に荷棚、下に座席の背、人影 0〜2 */
function win(T, TE, t, k, j, x, w, lv) {
  const y0 = Y.win, y1 = Y.winB, q = hash32(t.h, 43, k * 16 + j);
  T(x - 1, y0 - 1, w + 2, y1 - y0 + 2, shade(BODY, 0.45)); // 窓枠のゴム
  const F = lv >= 0 ? TE : T, inner = lv >= 0 ? LIT : mix(GLASS, SEEN, 0.55);
  F(x, y0, w, y1 - y0, inner);
  F(x, y0, w, 7, lv >= 0 ? mix(LIT, CEIL, 0.25) : CEIL);                     // 天井・荷棚
  F(x, y1 - 10, w, 10, lv >= 0 ? mix(LIT, SEAT, 0.45) : shade(SEAT, 0.2));   // 座席の背
  // 人影（座った人の頭と肩 / 立っている人）。位置は h のハッシュ（くり返さない）
  const hc = lv >= 0 ? HEAD_N : mix(HEAD, inner, 0.3);
  const person = (px, y) => { // 頭（角を落とす）と、なで肩の上半身。y は頭のてっぺん
    F(px + 2, y, 5, 1, hc); F(px + 1, y + 1, 7, 6, hc); F(px + 2, y + 7, 5, 1, hc);
    F(px, y + 8, 9, 1, hc); F(px - 1, y + 9, 11, y1 - y - 9, hc);
  };
  for (let n = 0; n < (q & 3) && n < 2; n++) {
    const px = x + 2 + Math.floor(((q >>> (4 + n * 7)) & 127) / 128 * Math.max(1, w - 13)), stand = (q >>> (18 + n)) & 1;
    person(px, stand ? y0 + 8 : y1 - 24);
  }
  if (lv < 0) { T(x, y0 + 7, w, 1, tint(inner, 0.3)); T(x + w - 5, y0 + 8, 2, y1 - y0 - 18, tint(inner, 0.18)); } // 昼のガラスの映り
}

/* 両開きの扉: 戸袋の縁、合わせ目をはさんで1枚に見える扉の窓（2枚の窓の間隔 21 が移動量の帯に入るため）、扉の合わせ目 */
function door(T, TE, x, lv) {
  const y0 = Y.door, hw = DW >> 1;
  T(x - 1, y0 - 1, DW + 2, SH - y0 + 1, EDGE);
  T(x, y0, DW, SH - y0, DOOR);
  T(x, y0, DW, 1, tint(DOOR, 0.3));
  const wx = x + 7, wy = Y.dWin[0], w = DW - 14, h = Y.dWin[1] - Y.dWin[0];
  T(wx - 1, wy - 1, w + 2, h + 2, shade(BODY, 0.45));
  if (lv >= 0) { TE(wx, wy, w, h, LIT); TE(wx, wy, w, 6, mix(LIT, CEIL, 0.25)); }
  else { T(wx, wy, w, h, mix(GLASS, SEEN, 0.5)); T(wx, wy, w, 6, CEIL); T(wx, wy + 6, w, 1, tint(SEEN, 0.2)); }
  T(x + hw - 1, y0, 2, SH - y0, shade(DOOR, 0.3));                 // 合わせ目（扉の窓の上も通す）
  T(x, Y.band, DW, Y.bandB - Y.band - 1, mix(DOOR, BAND, 0.25));   // 扉の帯は薄く
}

/* 乗務員室: 前面側の区画に運転台の側窓と手すり（扉の割りの都合で乗務員扉は描かない）。e は前面の x、dir は外向き（−1 = 左） */
function cab(T, TE, e, dir, lv) {
  const wx = dir < 0 ? e + 16 : e - 16 - 15;
  T(wx - 1, Y.win - 1, 17, 34, shade(BODY, 0.45));
  if (lv >= 0) TE(wx, Y.win, 15, 32, mix(LIT, CEIL, 0.5)); else { T(wx, Y.win, 15, 32, mix(GLASS, SEEN, 0.3)); T(wx, Y.win, 15, 6, CEIL); }
  T(dir < 0 ? e + 6 : e - 10, Y.win + 40, 4, 20, shade(BODY, 0.2)); // 乗務員室の手すり
}

/* 前面（先頭の左端・最後尾の右端）: 傾いた前面ガラスの縁、前照灯か尾灯。e は車端の x、dir は外向き（裾とスカートは窓の下の外） */
function front(T, TE, g, e, dir) {
  const lean = y => y < Y.lean ? Math.round((Y.lean - y) / 2) : 0;
  // 前面ガラス（斜めから見えるぶん、縁に沿って幅 5）と、その下の前面の縁
  for (let y = 0; y < SH; y++) {
    const xe = dir < 0 ? e + lean(y) : e - lean(y) - 1;
    if (y >= Y.top && y < Y.glass) T(dir < 0 ? xe : xe - 4, y, 5, 1, y < Y.top + 6 ? '#5a6268' : '#1f262c');
    else T(xe, y, 1, 1, EDGE);
  }
  // 灯り（前照灯は白、尾灯は赤。昼も灯す）
  const lx = dir < 0 ? e : e - 7, [ly0, ly1] = Y.lamp;
  T(lx - (dir < 0 ? 0 : 1), ly0 - 1, 8, ly1 - ly0 + 2, '#2a2d30');
  TE(lx, ly0, 7, ly1 - ly0, dir < 0 ? HEADLIGHT : TAIL);
  // 夜: 灯りのにじみ（外側へ）
  const tn = toneNow(), n = tn ? tn.lit : 0;
  if (n > 0) {
    const a = g.globalAlpha, ox = dir < 0 ? lx - 13 : lx + 7;
    g.globalAlpha = a * 0.35 * n; TE(ox, ly0 - 3, 13, ly1 - ly0 + 6, dir < 0 ? HEADLIGHT : TAIL);
    g.globalAlpha = a * 0.18 * n; TE(dir < 0 ? ox - 13 : ox + 13, ly0 - 5, 13, ly1 - ly0 + 10, dir < 0 ? HEADLIGHT : TAIL);
    g.globalAlpha = a;
  }
}
