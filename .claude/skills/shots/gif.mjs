// 依存なしの GIF89a エンコーダ（無限ループ、LZW 可変長コード、差分矩形）
// encodeGif(frames, width, height, delayCs) -> { buf, colors, quantized, frames }
//   frames: RGBA の Uint8Array（または Uint8ClampedArray）の配列。delayCs: 1 フレームの表示時間（1/100 秒）

function lzw(idx, minCode) {
  const clear = 1 << minCode, eoi = clear + 1;
  const out = []; let cur = 0, nb = 0;
  let size = minCode + 1, next = eoi + 1, dict = new Map();
  const emit = code => {
    cur |= code << nb; nb += size;
    while (nb >= 8) { out.push(cur & 255); cur >>>= 8; nb -= 8; }
  };
  emit(clear);
  let prefix = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i], key = (prefix << 8) | k, c = dict.get(key);
    if (c !== undefined) { prefix = c; continue; }
    emit(prefix);
    if (next === 4096) { emit(clear); dict = new Map(); size = minCode + 1; next = eoi + 1; }
    else { dict.set(key, next++); if (next > (1 << size) && size < 12) size++; }
    prefix = k;
  }
  emit(prefix); emit(eoi);
  if (nb > 0) out.push(cur & 255);
  return out;
}

function subBlocks(bytes) {
  const o = [];
  for (let i = 0; i < bytes.length; i += 255) { const n = Math.min(255, bytes.length - i); o.push(n); for (let j = 0; j < n; j++) o.push(bytes[i + j]); }
  o.push(0);
  return o;
}

export function encodeGif(frames, width, height, delayCs) {
  const npx = width * height;
  // 色を数える（24bit にまとめる）
  const count = new Map();
  for (const f of frames) for (let p = 0; p < npx; p++) {
    const c = (f[p * 4] << 16) | (f[p * 4 + 1] << 8) | f[p * 4 + 2];
    count.set(c, (count.get(c) || 0) + 1);
  }
  const quantized = count.size > 256;
  let pal = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(e => e[0]);
  if (quantized) pal = pal.slice(0, 255);
  const map = new Map(pal.map((c, i) => [c, i]));
  const nearest = c => {
    let r = map.get(c); if (r !== undefined) return r;
    const R = c >> 16, G = (c >> 8) & 255, B = c & 255; let best = 0, bd = Infinity;
    for (let i = 0; i < pal.length; i++) { const q = pal[i], dr = R - (q >> 16), dg = G - ((q >> 8) & 255), db = B - (q & 255), d = dr * dr + dg * dg + db * db; if (d < bd) { bd = d; best = i; } }
    map.set(c, best); return best;
  };
  let bits = 1; while ((1 << bits) < pal.length) bits++;
  const minCode = Math.max(2, bits);
  const o = [];
  const w16 = v => o.push(v & 255, (v >> 8) & 255);
  for (const ch of 'GIF89a') o.push(ch.charCodeAt(0));
  w16(width); w16(height); o.push(0x80 | 0x70 | (bits - 1), 0, 0);
  for (let i = 0; i < (1 << bits); i++) { const c = pal[i] ?? 0; o.push(c >> 16, (c >> 8) & 255, c & 255); }
  o.push(0x21, 0xff, 11); for (const ch of 'NETSCAPE2.0') o.push(ch.charCodeAt(0)); o.push(3, 1, 0, 0, 0);
  let prev = null;
  for (const f of frames) {
    const ix = new Uint8Array(npx);
    for (let p = 0; p < npx; p++) ix[p] = nearest((f[p * 4] << 16) | (f[p * 4 + 1] << 8) | f[p * 4 + 2]);
    let x0 = 0, y0 = 0, w = width, h = height;
    if (prev) {
      let minX = width, minY = height, maxX = -1, maxY = -1;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (ix[y * width + x] !== prev[y * width + x]) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      if (maxX < 0) { x0 = 0; y0 = 0; w = 1; h = 1; } else { x0 = minX; y0 = minY; w = maxX - minX + 1; h = maxY - minY + 1; }
    }
    const sub = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) sub[y * w + x] = ix[(y0 + y) * width + x0 + x];
    o.push(0x21, 0xf9, 4, 1 << 2, delayCs & 255, (delayCs >> 8) & 255, 0, 0); // disposal = 1（そのまま残す）
    o.push(0x2c); w16(x0); w16(y0); w16(w); w16(h); o.push(0);
    o.push(minCode); for (const b of subBlocks(lzw(sub, minCode))) o.push(b);
    prev = ix;
  }
  o.push(0x3b);
  return { buf: Buffer.from(o), colors: pal.length, quantized, frames: frames.length };
}
