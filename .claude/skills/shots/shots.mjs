// 指定シード・絵柄で、各バイオームの中心と遷移の途中の景色を PNG に保存する（ヘッドレス Chrome を CDP で操作。依存なし）
// 使い方: node shots.mjs <outDir> <seed,seed> <style,style> [mode]
//   mode: both（既定） | raw | view | run | perf | pano:<距離,距離> | zoom:<距離,距離>
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
    if (!window.__m) window.__m = { st: await import('/src/state.js'), w: await import('/src/world.js'), sc: await import('/src/scenery/index.js'), sky: await import('/src/scenery/sky.js') };
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
  window.__goto = async (dist) => { const { st } = await window.__mods(); st.state.dist = dist; st.state.nextJoint = dist + 100000; st.state.bobs.length = 0; window.__step(2, 16); return st.state.dist; };
  window.__view = () => document.getElementById('view').toDataURL('image/png');
  // 複数の dataURL を縦に並べ、ラベル用の余白なしで1枚にする
  window.__sheet = async (urls) => {
    const ims = await Promise.all(urls.map(u => new Promise(r => { const im = new Image(); im.onload = () => r(im); im.src = u; })));
    const c = document.createElement('canvas'); c.width = Math.max(...ims.map(i => i.width)); c.height = ims.reduce((a, i) => a + i.height + 6, 0);
    const g = c.getContext('2d'); g.fillStyle = '#ff00ff'; g.fillRect(0, 0, c.width, c.height);
    let y = 0; for (const im of ims) { g.drawImage(im, 0, y); y += im.height + 6; }
    return c.toDataURL('image/png');
  };
})();`;

async function load(seed, style) {
  const pg = await openPage();
  await pg.send('Page.addScriptToEvaluateOnNewDocument', { source: stub({ 'shasou-style': style, 'shasou-pass': '1' }) });
  await pg.send('Page.navigate', { url: `${BASE}/index.html#line-${seed}` });
  for (let i = 0; i < 100 && !pg.events.includes('Page.loadEventFired'); i++) await sleep(50);
  await sleep(300);
  return pg;
}
const save = (name, url) => { const b = Buffer.from(url.split(',')[1], 'base64'); fs.writeFileSync(path.join(OUT, name), b); return crypto.createHash('sha256').update(b).digest('hex').slice(0, 12); };

const allErrors = []; let randCalls = 0;
for (const seed of seedArg.split(',')) for (const style of styleArg.split(',')) {
  const hashes = [];
  for (let pass = 0; pass < 2; pass++) { // 2回読み込んで同じ絵になるか（決定性）
    const pg = await load(seed, style);
    const plan = await pg.ev('__plan()');
    if (pass === 0) console.log(`seed ${seed} ${style}: ` + plan.map(p => `${p[0]}@${p[1]}`).join('  '));
    const h = [];
    if (mode === 'run') { // 実際のループを 50ms 刻みで 150 秒ぶん進め、30 秒ごとに画面を保存
      const urls = []; for (let k = 0; k < 5; k++) { await pg.ev('__step(600, 50)'); urls.push(await pg.ev('__view()')); }
      const dist = await pg.ev('(async () => Math.round((await __mods()).st.state.dist))()');
      h.push(save(`run-${seed}-${style}.png`, await pg.ev(`__sheet(${JSON.stringify(urls)})`)) + ' dist=' + dist);
    } else if (mode === 'perf') { // チャンク生成の所要時間（Date.now は差し替えていない）
      console.log('  perf ' + await pg.ev(`(async () => { const { sc } = await __mods(); const out = []; for (const L of sc.layers) { let mx = 0; const t0 = Date.now(); let n = 0; for (let i = -2; i < 400; i++) { L.cache.clear(); const a = Date.now(); L.chunk(i); mx = Math.max(mx, Date.now() - a); n++; } out.push('layer' + L.id + ' mean=' + ((Date.now() - t0) / n).toFixed(2) + 'ms max=' + mx + 'ms'); } return out.join(' | '); })()`));
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
