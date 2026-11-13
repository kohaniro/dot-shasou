// サブエージェントの記録(JSONL)から、時間の内訳を集計する。中身は出さず、合計だけ出す。
// 使い方: node agent-time.mjs <記録ファイル>
import fs from 'node:fs';
const file = process.argv[2];
const PAUSE = 5 * 60 * 1000; // これより長い空白は中断（利用枠・認証エラー）として除く
const ev = [];
for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!l) continue;
  let o; try { o = JSON.parse(l); } catch { continue; }
  if ((o.type === 'assistant' || o.type === 'user') && o.timestamp && o.message) ev.push(o);
}
ev.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
const tools = new Map(); // tool_use id → {name, kind}
const sum = {}, cnt = {};
const add = (k, ms) => { sum[k] = (sum[k] || 0) + ms; cnt[k] = (cnt[k] || 0) + 1; };
const bashKind = c => /shots\.mjs/.test(c) ? 'Bash(shots 撮影)' : /^\s*(node|python)/.test(c) ? 'Bash(node/python 検証)' : 'Bash(その他)';
let paused = 0, pauses = 0, prev = null;
const reqs = new Map(); let models = new Set(), efforts = new Set();
const outChars = {}; // ツール入力の文字数（書いたコード量の目安）
for (const o of ev) {
  const ts = Date.parse(o.timestamp), c = o.message.content;
  const gap = prev === null ? 0 : ts - prev; prev = ts;
  const blocks = Array.isArray(c) ? c : [{ type: 'text' }];
  if (gap > PAUSE) { paused += gap; pauses++; }
  if (o.type === 'assistant') {
    if (o.requestId && o.message.usage) reqs.set(o.requestId, o.message.usage);
    if (o.message.model) models.add(o.message.model);
    if (o.effort) efforts.add(typeof o.effort === 'string' ? o.effort : JSON.stringify(o.effort));
    const b = blocks[0];
    let k;
    if (b.type === 'thinking') k = 'モデル: 思考';
    else if (b.type === 'text') k = 'モデル: 文章（報告など）';
    else if (b.type === 'tool_use') {
      const n = b.name, inp = b.input || {};
      const kind = n === 'Bash' || n === 'PowerShell' ? bashKind(inp.command || '') : n;
      tools.set(b.id, kind);
      const wrote = n === 'Write' || n === 'Edit' ? 'コードを書く(Write/Edit)' : n === 'Bash' || n === 'PowerShell' ? 'コマンドを書く' : '読む・探す指示(' + n + ')';
      k = 'モデル: ' + wrote;
      outChars[wrote] = (outChars[wrote] || 0) + JSON.stringify(inp).length;
    } else k = 'モデル: その他';
    if (gap <= PAUSE) add(k, gap);
  } else {
    const b = blocks.find(x => x.type === 'tool_result');
    if (b) { if (gap <= PAUSE) add('ツール実行: ' + (tools.get(b.tool_use_id) || '?'), gap); }
  }
}
let out = 0, think = 0;
for (const u of reqs.values()) { out += u.output_tokens || 0; think += (u.output_tokens_details && u.output_tokens_details.thinking_tokens) || 0; }
const total = Object.values(sum).reduce((a, b) => a + b, 0);
const f = ms => (ms / 60000).toFixed(1).padStart(6) + '分';
console.log('モデル:', [...models].join(','), '/ effort:', [...efforts].join(',') || '(記録なし)');
console.log('実働', f(total), '/ 中断', f(paused), `(${pauses}回)`, '/ API 呼び出し', reqs.size, '回 / 出力', out, 'トークン（うち思考', think + '）');
const model = Object.entries(sum).filter(([k]) => k.startsWith('モデル')).reduce((a, [, v]) => a + v, 0);
console.log('  モデルの生成', f(model), (model / total * 100).toFixed(0) + '%', '/ ツール実行', f(total - model), ((total - model) / total * 100).toFixed(0) + '%');
for (const [k, v] of Object.entries(sum).sort((a, b) => b[1] - a[1])) console.log(f(v), (v / total * 100).toFixed(0).padStart(3) + '%', String(cnt[k]).padStart(4) + '回', k);
console.log('ツール入力の文字数:', JSON.stringify(outChars));
