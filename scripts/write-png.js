'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function writeRgb(raw, width, x, y, rgb) {
  const i = y * (width * 3 + 1) + 1 + x * 3;
  raw[i] = rgb[0];
  raw[i + 1] = rgb[1];
  raw[i + 2] = rgb[2];
}

function fillRect(raw, width, x0, y0, x1, y1, rgb) {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1)));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1)));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1)));
  const height = raw.length / (width * 3 + 1);
  const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1)));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      writeRgb(raw, width, x, y, rgb);
    }
  }
}

function fillCircle(raw, width, cx, cy, radius, rgb) {
  const height = raw.length / (width * 3 + 1);
  const r2 = radius * radius;
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(height - 1, Math.ceil(cy + radius));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        writeRgb(raw, width, x, y, rgb);
      }
    }
  }
}

function writePngBuffer(width, height, paint) {
  const raw = Buffer.alloc((width * 3 + 1) * height, 0);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0;
  }
  paint(raw, width, height);
  return raw;
}

function writePng(filePath, width, height, rgb) {
  const raw = writePngBuffer(width, height, (buf, w, h) => {
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const t = x / Math.max(1, w - 1);
        const u = y / Math.max(1, h - 1);
        writeRgb(buf, w, x, y, [
          Math.round(rgb[0] * (0.75 + 0.25 * t)),
          Math.round(rgb[1] * (0.8 + 0.2 * u)),
          Math.round(rgb[2] * (0.85 + 0.15 * (1 - t))),
        ]);
      }
    }
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    const r = Math.min(w, h) * 0.28;
    fillCircle(buf, w, cx, cy, r, [245, 247, 250]);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        if (Math.abs(dx) < r * 0.08 && dy < -r * 0.7 && dy > -r * 1.15) {
          writeRgb(buf, w, x, y, [40, 50, 55]);
        }
      }
    }
  });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, png);
}

const root = path.join(__dirname, '..');
if (process.env.WRITE_APP_IMAGES === '1') {
  writePng(path.join(root, 'assets/images/small.png'), 250, 175, [21, 94, 99]);
  writePng(path.join(root, 'assets/images/large.png'), 500, 350, [21, 94, 99]);
  writePng(path.join(root, 'assets/images/xlarge.png'), 1000, 700, [21, 94, 99]);
  writePng(path.join(root, 'drivers/vacuum/assets/images/small.png'), 75, 75, [21, 94, 99]);
  writePng(path.join(root, 'drivers/vacuum/assets/images/large.png'), 500, 500, [21, 94, 99]);
  writePng(path.join(root, 'drivers/vacuum/assets/images/xlarge.png'), 1000, 1000, [21, 94, 99]);
}

function writeMapPreview(filePath, dark) {
  const bg = dark ? [28, 28, 30] : [255, 255, 255];
  const floor = dark ? [31, 92, 97] : [213, 236, 238];
  const wall = dark ? [143, 211, 215] : [21, 94, 99];
  const trail = [224, 122, 61];
  const robot = dark ? [94, 224, 232] : [21, 94, 99];
  const charger = dark ? [142, 224, 162] : [47, 125, 50];
  const width = 500;
  const height = 500;
  const raw = writePngBuffer(width, height, (buf) => {
    fillRect(buf, width, 0, 0, width, height, bg);
    fillRect(buf, width, 70, 80, 430, 410, floor);
    fillRect(buf, width, 70, 80, 430, 96, wall);
    fillRect(buf, width, 70, 80, 86, 410, wall);
    fillRect(buf, width, 414, 80, 430, 410, wall);
    fillRect(buf, width, 70, 394, 430, 410, wall);
    fillRect(buf, width, 230, 80, 246, 220, wall);
    fillRect(buf, width, 70, 250, 220, 266, wall);
    fillRect(buf, width, 300, 250, 430, 266, wall);
    for (let i = 0; i < 90; i += 1) {
      const t = i / 89;
      const x = 140 + t * 180;
      const y = 330 - Math.sin(t * Math.PI) * 90;
      fillCircle(buf, width, x, y, 4, trail);
    }
    fillRect(buf, width, 118, 318, 146, 346, charger);
    fillCircle(buf, width, 318, 248, 16, robot);
    fillCircle(buf, width, 338, 248, 7, robot);
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, png);
}

writeMapPreview(path.join(root, 'widgets/map/preview-light.png'), false);
writeMapPreview(path.join(root, 'widgets/map/preview-dark.png'), true);
console.log('Wrote Homey PNG assets');
