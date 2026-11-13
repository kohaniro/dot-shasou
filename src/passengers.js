import { state } from './state.js';
import { hash32, rng, ri, pick } from './rng.js';
import { R, shade, tint } from './palette.js';
import { world } from './world.js';
import { stationAt } from './stations.js';
import { timeline } from './journey.js';

/* ---------- 乗客（座っている人と、通路を歩く立ち姿。標準解像度の寸法で直接描く） ---------- */
/* 決まり: 乗客の描画はすべて PR() を通す（R() を直接呼ばない）。PR を通せばシルエット表示（state.passMode === 'sil'）に自動で対応する */
const SIL = '#23262d';
const PR = (g, x, y, w, h, c) => R(g, x, y, w, h, state.passMode === 'sil' ? SIL : c);
const SKIN = ['#f0c9a4', '#e3b58f', '#d9a37c', '#f4d3b5'];
const HAIR = ['#2a2622', '#3a2e28', '#4b3a2f', '#1f2228', '#6b5a4a', '#8a8a8a'];
const HAIR_OLD = ['#dad8d1', '#b9b8b4', '#96969a', '#ebe9e3'];
const TOPS = ['#e8e6e0', '#2f3a4f', '#6b7f99', '#8a4a44', '#4f6b55', '#c9b79a', '#3d3d42', '#b8c4d0', '#d9c26a', '#7a5f8a'];
const KID_TOPS = ['#d9c26a', '#d86a5a', '#5a9ad0', '#e8e6e0', '#6fae7a', '#e58a3c'];
const BOTTOMS = ['#2b3040', '#3f4654', '#5a5248', '#22252b', '#6f6a5c', '#34465e'];
const BOOKS = ['#8a4a44', '#3f6f8f', '#4f6b55', '#c9a24a', '#e8e4d8'];
const SHOES = ['#22252b', '#3a2e28', '#e8e6e0', '#5a5248', '#8a4a44'];
const PAGE = '#f1eee4', EYE = '#2a2622';

/* いま座っている人の配列（席の順）。drawPassengers() が毎フレーム入れ直す。歩いている途中の人は含まない */
export let passengers = [];
/* 席 k（0〜6）の中心の画面 x */
export const seatX = k => Math.round(46 + (k + 0.5) * 228 / 7);

/* 乱数 r から人物1人ぶんの属性を作る（席の位置は含まない）
   kind  'adult' | 'child' | 'elder'
   体格  sy: 肩の y（座高。小さいほど高い） / sw: 胴の半幅 / aw: 腕の太さ / belly: 胴まわり 0〜2 / tw: 腿の太さ / hw: 頭の半幅 / hh: 頭の高さ
   姿勢  torso: 'up' | 'back'（寄りかかる）| 'fwd'（前かがみ） / tilt: 体の傾き（肩でのドット数、符号つき） / legs: 'normal' | 'together' | 'open' | 'cross' | 'dangle'
         side: 組む脚・片手持ちの向き（±1） / arms: 'cross' | 'lap'（居眠り・何もしないときの腕）
   しぐさ pose: 'phone' | 'book' | 'sleep' | 'idle' / hold: 持つ高さ 'lap' | 'chest' | 'face' / hand: スマホを持つ手 0（両手）| ±1（片手）
   見た目 skin hair hs（0 短髪 1 ロング 2 ボブ 3 帽子 4 薄い） cap top bottom book shoe mask collar bag look phase */
