import { W, SH, state } from './state.js';
import { hash32, rng } from './rng.js';
import { world } from './world.js';
import { setTone, setGround } from './palette.js';
import { bakeWeather } from './weather.js';
import { lightSalt } from './lights.js';

/* チャンクを描くときのトーン（時間帯・天気の色調。tone.js が書き換える）。
   a: いま見せているトーン（Layer の cache）/ b: 次のトーン（cacheB。切り替えの準備中とクロスフェード中だけ。無ければ null） */
export const tones = { a: null, b: null };

/* ---------- chunked parallax layers ----------
   f: 視差係数
   drop: 高架（elev = 1）のとき下げるドット数（main.js の render() が描く位置をずらす。チャンクの絵は変えない）
   drift: 時間で流れる速さ（ドット/秒。雲だけ）
   air: 奥行きの区分（palette.js の AIR。トーンの色変換が、遠い層ほど空の色になじませる。scenery/index.js が入れる）
   gy / refl / cap: 天気の絵づくり用（scenery/index.js が入れる。weather.js の bakeWeather）。gy は地面の上端（これより下の矩形は、雨・雪のとき
     濡れた地面・積もった雪の色になる。0 = 地面なし）、refl は夜の濡れた地面に灯りを映す行数、cap は上の縁に雪を載せるか
   cache / cacheB: トーン a / b で描いたチャンク。chunk() / render() の b を真にすると cacheB の側を使う */
export function Layer(id, factor, cw, draw, drop = 0) { this.id = id; this.f = factor; this.cw = cw; this.draw = draw; this.drop = drop; this.drift = 0; this.air = 0; this.gy = 0; this.refl = 0; this.cap = false; this.cache = new Map(); this.cacheB = new Map(); }
Layer.prototype.chunk = function (i, b = false) {
  const m = b ? this.cacheB : this.cache;
  let c = m.get(i);
  if (!c) {
    c = document.createElement('canvas'); c.width = this.cw; c.height = SH;
    const tn = b ? tones.b : tones.a, fall = !!tn && (tn.rain > 0 || tn.snow > 0), g = c.getContext('2d');
    const prev = setTone(tn, this.air); // 景色のチャンクにはトーンをかける（描き終えたら戻す）
    if (fall) setGround(this.gy);       // 雨・雪: 地面の矩形は、濡れた色・雪の色で
    lightSalt(this.id, i);
    this.draw(g, i, rng(hash32(state.seed, this.id, i)), this);
    if (fall) { setGround(0); bakeWeather(g, this, i, tn); } // 雨・雪の仕上げ（屋根や木の上の雪、濡れた面のてり、灯りの映り込み）
    setTone(prev);
    m.set(i, c);
    if (m.size > 8) for (const k of m.keys()) if (Math.abs(k - i) > 3) m.delete(k);
  }
  return c;
};
/* top を渡すと、絵を下へずらして描くとき（oy > top）にできる上のすき間を、絵のいちばん上の行を引きのばして埋める */
Layer.prototype.render = function (g, off, oy, top, b = false) {
  const wx = Math.floor(off);
  const i0 = Math.floor(wx / this.cw), i1 = Math.floor((wx + W - 1) / this.cw);
  for (let i = i0; i <= i1; i++) {
    const c = this.chunk(i, b);
    g.drawImage(c, i * this.cw - wx, oy);
    if (oy > top) g.drawImage(c, 0, 0, this.cw, 1, i * this.cw - wx, top, this.cw, oy - top);
  }
};
/* 両方のトーンのチャンクを捨てる（シード・絵柄を替えたとき、トーンを即座に替えたとき） */
Layer.prototype.clear = function () { this.cache.clear(); this.cacheB.clear(); };
/* 走行距離 d → レイヤー通しの座標。窓の中央で全レイヤーが同じ地点を指すようにそろえる（遠景だけ先に景色が変わって見えないように） */
export const layerX = (L, d) => (d - W / 2) * L.f + W / 2;
/* state.dist = dist のときの描画のオフセット（= layerX(L, dist + W/2) − W/2） */
export const layerOff = (L, dist) => dist * L.f;
/* いまの画面の描画のオフセット（時間で流れるレイヤーはそのぶんも足す） */
export const viewOff = L => layerOff(L, state.dist) + (L.drift ? state.t * L.drift : 0);
/* レイヤー内の位置 → 走行距離（layerX の逆） */
export const distAt = (L, i, x) => (i * L.cw + x - W / 2) / L.f + W / 2;
/* その位置の world()（都市度・バイオームの重みなど） */
export const env = (L, i, x) => world(distAt(L, i, x));
