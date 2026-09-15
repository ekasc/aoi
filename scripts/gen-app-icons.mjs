import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

// Aoi kept-page + seal mark. Flat shapes only: moss page block, ivory
// spine + text lines, clay seal disc. Rendered supersampled, downscaled
// with a box filter for clean edges. No gradients, no hearts, no clip-art.
const IVORY = [0xfc, 0xf9, 0xf2, 255];
const MOSS = [0x33, 0x4e, 0x45, 255];
const CLAY = [0x8a, 0x3e, 0x28, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

const SS = 3; // supersample factor
const N = 1024;

function buf(w, h, fill) {
  const b = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    b[i * 4] = fill[0]; b[i * 4 + 1] = fill[1]; b[i * 4 + 2] = fill[2]; b[i * 4 + 3] = fill[3];
  }
  return { w, h, px: b };
}

function setPx(img, x, y, c) {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  const i = (y * img.w + x) * 4;
  img.px[i] = c[0]; img.px[i + 1] = c[1]; img.px[i + 2] = c[2]; img.px[i + 3] = c[3];
}

function fillRect(img, x0, y0, x1, y1, c) {
  for (let y = Math.max(0, y0); y < Math.min(img.h, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(img.w, x1); x += 1) setPx(img, x, y, c);
  }
}

function fillCircle(img, cx, cy, r, c) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y += 1) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x += 1) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) setPx(img, x, y, c);
    }
  }
}

function fillRoundRect(img, x0, y0, x1, y1, r, c) {
  fillRect(img, x0 + r, y0, x1 - r, y1, c);
  fillRect(img, x0, y0 + r, x1, y1 - r, c);
  const corners = [[x0 + r, y0 + r], [x1 - r, y0 + r], [x0 + r, y1 - r], [x1 - r, y1 - r]];
  for (const [cx, cy] of corners) fillCircle(img, cx, cy, r, c);
}

// Draw the mark in a 1024-space mapped onto img (img is 1024*SS).
// opts: { mono } — monochrome silhouette (white page + seal, no details).
function drawMarkAt(img, s, ox, oy, mono) {
  const X = (v) => Math.round(ox + v * s);
  const R = (v) => Math.max(1, Math.round(v * s));
  const page = mono ? WHITE : MOSS;
  fillRoundRect(img, X(332), X(252), X(692), X(772), R(28), page);
  if (!mono) {
    fillRect(img, X(376), X(292), X(388), X(732), IVORY); // spine
    for (const y of [352, 412, 472]) fillRect(img, X(420), X(y), X(644), X(y + 20), IVORY);
    fillCircle(img, X(604), X(648), R(54), CLAY); // seal
    fillCircle(img, X(604), X(648), R(15), IVORY);
  } else {
    fillCircle(img, X(604), X(648), R(54), WHITE);
  }
}

// Box-downsample by integer factor k.
function downsample(img, k) {
  const w = Math.floor(img.w / k), h = Math.floor(img.h / k);
  const out = buf(w, h, CLEAR);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < k; dy += 1) {
        for (let dx = 0; dx < k; dx += 1) {
          const i = ((y * k + dy) * img.w + x * k + dx) * 4;
          r += img.px[i]; g += img.px[i + 1]; b += img.px[i + 2]; a += img.px[i + 3];
        }
      }
      const n = k * k, j = (y * w + x) * 4;
      out.px[j] = Math.round(r / n); out.px[j + 1] = Math.round(g / n);
      out.px[j + 2] = Math.round(b / n); out.px[j + 3] = Math.round(a / n);
    }
  }
  return out;
}

// Final-size canvas, supersampled working buffer, single downsample.
// layers: [{ size, dx, dy, mono }] in final px; mark drawn once at working res.
function compose(finalSize, bg, layers) {
  const img = buf(finalSize * SS, finalSize * SS, bg);
  for (const { size, dx, dy, mono } of layers) {
    drawMarkAt(img, (size * SS) / N, dx * SS, dy * SS, mono);
  }
  return downsample(img, SS);
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i += 1) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

async function writePng(path, img) {
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y += 1) {
    raw[y * (img.w * 4 + 1)] = 0;
    img.px.copy(raw, y * (img.w * 4 + 1) + 1, y * img.w * 4, (y + 1) * img.w * 4);
  }
  // PNG mandates a zlib (RFC 1950) stream in IDAT — raw deflate bytes
  // decode in some viewers but fail strict decoders (browsers, jimp).
  const compressed = deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0); ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
  console.log('wrote', path, img.w + 'x' + img.h, png.length + ' bytes');
}

const [,, outDir] = process.argv;

async function main() {
  // Full icon: ivory tile + full-color mark.
  await writePng(`${outDir}/icon.png`, compose(N, IVORY, [{ size: N, dx: 0, dy: 0, mono: false }]));
  // Splash: ivory + smaller centered mark.
  await writePng(
    `${outDir}/splash-icon.png`,
    compose(N, IVORY, [{ size: 430, dx: (N - 430) / 2, dy: (N - 430) / 2, mono: false }])
  );
  // Android foreground: transparent, mark in safe zone.
  await writePng(
    `${outDir}/android-icon-foreground.png`,
    compose(N, CLEAR, [{ size: 640, dx: (N - 640) / 2, dy: (N - 640) / 2, mono: false }])
  );
  // Android background: flat ivory.
  await writePng(`${outDir}/android-icon-background.png`, compose(512, IVORY, []));
  // Android monochrome: white silhouette on transparent.
  await writePng(
    `${outDir}/android-icon-monochrome.png`,
    compose(432, CLEAR, [{ size: 432, dx: 0, dy: 0, mono: true }])
  );
  // Favicon: downscaled icon.
  await writePng(`${outDir}/favicon.png`, compose(48, IVORY, [{ size: 48, dx: 0, dy: 0, mono: false }]));
}

main().catch((e) => { console.error(e); process.exit(1); });