export function makePerson(r) {
  const a = r(), kind = a < 0.1 ? 'child' : a < 0.25 ? 'elder' : 'adult', child = kind === 'child', elder = kind === 'elder';
  const p = {
    kind, skin: pick(r, SKIN), hair: pick(r, elder ? HAIR_OLD : HAIR), hs: ri(r, 0, 3), cap: pick(r, TOPS), top: pick(r, child ? KID_TOPS : TOPS),
    bottom: pick(r, BOTTOMS), book: pick(r, BOOKS), shoe: pick(r, SHOES), phase: r() * 20, look: ri(r, -1, 1), mask: r() < 0.2, collar: r() < 0.4, bag: r() < 0.5,
    side: r() < 0.5 ? -1 : 1, tilt: 0, torso: 'up', legs: 'normal', arms: r() < 0.5 ? 'cross' : 'lap', hold: 'chest', hand: 0
  };
  // 体格
  const b1 = r(), b2 = r(), b3 = r(), b4 = r();
  if (child) { p.sy = 109 + Math.floor(b1 * 5); p.sw = b2 < 0.5 ? 6 : 7; p.aw = 2; p.belly = 1; p.tw = 6; p.hw = 4; p.hh = 11; p.collar = false; }
  else if (elder) {
    p.sy = 101 + Math.floor(b1 * 4); p.sw = b2 < 0.55 ? 8 : 9; p.aw = 3; p.belly = b3 < 0.6 ? 0 : 1; p.tw = 8; p.hw = 5; p.hh = 12;
    if (p.hs === 1) p.hs = b4 < 0.5 ? 4 : 2;
  } else {
    p.sy = 96 + Math.floor(b1 * 7); p.sw = b2 < 0.2 ? 8 : b2 < 0.5 ? 9 : b2 < 0.8 ? 10 : 11;
    p.belly = Math.min(b3 < 0.5 ? 0 : b3 < 0.8 ? 1 : 2, 12 - p.sw);
    p.aw = p.sw >= 10 && p.sw + p.belly <= 11 && b4 < 0.5 ? 4 : 3; p.tw = 8 + (p.sw >= 10 ? 1 : 0) + (p.belly === 2 ? 1 : 0);
    const hv = (b4 * 7) % 1;
    p.hw = p.sw <= 9 && hv < 0.3 ? 4 : p.sw >= 10 && hv < 0.22 ? 6 : 5;
    p.hh = (p.hw === 4 ? 11 : p.hw === 5 ? 12 : 13) + (((b3 * 5) % 1) < 0.5 ? 1 : 0);
  }
  // しぐさと姿勢
  const q = r(), q1 = r(), q2 = r(), q3 = r();
  const cut = child ? [0.25, 0.45, 0.55] : elder ? [0.12, 0.42, 0.62] : [0.42, 0.6, 0.73];
  p.pose = q < cut[0] ? 'phone' : q < cut[1] ? 'sleep' : q < cut[2] ? 'book' : 'idle';
  if (p.pose === 'sleep') {
    if (q1 < 0.42) p.tilt = p.side * (q2 < 0.5 ? 2 : 3); else if (q1 < 0.72) p.torso = 'back';
  } else if (p.pose === 'idle') {
    p.torso = q1 < 0.5 ? 'up' : q1 < 0.8 ? 'back' : 'fwd';
    if (p.torso === 'up' && q2 < 0.15) p.tilt = p.side;
  } else {
    p.hold = q1 < 0.32 ? 'lap' : q1 < 0.8 ? 'chest' : 'face';
    if (p.hold === 'lap' && q2 < 0.45) p.torso = 'fwd'; else if (p.hold !== 'lap' && q2 < 0.3) p.torso = 'back';
    if (p.pose === 'phone' && p.torso !== 'fwd' && q3 < 0.4) p.hand = p.side;
  }
  if (elder && p.torso === 'back' && p.pose !== 'sleep') p.torso = 'up';
  const l = r();
  if (child) p.legs = 'dangle';
  else if (elder) p.legs = l < 0.55 ? 'together' : 'normal';
  else if (p.torso === 'fwd') p.legs = l < 0.5 ? 'open' : 'normal';
  else p.legs = l < 0.27 ? 'together' : l < 0.54 ? 'normal' : l < (p.sw >= 10 ? 0.8 : 0.68) ? 'open' : 'cross';
  return p;
}

/* ---------- 顔ぶれ: 席 s・区間 n の人（または空席）は、シードと s と n だけで決まる ----------
   区間 n = 駅 n を出てから駅 n+1 に着くまで（区間 0 は出発から駅 1 まで）。
   区間 0: 各席 0.6 の確率で着席（3人未満なら作り直す）。
   駅 k（区間 k-1 → k）: 席ごとに rng(hash32(seed, SWAP_SALT, k*8+s)) で、座っている人は P_OFF で降り、
   空席には 0.32 + 0.38×city で新しい人が乗る（人が降りた席はその駅では空席のまま）。
   0 から順にたどるので結果をキャッシュする。シードが変わったら捨てる */
const SEATS = 7, SWAP_SALT = 78, P_OFF = 0.3;
const WALK_V = 21, WALK_MAX = 1.6;        // 歩く速さ（ドット/秒）と、間に合わないときの倍率の上限
const GAPS = [0.9, 0.75, 0.6, 0.45, 0.35]; // 人ごとにずらす間隔（秒）。間に合わなければ順に詰める
const EDGE_L = -16, EDGE_R = 336;         // ここまで出たら消える / ここから入ってくる
const T_STAND = 0.6, T_SIT = 0.3;         // tl.open からこの秒数で立ち始め、tl.close のこの秒数前までに座り終える
let cacheSeed = null, rosters = [], seatedLists = [], swaps = new Map();
function resetCache() { cacheSeed = state.seed; rosters = []; seatedLists = []; swaps = new Map(); }
const seat = (p, s) => { p.cx = seatX(s); p.seat = s; return p; };

