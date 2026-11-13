import { W, state } from './state.js';
import { hash32, rng } from './rng.js';
import { world } from './world.js';

/* ---------- 駅（シードから決定的に決める。描画はしない） ----------
   座標はすべて線路際（視差 1.0）の走行距離 d。画面の x 位置 sx に見えている地点は d = state.dist + sx。
   pos は「停車したときの state.dist」。そのとき窓の中央（画面 x = W/2）に見えるのは pos + W/2。
   ホームは線路際座標の [x0, x1]（x0 < pos + W/2 < x1）。電車は +x（画面の右）へ進むので、x1 側が進行方向の端。 */
const SALT = 31;              // hash32(seed, SALT, k)。景色の salt（1〜5, 10〜12, 77）と重ねない
const FIRST = [14000, 18000]; // 1駅目の pos の範囲
const GAP = [22000, 34000];   // 駅間（巡航 240 ドット/秒でおよそ2分）

/* 駅名の部品。読みは部品の組で決める（接尾の濁音形は、語幹が連濁してよいときだけ使う） */
const PRE = [['新', 'しん', 3], ['東', 'ひがし', 1], ['西', 'にし', 1], ['南', 'みなみ', 1], ['北', 'きた', 1], ['本', 'ほん', 0.4]];
// [漢字, 読み, 連濁してよいか]（読みに濁音があれば連濁しない＝ライマンの法則、は自動で判定）
const STEM = [
  ['桜', 'さくら', 1], ['緑', 'みどり', 1], ['若葉', 'わかば', 1], ['柳', 'やなぎ', 1], ['梅', 'うめ', 1], ['松', 'まつ', 0],
  ['竹', 'たけ', 1], ['栗', 'くり', 1], ['杉', 'すぎ', 1], ['萩', 'はぎ', 1], ['青葉', 'あおば', 1], ['朝日', 'あさひ', 0],
  ['星', 'ほし', 1], ['月見', 'つきみ', 0], ['富士見', 'ふじみ', 0], ['鶴', 'つる', 1], ['鷺', 'さぎ', 1], ['雲雀', 'ひばり', 1],
  ['椿', 'つばき', 1], ['桐', 'きり', 1], ['楓', 'かえで', 1], ['光', 'ひかり', 0], ['泉', 'いずみ', 1], ['宮', 'みや', 1],
  ['稲', 'いな', 1], ['千草', 'ちぐさ', 1], ['曙', 'あけぼの', 0], ['白樺', 'しらかば', 1], ['柿', 'かき', 1], ['桃', 'もも', 1],
  ['菊', 'きく', 1], ['葵', 'あおい', 0], ['霞', 'かすみ', 1], ['小鳥', 'ことり', 1], ['若竹', 'わかたけ', 1], ['春日', 'かすが', 0]
];
// [漢字, 読み, 連濁形 or null, 都市寄りの重み, 田園寄りの重み]
const SUF = [
  ['台', 'だい', null, 1.0, 0.5], ['町', 'まち', null, 1.0, 0.3], ['川', 'かわ', 'がわ', 0.6, 1.0], ['ヶ丘', 'がおか', null, 0.8, 0.5],
  ['野', 'の', null, 0.3, 1.0], ['橋', 'はし', 'ばし', 1.0, 0.4], ['山', 'やま', null, 0.2, 0.9], ['田', 'た', 'だ', 0.2, 1.0],
  ['坂', 'さか', 'ざか', 0.9, 0.3], ['沢', 'さわ', 'ざわ', 0.2, 1.0], ['原', 'はら', null, 0.3, 0.9], ['森', 'もり', null, 0.4, 0.8],
  ['公園', 'こうえん', null, 0.7, 0.05]
];
// 実在の有名な駅名・地名になりやすい組（軽い配慮）
const BAN = new Set(['梅田', '青山', '松山', '桜川', '光ヶ丘', '梅ヶ丘', '桃山', '宮原', '竹橋', '桜坂', '鶴橋', '菊川', '松原', '星川',
  '柳川', '春日', '富士見台', '月見台', '泉町', '霞ヶ丘', '白樺湖', '稲田', '杉田', '桜台', '緑ヶ丘', '藤沢', '桜田', '宮田', '本町',
  '新松田', '北松山', '宮坂', '稲荷町', '鷺沼', '梅島', '新桜台', '春日町', '菊名', '泉岳寺', '桜山']);
const VOICED = /[がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ]/;

