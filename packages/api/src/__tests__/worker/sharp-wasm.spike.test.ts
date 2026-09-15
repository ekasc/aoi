import { describe, expect, it } from 'vitest';

/**
 * Stage 0 de-risking spike — sharp 0.35 WASM on workerd.
 *
 * Everything in the media pipeline depends on sharp being able to re-encode
 * images inside a Cloudflare Worker (or, here, the workerd isolate provided
 * by @cloudflare/vitest-pool-workers). This test is the verdict: if it
 * passes, Stage 10 can build the sanitize job on server-side re-encode. If
 * it fails, the documented fallback applies (client `exif:false` baseline +
 * magic-byte verification, server re-encode deferred; see
 * docs/shape/spike-sharp-wasm.md).
 *
 * The test deliberately mirrors Tsuki's proven pattern:
 * - `const { default: sharp } = await import('sharp')` — dynamic import
 * - `sharp(buffer, { limitInputPixels: 268402689, sequentialRead: true })`
 * - sharp pinned to 0.35.3 with `@img/sharp-wasm32` installed explicitly
 *   (sharp resolves the WASM runtime under workerd via the freebsd/fallback
 *   platform entries in `dist/sharp.cjs`).
 */

describe('sharp WASM on workerd (spike)', () => {
  it('dynamically imports sharp inside the workerd isolate', async () => {
    const { default: sharp } = await import('sharp');
    expect(typeof sharp).toBe('function');
    const metadata = await sharp({
      create: { width: 1, height: 1, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).metadata();
    expect(metadata.width).toBe(1);
  });

  it('re-encodes an EXIF-carrying JPEG to clean WebP (metadata stripped)', async () => {
    const { default: sharp } = await import('sharp');

    // Build a tiny JPEG with EXIF (Copyright/Software) using sharp itself.
    // The whole EXIF segment is dropped on re-encode, which is what makes
    // GPS/location metadata unreadable after sanitization.
    const source = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 210, g: 105, b: 55 } },
    })
      .jpeg({ quality: 90 })
      .withMetadata({
        exif: {
          IFD0: { Copyright: 'Aoi spike fixture', Software: 'aoi-spike-0.35' },
        },
      })
      .toBuffer();

    const sourceMeta = await sharp(source).metadata();
    expect(sourceMeta.format).toBe('jpeg');
    expect(sourceMeta.exif).toBeTruthy();

    // The production pipeline shape: limit pixels, sequential read, WebP out.
    const out = await sharp(source, { limitInputPixels: 268_402_689, sequentialRead: true })
      .webp({ quality: 84 })
      .toBuffer();

    const outMeta = await sharp(out).metadata();
    expect(outMeta.format).toBe('webp');
    expect(outMeta.width).toBe(64);
    // Re-encode must not carry the input's EXIF forward (GPS is gone).
    expect(outMeta.exif).toBeUndefined();
  });

  it('enforces limitInputPixels (dimension/pixel cap mechanism works)', async () => {
    const { default: sharp } = await import('sharp');
    const input = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();

    // 64×64 = 4096 pixels > limit of 1000 → decode must reject.
    await expect(
      sharp(input, { limitInputPixels: 1000 }).jpeg().toBuffer()
    ).rejects.toThrow(/pixel limit/i);
  });
});