/* 区間 n の顔ぶれ: 長さ 7 の配列（人 or null） */
export function rosterAt(n) {
  if (cacheSeed !== state.seed) resetCache();
  n = Math.max(0, Math.floor(n));
  while (rosters.length <= n) {
    const k = rosters.length; let ros;
    if (k === 0) {
      for (let salt = 0; salt < 8; salt++) {
        const r = rng(hash32(state.seed, 77, salt)); ros = []; let cnt = 0;
        for (let s = 0; s < SEATS; s++) { if (r() > 0.6) { ros.push(null); continue; } ros.push(seat(makePerson(r), s)); cnt++; }
        if (cnt >= 3) break;
      }
    } else {
      const prev = rosters[k - 1], pOn = 0.32 + 0.38 * world(stationAt(k).pos).city; ros = [];
      for (let s = 0; s < SEATS; s++) {
        const r = rng(hash32(state.seed, SWAP_SALT, k * 8 + s));
        if (prev[s]) ros.push(r() < P_OFF ? null : prev[s]);
        else ros.push(r() < pOn ? seat(makePerson(r), s) : null);
      }
    }
    rosters.push(ros);
  }
  return rosters[n];
}
function seatedAt(n) { n = Math.max(0, n); return seatedLists[n] || (seatedLists[n] = rosterAt(n).filter(Boolean)); }

/* 駅 k での入れ替えの予定（stopT の関数として引けるよう、開始・終了の時刻を先に決めておく）。
   moves: { p, seat, off（降りる人か）, dir（歩く向き ±1）, x0（歩き始めの x）, start, end, v（ドット/秒）, m（歩調の倍率） }
   降りる人: tl.open + T_STAND から、端に近い席の順に gap ずつずらして立つ。
   乗る人: 同じ側の降りる人が出終わってから（早くても tl.opened）、遠い席の順に gap ずつずらして入る。
   全員が tl.close - T_SIT までに座れるよう、gap を詰め → 速さを WALK_MAX 倍まで上げ → それでも遅れる人は歩き始めを前倒しする */
export function swapAt(k) {
  if (cacheSeed !== state.seed) resetCache();
  let sw = swaps.get(k); if (sw) return sw;
  const prev = rosterAt(k - 1), next = rosterAt(k), st = stationAt(k), tl = timeline(st);
  const off = [], on = [];
  for (let s = 0; s < SEATS; s++) { if (prev[s] && !next[s]) off.push(s); if (!prev[s] && next[s]) on.push(s); }
  const t0 = tl.open + T_STAND, dead = tl.close - T_SIT;
  const plan = (gap, m, force) => {
    const v = WALK_V * m, moves = []; let ok = true;
    for (const side of [-1, 1]) {
      const edge = side < 0 ? EDGE_L : EDGE_R, dist = s => Math.abs(edge - seatX(s)), mine = s => (seatX(s) < 160 ? -1 : 1) === side;
      let clear = tl.opened;
      off.filter(mine).sort((a, b) => dist(a) - dist(b)).forEach((s, i) => {
        const start = t0 + i * gap, end = start + dist(s) / v; clear = Math.max(clear, end);
        moves.push({ p: prev[s], seat: s, off: true, dir: side, x0: seatX(s), start, end, v, m });
      });
      on.filter(mine).sort((a, b) => dist(b) - dist(a)).forEach((s, j) => {
        const dur = dist(s) / v; let start = clear + j * gap;
        if (start + dur > dead) { if (force) start = Math.max(t0, dead - dur); else ok = false; }
        moves.push({ p: next[s], seat: s, off: false, dir: -side, x0: edge, start, end: start + dur, v, m });
      });
    }
    return ok ? { moves, gap, m, forced: !!force } : null;
  };
  let res = null;
  for (const g of GAPS) if ((res = plan(g, 1))) break;
  const gMin = GAPS[GAPS.length - 1];
  for (let i = 1; !res && i <= 6; i++) res = plan(gMin, Math.min(WALK_MAX, 1 + i * 0.1));
  if (!res) res = plan(gMin, WALK_MAX, true);
  sw = { k, off, on, stay: prev.filter((p, s) => p && next[s]), tl, ...res };
  swaps.set(k, sw);
  return sw;
}

