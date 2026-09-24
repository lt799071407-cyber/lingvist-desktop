/**
 * 生成默认应用图标（无需任何图片素材、无需联网）。
 *   输出：assets/icon.png（256×256）、assets/tray.png（64×64）、assets/icon.ico（16/32/48/256）
 *
 * 用法：node scripts/make-icon.js
 * 想换成自己的图：直接替换 assets/icon.png 和 assets/tray.png 即可，
 * 重新生成 ico 的话再跑一次本脚本（ico 也是从同一套像素画的）。
 */

const fs = require('node:fs');
const zlib = require('node:zlib');
const path = require('node:path');

const BG = [0x2f, 0x6d, 0xf6]; // 圆角底色
const FG = [0xff, 0xff, 0xff]; // 字母 L

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 在 256×256 的设计坐标系里判断某点是否落在图标内
function insideShape(u, v) {
  const r = 56;
  const inRect = u >= 0 && u < 256 && v >= 0 && v < 256;
  if (!inRect) return false;
  const cx = Math.min(Math.max(u, r), 256 - r);
  const cy = Math.min(Math.max(v, r), 256 - r);
  const d = (u - cx) ** 2 + (v - cy) ** 2;
  return d <= r * r;
}

function isLetter(u, v) {
  const vertical = u >= 88 && u <= 116 && v >= 60 && v <= 196;
  const horizontal = u >= 88 && u <= 172 && v >= 168 && v <= 196;
  return vertical || horizontal;
}

function renderRGBA(size) {
  const ss = 4; // 4 倍超采样后降采样，边缘更干净
  const n = size * ss;
  const acc = new Float32Array(size * size * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = ((x + 0.5) / n) * 256;
      const v = ((y + 0.5) / n) * 256;
      if (!insideShape(u, v)) continue;
      const c = isLetter(u, v) ? FG : BG;
      const o = ((y >> 2) * size + (x >> 2)) * 4;
      acc[o] += c[0];
      acc[o + 1] += c[1];
      acc[o + 2] += c[2];
      acc[o + 3] += 255;
    }
  }
  const out = Buffer.alloc(size * size * 4);
  const per = ss * ss;
  for (let i = 0; i < out.length; i++) out[i] = Math.round(acc[i] / per);
  return out;
}

function icoEntry(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR + AND mask
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const xorSize = size * size * 4;
  const maskRow = Math.ceil(size / 32) * 4;
  const andSize = maskRow * size;
  header.writeUInt32LE(xorSize + andSize, 20);

  const xor = Buffer.alloc(xorSize);
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4; // ICO 是自下而上存行
    for (let x = 0; x < size; x++) {
      const s = src + x * 4;
      const d = (y * size + x) * 4;
      xor[d] = rgba[s + 2];
      xor[d + 1] = rgba[s + 1];
      xor[d + 2] = rgba[s];
      xor[d + 3] = rgba[s + 3];
    }
  }

  const and = Buffer.alloc(andSize);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const alpha = rgba[((size - 1 - y) * size + x) * 4 + 3];
      if (alpha === 0) and[y * maskRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, xor, and]);
}

function buildICO(sizes) {
  const images = sizes.map((s) => ({ s, data: icoEntry(s, renderRGBA(s)) }));
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = [];
  for (const { s, data } of images) {
    const e = Buffer.alloc(16);
    e[0] = s === 256 ? 0 : s;
    e[1] = s === 256 ? 0 : s;
    e[2] = 0;
    e[3] = 0;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }
  return Buffer.concat([dir, ...entries, ...images.map((i) => i.data)]);
}

const assets = path.join(__dirname, '..', 'assets');
fs.mkdirSync(assets, { recursive: true });

fs.writeFileSync(path.join(assets, 'icon.png'), encodePNG(256, 256, renderRGBA(256)));
fs.writeFileSync(path.join(assets, 'tray.png'), encodePNG(64, 64, renderRGBA(64)));
fs.writeFileSync(path.join(assets, 'icon.ico'), buildICO([16, 32, 48, 256]));

console.log('已生成 assets/icon.png(256) assets/tray.png(64) assets/icon.ico(16/32/48/256)');
