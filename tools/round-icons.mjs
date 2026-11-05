// Gives the app icons rounded corners (transparent outside), so Windows shows them like other apps.
// iPhone rounds apple-touch-icon itself and Android uses the maskable icon, so only the "any" icons change.
// Usage: node tools/round-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DIR = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'docs', 'icons');
const RADIUS = 0.2; // share of the icon size, close to Windows 11 app tiles

function decode(buf) {
  let pos = 8, w, h, depth, type, idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), kind = buf.toString('ascii', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; if (data[12]) throw new Error('interlaced PNG'); }
    if (kind === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  if (depth !== 8 || ![2, 6].includes(type)) throw new Error(`unsupported PNG (depth ${depth}, type ${type})`);
  const ch = type === 6 ? 4 : 3, stride = w * ch, raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(h * stride), out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[y * stride + x - ch] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= ch && y ? px[(y - 1) * stride + x - ch] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  for (let i = 0; i < w * h; i++) { px.copy(out, i * 4, i * ch, i * ch + 3); out[i * 4 + 3] = ch === 4 ? px[i * ch + 3] : 255; }
  return { w, h, rgba: out };
}

function crc32(b) { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function encode(w, h, rgba) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Coverage of pixel (x, y) by a rounded square, 4×4 supersampled for smooth corners.
function coverage(x, y, size, r) {
  let n = 0;
  for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
    const px = x + (sx + 0.5) / 4, py = y + (sy + 0.5) / 4;
    const cx = Math.min(Math.max(px, r), size - r), cy = Math.min(Math.max(py, r), size - r);
    if ((px - cx) ** 2 + (py - cy) ** 2 <= r * r) n++;
  }
  return n / 16;
}

for (const name of ['icon-192.png', 'icon-512.png']) {
  const file = path.join(DIR, name);
  const { w, h, rgba } = decode(fs.readFileSync(file));
  const r = w * RADIUS;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    rgba[i + 3] = Math.round(rgba[i + 3] * coverage(x, y, w, r));
  }
  fs.writeFileSync(file, encode(w, h, rgba));
  console.log(name, 'rounded');
}
