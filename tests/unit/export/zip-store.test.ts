import { describe, expect, it } from 'vitest';

import {
  crc32Of,
  ZipStoreWriter,
  ZIP_STREAM_CHUNK_BYTES,
  type ZipAppendSink,
} from '@/features/export/zip-store';

/** In-memory append sink with positioned patching (mirrors the FS adapter). */
class MemorySink implements ZipAppendSink {
  bytes = new Uint8Array(0);

  writeBytes(chunk: Uint8Array): void {
    const next = new Uint8Array(this.bytes.length + chunk.length);
    next.set(this.bytes, 0);
    next.set(chunk, this.bytes.length);
    this.bytes = next;
  }

  patchBytes(offset: number, chunk: Uint8Array): void {
    this.bytes.set(chunk, offset);
  }
}

type ParsedEntry = { name: string; data: Uint8Array; crc: number; method: number };

/** Minimal structural parser: EOCD → central directory → local entries. */
function parseZip(bytes: Uint8Array): ParsedEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const findEocd = (): number => {
    for (let i = bytes.length - 22; i >= 0; i -= 1) {
      if (view.getUint32(i, true) === 0x06054b50) return i;
    }
    throw new Error('no EOCD');
  };
  const eocd = findEocd();
  const count = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  const text = new TextDecoder();
  const entries: ParsedEntry[] = [];
  let pos = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(pos, true) !== 0x02014b50) throw new Error('bad central header');
    const method = view.getUint16(pos + 10, true);
    const crc = view.getUint32(pos + 16, true);
    const size = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = text.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    entries.push({
      name,
      data: bytes.subarray(dataStart, dataStart + size),
      crc,
      method,
    });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

describe('ZipStoreWriter', () => {
  it('round-trips stored entries with valid CRCs (no compression)', async () => {
    const sink = new MemorySink();
    const writer = new ZipStoreWriter(sink, new Date('2026-03-01T12:00:00.000Z'));
    const hello = new TextEncoder().encode('{"hello":"world"}');
    await writer.addBytes('manifest.json', hello);
    await writer.addBytes('media/photo.jpg', new Uint8Array([1, 2, 3, 4, 5]));
    await writer.finish();

    const entries = parseZip(sink.bytes);
    expect(entries.map((e) => e.name)).toEqual(['manifest.json', 'media/photo.jpg']);
    expect(entries.every((e) => e.method === 0)).toBe(true);
    expect(new TextDecoder().decode(entries[0].data)).toBe('{"hello":"world"}');
    expect([...entries[1].data]).toEqual([1, 2, 3, 4, 5]);
    for (const entry of entries) {
      expect(entry.crc).toBe(crc32Of(entry.data));
    }
  });

  it('streams large parts chunk-wise with a patched header (single chunk in RAM)', async () => {
    const sink = new MemorySink();
    const writer = new ZipStoreWriter(sink);
    const size = ZIP_STREAM_CHUNK_BYTES * 2 + 123;
    const source = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) source[i] = i & 0xff;
    const seenLengths: number[] = [];
    await writer.addStream('media/big.bin', size, async (offset, length) => {
      seenLengths.push(length);
      return source.subarray(offset, offset + length);
    });
    await writer.finish();

    expect(Math.max(...seenLengths)).toBeLessThanOrEqual(ZIP_STREAM_CHUNK_BYTES);
    const entries = parseZip(sink.bytes);
    expect(entries).toHaveLength(1);
    expect(entries[0].data.length).toBe(size);
    expect([...entries[0].data]).toEqual([...source]);
    expect(entries[0].crc).toBe(crc32Of(source));
  });

  it('keeps unicode names and empty archives valid', async () => {
    const sink = new MemorySink();
    const writer = new ZipStoreWriter(sink);
    await writer.addBytes('notes/été-☕.json', new TextEncoder().encode('[]'));
    await writer.finish();
    const entries = parseZip(sink.bytes);
    expect(entries.map((e) => e.name)).toEqual(['notes/été-☕.json']);

    const emptySink = new MemorySink();
    const empty = new ZipStoreWriter(emptySink);
    await empty.finish();
    expect(parseZip(emptySink.bytes)).toEqual([]);
  });
});
