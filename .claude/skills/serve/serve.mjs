// ドット車窓の確認用 静的サーバー（依存なし）。
//   node serve.mjs            前面で起動
//   node serve.mjs --detach   裏で起動（すでに動いていれば何もしない）
//   node serve.mjs --hook     --detach と同じ。新しく起動したときだけ Claude Code のフック用 JSON を出す
//   node serve.mjs --stop     裏で動いているサーバーを止める
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.SHASOU_PORT) || 8000;
const HOST = '127.0.0.1';
const URL_ = `http://localhost:${PORT}/`;
const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), '../../..'); // .claude/skills/serve → プロジェクト直下
const PID_FILE = path.join(os.tmpdir(), `dot-shasou-serve-${PORT}.pid`);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg'
};

const listening = () => new Promise(res => {
  const s = net.connect(PORT, HOST);
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('error', () => res(false));
});

function serve() {
  const server = http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, URL_).pathname); } catch (e) { res.writeHead(400).end(); return; }
    let file = path.join(ROOT, rel);
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    if (rel.split('/').some(s => s.startsWith('.'))) { res.writeHead(404).end(); return; } // .git や .claude は出さない
    fs.stat(file, (err, st) => {
      if (!err && st.isDirectory()) file = path.join(file, 'index.html');
      fs.readFile(file, (err2, buf) => {
        if (err2) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found'); return; }
        // 編集がすぐ反映されるよう、キャッシュさせない
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(buf);
      });
    });
  });
  server.on('error', e => { if (e.code === 'EADDRINUSE') { console.log(`ポート ${PORT} は使用中です: ${URL_}`); process.exit(0); } throw e; });
  server.listen(PORT, HOST, () => {
    fs.writeFileSync(PID_FILE, String(process.pid));
    console.log(`ドット車窓: ${URL_} （基準の試作は ${URL_}prototype.html）`);
  });
  const bye = () => { try { fs.unlinkSync(PID_FILE); } catch (e) {} process.exit(0); };
  process.on('SIGINT', bye); process.on('SIGTERM', bye);
}

const arg = process.argv[2];
if (arg === '--stop') {
  let pid = 0;
  try { pid = Number(fs.readFileSync(PID_FILE, 'utf8')); } catch (e) {}
  if (!pid) console.log('裏で動いているサーバーは見つかりません。');
  else {
    try { process.kill(pid); console.log(`サーバーを止めました (pid ${pid})。`); } catch (e) { console.log('サーバーはすでに止まっています。'); }
    try { fs.unlinkSync(PID_FILE); } catch (e) {}
  }
} else if (arg === '--detach' || arg === '--hook') {
  if (await listening()) {
    if (arg === '--detach') console.log(`すでに起動しています: ${URL_}`);
  } else {
    spawn(process.execPath, [SELF], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    if (arg === '--hook') console.log(JSON.stringify({ systemMessage: `確認用サーバーを起動しました: ${URL_}` }));
    else console.log(`起動しました: ${URL_}`);
  }
} else {
  serve();
}