const wpick = (r, arr, wf) => { let s = 0; for (const a of arr) s += wf(a); let t = r() * s; for (const a of arr) { t -= wf(a); if (t < 0) return a; } return arr[arr.length - 1]; };
function makeName(r, size, used) {
  for (let tries = 0; tries < 40; tries++) {
    const pre = r() < 0.28 ? wpick(r, PRE, p => p[2]) : null;
    const stem = STEM[Math.floor(r() * STEM.length)];
    const suf = wpick(r, SUF, s => s[3] * size + s[4] * (1 - size) + 0.05);
    const ren = suf[2] && stem[2] && !VOICED.test(stem[1]);
    const name = (pre ? pre[0] : '') + stem[0] + suf[0];
    const kana = (pre ? pre[1] : '') + stem[1] + (ren ? suf[2] : suf[1]);
    if (kana.length > 8 || BAN.has(name) || used.has(name)) continue;
    return { name, kana };
  }
  // 40回で決まらなければ重なりを許す（部品の組は数百あるので、まず起きない）
  const stem = STEM[Math.floor(r() * STEM.length)];
  return { name: '新' + stem[0] + '台', kana: 'しん' + stem[1] + 'だい' };
}

/* ---------- 駅の表（シードごとにキャッシュ。k は 1 から） ---------- */
let cacheSeed = null, list = [], used = new Set();
function ensure(k) {
  if (cacheSeed !== state.seed) { cacheSeed = state.seed; list = []; used = new Set(); }
  while (list.length < k) {
    const n = list.length + 1, r = rng(hash32(state.seed, SALT, n));
    const prev = n === 1 ? 0 : list[n - 2].pos;
    const g = n === 1 ? FIRST : GAP;
    const pos = Math.round(prev + g[0] + (g[1] - g[0]) * r());
    const u = world(pos + W / 2).urban;
    const size = Math.min(1, Math.max(0, 0.15 + 0.8 * u + 0.12 * (r() - 0.5)));
    const len = Math.round((900 + 1300 * size) / 10) * 10;
    const at = 0.35 + 0.3 * r();          // 窓の中央がホームのどこに来るか（0=後ろ端, 1=前端）
    const c = pos + W / 2;
    const x0 = Math.round(c - len * at), x1 = x0 + len;
    const { name, kana } = makeName(r, size, used);
    used.add(name);
    list.push(Object.freeze({ k: n, pos, name, kana, size, len, x0, x1, dwell: 8 + 6 * size }));
  }
  return list[k - 1];
}

/* 駅 k（k = 1, 2, …）。{ k, pos, name, kana, size, len, x0, x1, dwell } */
export function stationAt(k) { return k >= 1 ? ensure(Math.floor(k)) : null; }

/* d 以上で最も近い pos の駅（停車中 dist === pos ならその駅自身） */
export function nextStation(d) {
  let k = 1;
  // 駅間は GAP[0] 以上なので、表を伸ばしながら前から探しても数歩で届く。表の中は二分探索
  while (ensure(k).pos < d) {
    if (list[list.length - 1].pos < d) { k = list.length + 1; continue; }
    let lo = k, hi = list.length; // list[hi-1].pos >= d
    while (lo < hi) { const m = (lo + hi) >> 1; if (list[m - 1].pos < d) lo = m + 1; else hi = m; }
    return list[lo - 1];
  }
  return ensure(k);
}
/* d より手前（pos < d）で最も近い駅。無ければ null */
export function prevStation(d) {
  const n = nextStation(d);
  return n.k > 1 ? ensure(n.k - 1) : null;
}

/* 線路際座標 d の近く（ホーム [x0, x1] を margin だけ広げた範囲）にある駅。無ければ null。
   レイヤー描画側は d = distAt(L, i, x)（layers.js）で各レイヤーの位置を線路際座標に直して使う */
export function stationNear(d, margin = 0) {
  // ホームは pos + W/2 の前後 len 以内にある。len < GAP[0] なので候補は d 前後の2駅だけ
  const a = nextStation(d - W / 2 - 2200 - margin);
  for (let k = a.k; k <= a.k + 1; k++) { const s = ensure(k); if (d >= s.x0 - margin && d <= s.x1 + margin) return s; }
  return null;
}

/* [d0, d1] と重なるホームを持つ駅の配列（チャンク1枚ぶんの描画に） */
export function stationsIn(d0, d1) {
  const out = [];
  for (let s = nextStation(d0 - W / 2 - 2200); s.x0 <= d1; s = ensure(s.k + 1)) if (s.x1 >= d0) out.push(s);
  return out;
}
