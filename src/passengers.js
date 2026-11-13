import { state } from './state.js';
import { hash32, rng, ri, pick } from './rng.js';
import { R, shade, tint } from './palette.js';

/* ---------- 乗客（試し描き: 座っている人。標準解像度の寸法で直接描く） ---------- */
const SKIN = ['#f0c9a4', '#e3b58f', '#d9a37c', '#f4d3b5'];
const HAIR = ['#2a2622', '#3a2e28', '#4b3a2f', '#1f2228', '#6b5a4a', '#8a8a8a'];
const TOPS = ['#e8e6e0', '#2f3a4f', '#6b7f99', '#8a4a44', '#4f6b55', '#c9b79a', '#3d3d42', '#b8c4d0', '#d9c26a', '#7a5f8a'];
const BOTTOMS = ['#2b3040', '#3f4654', '#5a5248', '#22252b', '#6f6a5c', '#34465e'];
const BOOKS = ['#8a4a44', '#3f6f8f', '#4f6b55', '#c9a24a', '#e8e4d8'];
export let passengers = [];
export function genPassengers() {
  for (let salt = 0; salt < 8; salt++) {
    const r = rng(hash32(state.seed, 77, salt)); passengers = [];
    for (let k = 0; k < 7; k++) {
      if (r() > 0.6) continue;
      const q = r();
      passengers.push({
        cx: Math.round(46 + (k + 0.5) * 228 / 7), skin: pick(r, SKIN), hair: pick(r, HAIR), hs: ri(r, 0, 3), cap: pick(r, TOPS),
        top: pick(r, TOPS), bottom: pick(r, BOTTOMS), pose: q < 0.4 ? 'phone' : q < 0.6 ? 'sleep' : q < 0.75 ? 'book' : 'idle',
        phase: r() * 20, h: ri(r, 0, 3), lean: r() < 0.5 ? -1 : 1, look: ri(r, -1, 1), mask: r() < 0.2, collar: r() < 0.4, bag: r() < 0.5, book: pick(r, BOOKS)
      });
    }
    if (passengers.length >= 3) break;
  }
}
export function drawPerson(g, p, t) {
  const cx = p.cx, T = p.top, Ts = shade(T, 0.22), Th = tint(T, 0.2), B = p.bottom, sk = p.skin, sks = shade(sk, 0.2), hair = p.hair, tt = t + p.phase;
  const base = 85 + p.h, sy = base + 14;
  let hx = cx, hy = base, eyes = true, ey = base + 7;
  if (p.pose === 'sleep') { hy += 3 + (Math.sin(tt * 0.8) > 0.5 ? 1 : 0); hx += p.lean; eyes = false; }      // こっくり
  else if (p.pose === 'phone' || p.pose === 'book') { hy += 1; ey = hy + 8; }                                 // うつむき
  // 脚（ひざから先は画面の下へ）
  R(g, cx - 11, 133, 9, 9, B); R(g, cx + 3, 133, 9, 9, B); R(g, cx - 11, 133, 9, 1, tint(B, 0.15)); R(g, cx + 3, 133, 9, 1, tint(B, 0.15));
  R(g, cx - 10, 142, 7, 8, shade(B, 0.18)); R(g, cx + 4, 142, 7, 8, shade(B, 0.18));
  // 胴と上腕
  R(g, cx - 10, sy + 1, 21, 134 - sy, T); R(g, cx - 8, sy, 17, 1, T); R(g, cx + 8, sy + 2, 3, 132 - sy, Ts);
  R(g, cx - 13, sy + 2, 3, 19, Ts); R(g, cx + 11, sy + 2, 3, 19, Ts); R(g, cx - 12, sy + 1, 2, 1, Ts); R(g, cx + 11, sy + 1, 2, 1, Ts);
  R(g, cx - 2, base + 12, 5, 3, sks);
  if (p.collar) { R(g, cx - 4, sy, 3, 2, Th); R(g, cx + 2, sy, 3, 2, Th); }
  // しぐさ
  if (p.pose === 'phone') {
    R(g, cx - 13, 119, 11, 4, Ts); R(g, cx + 3, 119, 11, 4, Ts);
    R(g, cx - 2, 112, 5, 8, '#2a2d33'); R(g, cx - 2, 112, 5, 1, '#4a4f58');
    R(g, cx - 4, 116, 3, 4, sk); R(g, cx + 2, 116, 3, 4, sk);
    R(g, cx + 1, 115 + (Math.floor(tt * 2.5) % 3 === 0 ? 1 : 0), 1, 1, sk);   // 親指
  } else if (p.pose === 'book') {
    R(g, cx - 13, 121, 11, 4, Ts); R(g, cx + 3, 121, 11, 4, Ts);
    R(g, cx - 8, 113, 17, 9, p.book); R(g, cx, 113, 1, 9, shade(p.book, 0.3)); R(g, cx - 7, 112, 15, 1, '#f1eee4');
    if ((tt % 9) < 0.35) R(g, cx + 2, 110, 4, 2, '#f1eee4');                    // ページをめくる
    R(g, cx - 9, 117, 2, 4, sk); R(g, cx + 8, 117, 2, 4, sk);
  } else if (p.pose === 'sleep') {
    R(g, cx - 12, 117, 25, 6, Ts); R(g, cx - 10, 117, 21, 1, T); R(g, cx + 7, 119, 3, 3, sk); R(g, cx - 10, 120, 3, 3, sk); // 腕組み
  } else {
    if (p.bag) { const bc = shade(p.cap, 0.35); R(g, cx - 8, 123, 17, 11, bc); R(g, cx - 8, 123, 17, 1, tint(bc, 0.2)); R(g, cx - 3, 121, 7, 2, shade(bc, 0.2)); }
    R(g, cx - 13, sy + 21, 3, 6, Ts); R(g, cx + 11, sy + 21, 3, 6, Ts);
    R(g, cx - 11, p.bag ? 124 : 130, 4, 3, sk); R(g, cx + 8, p.bag ? 124 : 130, 4, 3, sk);
  }
  // 頭
  R(g, hx - 4, hy, 9, 12, sk); R(g, hx - 5, hy + 2, 11, 8, sk); R(g, hx - 3, hy + 12, 7, 1, sk); R(g, hx + 4, hy + 4, 1, 6, sks);
  if (p.hs === 3) {                                                             // 帽子
    const c = p.cap; R(g, hx - 4, hy - 1, 9, 2, c); R(g, hx - 5, hy + 1, 11, 3, c); R(g, hx - 6, hy + 4, 13, 1, shade(c, 0.3));
    R(g, hx - 5, hy + 5, 1, 2, hair); R(g, hx + 5, hy + 5, 1, 2, hair);
  } else {
    R(g, hx - 4, hy - 1, 9, 3, hair); R(g, hx - 5, hy + 1, 11, 3, hair); R(g, hx - 5, hy + 4, 1, 3, hair); R(g, hx + 5, hy + 4, 1, 3, hair);
    if (p.hs === 0) R(g, hx - 4, hy + 4, 3, 1, hair); else R(g, hx - 4, hy + 4, 9, 1, hair);
    if (p.hs === 1) { R(g, hx - 6, hy + 2, 2, 14, hair); R(g, hx + 5, hy + 2, 2, 14, hair); }
    if (p.hs === 2) { R(g, hx - 6, hy + 2, 2, 9, hair); R(g, hx + 5, hy + 2, 2, 9, hair); }
    if (!eyes) R(g, hx - 4, hy + 4, 9, 2, hair);
  }
  if (eyes) { const blink = (tt % 4.3) < 0.12, ec = blink ? sks : '#2a2622'; R(g, hx - 3 + p.look, ey, 2, 1, ec); R(g, hx + 2 + p.look, ey, 2, 1, ec); }
  else { R(g, hx - 3, hy + 8, 2, 1, sks); R(g, hx + 2, hy + 8, 2, 1, sks); }
  if (p.mask) { R(g, hx - 4, hy + 9, 9, 3, '#eef1f1'); R(g, hx - 5, hy + 9, 1, 1, '#eef1f1'); R(g, hx + 5, hy + 9, 1, 1, '#eef1f1'); }
  else R(g, hx - 1, hy + 10, 3, 1, sks);
}
