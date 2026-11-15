// 指定シード・絵柄で、各バイオームの中心と遷移の途中の景色を PNG に保存する（ヘッドレス Chrome を CDP で操作。依存なし）
// 使い方: node shots.mjs <outDir> <seed,seed> <style,style> [mode]
//   mode: both（既定） | raw | view | run | perf | pano:<距離,距離> | at:<距離,距離> | zoom:<距離,距離> | station[:<k,k>] | door[:<k,k>] | journey[:<秒>] | pass | walk | swap[:<k,k>] | feat | tunnel[:<k,k>] | bridge[:<k,k>] | xing | crossing[:<k,k>] | wall | closewall[:<k,k>]
//         | course | curve[:<k,k>] | elev[:<k,k>] | clock | tod[:<距離,距離>] | wx[:<距離,距離>] | tonerun[:<秒>]
//         | gif:<開始距離>（README 用の GIF。SHOTS_GIF_SECS 既定8 / SHOTS_GIF_FPS 既定20 / SHOTS_GIF_SCALE 既定1）
//   時間帯・天気は、既定では昼・晴に固定して撮る。環境変数 SHOTS_TOD=auto|dawn|noon|dusk|night|<時刻> と SHOTS_WX=auto|clear|cloud|rain|snow で変える（auto = 走行距離から決まる値。cloud:0.5 のように強さも付けられる）
//   SHOTS_WXS=clear,cloud:0.5,cloud,rain:0.5,rain のように並べると、wx mode がその段階を順に撮る
// 時間と Math.random を差し替えて固定ステップで進めるので、同じ引数なら同じ絵になる。各ケースを2回描いて一致も確かめる。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encodeGif } from './gif.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [outArg = path.join(os.tmpdir(), 'dot-shasou-shots'), seedArg = '1234', styleArg = 'real', mode = 'both'] = process.argv.slice(2);
const OUT = path.resolve(outArg); fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:8000', DPORT = 9334;
const TOD_ENV = process.env.SHOTS_TOD || 'noon', WX_ENV = process.env.SHOTS_WX || 'clear';
if (!/^(auto|dawn|noon|dusk|night|\d+(\.\d+)?)$/.test(TOD_ENV) || !/^(auto|clear|(cloud|rain|snow)(:\d+(\.\d+)?)?)$/.test(WX_ENV)) { console.error('SHOTS_TOD は auto|dawn|noon|dusk|night|<時刻>、SHOTS_WX は auto|clear|cloud|rain|snow（cloud:0.5 のように強さ 0〜1 を付けられる）'); process.exit(1); }
const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && fs.existsSync(p));
if (!CHROME) { console.error('Chrome / Edge が見つかりません。環境変数 CHROME_PATH で実行ファイルを指定してください。'); process.exit(1); }
// 確認用サーバーが止まっていれば起動する
spawnSync(process.execPath, [path.join(HERE, '../serve/serve.mjs'), '--detach'], { stdio: 'ignore' });
const prof = path.join(os.tmpdir(), 'dot-shasou-chrome-prof-shots');
fs.rmSync(prof, { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + DPORT, '--user-data-dir=' + prof, '--no-first-run', '--disable-gpu', '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 50; i++) { try { await (await fetch(`http://127.0.0.1:${DPORT}/json/version`)).json(); break; } catch (e) { await sleep(200); } }
for (let i = 0; i < 25; i++) { try { await fetch(BASE + '/'); break; } catch (e) { await sleep(200); } }

async function openPage() {
  const t = await (await fetch(`http://127.0.0.1:${DPORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(), events = [], errors = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.j(new Error(JSON.stringify(m.error))) : p.r(m.result); }
    else {
      if (m.method === 'Runtime.exceptionThrown') errors.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
      if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) errors.push('CONSOLE ' + m.params.type + ' ' + m.params.args.map(a => a.value ?? a.description).join(' '));
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('LOG ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
      events.push(m.method);
    }
  };
  const send = (method, params = {}) => new Promise((r, j) => { pending.set(++id, { r, j }); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  return { send, ev, errors, events, close: async () => { ws.close(); await fetch(`http://127.0.0.1:${DPORT}/json/close/${t.id}`); } };
}

const stub = (ls) => `(() => {
  if (location.protocol === 'about:') return;
  let now = 5000; performance.now = () => now;
  const q = []; window.requestAnimationFrame = f => { q.push(f); return q.length; };
  let rs = 12345; Math.random = () => { window.__randCalls = (window.__randCalls || 0) + 1; rs = (Math.imul(rs, 1103515245) + 12345) & 0x7fffffff; return rs / 0x80000000; };
  const ls = ${JSON.stringify(ls)};
  localStorage.clear(); for (const k in ls) localStorage.setItem(k, ls[k]);
  window.__step = (n, ms) => { for (let i = 0; i < n; i++) { now += ms; const c = q.splice(0); for (const f of c) f(now); } return q.length; };
  window.__mods = async () => {
    if (!window.__m) window.__m = { st: await import('/src/state.js'), w: await import('/src/world.js'), sc: await import('/src/scenery/index.js'), sky: await import('/src/scenery/sky.js'), j: await import('/src/journey.js'), sn: await import('/src/stations.js'), ck: await import('/src/clock.js'), tn: await import('/src/tone.js'), ft: await import('/src/features.js'), co: await import('/src/course.js'), xg: await import('/src/crossings.js'), cw: await import('/src/closewalls.js'), ly: await import('/src/layers.js') };
    return window.__m;
  };
  // 最初の1周について、各バイオームの中心と遷移の中間の距離を求める
  window.__plan = async () => {
    const { w } = await window.__mods(); const runs = []; let cur = null, st = 0;
    const seen = () => new Set(runs.map(r => r[0]));
    for (let d = 0; d < 800000 && !(seen().has('mount') && seen().has('sea')); d += 20) { // 区間は終わったときに積むので、山間と海沿いを両方抜けるまで
      const e = w.world(d), b = w.BIOME_KEYS.reduce((a, k) => e[k] > e[a] ? k : a, 'city');
      if (b !== cur) { if (cur) runs.push([cur, st, d]); cur = b; st = d; }
    }
    // 先に各バイオームの中心（最初に現れた区間）、続けて遷移（隣り合う組ごとに最初の1回）
    const out = [], pairs = new Set();
    for (const b of w.BIOME_KEYS) { const k = runs.findIndex(r => r[0] === b); if (k >= 0) out.push([b, k === 0 ? Math.round(runs[0][2] * 0.3) : Math.round((runs[k][1] + runs[k][2]) / 2)]); }
    runs.forEach((r, k) => { const n = runs[k + 1]; if (!n) return; const key = [r[0], n[0]].sort().join(); if (pairs.has(key)) return; pairs.add(key); out.push([r[0] + '>' + n[0], r[2]]); });
    return out;
  };
  // 車内を重ねない景色だけの絵（空 + 各レイヤー）。幅 wd ドット、倍率 sc。
  // scenery/index.js の layers を並び順のまま全部重ねる（ホームの層 plat も含む。main.js の render() と違い、駅の近くかどうかは見ない。架線は描かない）。
  // トンネル・橋の「架線より手前に重ねる層」も Layer として layers に足せば（render() の重ね順と同じ位置に）、ここは直さなくてもこの絵に入る。
  // Layer でない描き方（render() の中で毎フレーム直接描く）にする場合は、下のループの後に同じ描画を足すこと
  window.__raw = async (dist, wd, sc) => {
    const { sc: S, sky, st, co, ly, tn } = await window.__mods(); const el = co.elev(dist + 160);
    tn.snapToneAt(dist); // この地点の時間帯・天気のトーンで描く（画面の地点のトーンへは、次の描画で戻る）
    const c = document.createElement('canvas'); c.width = wd * sc; c.height = 80 * sc; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.scale(sc, sc);
    for (let x = 0; x < wd; x += 320) g.drawImage(sky.sky, x, 0);
    for (const L of S.layers) {
      const wx = Math.floor(ly.layerOff(L, dist) - (wd - 320) / 2), i0 = Math.floor(wx / L.cw), i1 = Math.floor((wx + wd - 1) / L.cw);
      for (let i = i0; i <= i1; i++) g.drawImage(L.chunk(i), i * L.cw - wx, Math.round(L.drop * el * 2) / 2);
    }
    return c.toDataURL('image/png');
  };
  // 任意の距離へ飛ぶ。進行の状態（phase / station / door）も、その地点に合わせて置き直す。
  // stopT を渡すと、駅の pos ちょうどのとき停車してからその秒数の状態にする
  window.__goto = async (dist, stopT = 0) => { const { st, j } = await window.__mods(); j.seekJourney(dist, stopT); st.state.nextJoint = st.state.dist + 100000; st.state.bobs.length = 0; st.state.hits.length = 0; window.__step(2, 16); return st.state.dist; };
  window.__jst = async () => { const { st } = await window.__mods(); const s = st.state; return { t: +s.t.toFixed(2), dist: +s.dist.toFixed(1), speed: +s.speed.toFixed(2), phase: s.phase, door: +s.door.toFixed(2), stopT: +s.stopT.toFixed(2), k: s.station && s.station.k }; };
  // 駅 k の3コマ: 進入中（残り約600・減速中）/ 停車・ドア全開 / 発車直後（pos+300）。実際のループを 50ms 刻みで進めて撮る
  window.__station = async (k, withRaw) => {
    const { st, sn } = await window.__mods(); const S = st.state, s = sn.stationAt(k), views = [], raws = [], info = [];
    const shot = async (tag) => { views.push(window.__view()); if (withRaw) raws.push(await window.__raw(S.dist, 480, 2)); info.push(tag + ' ' + JSON.stringify(await window.__jst())); };
    await window.__goto(s.pos - 600); await shot('approach');
    for (let i = 0; i < 2000 && !(S.phase === 'stop' && S.door >= 1); i++) window.__step(1, 50);
    window.__step(10, 50); await shot('open');
    for (let i = 0; i < 4000 && !(S.phase !== 'stop' && S.dist >= s.pos + 300); i++) window.__step(1, 50);
    await shot('depart');
    return { s, views, raws, info };
  };
  // トンネル・橋の一覧（d = 0〜dMax）と、区間どうし・駅のホームとの最小間隔
  window.__feat = async (dMax) => {
    const { w, sn, ft } = await window.__mods(); const fs = ft.featuresIn(0, dMax), rows = [], cnt = {}, via = {};
    let minGap = Infinity, minSt = Infinity;
    fs.forEach((f, i) => {
      const e = w.world((f.a + f.b) / 2), top = w.BIOME_KEYS.filter(k => e[k] > 0.005).sort((x, y) => e[y] - e[x]).slice(0, 2).map(k => k + ' ' + e[k].toFixed(2)).join(' / ');
      let sd = Infinity, sk = 0; const n0 = sn.nextStation(f.a - 4000).k;
      for (let k = Math.max(1, n0 - 1); k <= n0 + 2; k++) { const s = sn.stationAt(k), g = Math.max(0, s.x0 - f.b, f.a - s.x1); if (g < sd) { sd = g; sk = k; } }
      if (i > 0) minGap = Math.min(minGap, f.a - fs[i - 1].b);
      minSt = Math.min(minSt, sd); cnt[f.type] = (cnt[f.type] || 0) + 1; via[f.via] = (via[f.via] || 0) + 1;
      rows.push([f.type, '#' + f.n, 'k' + cnt[f.type], 'a=' + f.a, 'b=' + f.b, 'len=' + f.len, f.via, '[' + top + ']', 'station k' + sk + ' ' + sd].join('  '));
    });
    // 参考: mount / sea が 0.5 をまたぐ地点（入口・出口のトンネルの中心になるはずの地点）
    const cross = []; let pm = 0, ps = 0;
    for (let d = 0; d <= dMax; d += 50) { const e = w.world(d); if (d > 0) { if ((pm < 0.5) !== (e.mount < 0.5)) cross.push('mount' + (e.mount > pm ? '+' : '-') + '@' + d); if ((ps < 0.5) !== (e.sea < 0.5)) cross.push('sea' + (e.sea > ps ? '+' : '-') + '@' + d); } pm = e.mount; ps = e.sea; }
    return { rows, cnt, via, minGap, minSt, cross };
  };
  // トンネル・橋（type の k 番目）の4コマ: 入口が窓の右寄り（画面 x=250 に a）/ 入口が窓の中央 / 区間の中ほど / 出口が窓の中央
  window.__feature = async (type, k) => {
    const { st, ft } = await window.__mods(); const S = st.state, f = ft.featureNo(type, k), views = [], raws = [], info = [];
    if (!f) return null;
    const pts = [['enter-right', f.a - 250], ['enter-center', f.a - 160], ['middle', Math.round((f.a + f.b) / 2) - 160], ['exit-center', f.b - 160]];
    for (const [tag, d] of pts) {
      await window.__goto(d); views.push(window.__view()); raws.push(await window.__raw(S.dist, 480, 2));
      const m = ft.featureMix(S.dist + 160);
      info.push(tag + ' dist=' + S.dist.toFixed(1) + ' phase=' + S.phase + ' speed=' + S.speed.toFixed(1) + ' mix(tunnel=' + m.tunnel.toFixed(2) + ' bridge=' + m.bridge.toFixed(2) + ') prox=' + ft.tunnelProx(S.dist + 160, 600).toFixed(2));
    }
    return { f, views, raws, info };
  };
  // 踏切（crossings.js）の一覧と検証（d = 0〜dMax）: 間隔、駅・橋・トンネル・高架・カーブとの重なり、バイオーム別の件数
  window.__xing = async (dMax) => {
    const { w, sn, ft, co, xg } = await window.__mods(); const xs = xg.crossingsIn(0, dMax), rows = [], bio = {}, bad = { station: 0, feature: 0, elev: 0, curve: 0, start: 0 };
    const gaps = [];
    xs.forEach((x, i) => {
      const e = w.world(x.c), top = w.BIOME_KEYS.reduce((a, k) => e[k] > e[a] ? k : a, 'city');
      bio[top] = (bio[top] || 0) + 1;
      if (i > 0) gaps.push(x.c - xs[i - 1].c);
      if (sn.stationsIn(x.a, x.b).length) bad.station++;
      if (ft.featureNear(x.c, x.w / 2)) bad.feature++;
      let el = false, cu = false; for (let d = x.a - 700; d <= x.b + 700; d += 5) { if (co.elev(d) > 0) el = true; if (d >= x.a && d <= x.b && co.curve(d) !== 0) cu = true; } // 高架は前後 700（中景が窓の端で映す範囲）まで見る
      if (el) bad.elev++; if (cu) bad.curve++; if (x.a < 2000) bad.start++;
      const s = sn.nextStation(x.c - 160), sp = sn.prevStation(x.c - 160);
      const sd = Math.min(...[s, sp].filter(Boolean).map(q => Math.max(0, q.x0 - x.b, x.a - q.x1)));
      const f = ft.featureNear(x.c, 1e5), fd = f ? Math.max(0, f.a - x.b, x.a - f.b) : '-';
      rows.push(['xing', '#' + x.n, 'c=' + x.c, 'w=' + x.w, 'h=' + x.h, i ? 'gap ' + gaps[gaps.length - 1] : 'first', top + ' ' + e[top].toFixed(2), 'station ' + sd, 'feature ' + fd].join('  '));
    });
    const nSt = sn.nextStation(dMax).k - 1;
    const mean = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : '-', min = gaps.length ? Math.min(...gaps) : '-', max = gaps.length ? Math.max(...gaps) : '-';
    return { rows, sum: 'count ' + xs.length + '  stations ' + nSt + '（駅間あたり ' + (xs.length / Math.max(1, nSt)).toFixed(2) + '）  gap mean ' + mean + ' min ' + min + ' max ' + max + '（250 ドット/秒で平均 ' + (typeof mean === 'number' ? (mean / 250).toFixed(0) : '-') + ' 秒）  biome ' + JSON.stringify(bio),
      bad: 'overlaps: station ' + bad.station + ' feature ' + bad.feature + ' elev ' + bad.elev + ' curve ' + bad.curve + ' start ' + bad.start };
  };
  // 踏切（k 番目）の5コマ: 道の中心 c が窓の右寄り（画面 x=250）/ 至近の層が窓に入った所 / 窓の中央 / 至近の層が出ていく所 / 通過後（窓の左端より 200 手前、x=-200 相当）
  window.__crossing = async (k) => {
    const { st, xg } = await window.__mods(); const S = st.state, x = xg.crossingNo(k), views = [], raws = [], info = [];
    if (!x) return null;
    for (const [tag, d] of [['right', x.c - 250], ['near-in', x.c - 205], ['center', x.c - 160], ['near-out', x.c - 115], ['passed', x.c + 200]]) {
      await window.__goto(d); views.push(window.__view()); raws.push(await window.__raw(S.dist, 480, 2));
      const q = xg.crossingAt(S.dist + 160);
      info.push(tag + ' dist=' + S.dist.toFixed(1) + ' phase=' + S.phase + ' speed=' + S.speed.toFixed(1) + ' crossingAt(center)=' + (q ? 'x ' + q.x.toFixed(1) + ' #' + q.xing.n : 'null'));
    }
    return { x, views, raws, info };
  };
  // 至近距離の建物（closewalls.js）の一覧と検証（d = 0〜dMax）: 件数、都心の区間あたりの頻度、間隔・長さ、バイオーム、駅・橋/トンネル・踏切・高架との重なり
  window.__wall = async (dMax) => {
    const { w, sn, ft, co, xg, cw } = await window.__mods(); const ws = cw.wallsIn(0, dMax), rows = [], bio = {}, mats = {}, bad = { station: 0, feature: 0, crossing: 0, elev: 0, start: 0, order: 0 };
    const gaps = [], lens = []; let glass = 0;
    ws.forEach((x, i) => {
      const e = w.world((x.a + x.b) / 2), top = w.BIOME_KEYS.reduce((a, k) => e[k] > e[a] ? k : a, 'city');
      bio[top] = (bio[top] || 0) + 1; lens.push(x.len); if (x.glass) glass++;
      for (const b of x.bldgs) mats[b.mat] = (mats[b.mat] || 0) + 1;
      if (i > 0) { gaps.push(x.a - ws[i - 1].b); if (x.a <= ws[i - 1].b) bad.order++; }
      // 窓に同時に入りうる範囲で見る（至近の建物は中央 ±115、ホーム ±160、トンネルの壁 240、トラス 130、踏切の至近の層 170）
      if (sn.stationsIn(x.a - 300, x.b + 300).length) bad.station++;
      if (ft.featureNear((x.a + x.b) / 2, x.len / 2 + 360)) bad.feature++;
      if (xg.crossingNear((x.a + x.b) / 2, x.len / 2 + 290)) bad.crossing++;
      let el = false; for (let d = x.a - 300; d <= x.b + 300; d += 5) if (co.elev(d) > 0) el = true;
      if (el) bad.elev++; if (x.a < 2000) bad.start++;
      const s = sn.nextStation(x.a - 160), sp = sn.prevStation(x.a - 160);
      const sd = Math.min(...[s, sp].filter(Boolean).map(q => Math.max(0, q.x0 - x.b, x.a - q.x1)));
      rows.push(['wall', '#' + x.n, 'a=' + x.a, 'b=' + x.b, 'len=' + x.len, 'h=' + x.h, x.glass ? 'glass' : '-', '[' + x.bldgs.map(b => b.mat + (b.gap ? '/' + b.gap : '')).join(' ') + ']', i ? 'gap ' + gaps[gaps.length - 1] : 'first', top + ' ' + e[top].toFixed(2), 'station ' + sd].join('  '));
    });
    // 都心（city >= 0.5）の区間の長さと、制限速度で走ったときの秒数
    let cityD = 0, cityT = 0, inCity = 0; const step = 50;
    for (let d = 0; d < dMax; d += step) { const e = w.world(d); if (e.city >= 0.5) { cityD += step; cityT += step / Math.max(60, co.speedLimit(d)); } }
    for (const x of ws) if (w.world((x.a + x.b) / 2).city >= 0.5) inCity++;
    const avg = a => a.length ? Math.round(a.reduce((p, q) => p + q, 0) / a.length) : '-';
    return { rows, sum: 'count ' + ws.length + '（都心の中 ' + inCity + '）  glass ' + glass + '  city distance ' + cityD + '（制限速度で ' + cityT.toFixed(0) + ' 秒）  都心で ' + (inCity ? (cityT / inCity).toFixed(0) : '-') + ' 秒に1件（' + (inCity ? Math.round(cityD / inCity) : '-') + ' ドットに1件）' +
      '  gap mean ' + avg(gaps) + ' min ' + (gaps.length ? Math.min(...gaps) : '-') + '  len mean ' + avg(lens) + ' min ' + (lens.length ? Math.min(...lens) : '-') + ' max ' + (lens.length ? Math.max(...lens) : '-') + '  biome ' + JSON.stringify(bio) + '  mat ' + JSON.stringify(mats),
      bad: 'overlaps: station ' + bad.station + ' feature ' + bad.feature + ' crossing ' + bad.crossing + ' elev ' + bad.elev + ' start ' + bad.start + ' order ' + bad.order };
  };
  // 至近の建物（k 番目）の5コマ: 手前の端 a が窓の右から入ってくる所（a が画面 x=240）/ 窓いっぱい（a が x=20）/ 中ほどが窓の中央 / 出ていく所（b が x=60）/ 通過後（b が x=-200）
  window.__closewall = async (k) => {
    const { st, cw } = await window.__mods(); const S = st.state, x = cw.wallNo(k), views = [], raws = [], info = [], F = 1.4;
    if (!x) return null;
    const at = (d, sx) => d - 160 - (sx - 160) / F; // 線路際の座標 d が、至近の層で画面 x=sx に来る state.dist
    for (const [tag, d] of [['enter', at(x.a, 240)], ['full', at(x.a, 20)], ['middle', (x.a + x.b) / 2 - 160], ['leave', at(x.b, 60)], ['passed', at(x.b, -200)]]) {
      await window.__goto(d); views.push(window.__view()); raws.push(await window.__raw(S.dist, 480, 2));
      info.push(tag + ' dist=' + S.dist.toFixed(1) + ' phase=' + S.phase + ' speed=' + S.speed.toFixed(1) + ' near=' + !!cw.wallNear(S.dist + 160, 135));
    }
    // チャンクの継ぎ目: 同じ範囲をチャンク幅 256（本物）と 61 で描いて重ね、違う画素の数を数える（0 であること）
    const { sc, ly, tn } = await window.__mods(); tn.snapToneAt(S.dist);
    const L1 = sc.closewall, L2 = new ly.Layer(L1.id, L1.f, 61, L1.draw), X0 = Math.round((x.a - 160) * F + 160) - 40, X1 = Math.round((x.b - 160) * F + 160) + 40;
    const comp = L => { const c = document.createElement('canvas'); c.width = X1 - X0; c.height = 80; const g = c.getContext('2d'); for (let i = Math.floor(X0 / L.cw); i * L.cw < X1; i++) g.drawImage(L.chunk(i), i * L.cw - X0, 0); return g.getImageData(0, 0, c.width, 80).data; };
    const d1 = comp(L1), d2 = comp(L2); let diff = 0; for (let q = 0; q < d1.length; q += 4) if (d1[q] !== d2[q] || d1[q + 1] !== d2[q + 1] || d1[q + 2] !== d2[q + 2] || d1[q + 3] !== d2[q + 3]) diff++;
    info.push('seam check (chunk 256 vs 61): ' + diff + ' px differ');
    return { x, views, raws, info };
  };
  // 線形（course.js）の一覧と検証（d = 0〜dMax）: カーブ、向きの範囲、傾きの最大、高架、制限速度、実際に走らせた駅間ごとの最高速度
  window.__course = async (dMax) => {
    const { st, sn, ft, co, j, w } = await window.__mods(); const S = st.state, rows = [], bad = [];
    const cs = [], es = [];
    for (let c = co.nextCurve(0); c && c.a <= dMax; c = co.nextCurve(c.a + 1)) cs.push(c);
    for (let e = co.nextElev(0); e && e.a <= dMax; e = co.nextElev(e.a + 1)) es.push(e);
    let hMin = 0, hMax = 0, sMax = 0, cMax = 0, up = 0, top = 0, ph = 0;
    for (let d = 0; d <= dMax; d += 10) {
      const h = co.heading(d), el = co.elev(d), c = co.curve(d);
      hMin = Math.min(hMin, h); hMax = Math.max(hMax, h); sMax = Math.max(sMax, Math.abs(h - ph) / 10); cMax = Math.max(cMax, Math.abs(c)); ph = h;
      if (el > 0) up++; if (el >= 1) top++;
      if (d % 50) continue;
      const e = w.world(d), f = ft.featureNear(d, 0), s = sn.stationNear(d, 0);
      if (el > 0 && (e.mount > 0 || e.sea > 0)) bad.push('elev in mount/sea @' + d);
      if (el > 0 && ft.featureNear(d, 499)) bad.push('elev near feature @' + d);
      if (el > 0 && el < 1 && sn.stationNear(d, 299)) bad.push('ramp at platform @' + d);
      if (c !== 0 && sn.stationNear(d, 299)) bad.push('curve at platform @' + d);
      if (c !== 0) { const n = ft.featureNear(d, 299); if (n && (n.type === 'bridge' ? d >= n.a - 199 && d <= n.b + 199 : Math.abs(d - n.a) < 300 || Math.abs(d - n.b) < 300)) bad.push('curve near ' + n.type + ' @' + d); }
      if (d < 3000 && (c !== 0 || el > 0)) bad.push('not straight at start @' + d);
    }
    cs.forEach((c, i) => rows.push(['curve', '#' + c.n, 'a=' + c.a, 'len=' + c.len, 'h ' + c.h0.toFixed(1) + '→' + c.h1.toFixed(1), 'peak ' + (1.5 * (c.h1 - c.h0) / c.len / co.SLOPE_MAX).toFixed(2), i ? 'gap ' + (c.a - cs[i - 1].b) : ''].join('  ')));
    es.forEach(e => { const m = w.world((e.a + e.b) / 2), k1 = sn.nextStation(e.a - 160).k, inn = []; for (let k = k1; sn.stationAt(k).x0 < e.b; k++) inn.push('k' + k + (co.elev(sn.stationAt(k).pos + 160) >= 1 ? '(高架)' : '(勾配)')); rows.push(['elev', '#' + e.n, 'a=' + e.a, 'b=' + e.b, 'len=' + (e.b - e.a), 'up=' + e.up, 'down=' + e.down, 'city+resi@mid ' + (m.city + m.resi).toFixed(2), 'stations ' + (inn.join(',') || '-')].join('  ')); });
    // 実際に走らせる（描画なし・50ms 刻み）: 駅間ごとの最高速度、巡航中の加減速の最大、制限の超過
    j.jumpTo(0); const legs = []; let leg = { k: S.station.k, vmax: 0, lim: [1e9, 0] }, acc = 0, dec = 0, over = 0, tsec = 0;
    for (let n = 0; n < 400000 && S.dist < dMax; n++) {
      const ph0 = S.phase, v0 = S.speed; j.stepJourney(0.05); tsec += 0.05;
      if (S.station.k !== leg.k) { legs.push(leg); leg = { k: S.station.k, vmax: 0, lim: [1e9, 0] }; }
      leg.vmax = Math.max(leg.vmax, S.speed);
      if (S.phase === 'run' && ph0 === 'run') { const a = (S.speed - v0) / 0.05; acc = Math.max(acc, a); dec = Math.min(dec, a); const l = co.speedLimit(S.dist); over = Math.max(over, S.speed - l); leg.lim[0] = Math.min(leg.lim[0], l); leg.lim[1] = Math.max(leg.lim[1], l); }
    }
    const kmh = v => Math.round(v * 0.36);
    const kinds = [...new Set(bad.map(b => b.split('@')[0]))];
    return { rows, bad: kinds.map(b => b + '×' + bad.filter(x => x.startsWith(b)).length),
      sum: 'curves ' + cs.length + '  heading ' + hMin.toFixed(1) + '〜' + hMax.toFixed(1) + '  max|slope| ' + sMax.toFixed(4) + '  max|curve| ' + cMax.toFixed(2) + '  elev spans ' + es.length + '  elev>0 ' + (100 * up * 10 / dMax).toFixed(1) + '%  elev=1 ' + (100 * top * 10 / dMax).toFixed(1) + '%',
      run: 'sim ' + Math.round(tsec) + 's  run accel max +' + acc.toFixed(2) + ' / ' + dec.toFixed(2) + '  max over limit ' + over.toFixed(2) + '  legs vmax km/h: ' + legs.map(l => 'k' + l.k + ' ' + kmh(l.vmax) + '(制限 ' + kmh(l.lim[0]) + '〜' + kmh(l.lim[1]) + ')').join(' ') };
  };
  // カーブ・高架（k 番目）のコマ: カーブは 始点 / 1/4 / 中ほど（最もきつい）/ 終点 が窓の中央、高架は 勾配の始点 / 勾配の中ほど / 上りきった所 / 高架の中ほど / 下り勾配の中ほど
  window.__courseShot = async (type, k) => {
    const { st, co } = await window.__mods(); const S = st.state, views = [], raws = [], info = [];
    const next = type === 'curve' ? co.nextCurve : co.nextElev; let c = next(0);
    for (let n = 1; c && n < k; n++) c = next(c.a + 1);
    if (!c) return null;
    const pts = type === 'curve' ? [['start', c.a], ['quarter', c.a + c.len / 4], ['middle', c.a + c.len / 2], ['end', c.b]]
      : [['ramp-start', c.a], ['ramp-mid', c.a + c.up / 2], ['top', c.a + c.up], ['middle', (c.a + c.b) / 2], ['down-mid', c.b - c.down / 2]];
    for (const [tag, d] of pts) {
      await window.__goto(Math.round(d) - 160); views.push(window.__view()); raws.push(await window.__raw(S.dist, 480, 2));
      info.push(tag + ' dist=' + S.dist.toFixed(1) + ' phase=' + S.phase + ' speed=' + S.speed.toFixed(1) + ' heading=' + co.heading(S.dist + 160).toFixed(1) + ' curve=' + S.curve.toFixed(2) + ' elev=' + S.elev.toFixed(2) + ' lean=' + S.lean.toFixed(2));
    }
    return { c, views, raws, info };
  };
  // 固定ステップで secs 秒進め、進行を記録して検証する（描画もするが画像は保存しない）
  window.__journey = async (secs, dt) => {
    const { st, sn } = await window.__mods(); const S = st.state, log = [], ev = [];
    let prev = { ...await window.__jst() }, maxJump = 0, maxAcc = 0, maxDec = 0, crawl = 0, lastV = S.speed;
    const n = Math.round(secs / dt);
    for (let i = 0; i < n; i++) {
      const ph0 = S.phase, k0 = S.station.k, v0 = S.speed, d0 = S.dist;
      window.__step(1, dt * 1000);
      const a = (S.speed - v0) / dt; maxAcc = Math.max(maxAcc, a); maxDec = Math.min(maxDec, a);
      if (i > 0) maxJump = Math.max(maxJump, Math.abs(a - lastV)); lastV = a;
      if (S.phase === 'brake' && S.speed < 3) crawl += dt;
      if (S.dist < d0 - 1e-9) ev.push('BACKWARD at t=' + S.t.toFixed(2));
      if (S.phase !== ph0) {
        const s = S.station, e = { t: +S.t.toFixed(2), from: ph0, to: S.phase, k: s.k, dist: +S.dist.toFixed(3), speed: +S.speed.toFixed(2) };
        if (S.phase === 'brake') e.remain = +(s.pos - S.dist).toFixed(1);
        if (S.phase === 'stop') { e.err = +(S.dist - s.pos).toFixed(6); e.name = s.name + '/' + s.kana; e.size = +s.size.toFixed(2); e.len = s.len; }
        if (ph0 === 'stop') e.nextK = s.k;
        ev.push(JSON.stringify(e));
      }
      if (i % Math.round(10 / dt) === 0) log.push('t=' + S.t.toFixed(0) + ' d=' + S.dist.toFixed(0) + ' v=' + S.speed.toFixed(1) + ' ' + S.phase + (S.phase === 'stop' ? ' door=' + S.door.toFixed(2) : ''));
    }
    return { ev, log, maxAcc: +maxAcc.toFixed(2), maxDec: +maxDec.toFixed(2), maxAccJumpPerStep: +maxJump.toFixed(2), crawlSecs: +crawl.toFixed(2),
      stations: [1, 2, 3, 4].map(k => { const s = sn.stationAt(k); return k + ':' + s.name + '(' + s.kana + ') pos=' + s.pos + ' size=' + s.size.toFixed(2) + ' len=' + s.len + ' x0=' + s.x0 + ' x1=' + s.x1; }) };
  };
  // 時間帯・天気の固定（tod: 'auto' | 'dawn' | 'noon' | 'dusk' | 'night' | 時刻、wx: 'auto' | 'clear' | 'cloud' | 'rain' | 'snow'）。すぐ効く
  window.__fix = async (tod, wx) => {
    const { st, ck, tn } = await window.__mods();
    if (tod !== undefined) st.state.todFix = tod === 'auto' ? null : tod in ck.TOD ? ck.TOD[tod] : Number(tod);
    if (wx !== undefined) st.state.wxFix = wx === 'auto' ? null : wx;
    tn.snapToneAt(st.state.dist); // チャンクを直接作る mode（perf など）でも、すぐこのトーンで描かれるように
  };
  // 時刻・天気の一覧と検証（d = 0〜dMax。固定は外して見る）
  window.__clock = async (dMax) => {
    const { st, ck, tn } = await window.__mods(); const S = st.state, keep = [S.todFix, S.wxFix]; S.todFix = null; S.wxFix = null;
    const hm = h => { const m = Math.floor(h * 60 + 1e-6); return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
    const tl = h => h >= ck.DAWN[1] && h < ck.DUSK[0] ? '昼' : h >= ck.DUSK[0] && h < ck.DUSK[1] ? '夕' : h >= ck.DAWN[0] && h < ck.DAWN[1] ? '朝' : '夜';
    const wl = w => w.snow > 0.5 ? '雪' : w.rain > 0.5 ? '雨' : w.cloud > 0.5 ? '曇' : '晴';
    const table = []; let line = [];
    for (let d = 0; d <= dMax; d += 10000) { const h = ck.timeAt(d); line.push(String(d / 1000).padStart(3) + 'k ' + hm(h) + tl(h) + wl(ck.weatherAt(d))); if (line.length === 8) { table.push(line.join('  ')); line = []; } }
    if (line.length) table.push(line.join('  '));
    const spans = [], tshare = {}, wshare = {}, wruns = []; let cur = null, s0 = 0, wcur = null, w0 = 0, bad = 0, both = 0, maxStep = 0, pw = null, direct = 0;
    for (let d = 0; d <= dMax; d += 20) {
      const h = ck.timeAt(d), w = ck.weatherAt(d), a = tl(h), b = wl(w);
      if (a !== cur) { if (cur) spans.push(cur + ' ' + s0 + '〜' + d + '（' + (d - s0) + '）'); cur = a; s0 = d; }
      if (b !== wcur) { if (wcur) { wruns.push(wcur + ' ' + w0 + '〜' + d + '（' + (d - w0) + '）'); if (wcur !== '曇' && b !== '曇') direct++; } wcur = b; w0 = d; }
      tshare[a] = (tshare[a] || 0) + 20; wshare[b] = (wshare[b] || 0) + 20;
      if ((w.rain > 0 || w.snow > 0) && w.cloud < 1) bad++;
      if (w.rain > 0 && w.snow > 0) both++;
      if (pw) maxStep = Math.max(maxStep, Math.abs(w.cloud - pw.cloud), Math.abs(w.rain - pw.rain), Math.abs(w.snow - pw.snow)); pw = w;
    }
    spans.push(cur + ' ' + s0 + '〜（途中）'); wruns.push(wcur + ' ' + w0 + '〜（途中）');
    const segs = []; for (let k = ck.wxSeg(0); ck.wxEdge(k) <= dMax; k++) segs.push(ck.wxKind(k) + '@' + ck.wxEdge(k));
    // トーンの段階が切り替わる地点
    const sw = []; let key = tn.toneAt(0).key, last = 0, minGap = Infinity, minAt = '';
    for (let d = 5; d <= dMax; d += 5) { const k = tn.toneAt(d).key; if (k !== key) { if (sw.length && d - last < minGap) { minGap = d - last; minAt = last + '〜' + d + '（→ ' + key + ' → ' + k + '）'; } sw.push(d + ':' + k); key = k; last = d; } }
    const pct = o => Object.keys(o).map(k => k + ' ' + (100 * o[k] / (dMax + 20)).toFixed(1) + '%').join('  ');
    [S.todFix, S.wxFix] = keep;
    return { start: hm(ck.rawTimeAt(0)), table, spans, wruns, segs, tshare: pct(tshare), wshare: pct(wshare), bad, both, direct, maxStep, nsw: sw.length, minGap, minAt, sw };
  };
  // 同じ地点を、時間帯（kind = 'tod'）か天気（'wx'）を替えて撮る。車内込みの画面と景色だけの絵
  window.__toneShot = async (kind, vals, dist) => {
    const { st } = await window.__mods(); const S = st.state, keep = [S.todFix, S.wxFix], views = [], raws = [], info = [];
    for (const v of vals) {
      await (kind === 'tod' ? window.__fix(v) : window.__fix(undefined, v));
      await window.__goto(dist); views.push(window.__view()); raws.push(await window.__raw(S.dist, 480, 2));
      info.push(v + ' dist=' + S.dist.toFixed(1) + ' hour=' + S.hour.toFixed(2) + ' wx=' + JSON.stringify(S.wx) + ' tone=' + S.tone.key + (S.tone.id ? '（昼・晴 = 色を変えない）' : ''));
    }
    [S.todFix, S.wxFix] = keep; S.toneSnap = true;
    return { views, raws, info };
  };
  // トーンの切り替え（準備 → クロスフェード → 入れ替え）を実ループで確かめる: 固定を外し、最初の夕方の手前から 16ms 刻みで secs 秒進める
  window.__toneRun = async (secs) => {
    const { st, ck, j } = await window.__mods(); const S = st.state; S.todFix = null; S.wxFix = null;
    const start = ck.nextTimePoint(0, ck.DUSK[0]) - 160 - 400, hm = h => Math.floor(h) + ':' + String(Math.floor(h % 1 * 60)).padStart(2, '0');
    j.jumpTo(start); window.__step(2, 16);
    const ev = [], views = [], n = Math.round(secs / 0.016); let key = S.tone.key, to = null, fades = 0, swaps = 0, maxMs = 0, mid = false, slow = 0;
    for (let i = 0; i < n; i++) {
      const a = Date.now(); window.__step(1, 16); const ms = Date.now() - a; maxMs = Math.max(maxMs, ms); if (ms > 16) slow++;
      const k2 = S.tone.key, to2 = S.toneTo ? S.toneTo.key : null;
      if (to2 && to2 !== to) { fades++; ev.push('t=' + (i * 0.016).toFixed(1) + ' d=' + Math.round(S.dist) + ' ' + hm(S.hour) + ' fade ' + k2 + '→' + to2); }
      if (k2 !== key) { swaps++; key = k2; }
      to = to2;
      if (to2 && !mid && fades >= 9 && S.toneK > 0.45 && S.toneK < 0.56) { mid = true; views.push(window.__view()); ev.push('  （↑ のフェード ' + S.toneK.toFixed(2) + ' の画面を撮影）'); }
      else if (i % Math.round(n / 4) === Math.round(n / 8)) views.push(window.__view());
    }
    views.push(window.__view());
    return { start, ev, fades, swaps, maxMs, slow, frames: n, views, end: 'dist=' + Math.round(S.dist) + ' ' + hm(S.hour) + ' tone=' + S.tone.key + ' phase=' + S.phase };
  };
  window.__view = () => document.getElementById('view').toDataURL('image/png');
  window.__viewSize = () => { const v = document.getElementById('view'); return [v.width, v.height]; };
  // GIF 用: 画面（#view）の RGBA を base64 で返す
  window.__viewPx = () => {
    const v = document.getElementById('view'), d = v.getContext('2d').getImageData(0, 0, v.width, v.height).data; let s = '';
    for (let i = 0; i < d.length; i += 32768) s += String.fromCharCode.apply(null, d.subarray(i, i + 32768));
    return btoa(s);
  };
  // GIF 用: ms 進める（1 ステップは 50ms 以下）
  window.__advance = ms => { const n = Math.max(1, Math.ceil(ms / 50 - 1e-9)); for (let i = 0; i < n; i++) window.__step(1, ms / n); };
  // 画面のうち座席まわり（内部座標 y=76〜150、幅320）を3倍に拡大した絵
  window.__seat = () => {
    const v = document.getElementById('view'), k = v.width / 320, c = document.createElement('canvas'); c.width = 960; c.height = 74 * 3;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(v, 0, (76 - 20) * k, 320 * k, 74 * k, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  };
  // 歩く立ち姿の確認: いまの画面を3倍にした上に、7人（大人・子ども・高齢者を含む）を歩幅の違う瞬間で並べる
  window.__walk = async (seed, dir, t0) => {
    const ps = await import('/src/passengers.js'), rn = await import('/src/rng.js');
    const v = document.getElementById('view'), c = document.createElement('canvas'); c.width = 960; c.height = 390;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(v, 0, 0, c.width, c.height); g.setTransform(3, 0, 0, 3, 0, -60);
    const people = []; let s = 1;
    for (const kind of ['adult', 'adult', 'child', 'adult', 'elder', 'adult', 'adult']) for (; ; s++) { const p = ps.makePerson(rn.rng(rn.hash32(seed, 5, s))); if (p.kind === kind) { people.push(p); s++; break; } }
    people.forEach((p, i) => ps.drawWalker(g, p, 34 + i * 42, t0 + i * 0.17, dir));
    return c.toDataURL('image/png');
  };
  // 駅 k での乗客の入れ替え6コマ: 降りる人が立った直後 / 歩いている途中 / 乗る人が入ってきたところ / 歩いている途中 / 全員が座ったあと（ドアが閉まる前）/ 発車後
  window.__swap = async (k) => {
    const { st, sn } = await window.__mods(); const ps = await import('/src/passengers.js'), S = st.state;
    const s = sn.stationAt(k), sw = ps.swapAt(k), tl = sw.tl, offs = sw.moves.filter(m => m.off), ons = sw.moves.filter(m => !m.off);
    const mn = (a, f, d) => a.length ? Math.min(...a.map(f)) : d, mx = (a, f, d) => a.length ? Math.max(...a.map(f)) : d;
    const o0 = mn(offs, m => m.start, tl.open + 0.6), o1 = mx(offs, m => m.end, o0 + 3), b0 = mn(ons, m => m.start, tl.opened), b1 = mx(ons, m => m.end, b0 + 3);
    const ts = [o0 + 0.1, (o0 + o1) / 2, b0 + 0.8, (b0 + b1) / 2, tl.close - 0.15], views = [], info = [];
    const tags = ['stood', 'off-walk', 'on-enter', 'on-walk', 'seated', 'departed'];
    const shot = i => { views.push(window.__view()); info.push(tags[i] + ' stopT=' + S.stopT.toFixed(2) + ' phase=' + S.phase + ' seated=[' + ps.passengers.map(p => p.seat).join(',') + ']'); };
    for (let i = 0; i < ts.length; i++) { await window.__goto(s.pos, ts[i]); shot(i); }
    await window.__goto(s.pos + 300); shot(5);
    return { s, views, info, off: sw.off, on: sw.on, gap: sw.gap, m: sw.m, forced: sw.forced, close: +tl.close.toFixed(2), last: +b1.toFixed(2) };
  };
  // 入れ替えの検証: 区間 n の顔ぶれを直接求めた場合と 0 から順に求めた場合の一致、駅 1〜kMax の予定（最後に座る時刻 < tl.close か）
  window.__swapCheck = async (n, kMax) => {
    const { sn } = await window.__mods(); const ps = await import('/src/passengers.js');
    const sig = ros => ros.map(p => p ? [p.kind, p.top, p.bottom, p.pose, p.phase.toFixed(4), p.seat].join('/') : '-').join('|');
    ps.genPassengers(); const direct = sig(ps.rosterAt(n));
    ps.genPassengers(); let seq = ''; for (let i = 0; i <= n; i++) seq = sig(ps.rosterAt(i));
    const rows = []; let worst = Infinity, minDwell = null;
    for (let k = 1; k <= kMax; k++) {
      const s = sn.stationAt(k), sw = ps.swapAt(k), last = Math.max(0, ...sw.moves.map(m => m.end)), margin = sw.tl.close - last;
      worst = Math.min(worst, margin); if (!minDwell || s.dwell < minDwell.dwell) minDwell = { k, dwell: s.dwell };
      rows.push('k' + k + ' dwell=' + s.dwell.toFixed(2) + ' close=' + sw.tl.close.toFixed(2) + ' last=' + last.toFixed(2) + ' margin=' + margin.toFixed(2) + ' gap=' + sw.gap + ' x' + sw.m.toFixed(1) + (sw.forced ? ' FORCED' : '') + ' off=[' + sw.off + '] on=[' + sw.on + '] n=' + ps.rosterAt(k).filter(Boolean).length);
    }
    return { same: direct === seq, rows, worst: +worst.toFixed(2), minDwell: 'k' + minDwell.k + ' (' + minDwell.dwell.toFixed(2) + ')' };
  };
  // 複数の dataURL を縦に並べ、ラベル用の余白なしで1枚にする
  window.__sheet = async (urls) => {
    const ims = await Promise.all(urls.map(u => new Promise(r => { const im = new Image(); im.onload = () => r(im); im.src = u; })));
    const c = document.createElement('canvas'); c.width = Math.max(...ims.map(i => i.width)); c.height = ims.reduce((a, i) => a + i.height + 6, 0);
    const g = c.getContext('2d'); g.fillStyle = '#ff00ff'; g.fillRect(0, 0, c.width, c.height);
    let y = 0; for (const im of ims) { g.drawImage(im, 0, y); y += im.height + 6; }
    return c.toDataURL('image/png');
  };
})();`;

async function load(seed, style, passMode = 'on') {
  const pg = await openPage();
  await pg.send('Page.addScriptToEvaluateOnNewDocument', { source: stub({ 'shasou-style': style, 'shasou-pass': passMode }) });
  await pg.send('Page.navigate', { url: `${BASE}/index.html#line-${seed}` });
  for (let i = 0; i < 100 && !pg.events.includes('Page.loadEventFired'); i++) await sleep(50);
  await sleep(300);
  await pg.ev(`__fix(${JSON.stringify(TOD_ENV)}, ${JSON.stringify(WX_ENV)})`); // 時間帯・天気の固定（既定は昼・晴）。次の描画から効く
  return pg;
}
const save = (name, url) => { const b = Buffer.from(url.split(',')[1], 'base64'); fs.writeFileSync(path.join(OUT, name), b); return crypto.createHash('sha256').update(b).digest('hex').slice(0, 12); };

const allErrors = []; let randCalls = 0;
if (mode === 'pass') { // 乗客の確認: 絵柄ごとに、シードごとの座席まわり（あり）＋最初のシードのシルエットを縦に並べる
  const seeds = seedArg.split(',');
  for (const style of styleArg.split(',')) {
    const hashes = [];
    for (let pass = 0; pass < 2; pass++) {
      const urls = [];
      for (const [seed, pm] of [...seeds.map(s => [s, 'on']), [seeds[0], 'sil']]) {
        const pg = await load(seed, style, pm);
        await pg.ev('__goto(0)'); urls.push(await pg.ev('__seat()'));
        if (pm === 'sil') hashes.push(save(`pass-${style}.png`, await pg.ev(`__sheet(${JSON.stringify(urls)})`)));
        randCalls = Math.max(randCalls, await pg.ev('window.__randCalls || 0'));
        allErrors.push(...pg.errors.filter(e => !e.includes('favicon.ico')).map(e => `${seed}/${style}/${pm}: ${e}`));
        await pg.close();
      }
    }
    console.log(`pass ${style}: seeds ${seeds.join(',')} (on) + ${seeds[0]} (sil)
  deterministic: ${hashes[0] === hashes[1] ? 'YES' : 'NO'}  ${hashes[0]}`);
  }
} else if (mode === 'walk') { // 歩く立ち姿の確認: 右向き / 左向き / シルエット の3コマ
  for (const seed of seedArg.split(',')) for (const style of styleArg.split(',')) {
    const hashes = [];
    for (let pass = 0; pass < 2; pass++) {
      const urls = [];
      for (const [pm, dir, t0] of [['on', 1, 0], ['on', -1, 0.4], ['sil', 1, 0]]) {
        const pg = await load(seed, style, pm);
        await pg.ev('__goto(0)'); urls.push(await pg.ev(`__walk(${Number(seed)}, ${dir}, ${t0})`));
        if (pm === 'sil') hashes.push(save(`walk-${seed}-${style}.png`, await pg.ev(`__sheet(${JSON.stringify(urls)})`)));
        randCalls = Math.max(randCalls, await pg.ev('window.__randCalls || 0'));
        allErrors.push(...pg.errors.filter(e => !e.includes('favicon.ico')).map(e => `${seed}/${style}/${pm}: ${e}`));
        await pg.close();
      }
    }
    console.log(`walk ${seed} ${style}
  deterministic: ${hashes[0] === hashes[1] ? 'YES' : 'NO'}  ${hashes[0]}`);
  }
} else
for (const seed of seedArg.split(',')) for (const style of styleArg.split(',')) {
  const hashes = [];
  for (let pass = 0; pass < 2; pass++) { // 2回読み込んで同じ絵になるか（決定性）
    const pg = await load(seed, style);
    const plan = await pg.ev('__plan()');
    if (pass === 0) console.log(`seed ${seed} ${style}: ` + plan.map(p => `${p[0]}@${p[1]}`).join('  '));
    const h = [];
    if (mode === 'run') { // 実際のループを 50ms 刻みで 150 秒ぶん進め、30 秒ごとに画面を保存
      const urls = [], lg = []; for (let k = 0; k < 5; k++) { await pg.ev('__step(600, 50)'); urls.push(await pg.ev('__view()')); lg.push(JSON.stringify(await pg.ev('__jst()'))); }
      if (pass === 0) console.log('  ' + lg.join('\n  '));
      const dist = await pg.ev('(async () => Math.round((await __mods()).st.state.dist))()');
      h.push(save(`run-${seed}-${style}.png`, await pg.ev(`__sheet(${JSON.stringify(urls)})`)) + ' dist=' + dist);
    } else if (mode === 'perf') { // チャンク生成の所要時間（Date.now は差し替えていない）
      console.log('  perf ' + await pg.ev(`(async () => { const { sc } = await __mods(); const out = []; for (const L of sc.layers) { let mx = 0; const t0 = Date.now(); let n = 0; for (let i = -2; i < 400; i++) { L.clear(); const a = Date.now(); L.chunk(i); mx = Math.max(mx, Date.now() - a); n++; } out.push('layer' + L.id + ' mean=' + ((Date.now() - t0) / n).toFixed(2) + 'ms max=' + mx + 'ms'); } return out.join(' | '); })()`));
    } else if (mode === 'station' || mode.startsWith('station:')) { // 駅ごとに 進入中 / 停車・ドア全開 / 発車直後 の3コマ
      const ks = mode.startsWith('station:') ? mode.slice(8).split(',').map(Number) : [1, 2];
      for (const k of ks) {
        const r = await pg.ev(`__station(${k}, true)`);
        if (pass === 0) console.log(`  station ${k}: ${r.s.name}（${r.s.kana}） pos=${r.s.pos} size=${r.s.size.toFixed(2)} len=${r.s.len} x0=${r.s.x0} x1=${r.s.x1}\n    ` + r.info.join('\n    '));
        h.push(save(`station-${seed}-${style}-k${k}.png`, await pg.ev(`__sheet(${JSON.stringify(r.views)})`)));
        h.push(save(`station-raw-${seed}-${style}-k${k}.png`, await pg.ev(`__sheet(${JSON.stringify(r.raws)})`)));
      }
    } else if (mode === 'feat') { // トンネル・橋の一覧（画像なし）
      const r = await pg.ev('__feat(260000)');
      if (pass === 0) console.log(['', ...r.rows, `count: ${JSON.stringify(r.cnt)}  via: ${JSON.stringify(r.via)}  min gap between features: ${r.minGap}  min gap to platform: ${r.minSt}`, `crossings(0.5): ${r.cross.join(' ')}`].join('\n  ').slice(1));
      h.push(crypto.createHash('sha256').update(r.rows.join(';')).digest('hex').slice(0, 12));
    } else if (/^(tunnel|bridge)(:|$)/.test(mode)) { // トンネル・橋の k 番目ごとに4コマ
      const [type, arg] = mode.split(':'), ks = arg ? arg.split(',').map(Number) : [1, 2];
      for (const k of ks) {
        const r = await pg.ev(`__feature('${type}', ${k})`);
        if (!r) { if (pass === 0) console.log(`  ${type} ${k}: 見つからない`); continue; }
        if (pass === 0) console.log([`  ${type} ${k}: #${r.f.n} a=${r.f.a} b=${r.f.b} len=${r.f.len} via=${r.f.via} h=${r.f.h}`, ...r.info].join('\n    '));
        h.push(save(`${type}-${seed}-${style}-k${k}.png`, await pg.ev(`__sheet(${JSON.stringify(r.views)})`)));
        h.push(save(`${type}-raw-${seed}-${style}-k${k}.png`, await pg.ev(`__sheet(${JSON.stringify(r.raws)})`)));
      }
    } else if (mode === 'xing') { // 踏切の一覧と検証（画像なし）
      const r = await pg.ev('__xing(260000)');
      if (pass === 0) console.log(['', ...r.rows, r.sum, r.bad].join('\n  ').slice(1));
      h.push(crypto.createHash('sha256').update(r.rows.join(';')).digest('hex').slice(0, 12));
    } else if (/^crossing(:|$)/.test(mode)) { // 踏切の k 番目ごとに5コマ
      const arg = mode.split(':')[1], ks = arg ? arg.split(',').map(Number) : [1, 2];
      for (const k of ks) {
        const r = await pg.ev(`__crossing(${k})`);
        if (!r) { if (pass === 0) console.log(`  crossing ${k}: 見つからない`); continue; }
        if (pass === 0) console.log([`  crossing ${k}: #${r.x.n} c=${r.x.c} a=${r.x.a} b=${r.x.b} w=${r.x.w} h=${r.x.h}`, ...r.info].join('\n    '));
        h.push(save(`crossing-${seed}-${style}-k${k}.png`, await pg.ev(`__sheet(${JSON.stringify(r.views)})`)));
        h.push(save(`crossing-raw-${seed}-${style}-k${k}.png`, await pg.ev(`__sheet(${JSON.stringify(r.raws)})`)));
      }
    } else if (mode === 'wall') { // 至近の建物の一覧と検証（画像なし）
      const r = await pg.ev('__wall(260000)');
      if (pass === 0) console.log(['', ...r.rows, r.sum, r.bad].join('\n  ').slice(1));
      h.push(crypto.createHash('sha256').update(r.rows.join(';')).digest('hex').slice(0, 12));
    } else if (/^closewall(:|$)/.test(mode)) { // 至近の建物の k 番目ごとに5コマ
      const arg = mode.split(':')[1], ks = arg ? arg.split(',').map(Number) : [1, 2];
      for (const k of ks) {
        const r = await pg.ev(`__closewall(${k})`);
        if (!r) { if (pass === 0) console.log(`  closewall ${k}: 見つからない`); continue; }
        if (pass === 0) console.log([`  closewall ${k}: #${r.x.n} a=${r.x.a} b=${r.x.b} len=${r.x.len} glass=${r.x.glass} h=${r.x.h} [${r.x.bldgs.map(b => b.mat).join(' ')}]`, ...r.info].join('\n    '));
        h.push(save(`closewall-${seed}-${style}-k${k}.png`, await pg.ev(`__sheet(${JSON.stringify(r.views)})`)));
        h.push(save(`closewall-raw-${seed}-${style}-k${k}.png`, await pg.ev(`__sheet(${JSON.stringify(r.raws)})`)));
      }
    } else if (mode === 'clock') { // 時刻・天気の一覧と検証（画像なし）
      const r = await pg.ev('__clock(450000)');
      if (pass === 0) console.log(['', `出発 ${r.start}（10000 ドットごとの 時刻・時間帯・天気）`, ...r.table, '時間帯: ' + r.spans.join(' / '), '  割合: ' + r.tshare,
        '天気の区間: ' + r.segs.join(' '), '天気（0.5 で区切った見かけ）: ' + r.wruns.join(' / '), '  割合: ' + r.wshare,
        `検証: 雨・雪なのに cloud < 1 の地点 ${r.bad} ／ 雨と雪が同時 ${r.both} ／ 曇りを通らない切り替わり ${r.direct} ／ 20 ドットあたりの変化の最大 ${r.maxStep.toFixed(4)}`,
        `トーンの切り替え: ${r.nsw} 回  最小間隔 ${r.minGap} ドット ${r.minAt}`, '  最初の 30 回: ' + r.sw.slice(0, 30).join(' ')].join('\n  ').slice(1));
      h.push(crypto.createHash('sha256').update(r.table.join(';') + r.sw.join(';')).digest('hex').slice(0, 12));
    } else if (/^(tod|wx)(:|$)/.test(mode)) { // 同じ地点を 朝焼け / 昼 / 夕焼け / 夜、または 晴 / 曇 / 雨 / 雪 で
      const [kind, arg] = mode.split(':'), ds = arg ? arg.split(',').map(Number) : [(plan.find(p => p[0] === 'suburb') || plan[0])[1]];
      const vals = kind === 'tod' ? (process.env.SHOTS_HOURS ? process.env.SHOTS_HOURS.split(',') : ['dawn', 'noon', 'dusk', 'night']) : (process.env.SHOTS_WXS ? process.env.SHOTS_WXS.split(',') : ['clear', 'cloud', 'rain', 'snow']), views = [], raws = [];
      for (const d of ds) {
        const r = await pg.ev(`__toneShot('${kind}', ${JSON.stringify(vals)}, ${d})`);
        if (pass === 0) console.log(`  ${kind} @${d}\n    ` + r.info.join('\n    '));
        views.push(...r.views); raws.push(...r.raws);
      }
      h.push(save(`${kind}-${seed}-${style}.png`, await pg.ev(`__sheet(${JSON.stringify(views)})`)));
      h.push(save(`${kind}-raw-${seed}-${style}.png`, await pg.ev(`__sheet(${JSON.stringify(raws)})`)));
    } else if (/^tonerun(:|$)/.test(mode)) { // トーンの切り替えを実ループで（最初の夕方）
      const r = await pg.ev(`__toneRun(${mode.includes(':') ? Number(mode.split(':')[1]) : 100})`);
      if (pass === 0) console.log([`  tonerun: start dist=${Math.round(r.start)}  fades=${r.fades} swaps=${r.swaps}  frames=${r.frames} max frame ${r.maxMs}ms（16ms 超 ${r.slow} 回）  end ${r.end}`, ...r.ev].join('\n    '));
      h.push(save(`tonerun-${seed}-${style}.png`, await pg.ev(`__sheet(${JSON.stringify(r.views)})`)) + ' fades=' + r.fades + ' swaps=' + r.swaps);
    } else if (mode === 'course') { // 線形の一覧と検証（画像なし）
      const r = await pg.ev('__course(200000)');
      if (pass === 0) console.log(['', ...r.rows, r.sum, r.run, 'violations: ' + (r.bad.length ? r.bad.join(' / ') : 'none')].join('\n  ').slice(1));
      h.push(crypto.createHash('sha256').update(r.rows.join(';') + r.run).digest('hex').slice(0, 12));
    } else if (/^(curve|elev)(:|$)/.test(mode)) { // カーブ・高架の k 番目ごとのコマ
      const [type, arg] = mode.split(':'), ks = arg ? arg.split(',').map(Number) : [1, 2];
      for (const k of ks) {
        const r = await pg.ev(`__courseShot('${type}', ${k})`);
        if (!r) { if (pass === 0) console.log(`  ${type} ${k}: 見つからない`); continue; }
        if (pass === 0) console.log([`  ${type} ${k}: ${JSON.stringify(r.c)}`, ...r.info].join('\n    '));
        h.push(save(`${type}-${seed}-${style}-k${k}.png`, await pg.ev(`__sheet(${JSON.stringify(r.views)})`)));
        h.push(save(`${type}-raw-${seed}-${style}-k${k}.png`, await pg.ev(`__sheet(${JSON.stringify(r.raws)})`)));
      }
    } else if (mode === 'door' || mode.startsWith('door:')) { // 駅 k に停車して、ドアが開く途中の3コマ（開き始め / 半開き / ほぼ全開）
      const ks = mode.startsWith('door:') ? mode.slice(5).split(',').map(Number) : [1, 2];
      for (const k of ks) {
        const urls = []; for (const t of [1.5, 2.0, 2.6]) { await pg.ev(`(async () => __goto((await __mods()).sn.stationAt(${k}).pos, ${t}))()`); urls.push(await pg.ev('__view()')); }
        h.push(save(`door-${seed}-${style}-k${k}.png`, await pg.ev(`__sheet(${JSON.stringify(urls)})`)));
      }
    } else if (mode === 'swap' || mode.startsWith('swap:')) { // 駅 k での乗客の入れ替え6コマ
      const ks = mode.startsWith('swap:') ? mode.slice(5).split(',').map(Number) : [1, 2];
      const c = await pg.ev('__swapCheck(3, 12)');
      if (pass === 0) console.log(`  roster(3) direct === sequential: ${c.same ? 'YES' : 'NO'}  min dwell: ${c.minDwell}  worst margin to tl.close (k1-12): ${c.worst}s\n    ` + c.rows.join('\n    '));
      h.push(crypto.createHash('sha256').update(c.same + c.rows.join(';')).digest('hex').slice(0, 12));
      for (const k of ks) {
        const r = await pg.ev(`__swap(${k})`);
        if (pass === 0) console.log(`  swap ${k}: ${r.s.name} dwell=${r.s.dwell.toFixed(2)} off=[${r.off}] on=[${r.on}] gap=${r.gap} speed x${r.m.toFixed(1)}${r.forced ? ' FORCED' : ''} lastSeated=${r.last} close=${r.close}\n    ` + r.info.join('\n    '));
        h.push(save(`swap-${seed}-${style}-k${k}.png`, await pg.ev(`__sheet(${JSON.stringify(r.views)})`)), crypto.createHash('sha256').update(r.info.join(';')).digest('hex').slice(0, 6));
      }
    } else if (mode === 'journey' || mode.startsWith('journey:')) { // 進行のログと検証（画像なし）
      const secs = mode.startsWith('journey:') ? Number(mode.slice(8)) : 420;
      const r = await pg.ev(`__journey(${secs}, 0.05)`);
      if (pass === 0) console.log('  ' + r.stations.join('\n  ') + '\n  events:\n    ' + r.ev.join('\n    ') + '\n  every 10s: ' + r.log.join(' | ') +
        `\n  maxAcc=${r.maxAcc} maxDec=${r.maxDec} maxAccJumpPerStep=${r.maxAccJumpPerStep} crawl(brake & v<3)=${r.crawlSecs}s`);
      h.push(r.ev.join(';'));
    } else if (mode.startsWith('gif:')) { // README 用の GIF: __goto した地点から固定ステップで進め、毎フレームの画面を GIF にする
      const secs = Number(process.env.SHOTS_GIF_SECS || 8), fps = Number(process.env.SHOTS_GIF_FPS || 20), sc = Number(process.env.SHOTS_GIF_SCALE || 1);
      const delay = Math.max(1, Math.round(100 / fps)), nf = Math.max(1, Math.round(secs * fps));
      await pg.ev(`__goto(${Number(mode.slice(4))})`);
      const [cw, ch] = await pg.ev('__viewSize()'); const ow = Math.max(1, Math.round(cw * sc)), oh = Math.max(1, Math.round(ch * sc));
      const frames = [];
      for (let i = 0; i < nf; i++) {
        if (i > 0) await pg.ev(`__advance(${1000 / fps})`);
        const src = Buffer.from(await pg.ev('__viewPx()'), 'base64');
        if (ow === cw && oh === ch) frames.push(new Uint8Array(src.buffer, src.byteOffset, src.length));
        else { const f = new Uint8Array(ow * oh * 4); for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) { const s = (Math.min(ch - 1, Math.floor(y / sc)) * cw + Math.min(cw - 1, Math.floor(x / sc))) * 4, d = (y * ow + x) * 4; f[d] = src[s]; f[d + 1] = src[s + 1]; f[d + 2] = src[s + 2]; f[d + 3] = src[s + 3]; } frames.push(f); }
        if (i === 0 && process.env.SHOTS_GIF_DUMP) fs.writeFileSync(process.env.SHOTS_GIF_DUMP + '.rgba', frames[0]);
        if (i === nf - 1 && process.env.SHOTS_GIF_DUMP) fs.writeFileSync(process.env.SHOTS_GIF_DUMP + '-last.rgba', frames[i]);
      }
      const r = encodeGif(frames, ow, oh, delay);
      const name = `gif-${seed}-${style}.gif`; fs.writeFileSync(path.join(OUT, name), r.buf);
      if (pass === 0) console.log(`  gif: ${r.frames} frames (${secs}s @ ${fps}fps, delay ${delay}cs)  canvas ${cw}x${ch} -> ${ow}x${oh}  colors ${r.colors}${r.quantized ? ' (quantized to 255 from more)' : ' (lossless)'}  size ${r.buf.length} bytes (${(r.buf.length / 1024).toFixed(1)} KiB)`);
      h.push(crypto.createHash('sha256').update(r.buf).digest('hex'));
    } else if (mode.startsWith('at:')) { // 指定した走行距離（state.dist。窓の中央は +160）の、車内込みの画面
      const urls = []; for (const d of mode.slice(3).split(',')) { await pg.ev(`__goto(${d})`); urls.push(await pg.ev('__view()')); }
      h.push(save(`at-${seed}-${style}.png`, await pg.ev(`__sheet(${JSON.stringify(urls)})`)));
    } else if (mode.startsWith('pano:')) { // 横に長い絵（チャンクの継ぎ目の確認）
      const urls = []; for (const d of mode.slice(5).split(',')) urls.push(await pg.ev(`__raw(${d}, 1280, 1)`));
      h.push(save(`pano-${seed}-${style}.png`, await pg.ev(`__sheet(${JSON.stringify(urls)})`)));
    } else if (mode.startsWith('zoom:')) { // 指定距離を 4 倍で（何枚かを縦に並べる）
      const urls = []; for (const d of mode.slice(5).split(',')) urls.push(await pg.ev(`__raw(${d}, 320, 4)`));
      h.push(save(`zoom-${seed}-${style}.png`, await pg.ev(`__sheet(${JSON.stringify(urls)})`)));
    } else {
    if (mode !== 'view') {
      const urls = []; for (const [, d] of plan) urls.push(await pg.ev(`__raw(${d}, 480, 2)`));
      const nc = plan.filter(p => !p[0].includes('>')).length;
      const A = await pg.ev(`__sheet(${JSON.stringify(urls.slice(0, nc))})`), B = await pg.ev(`__sheet(${JSON.stringify(urls.slice(nc))})`);
      h.push(save(`raw-${seed}-${style}-a.png`, A), save(`raw-${seed}-${style}-b.png`, B));
    }
    if (mode !== 'raw') {
      const urls = []; for (const [, d] of plan) { await pg.ev(`__goto(${d})`); urls.push(await pg.ev('__view()')); }
      const nc = plan.filter(p => !p[0].includes('>')).length;
      const A = await pg.ev(`__sheet(${JSON.stringify(urls.slice(0, nc))})`), B = await pg.ev(`__sheet(${JSON.stringify(urls.slice(nc))})`);
      h.push(save(`view-${seed}-${style}-a.png`, A), save(`view-${seed}-${style}-b.png`, B));
    }
    }
    hashes.push(h.join(' '));
    randCalls = Math.max(randCalls, await pg.ev('window.__randCalls || 0'));
    allErrors.push(...pg.errors.filter(e => !e.includes('favicon.ico')).map(e => `${seed}/${style}: ${e}`));
    await pg.close();
  }
  console.log(`  deterministic: ${hashes[0] === hashes[1] ? 'YES' : 'NO'}  ${hashes[0]}`);
}
console.log('Math.random calls (max per page): ' + randCalls);
console.log('出力先: ' + OUT);
console.log('CONSOLE ERRORS: ' + (allErrors.length ? '\n' + allErrors.join('\n') : 'none'));
chrome.kill();
await sleep(500);
try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {}
process.exit(0);
