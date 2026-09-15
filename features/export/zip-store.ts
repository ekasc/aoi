/**
 * Minimal store-only (uncompressed) ZIP writer over an abstract byte sink.
 *
 * Raw data export deliberately avoids compression: original media bytes are
 * preserved bit-for-bit (no photo recompression for aesthetics), and a
 * store-only layout streams with O(1) RAM — small parts (JSON, headers)
 * buffer in memory while large media streams chunk-by-chunk from disk.
 *
 * No dependency: the ZIP local/central/end structures needed for method-0
 * entries fit in a few dozen lines, and every writer here is covered by
 * round-trip structural tests (tests/unit/export/zip-store.test.ts).
 *
 * Limits (honest, explicit): names ≤ 64 KiB UTF-8, archive < 4 GiB
 * (no ZIP64 — a larger Space fails with a clear error, never a corrupt
 * archive). Timestamps are DOS-encodeable (>= 1980); older dates clamp.
 */

export const ZIP_STREAM_CHUNK_BYTES = 64 * 1024;
const MAX_ZIP_SIZE = 0xffffffff;
const MAX_NAME_BYTES = 0xffff;

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const END_OF_CENTRAL_SIG = 0x06054b50;

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32Init(): number {
  return 0xffffffff;
}

export function crc32Update(crc: number, chunk: Uint8Array): number {
  let c = crc >>> 0;
  for (let i = 0; i < chunk.length; i += 1) {
    c = CRC_TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
  }
  return c >>> 0;
}

export function crc32Final(crc: number): number {
  return (crc ^ 0xffffffff) >>> 0;
}

export function crc32Of(data: Uint8Array): number {
  return crc32Final(crc32Update(crc32Init(), data));
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = date.getFullYear();
  const clampedYear = year < 1980 ? 1980 : year;
  return {
    time:
      ((date.getHours() & 0x1f) << 11) |
      ((date.getMinutes() & 0x3f) << 5) |
      ((Math.floor(date.getSeconds() / 2) & 0x1f) >>> 0),
    date:
      (((clampedYear - 1980) & 0x7f) << 9) |
      (((date.getMonth() + 1) & 0x0f) << 5) |
      ((date.getDate() & 0x1f) >>> 0),
  };
}

function u16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function u32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

/** Append-only sink (disk file, memory buffer in tests). */
export interface ZipAppendSink {
  writeBytes(chunk: Uint8Array): void | Promise<void>;
  /** Overwrite previously written bytes (single-pass streaming CRC). */
  patchBytes(offset: number, chunk: Uint8Array): void | Promise<void>;
}

type ZipEntry = {
  nameBytes: Uint8Array;
  crc: number;
  size: number;
  localHeaderOffset: number;
  time: number;
  date: number;
};

export class ZipStoreWriter {
  private offset = 0;
  private readonly entries: ZipEntry[] = [];
  private readonly encoder = new TextEncoder();
  private readonly dos: { time: number; date: number };
  private finished = false;

  constructor(
    private readonly sink: ZipAppendSink,
    now: Date = new Date()
  ) {
    this.dos = dosDateTime(now);
  }

  private async emit(chunk: Uint8Array): Promise<void> {
    if (this.offset + chunk.length > MAX_ZIP_SIZE) {
      throw new Error('This Space is too large to export on this device.');
    }
    await this.sink.writeBytes(chunk);
    this.offset += chunk.length;
  }

  private encodeName(name: string): Uint8Array {
    const bytes = this.encoder.encode(name);
    if (bytes.length === 0 || bytes.length > MAX_NAME_BYTES) {
      throw new Error(`Cannot archive entry with an invalid name: ${name || '(empty)'}`);
    }
    return bytes;
  }

  private localHeader(nameBytes: Uint8Array, crc: number, size: number): Uint8Array {
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    u32(view, 0, LOCAL_HEADER_SIG);
    u16(view, 4, 20); // version needed
    u16(view, 6, 0x0800); // UTF-8 names
    u16(view, 8, 0); // method: store
    u16(view, 10, this.dos.time);
    u16(view, 12, this.dos.date);
    u32(view, 14, crc);
    u32(view, 18, size);
    u32(view, 22, size);
    u16(view, 26, nameBytes.length);
    u16(view, 28, 0); // no extra field
    header.set(nameBytes, 30);
    return header;
  }

