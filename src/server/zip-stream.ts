/**
 * Minimal streaming ZIP writer (store method, no compression, no zip64). Generated images are
 * already compressed, so storing them keeps the code small and the download instant. Files are
 * read one at a time, so memory stays at about one image no matter how many are archived.
 */

/** Classic ZIP limits: 65535 entries and 4 GiB per file and in total. */
export const ZIP_MAX_ENTRIES = 0xffff;
export const ZIP_MAX_BYTES = 0xffffffff;

export interface ZipEntry {
  /** Path inside the archive, `/`-separated and unique. */
  name: string;
  /** Loads the file's bytes when the entry is reached. */
  read: () => Promise<Uint8Array>;
}

interface CentralRecord {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
}

const encoder = new TextEncoder();

function dosDateTime(date: Date): { time: number; day: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function localHeader(rec: CentralRecord, stamp: { time: number; day: number }): Uint8Array {
  const buf = new Uint8Array(30 + rec.name.length);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true); // version needed
  view.setUint16(6, 0x0800, true); // flags: names are UTF-8
  view.setUint16(8, 0, true); // method: stored
  view.setUint16(10, stamp.time, true);
  view.setUint16(12, stamp.day, true);
  view.setUint32(14, rec.crc, true);
  view.setUint32(18, rec.size, true); // compressed size
  view.setUint32(22, rec.size, true); // uncompressed size
  view.setUint16(26, rec.name.length, true);
  buf.set(rec.name, 30);
  return buf;
}

function centralDirectory(records: CentralRecord[], stamp: { time: number; day: number }, offset: number): Uint8Array {
  const size = records.reduce((n, r) => n + 46 + r.name.length, 0);
  const buf = new Uint8Array(size + 22);
  const view = new DataView(buf.buffer);
  let pos = 0;
  for (const rec of records) {
    view.setUint32(pos, 0x02014b50, true);
    view.setUint16(pos + 4, 20, true); // version made by
    view.setUint16(pos + 6, 20, true); // version needed
    view.setUint16(pos + 8, 0x0800, true);
    view.setUint16(pos + 10, 0, true);
    view.setUint16(pos + 12, stamp.time, true);
    view.setUint16(pos + 14, stamp.day, true);
    view.setUint32(pos + 16, rec.crc, true);
    view.setUint32(pos + 20, rec.size, true);
    view.setUint32(pos + 24, rec.size, true);
    view.setUint16(pos + 28, rec.name.length, true);
    view.setUint32(pos + 42, rec.offset, true);
    buf.set(rec.name, pos + 46);
    pos += 46 + rec.name.length;
  }
  view.setUint32(pos, 0x06054b50, true);
  view.setUint16(pos + 8, records.length, true);
  view.setUint16(pos + 10, records.length, true);
  view.setUint32(pos + 12, size, true);
  view.setUint32(pos + 16, offset, true);
  return buf;
}

/** Streams the entries as one ZIP archive. The caller keeps the entry count and total size within the classic limits. */
export function zipStream(entries: ZipEntry[], now = new Date()): ReadableStream<Uint8Array> {
  const stamp = dosDateTime(now);
  const records: CentralRecord[] = [];
  let next = 0;
  let offset = 0;
  let finished = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;
      if (next < entries.length) {
        const entry = entries[next++]!;
        const data = await entry.read();
        const rec: CentralRecord = { name: encoder.encode(entry.name), crc: Bun.hash.crc32(data), size: data.length, offset };
        const header = localHeader(rec, stamp);
        records.push(rec);
        offset += header.length + data.length;
        controller.enqueue(header);
        controller.enqueue(data);
        return;
      }
      finished = true;
      controller.enqueue(centralDirectory(records, stamp, offset));
      controller.close();
    },
  });
}
