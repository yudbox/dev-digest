/**
 * Minimal ZIP builder and extractor using Node.js built-ins only.
 *
 * Build: `buildZip` produces a standard ZIP archive (STORE method, CRC-32 included).
 * Extract: `extractFirstFileFromZip` reads the first file from a ZIP buffer.
 *
 * No external dependencies — avoids pulling transitive/untyped packages into
 * the critical path. Sufficient for the CI export and ingest use-cases (small
 * text files, single-artifact ZIPs).
 */
import { inflateRawSync } from "node:zlib";

// ---------------------------------------------------------------------------
// CRC-32 (IEEE 802.3 polynomial, table-based)
// ---------------------------------------------------------------------------

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (CRC32_TABLE[(crc ^ buf[i]!) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// ZIP builder — STORE method (no compression, maximum compatibility)
// ---------------------------------------------------------------------------

export interface ZipEntry {
  path: string;
  contents: string;
}

/**
 * Build a standard ZIP archive buffer from an array of text files.
 * Uses STORE (method=0) for simplicity — content is already text/yaml/json so
 * compression ratio would be low anyway.
 */
export function buildZip(files: ZipEntry[]): Buffer {
  const localHeaders: Buffer[] = [];
  const offsets: number[] = [];
  const crcs: number[] = [];
  const dataBufs: Buffer[] = [];
  const nameBufs: Buffer[] = [];

  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.path, "utf-8");
    const dataBuf = Buffer.from(file.contents, "utf-8");
    const crc = crc32(dataBuf);

    offsets.push(offset);
    crcs.push(crc);
    nameBufs.push(nameBuf);
    dataBufs.push(dataBuf);

    // Local file header (30 bytes fixed + filename)
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); // signature
    lfh.writeUInt16LE(20, 4); // version needed (2.0)
    lfh.writeUInt16LE(0, 6); // general purpose bit flag
    lfh.writeUInt16LE(0, 8); // compression method: STORE
    lfh.writeUInt16LE(0, 10); // last mod time
    lfh.writeUInt16LE(0, 12); // last mod date
    lfh.writeUInt32LE(crc, 14); // crc-32
    lfh.writeUInt32LE(dataBuf.length, 18); // compressed size
    lfh.writeUInt32LE(dataBuf.length, 22); // uncompressed size
    lfh.writeUInt16LE(nameBuf.length, 26); // file name length
    lfh.writeUInt16LE(0, 28); // extra field length

    localHeaders.push(lfh);
    offset += 30 + nameBuf.length + dataBuf.length;
  }

  // Central directory
  const cdParts: Buffer[] = [];
  for (let i = 0; i < files.length; i++) {
    const nameBuf = nameBufs[i]!;
    const dataBuf = dataBufs[i]!;
    const crc = crcs[i]!;

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0); // signature
    cdh.writeUInt16LE(20, 4); // version made by
    cdh.writeUInt16LE(20, 6); // version needed
    cdh.writeUInt16LE(0, 8); // general purpose bit flag
    cdh.writeUInt16LE(0, 10); // compression method: STORE
    cdh.writeUInt16LE(0, 12); // last mod time
    cdh.writeUInt16LE(0, 14); // last mod date
    cdh.writeUInt32LE(crc, 16); // crc-32
    cdh.writeUInt32LE(dataBuf.length, 20); // compressed size
    cdh.writeUInt32LE(dataBuf.length, 24); // uncompressed size
    cdh.writeUInt16LE(nameBuf.length, 28); // file name length
    cdh.writeUInt16LE(0, 30); // extra field length
    cdh.writeUInt16LE(0, 32); // file comment length
    cdh.writeUInt16LE(0, 34); // disk number start
    cdh.writeUInt16LE(0, 36); // internal file attributes
    cdh.writeUInt32LE(0, 38); // external file attributes
    cdh.writeUInt32LE(offsets[i]!, 42); // relative offset of local header

    cdParts.push(cdh, nameBuf);
  }

  const cdBuf = Buffer.concat(cdParts);
  const cdOffset = offset;
  const cdSize = cdBuf.length;

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with start of CD
  eocd.writeUInt16LE(files.length, 8); // entries on this disk
  eocd.writeUInt16LE(files.length, 10); // total entries
  eocd.writeUInt32LE(cdSize, 12); // size of central directory
  eocd.writeUInt32LE(cdOffset, 16); // offset of start of CD
  eocd.writeUInt16LE(0, 20); // comment length

  // Interleave local headers + name + data, then CD + EOCD
  const parts: Buffer[] = [];
  for (let i = 0; i < files.length; i++) {
    parts.push(localHeaders[i]!, nameBufs[i]!, dataBufs[i]!);
  }
  parts.push(cdBuf, eocd);

  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// ZIP extractor — reads the first file from a ZIP buffer
// ---------------------------------------------------------------------------

/**
 * Extract the raw content of the FIRST file in a ZIP buffer.
 * Supports STORE (method=0) and DEFLATE (method=8).
 * Throws on invalid ZIP structure or unsupported compression method.
 */
export function extractFirstFileFromZip(zipBuf: Buffer): Buffer {
  if (zipBuf.length < 22) throw new Error("Buffer too small to be a valid ZIP");

  // Scan backwards for EOCD signature (0x06054b50)
  let eocdOffset = -1;
  for (let i = zipBuf.length - 22; i >= 0; i--) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1)
    throw new Error("Invalid ZIP: EOCD signature not found");

  const cdOffset = zipBuf.readUInt32LE(eocdOffset + 16);

  // Read first central directory entry
  if (zipBuf.readUInt32LE(cdOffset) !== 0x02014b50) {
    throw new Error("Invalid ZIP: central directory signature mismatch");
  }

  const method = zipBuf.readUInt16LE(cdOffset + 10);
  const compressedSize = zipBuf.readUInt32LE(cdOffset + 20);
  const localHeaderOffset = zipBuf.readUInt32LE(cdOffset + 42);

  // Jump to local file header
  if (zipBuf.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
    throw new Error("Invalid ZIP: local file header signature mismatch");
  }

  const fnLen = zipBuf.readUInt16LE(localHeaderOffset + 26);
  const extraLen = zipBuf.readUInt16LE(localHeaderOffset + 28);
  const dataOffset = localHeaderOffset + 30 + fnLen + extraLen;

  const compressed = zipBuf.subarray(dataOffset, dataOffset + compressedSize);

  if (method === 0) return Buffer.from(compressed); // STORED
  if (method === 8) return inflateRawSync(compressed); // DEFLATED
  throw new Error(`Unsupported ZIP compression method: ${method}`);
}