  /** Small complete part (JSON, manifest): CRC known up front. */
  async addBytes(name: string, data: Uint8Array): Promise<void> {
    this.assertOpen();
    const nameBytes = this.encodeName(name);
    if (data.length > MAX_ZIP_SIZE) {
      throw new Error('This Space is too large to export on this device.');
    }
    const headerOffset = this.offset;
    await this.emit(this.localHeader(nameBytes, crc32Of(data), data.length));
    await this.emit(data);
    this.entries.push({
      nameBytes,
      crc: crc32Of(data),
      size: data.length,
      localHeaderOffset: headerOffset,
      time: this.dos.time,
      date: this.dos.date,
    });
  }

  /**
   * Large part (media): single pass — header placeholder, chunked data
   * with incremental CRC, then seek back and patch CRC/sizes. At most one
   * chunk lives in RAM.
   */
  async addStream(
    name: string,
    size: number,
    readChunk: (offset: number, length: number) => Promise<Uint8Array>
  ): Promise<void> {
    this.assertOpen();
    if (!Number.isInteger(size) || size < 0 || size > MAX_ZIP_SIZE) {
      throw new Error(`Cannot archive ${name}: unreadable size.`);
    }
    const nameBytes = this.encodeName(name);
    const headerOffset = this.offset;
    await this.emit(this.localHeader(nameBytes, 0, 0));
    let crc = crc32Init();
    let position = 0;
    while (position < size) {
      const chunk = await readChunk(position, Math.min(ZIP_STREAM_CHUNK_BYTES, size - position));
      if (chunk.length === 0) {
        throw new Error(`Cannot archive ${name}: file changed while reading.`);
      }
      await this.emit(chunk);
      crc = crc32Update(crc, chunk);
      position += chunk.length;
    }
    const finalCrc = crc32Final(crc);
    const patch = new Uint8Array(12);
    const view = new DataView(patch.buffer);
    u32(view, 0, finalCrc);
    u32(view, 4, size);
    u32(view, 8, size);
    await this.sink.patchBytes(headerOffset + 14, patch);
    this.entries.push({
      nameBytes,
      crc: finalCrc,
      size,
      localHeaderOffset: headerOffset,
      time: this.dos.time,
      date: this.dos.date,
    });
  }

  /** Central directory + end record. The writer is single-use. */
  async finish(): Promise<void> {
    this.assertOpen();
    this.finished = true;
    const centralOffset = this.offset;
    let centralSize = 0;
    for (const entry of this.entries) {
      const record = new Uint8Array(46 + entry.nameBytes.length);
      const view = new DataView(record.buffer);
      u32(view, 0, CENTRAL_HEADER_SIG);
      u16(view, 4, 20); // version made by
      u16(view, 6, 20); // version needed
      u16(view, 8, 0x0800);
      u16(view, 10, 0);
      u16(view, 12, entry.time);
      u16(view, 14, entry.date);
      u32(view, 16, entry.crc);
      u32(view, 20, entry.size);
      u32(view, 24, entry.size);
      u16(view, 28, entry.nameBytes.length);
      u16(view, 30, 0);
      u16(view, 32, 0);
      u16(view, 34, 0);
      u16(view, 36, 0);
      u32(view, 38, 0);
      u32(view, 42, entry.localHeaderOffset);
      record.set(entry.nameBytes, 46);
      await this.emit(record);
      centralSize += record.length;
    }
    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    u32(view, 0, END_OF_CENTRAL_SIG);
    u16(view, 8, this.entries.length);
    u16(view, 10, this.entries.length);
    u32(view, 12, centralSize);
    u32(view, 16, centralOffset);
    u16(view, 20, 0);
    await this.emit(end);
  }

  private assertOpen(): void {
    if (this.finished) {
      throw new Error('Archive writer is already finished.');
    }
  }
}
