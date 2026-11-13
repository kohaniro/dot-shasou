// 指定シード・絵柄で、各バイオームの中心と遷移の途中の景色を PNG に保存する（ヘッドレス Chrome を CDP で操作。依存なし）
// 使い方: node shots.mjs <outDir> <seed,seed> <style,style> [mode]
//   mode: both（既定） | raw | view | run | perf | pano:<距離,距離> | zoom:<距離,距離> | station[:<k,k>] | door[:<k,k>] | journey[:<秒>] | pass | walk | swap[:<k,k>]
// 時間と Math.random を差し替えて固定ステップで進めるので、同じ引数なら同じ絵になる。各ケースを2回描いて一致も確かめる。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [outArg = path.join(os.tmpdir(), 'dot-shasou-shots'), seedArg = '1234', styleArg = 'real', mode = 'both'] = process.argv.slice(2);
const OUT = path.resolve(outArg); fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:8000', DPORT = 9334;
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
    if (!window.__m) window.__m = { st: await import('/src/state.js'), w: await import('/src/world.js'), sc: await import('/src/scenery/index.js'), sky: await import('/src/scenery/sky.js'), j: await import('/src/journey.js'), sn: await import('/src/stations.js') };
    return window.__m;
  };
  // 最初の1周について、各バイオームの中心と遷移の中間の距離を求める
  window.__plan = async () => {
    const { w } = await window.__mods(); const runs = []; let cur = null, st = 0;
    for (let d = 0; d < 400000 && runs.length < 5; d += 20) {
      const e = w.world(d), b = w.BIOME_KEYS.reduce((a, k) => e[k] > e[a] ? k : a, 'city');
      if (b !== cur) { if (cur) runs.push([cur, st, d]); cur = b; st = d; }
    }
    const out = [];
    runs.slice(0, 4).forEach((r, k) => { out.push([r[0], k === 0 ? Math.round(r[2] * 0.3) : Math.round((r[1] + r[2]) / 2)]); if (k < 3) out.push([r[0] + '>' + runs[k + 1][0], r[2]]); });
    return out;
  };
  // 車内を重ねない景色だけの絵（空 + 各レイヤー）。幅 wd ドット、倍率 sc
  window.__raw = async (dist, wd, sc) => {
    const { sc: S, sky, st } = await window.__mods();
    const c = document.createElement('canvas'); c.width = wd * sc; c.height = 80 * sc; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.scale(sc, sc);
    for (let x = 0; x < wd; x += 320) g.drawImage(sky.sky, x, 0);
    for (const L of S.layers) {
      const wx = Math.floor(dist * L.f - (wd - 320) / 2), i0 = Math.floor(wx / L.cw), i1 = Math.floor((wx + wd - 1) / L.cw);
      for (let i = i0; i <= i1; i++) g.drawImage(L.chunk(i), i * L.cw - wx, 0);
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
  window.__view = () => document.getElementById('view').toDataURL('image/png');
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
      console.log('  perf ' + await pg.ev(`(async () => { const { sc } = await __mods(); const out = []; for (const L of sc.layers) { let mx = 0; const t0 = Date.now(); let n = 0; for (let i = -2; i < 400; i++) { L.cache.clear(); const a = Date.now(); L.chunk(i); mx = Math.max(mx, Date.now() - a); n++; } out.push('layer' + L.id + ' mean=' + ((Date.now() - t0) / n).toFixed(2) + 'ms max=' + mx + 'ms'); } return out.join(' | '); })()`));
    } else if (mode === 'station' || mode.startsWith('station:')) { // 駅ごとに 進入中 / 停車・ドア全開 / 発車直後 の3コマ
      const ks = mode.startsWith('station:') ? mode.slice(8).split(',').map(Number) : [1, 2];
      for (const k of ks) {
        const r = await pg.ev(`__station(${k}, true)`);
        if (pass === 0) console.log(`  station ${k}: ${r.s.name}（${r.s.kana}） pos=${r.s.pos} size=${r.s.size.toFixed(2)} len=${r.s.len} x0=${r.s.x0} x1=${r.s.x1}\n    ` + r.info.join('\n    '));
        h.push(save(`station-${seed}-${style}-k${k}.png`, await pg.ev(`__sheet(${JSON.stringify(r.views)})`)));
        h.push(save(`station-raw-${seed}-${style}-k${k}.png`, await pg.ev(`__sheet(${JSON.stringify(r.raws)})`)));
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
    } else if (mode.startsWith('pano:')) { // 横に長い絵（チャンクの継ぎ目の確認）
      const urls = []; for (const d of mode.slice(5).split(',')) urls.push(await pg.ev(`__raw(${d}, 1280, 1)`));
      h.push(save(`pano-${seed}-${style}.png`, await pg.ev(`__sheet(${JSON.stringify(urls)})`)));
    } else if (mode.startsWith('zoom:')) { // 指定距離を 4 倍で（何枚かを縦に並べる）
      const urls = []; for (const d of mode.slice(5).split(',')) urls.push(await pg.ev(`__raw(${d}, 320, 4)`));
      h.push(save(`zoom-${seed}-${style}.png`, await pg.ev(`__sheet(${JSON.stringify(urls)})`)));
    } else {
    if (mode !== 'view') {
      const urls = []; for (const [, d] of plan) urls.push(await pg.ev(`__raw(${d}, 480, 2)`));
      const A = await pg.ev(`__sheet(${JSON.stringify(urls.slice(0, 4))})`), B = await pg.ev(`__sheet(${JSON.stringify(urls.slice(4))})`);
      h.push(save(`raw-${seed}-${style}-a.png`, A), save(`raw-${seed}-${style}-b.png`, B));
    }
    if (mode !== 'raw') {
      const urls = []; for (const [, d] of plan) { await pg.ev(`__goto(${d})`); urls.push(await pg.ev('__view()')); }
      const A = await pg.ev(`__sheet(${JSON.stringify(urls.slice(0, 4))})`), B = await pg.ev(`__sheet(${JSON.stringify(urls.slice(4))})`);
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