/* キャッシュを捨てて作り直す（路線の切り替え時に ui.js の setSeed() が呼ぶ） */
export function genPassengers() {
  resetCache();
  passengers = seatedAt(0);
}

/* 太さ w の斜めの棒（腕・脚）。端点は整数で渡す */
function limb(g, x0, y0, x1, y1, w, c) {
  const dx = x1 - x0, dy = y1 - y0, h = w >> 1;
  if (Math.abs(dy) >= Math.abs(dx)) { const n = Math.abs(dy), s = dy < 0 ? -1 : 1; for (let i = 0; i <= n; i++) PR(g, Math.round(x0 + (n ? dx * i / n : 0)) - h, y0 + s * i, w, 1, c); }
  else { const n = Math.abs(dx), s = dx < 0 ? -1 : 1; for (let i = 0; i <= n; i++) PR(g, x0 + s * i, Math.round(y0 + dy * i / n) - h, 1, w, c); }
}

/* 正面の頭。m.bow: うつむき（-1 あおむけ 〜 3 深くうつむく） m.sh: 傾き（上半分を横へ1ドット） m.closed: 目を閉じる */
function headFront(g, p, hx, hy, tt, m) {
  const hw = p.hw, hh = p.hh, sk = p.skin, sks = shade(sk, 0.2), hair = p.hair, bow = m.bow, mid = hh >> 1;
  const H = (x, y, w, h, c) => {
    if (!m.sh) return PR(g, hx + x, hy + y, w, h, c);
    const up = Math.min(h, mid - y);
    if (up > 0) PR(g, hx + x + m.sh, hy + y, w, up, c);
    if (h > up) PR(g, hx + x, hy + Math.max(y, mid), w, h - Math.max(up, 0), c);
  };
  H(-hw + 1, 0, 2 * hw - 1, hh - 1, sk); H(-hw, 2, 2 * hw + 1, hh - 5, sk); H(-hw + 2, hh - 1, 2 * hw - 3, 1, sk); H(hw - 1, 4, 1, hh - 7, sks);
  const f = 3 + bow; // 前髪・つばの下端までの行数
  if (p.hs === 3) {                                                             // 帽子
    const c = p.cap; H(-hw + 1, -1, 2 * hw - 1, 2, c); H(-hw, 1, 2 * hw + 1, f, c); H(-hw - 1, 1 + f, 2 * hw + 3, 1, shade(c, 0.3));
    H(-hw, 2 + f, 1, 2, hair); H(hw, 2 + f, 1, 2, hair);
  } else if (p.hs === 4) {                                                      // 薄い髪（両脇だけ）
    H(-hw, 1, 2, 4 + bow, hair); H(hw - 1, 1, 2, 4 + bow, hair); H(-hw + 2, 0, 2 * hw - 3, 1, tint(sk, 0.25));
    if (bow > 1) H(-hw + 1, -1, 2 * hw - 1, 1, sk);
  } else {
    H(-hw + 1, -1, 2 * hw - 1, 3, hair); H(-hw, 1, 2 * hw + 1, f, hair); H(-hw, 1 + f, 1, 3, hair); H(hw, 1 + f, 1, 3, hair);
    if (p.hs === 0 && bow < 2) H(-hw + 1, 1 + f, 3, 1, hair); else H(-hw + 1, 1 + f, 2 * hw - 1, 1, hair);
    if (p.hs === 1) { H(-hw - 1, 2, 2, hh + 1, hair); H(hw, 2, 2, hh + 1, hair); }
    if (p.hs === 2) { H(-hw - 1, 2, 2, hh - 4, hair); H(hw, 2, 2, hh - 4, hair); }
  }
  const er = Math.round(hh * 0.54) + Math.max(-1, Math.min(bow, 2)), ew = hw <= 4 ? 1 : 2, exl = hw <= 4 ? -2 : -(hw - 2), exr = hw <= 4 ? 2 : hw - 3;
  if (m.closed) { H(exl, er, ew, 1, sks); H(exr, er, ew, 1, sks); }
  else { const blink = (tt % 4.3) < 0.12, ec = blink ? sks : EYE, lk = hw <= 4 ? 0 : p.look; H(exl + lk, er, ew, 1, ec); H(exr + lk, er, ew, 1, ec); }
  const mw = hw <= 4 ? 1 : 3;
  if (p.mask) { H(-hw + 1, hh - 4, 2 * hw - 1, 3, '#eef1f1'); H(-hw, hh - 4, 1, 1, '#eef1f1'); H(hw, hh - 4, 1, 1, '#eef1f1'); }
  else if (m.closed && bow < 0) H(-1, hh - 4, 2, 2, '#7a4a44');                  // あおむけの居眠り: 口が開く
  else if (bow < 2) H(-(mw >> 1), hh - 3, mw, 1, sks);
}

