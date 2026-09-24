/**
 * 把一张现成图片转成应用的图标资源。
 *   用法：node scripts/use-image-icon.js <图片路径>
 *
 * 行为：
 *   1. 解码 PNG（支持 8bit 灰度/RGB/调色板/灰度+A/RGBA，非隔行）
 *   2. 裁掉透明边，居中放到正方形画布（留 6% 边距）
 *   3. 生成 assets/tray.png(32)、assets/icon.png(256)、assets/icon.ico(16/32/48/256)
 *      源图太小（<128px）时跳过 icon.png / icon.ico，只更新托盘图标，避免放大发糊
 */

const fs = require('node:fs');
const zlib = require('node:zlib');
const path = require('node:path');

const input = process.argv[2];
if (!input) {
  console.error('用法: node scripts/use-image-icon.js <图片路径>');
  process.exit(1);
}

// ---------- PNG 解码 ----------
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG 文件');
  let pos = 8;
  let w = 0; let h = 0; let bitDepth = 0; let colorType = 0; let interlace = 0;
  let palette = null; let trns = null; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`暂不支持 ${bitDepth}bit 位深，请导出为 8bit PNG`);
  if (interlace !== 0) throw new Error('暂不支持隔行扫描（interlaced）PNG');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`暂不支持颜色类型 ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = w * channels;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const line = Buffer.alloc(stride);
    const filter = raw[y * (stride + 1)];
    raw.copy(line, 0, y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      if (filter === 1) line[i] = (line[i] + a) & 0xff;
      else if (filter === 2) line[i] = (line[i] + b) & 0xff;
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
    }
    prev = line;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const i = x * channels;
      if (colorType === 6) { out[o] = line[i]; out[o + 1] = line[i + 1]; out[o + 2] = line[i + 2]; out[o + 3] = line[i + 3]; }
      else if (colorType === 2) { out[o] = line[i]; out[o + 1] = line[i + 1]; out[o + 2] = line[i + 2]; out[o + 3] = 255; }
      else if (colorType === 0) { out[o] = out[o + 1] = out[o + 2] = line[i]; out[o + 3] = 255; }
      else if (colorType === 4) { out[o] = out[o + 1] = out[o + 2] = line[i]; out[o + 3] = line[i + 1]; }
      else if (colorType === 3) {
        const idx = line[i];
        out[o] = palette[idx * 3]; out[o + 1] = palette[idx * 3 + 1]; out[o + 2] = palette[idx * 3 + 2];
        out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      }
    }
  }
  return { w, h, rgba: out };
}

// ---------- 缩放（预乘 alpha 的面积平均 / 双线性） ----------
function toPremul(w, h, rgba) {
  const p = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3] / 255;
    p[i * 4] = rgba[i * 4] * a; p[i * 4 + 1] = rgba[i * 4 + 1] * a;
    p[i * 4 + 2] = rgba[i * 4 + 2] * a; p[i * 4 + 3] = rgba[i * 4 + 3];
  }
  return p;
}

function boxResize(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  for (let dy = 0; dy < dh; dy++) {
    const y0 = (dy * sh) / dh; const y1 = ((dy + 1) * sh) / dh;
    for (let dx = 0; dx < dw; dx++) {
      const x0 = (dx * sw) / dw; const x1 = ((dx + 1) * sw) / dw;
      let r = 0; let g = 0; let b = 0; let a = 0; let area = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const wy = Math.min(y1, y + 1) - Math.max(y0, y);
        if (wy <= 0) continue;
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const wx = Math.min(x1, x + 1) - Math.max(x0, x);
          if (wx <= 0) continue;
          const wgt = wx * wy;
          const s = (Math.min(y, sh - 1) * sw + Math.min(x, sw - 1)) * 4;
          r += src[s] * wgt; g += src[s + 1] * wgt; b += src[s + 2] * wgt; a += src[s + 3] * wgt;
          area += wgt;
        }
      }
      const o = (dy * dw + dx) * 4;
      if (area > 0) {
        const pa = a / area;
        out[o + 3] = Math.round(pa);
        if (pa > 0.0001) {
          out[o] = Math.round((r / area) * 255 / pa);
          out[o + 1] = Math.round((g / area) * 255 / pa);
          out[o + 2] = Math.round((b / area) * 255 / pa);
        }
      }
    }
  }
  return out;
}

function bilinearResize(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  for (let dy = 0; dy < dh; dy++) {
    const fy = ((dy + 0.5) * sh) / dh - 0.5;
    const y0 = Math.max(0, Math.floor(fy)); const y1 = Math.min(sh - 1, y0 + 1); const ty = fy - y0;
    for (let dx = 0; dx < dw; dx++) {
      const fx = ((dx + 0.5) * sw) / dw - 0.5;
      const x0 = Math.max(0, Math.floor(fx)); const x1 = Math.min(sw - 1, x0 + 1); const tx = fx - x0;
      for (let c = 0; c < 4; c++) {
        const v =
          src[(y0 * sw + x0) * 4 + c] * (1 - tx) * (1 - ty) +
          src[(y0 * sw + x1) * 4 + c] * tx * (1 - ty) +
          src[(y1 * sw + x0) * 4 + c] * (1 - tx) * ty +
          src[(y1 * sw + x1) * 4 + c] * tx * ty;
        out[(dy * dw + dx) * 4 + c] = Math.round(v);
      }
    }
  }
  return out;
}

function resizeTo(src, sw, sh, size) {
  return sw >= size || sh >= size
    ? boxResize(src, sw, sh, size, size)
    : bilinearResize(src, sw, sh, size, size);
}

// 裁掉透明边后居中放到正方形画布，四周留 6% 边距
function normalizeSquare(w, h, rgba) {
  let minX = w; let minY = h; let maxX = -1; let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('图片是全透明的');
  const cw = maxX - minX + 1; const ch = maxY - minY + 1;
  const side = Math.max(cw, ch);
  const margin = Math.round(side * 0.06);
  const canvas = side + margin * 2;
  const out = Buffer.alloc(canvas * canvas * 4);
  const ox = Math.floor((canvas - cw) / 2); const oy = Math.floor((canvas - ch) / 2);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const s = ((minY + y) * w + (minX + x)) * 4;
      const d = ((oy + y) * canvas + (ox + x)) * 4;
      out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = rgba[s + 3];
    }
  }
  return { size: canvas, rgba: out };
}

// ---------- PNG / ICO 编码（与 make-icon.js 相同） ----------
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
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function icoEntry(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const xorSize = size * size * 4;
  const maskRow = Math.ceil(size / 32) * 4;
  const andSize = maskRow * size;
  header.writeUInt32LE(xorSize + andSize, 20);
  const xor = Buffer.alloc(xorSize);
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4;
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
      if (rgba[((size - 1 - y) * size + x) * 4 + 3] === 0) and[y * maskRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, xor, and]);
}

// 由正方形 master(rgba Buffer, side×side) 生成各尺寸 ICO
function buildICOFromMaster(master, side, sizes) {
  const images = sizes.map((s) => ({ s, data: icoEntry(s, resizeTo(master, side, side, s)) }));
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
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }
  return Buffer.concat([dir, ...entries, ...images.map((i) => i.data)]);
}

// ---------- 主流程 ----------
const { w, h, rgba } = decodePNG(fs.readFileSync(input));

// 背景透明度检查：托盘/任务栏图标需要透明底，白底会很难看
let clearCount = 0;
for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 8) clearCount++;
const clearPct = Math.round((clearCount / (w * h)) * 100);
const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + w - 1) * 4].map((o) => rgba[o + 3]);
console.log(`透明像素占比 ${clearPct}%，四角 alpha = [${corners.join(', ')}]`);
if (clearPct < 1) {
  console.log('⚠ 这张图没有透明背景。用作托盘图标会带一整块底色。');
  console.log('  建议：在设计工具里把背景层关掉再导出 PNG；或确认底色与托盘深浅相容。');
}

const sq = normalizeSquare(w, h, rgba);
const assets = path.join(__dirname, '..', 'assets');
fs.mkdirSync(assets, { recursive: true });

fs.writeFileSync(path.join(assets, 'tray.png'), encodePNG(32, 32, resizeTo(sq.rgba, sq.size, sq.size, 32)));
console.log(`tray.png 已更新（源图 ${w}×${h} → 32×32）`);

if (Math.max(w, h) >= 128) {
  fs.writeFileSync(path.join(assets, 'icon.png'), encodePNG(256, 256, resizeTo(sq.rgba, sq.size, sq.size, 256)));
  fs.writeFileSync(path.join(assets, 'icon.ico'), buildICOFromMaster(sq.rgba, sq.size, [16, 32, 48, 256]));
  console.log('icon.png(256) 与 icon.ico(16/32/48/256) 已更新');
} else {
  console.log(`源图只有 ${Math.max(w, h)}px，icon.png / icon.ico 保持占位图不变`);
  console.log('要更新应用图标，请导出一张 512×512 或 1024×1024 的 PNG 后重新运行本脚本');
}
