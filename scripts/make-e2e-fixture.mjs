// Writes assets/e2e-test-photo.png: a valid 8x8 PNG (deterministic bytes).
// Sealed and uploaded by Flow C through the real encrypted-media pipeline;
// the bytes only need to be unfamiliar to both phones, not beautiful.
// It lives under assets/ (not e2e/fixtures/) because Metro must resolve it
// from the app graph: app/dev-e2e.tsx requires it at module scope.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'assets');
mkdirSync(dir, { recursive: true });

const width = 8;
const height = 8;
const raw = Buffer.alloc((width * 4 + 1) * height);
for (let y = 0; y < height; y += 1) {
  raw[y * (width * 4 + 1)] = 0; // filter 0
  for (let x = 0; x < width; x += 1) {
    const o = y * (width * 4 + 1) + 1 + x * 4;
    raw[o] = (x * 32) % 256;
    raw[o + 1] = (y * 32) % 256;
    raw[o + 2] = 128;
    raw[o + 3] = 255;
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Minimal CRC32 (no dependency).
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    crc32.table = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', (() => { const b = Buffer.alloc(13); b.writeUInt32BE(width, 0); b.writeUInt32BE(height, 4); b[8] = 8; b[9] = 6; return b; })()),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = join(dir, 'e2e-test-photo.png');
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