function drawSeated(g, p, t) {
  const cx = p.cx, child = p.kind === 'child', elder = p.kind === 'elder';
  const T = p.top, Ts = shade(T, 0.22), Th = tint(T, 0.2), B = p.bottom, Bs = shade(B, 0.18), Bh = tint(B, 0.15), sk = p.skin, sks = shade(sk, 0.2);
  const tt = t + p.phase, pose = p.pose, hold = p.hold, fwd = p.torso === 'fwd', back = p.torso === 'back';
  const lapY = child ? 135 : 133, aw = p.aw, tw = p.tw, hh = p.hh;
  const sy = p.sy + (fwd ? 4 : back ? 2 : 0), sw = p.sw + (fwd ? 1 : 0), round = elder || fwd;
  const ox = y => Math.round(p.tilt * (lapY - y) / (lapY - p.sy));               // 傾き: 腰で 0、肩で tilt
  const cAt = y => cx + ox(y);
  const hand = h => child ? PR(g, h[0] - 1, h[1] - 1, 2, 3, sk) : PR(g, h[0] - 1, h[1] - 1, 3, 4, sk);

  // 首と胴
  PR(g, cAt(sy) - (child ? 1 : 2), sy - 3, child ? 3 : 5, 4, sks);
  for (let y = sy; y <= lapY; y++) {
    const f = (y - sy) / (lapY - sy), o = ox(y);
    let w = y === sy ? sw - (round ? 3 : 2) : y === sy + 1 && round ? sw - 1 : sw;
    if (f > 0.45) w += p.belly - 1;
    PR(g, cx + o - w, y, 2 * w + 1, 1, T); if (y > sy) PR(g, cx + o + w - 2, y, 3, 1, Ts);
  }
  if (p.collar && !fwd) { const c = cAt(sy); PR(g, c - 4, sy, 3, 2, Th); PR(g, c + 2, sy, 3, 2, Th); }

  // 脚（ひざから先は画面の下へ）
  let lx = p.legs === 'open' ? 15 - (tw >> 1) : p.legs === 'together' ? 5 : 7;
  if (child) {                                                                   // 足が床に届かない
    lx = 4; const sw1 = pose !== 'sleep' ? Math.round(Math.sin(tt * 1.3) * 0.8) : 0;
    for (const s of [-1, 1]) {
      const x0 = cx + s * lx - 3, n = 5 + s * sw1;
      PR(g, x0, lapY, 6, 4, B); PR(g, x0, lapY, 6, 1, Bh); PR(g, x0 + 1, lapY + 4, 4, n, sks); PR(g, x0 + 1, lapY + 4 + n - 2, 4, 2, '#e8e6e0'); PR(g, x0, lapY + 4 + n, 6, 3, p.shoe);
    }
  } else if (p.legs === 'cross') {                                               // 足を組む: side の側へ上の脚が渡る
    const s = p.side, kx = cx + s * 4, x0 = kx - (tw >> 1), a = cx - s * (sw - 1), b = cx + s * (sw + 2), xl = Math.min(a, b), wd = Math.abs(b - a) + 1;
    lx = 6;
    PR(g, x0, lapY, tw, 9, B); PR(g, x0 + 1, lapY + 9, tw - 2, 150 - lapY - 9, Bs);
    PR(g, s > 0 ? b - tw + 3 : b, lapY + 3, tw - 2, 150 - lapY - 3, Bs);        // 上の脚のふくらはぎ
    PR(g, xl, lapY - 4, wd, 8, B); PR(g, xl, lapY - 4, wd, 1, Bh); PR(g, xl + 1, lapY + 3, wd - 2, 1, Bs); PR(g, b + s, lapY - 3, 1, 6, B);
  } else {
    const ky = lapY + (back ? 1 : 0), kh = back ? 10 : 9;
    if (p.legs === 'open') PR(g, cx - lx, lapY - 1, 2 * lx + 1, 4, Bs);
    for (const s of [-1, 1]) {
      const x0 = s < 0 ? cx - lx - (tw >> 1) : cx + lx - ((tw - 1) >> 1);
      PR(g, x0, ky, tw, kh, B); PR(g, x0, ky, tw, 1, Bh); PR(g, x0 + 1, ky + kh, tw - 2, 150 - ky - kh, Bs);
    }
  }

  // 腕: 肩 → ひじ → 手
  const armL = Math.round((lapY - p.sy) * 0.58), ey = Math.min(sy + armL, lapY - 3), sh = sy + 1;
  const axL = -(sw + 2), axR = sw + 1 + (aw >> 1);
  let eL = [cAt(ey) + axL, ey], eR = [cAt(ey) + axR, ey], hL = null, hR = null;
  if (fwd) { eL = [cx - lx - 1, lapY - 2]; eR = [cx + lx + 1, lapY - 2]; }       // ひじを膝に置く
  const arms = () => {
    limb(g, cAt(sh) + axL, sh, eL[0], eL[1], aw, Ts); limb(g, cAt(sh) + axR, sh, eR[0], eR[1], aw, Ts);
    if (hL) limb(g, eL[0], eL[1], hL[0], hL[1], aw, Ts); if (hR) limb(g, eR[0], eR[1], hR[0], hR[1], aw, Ts);
  };
  const rest = s => [cx + s * lx, lapY - (p.legs === 'cross' ? 5 : 1)];          // 膝に置いた手
  const folded = () => {                                                         // 腕組み
    const c = cAt(ey); arms();
    PR(g, c - sw - 2, ey - 3, 2 * sw + 5, 6, Ts); PR(g, c - sw, ey - 3, 2 * sw + 1, 1, T); PR(g, c + sw - 3, ey - 1, 3, 3, sk); PR(g, c - sw, ey, 3, 3, sk);
  };
  let bow = 0, dy = 0, closed = false;
  if (pose === 'phone') {
    const ph = hold === 'lap' ? 6 : 8, py = hold === 'face' ? sy + 1 : hold === 'lap' ? lapY - (fwd ? 13 : 10) : sy + 12, hy_ = py + ph - 3;
    const px = cAt(py + 4) - 2 + p.hand * 2;
    if (hold === 'face') { eL[0] += 1; eR[0] -= 1; }
    hL = p.hand > 0 ? rest(-1) : [px - 1, hy_]; hR = p.hand < 0 ? rest(1) : [px + 5, hy_];
    arms();
    PR(g, px, py, 5, ph, '#2a2d33'); PR(g, px, py, 5, 1, '#4a4f58');
    hand(hL); hand(hR);
    PR(g, p.hand < 0 ? px + 1 : px + 3, hy_ - 2 + (Math.floor(tt * 2.5) % 3 === 0 ? 1 : 0), 1, 1, sk);   // 親指
    bow = hold === 'lap' ? 2 : hold === 'chest' ? 1 : 0; dy = bow;
  } else if (pose === 'book') {
    const bh = hold === 'lap' ? 7 : 9, by = hold === 'face' ? sy + 2 : hold === 'lap' ? lapY - (fwd ? 12 : 9) : sy + 13, bw = Math.min(8, sw - 1), c = cAt(by + 4);
    if (hold === 'face') { eL[0] += 1; eR[0] -= 1; }
    hL = [c - bw, by + bh - 4]; hR = [c + bw, by + bh - 4];
    arms();
    PR(g, c - bw, by, 2 * bw + 1, bh, p.book); PR(g, c, by, 1, bh, shade(p.book, 0.3)); PR(g, c - bw + 1, by - 1, 2 * bw - 1, 1, PAGE);
    if ((tt % 9) < 0.35) PR(g, c + 2, by - 3, 4, 2, PAGE);                       // ページをめくる
    PR(g, c - bw - 1, by + bh - 5, 2, 4, sk); PR(g, c + bw, by + bh - 5, 2, 4, sk);
    bow = hold === 'lap' ? 2 : hold === 'chest' ? 1 : 0; dy = bow;
  } else if (pose === 'sleep') {
    if (p.arms === 'cross' && !child) folded();
    else { hL = [cx - 3, lapY - 2]; hR = [cx + 2, lapY - 1]; arms(); hand(hL); hand(hR); }
    closed = true;
    if (p.tilt) { bow = 1; dy = 2; } else if (back) bow = -1; else { bow = 3; dy = 3; }
    if (!back && Math.sin(tt * 0.8) > 0.5) dy++;                                 // こっくり
  } else {
    if (p.bag && !fwd) {
      const bc = shade(p.cap, 0.35), bw = child ? 6 : 8;
      hL = [cx - bw + 2, lapY - 9]; hR = [cx + bw - 2, lapY - 9]; arms();
      PR(g, cx - bw, lapY - 10, 2 * bw + 1, 11, bc); PR(g, cx - bw, lapY - 10, 2 * bw + 1, 1, tint(bc, 0.2)); PR(g, cx - 3, lapY - 12, 7, 2, shade(bc, 0.2));
      hand(hL); hand(hR);
    } else if (fwd) { hL = [cx - 1, lapY - 7]; hR = [cx + 2, lapY - 7]; arms(); PR(g, cx - 2, lapY - 9, 5, 5, sk); PR(g, cx, lapY - 9, 1, 5, sks); } // 手を組む
    else if (p.arms === 'cross' && !child && !elder) folded();
    else { hL = rest(-1); hR = rest(1); arms(); hand(hL); hand(hR); }
  }

  // 頭
  const sg = Math.sign(p.tilt), hx = cx + ox(sy - (hh >> 1)) + (pose === 'sleep' ? sg : 0);
  const hy = sy - hh - 1 + (elder ? 2 : 0) + (fwd ? 3 : 0) + dy;
  headFront(g, p, hx, hy, tt, { bow, sh: Math.abs(p.tilt) >= 2 ? sg : 0, closed });
}

