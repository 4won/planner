// Draws the app icons (blue tile, yellow highlighter stroke, white check) as PNGs with no dependencies.
// Usage: node tools/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'docs', 'icons');
const BLUE = [29, 92, 140], YELLOW = [243, 207, 90], WHITE = [255, 255, 255];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Shapes in unit space (0..1). `scale` shrinks the artwork toward the center (maskable safe zone).
function draw(size, { radius, scale = 1, background = true, mono = false }) {
  const S = 4, buf = Buffer.alloc(size * size * 4);
  const map = v => 0.5 + (v - 0.5) * scale;
  const check = [[0.27, 0.52], [0.43, 0.67], [0.74, 0.34]].map(([x, y]) => [map(x), map(y)]);
  const checkW = 0.085 * scale;
  const bar = { x0: map(0.22), y0: map(0.6), x1: map(0.78), y1: map(0.72), r: 0.03 * scale };
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let acc = [0, 0, 0, 0];
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const x = (px + (sx + 0.5) / S) / size, y = (py + (sy + 0.5) / S) / size;
      let col = null, a = 0;
      if (background && inRoundRect(x, y, 0, 0, 1, 1, radius)) { col = BLUE; a = 1; }
      if (!mono && inRoundRect(x, y, bar.x0, bar.y0, bar.x1, bar.y1, bar.r)) { col = YELLOW; a = 1; }
      if (distSeg(x, y, ...check[0], ...check[1]) <= checkW / 2 || distSeg(x, y, ...check[1], ...check[2]) <= checkW / 2) { col = WHITE; a = 1; }
      if (col) { acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2]; acc[3] += a; }
    }
    const n = S * S, i = (py * size + px) * 4;
    if (acc[3]) { buf[i] = acc[0] / acc[3]; buf[i + 1] = acc[1] / acc[3]; buf[i + 2] = acc[2] / acc[3]; }
    buf[i + 3] = Math.round((acc[3] / n) * 255);
  }
  return png(size, buf);
}

fs.mkdirSync(OUT, { recursive: true });
const write = (name, data) => { fs.writeFileSync(path.join(OUT, name), data); console.log(name, data.length, 'bytes'); };
write('icon-192.png', draw(192, { radius: 0.22 }));
write('icon-512.png', draw(512, { radius: 0.22 }));
write('maskable-512.png', draw(512, { radius: 0, scale: 0.78 }));
write('apple-touch-icon.png', draw(180, { radius: 0 }));
write('badge-96.png', draw(96, { radius: 0, background: false, mono: true, scale: 1.15 }));
