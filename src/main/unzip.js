// unzip.js — minimal ZIP reader for extension packages.
//
// This replaces the `extract-zip` dependency that extensions.js used to
// require. That import was never declared in package.json, so electron-builder
// never packaged it and every installed copy of Prism died at startup with:
//
//   Error: Cannot find module 'extract-zip'
//
// Adding the package back would not have been a clean fix either: extract-zip
// v2 is ESM-only, so the CommonJS `require()` above would throw again. Reading
// the archive here keeps the app free of runtime npm dependencies, which is
// also how the surrounding code works — extensions.js parses the CRX container
// by hand for exactly the same reason.
//
// Only the two methods that occur in real Chrome/Edge CRX payloads are
// supported: stored (0) and deflate (8). Both come from Node's own zlib.
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const EOCD_SIG = 0x06054b50;   // end of central directory
const CENTRAL_SIG = 0x02014b50; // central directory file header
const LOCAL_SIG = 0x04034b50;   // local file header

// The EOCD sits at the very end, but an archive comment may follow it, so scan
// backwards over at most the 64 KiB a comment can occupy.
function findEndOfCentralDirectory(buf) {
  const floor = buf.length - Math.min(buf.length, 0xffff + 22);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (i >= 0 && buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error('Not a ZIP archive: no end-of-central-directory record.');
}

function extract(zipPath, targetDir) {
  const buf = fs.readFileSync(zipPath);
  const eocd = findEndOfCentralDirectory(buf);
  const total = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(ptr) !== CENTRAL_SIG) {
      throw new Error('Corrupt ZIP: bad central directory header at entry ' + i + '.');
    }
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);

    ptr += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue; // directory entry

    // The archive came off the network, so it is untrusted input. Reject any
    // entry that would escape the target directory ("zip slip") before
    // touching the filesystem.
    const root = path.resolve(targetDir);
    const dest = path.resolve(root, name);
    if (dest !== root && !dest.startsWith(root + path.sep)) {
      throw new Error('Refusing to extract outside the target directory: ' + name);
    }

    // The local header repeats the name and extra lengths, and they are allowed
    // to differ from the central directory's, so the data offset can only be
    // read from the local header.
    if (buf.readUInt32LE(localOffset) !== LOCAL_SIG) {
      throw new Error('Corrupt ZIP: bad local file header for ' + name + '.');
    }
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(start, start + compressedSize);

    let data;
    if (method === 0) {
      data = Buffer.from(raw);
    } else if (method === 8) {
      data = zlib.inflateRawSync(raw);
    } else {
      throw new Error('Unsupported ZIP compression method ' + method + ' in ' + name);
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  }
}

module.exports = { extract };