export function drawPerson(g, p, t) { drawSeated(g, p, t); }

/* 通路を横向きに歩く立ち姿。x: 体の中心（腰）の画面 x、dir: -1 左へ / +1 右へ、t: 時刻（足を交互に動かす）
   縮尺は座っている人と同じ。床は y=162（画面の外）で、大人の頭頂は y 54〜70、子どもは 96〜106 */
const WFLOOR = 162;
export function drawWalker(g, p, x, t, dir) {
  const child = p.kind === 'child', elder = p.kind === 'elder', d = dir < 0 ? -1 : 1, x0 = Math.round(x);
  const T = p.top, Ts = shade(T, 0.22), Tf = shade(T, 0.4), B = p.bottom, Bh = tint(B, 0.15), Bf = shade(B, 0.32), sk = p.skin, sks = shade(sk, 0.2), hair = p.hair;
  const hw = p.hw, hh = p.hh, aw = p.aw;
  const H = child ? 66 - (p.sy - 109) * 2 : 100 + (99 - p.sy) * 2, leg = Math.round(H * (child ? 0.42 : 0.47));
  const ph = t * (child ? 7.4 : elder ? 4.4 : 5.4) + p.phase, s = Math.sin(ph), c = Math.cos(ph), A = child ? 3 : elder ? 4 : 6;
  const bob = Math.abs(s) < 0.45 ? -1 : 0, hip = WFLOOR - leg + bob, top = WFLOOR - H + bob + (elder ? 3 : 0), shY = top + hh + 1, knee = hip + (leg >> 1);
  const lean = elder ? 4 : 1;                                                    // 肩が腰より前へ出る量
  const bx = y => x0 + d * Math.round(lean * (hip - y) / (hip - shY));           // 体の中心線
  const td = child ? 8 : 11 + p.belly + (p.sw >= 10 ? 1 : 0) + (p.sw >= 11 ? 1 : 0), tb = td >> 1, tf = td - tb - 1, lw = child ? 5 : p.tw;
  const span = (xa, xb, y, h, col) => PR(g, Math.min(xa, xb), y, Math.abs(xb - xa) + 1, h, col);
  const legDraw = (sn, cs, col, colH) => {
    const lift = Math.max(0, cs), kx = x0 + d * Math.round(A * sn + lift * 2), fx = x0 + d * Math.round(A * 2.1 * sn - lift * A * 0.8), fy = WFLOOR - Math.round(lift * 3);
    limb(g, x0, hip, kx, knee, lw, col); limb(g, kx, knee, fx, fy - 3, Math.max(3, lw - 2), col);
    if (colH) limb(g, x0 + d * (lw >> 1), hip + 3, kx + d * (lw >> 1), knee, 1, colH);
    PR(g, d > 0 ? fx - 2 : fx - 5, fy - 3, 8, 3, p.shoe);
  };
  const armDraw = (sn, col, bag) => {
    const sx = bx(shY + 2), sy2 = shY + 2, la = Math.round((hip - shY) * 0.95), hxp = sx + d * Math.round(A * (bag ? 0.25 : 0.9) * sn), hyp = sy2 + la - Math.round(Math.abs(sn));
    const exx = Math.round((sx + hxp) / 2) - d * (bag ? 0 : 1), eyy = sy2 + (la >> 1);
    limb(g, sx, sy2, exx, eyy, aw + 1, col); limb(g, exx, eyy, hxp, hyp, aw, col);
    PR(g, hxp - 1, hyp, child ? 2 : 3, 3, sk);
    if (bag) { const bc = shade(p.cap, 0.35), bw = child ? 9 : 13; PR(g, hxp - (bw >> 1), hyp + 4, bw, 9, bc); PR(g, hxp - (bw >> 1), hyp + 4, bw, 1, tint(bc, 0.2)); PR(g, hxp - 2, hyp + 2, 1, 2, bc); PR(g, hxp + 2, hyp + 2, 1, 2, bc); }
  };
  armDraw(s, Tf, false);                                                         // 奥の腕・脚
  legDraw(-s, -c, Bf, null);
  // 首と胴
  const hxc = bx(shY) + d * (elder ? 2 : 1);
  span(hxc - d * 2, hxc + d * 1, shY - 3, 4, sks);
  for (let y = shY; y <= hip + 2; y++) {
    const f = (y - shY) / (hip - shY), cxr = bx(Math.min(y, hip));
    let b = tb + (elder && f < 0.35 && y > shY ? 1 : 0), fr = tf + (f > 0.45 && f < 0.95 ? p.belly : 0);
    if (y === shY) { b--; fr--; }
    const col = y >= hip - 1 ? B : T;
    span(cxr - d * b, cxr + d * fr, y, 1, col); if (col === T && y > shY) span(cxr - d * b, cxr - d * (b - 1), y, 1, Ts);
  }
  legDraw(s, c, B, Bh);                                                          // 手前の脚・腕
  armDraw(-s, Ts, p.bag);
  // 頭（横顔）
  const hy = top + (elder ? 1 : 0);
  const W = (u, y, w, h, col) => PR(g, d > 0 ? hxc + u : hxc - u - w + 1, hy + y, w, h, col);
  W(-hw + 1, 0, 2 * hw - 1, hh - 1, sk); W(-hw + 3, hh - 1, 2 * hw - 4, 1, sk); W(hw, Math.round(hh * 0.54), 1, 2, sk);
  const er = Math.round(hh * 0.54) - 1;
  W(-1, er, 2, 3, sks);                                                          // 耳
  if (p.hs === 3) { const cc = p.cap; W(-hw, -1, 2 * hw, 4, cc); W(hw - 2, 3, 5, 1, shade(cc, 0.3)); W(-hw, 3, 3, 3, hair); }
  else if (p.hs === 4) { W(-hw, 1, 3, 6, hair); W(-hw + 2, 0, 2 * hw - 3, 1, tint(sk, 0.25)); }
  else {
    W(-hw + 1, -1, 2 * hw - 2, 2, hair); W(-hw, 1, 2 * hw, 2, hair); W(-hw, 3, hw - 1, 3, hair); W(-hw, 6, 2, hh - 9, hair);
    if (p.hs === 1) W(-hw - 1, 2, hw - 1, hh + 3, hair);
    if (p.hs === 2) W(-hw - 1, 2, hw, hh - 4, hair);
  }
  W(hw - 3, er, hw <= 4 ? 1 : 2, 1, ((t + p.phase) % 4.3) < 0.12 ? sks : EYE);
  if (p.mask) { W(hw - 4, hh - 4, 5, 3, '#eef1f1'); W(0, hh - 4, hw - 4, 1, '#eef1f1'); }
  else W(hw - 2, hh - 3, 2, 1, sks);
}

/* 乗客全員を描く。表示の切り替え（あり / シルエット / なし）はここで見る。
   停車中は state.stopT だけから入れ替えの途中の姿を決める（フレームをまたぐ状態は持たない） */
export function drawPassengers(g, t) {
  const k = state.station ? state.station.k : 1;
  let walkers = null;
  if (state.phase === 'stop') {
    const sw = swapAt(k), T = state.stopT, seated = sw.stay.slice();
    for (const mv of sw.moves) {
      if (mv.off ? T < mv.start : T >= mv.end) seated.push(mv.p);
      else if (T >= mv.start && T < mv.end) (walkers || (walkers = [])).push(mv);
    }
    passengers = seated.sort((a, b) => a.seat - b.seat);
  } else passengers = seatedAt(k - 1);
  if (state.passMode === 'off') return;
  for (const p of passengers) drawPerson(g, p, t);
  if (!walkers) return;
  const T = state.stopT, xs = new Map();
  for (const mv of walkers) xs.set(mv, mv.x0 + mv.dir * mv.v * (T - mv.start));
  walkers.sort((a, b) => xs.get(a) - xs.get(b) || a.seat - b.seat);
  // 歩調: 歩いた時間 × 速さの倍率（速く歩くぶん足も速く動かし、進んだ距離と合わせる）
  for (const mv of walkers) drawWalker(g, mv.p, xs.get(mv), (T - mv.start) * mv.m, mv.dir);
}
