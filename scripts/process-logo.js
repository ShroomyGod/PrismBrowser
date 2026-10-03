// Converts Prism's logo into padded square application icons and a multi-size
// Windows .ico. The artwork is centered and scaled to preserve its aspect
// ratio at every icon size.
//
// Two sources feed this script:
//   assets/sourceimage.png  the gradient star -> icon-<size>.png, prism.ico
//   assets/sourcetext.png   the "Prism" letters -> wordmark.png, wordmark@2x.png
//
// Both arrive as flat-background renders, so each matte has to be cut away
// before anything is measured or scaled. Without that the canvas counts as
// artwork, nothing gets cropped, and every icon ships as a blank tile.
//
// The two mattes use different rules on purpose. The icon is saturated
// throughout, so knockWhiteBackground()'s brightness floor is safe on it. The
// wordmark gradient runs through pale yellow and pink that are nearly as
// bright as a white canvas, so a brightness floor would punch holes straight
// through the lettering; it instead measures the canvas colour from the
// image's own border via knockEdgeMatte().
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const SRC = path.join(__dirname, '..', 'assets', 'sourceimage.png');
const WORDMARK_SRC = path.join(__dirname, '..', 'assets', 'sourcetext.png');
const OUT = path.join(__dirname, '..', 'assets');

// Everything the artwork does not cover must show the browser's own chrome
// (dark by default) through it, not a white tile. A pixel becomes transparent
// in proportion to how close it sits to pure white, then is un-composited
// against that white matte so anti-aliased edges keep the artwork's hue
// instead of carrying a white fringe when scaled down.
//
// Pixels at or below OPAQUE_FLOOR are left completely alone. That protects the
// pale lavender ends of the arcs and the pink centre sparkle: both read as
// light, but neither is white, so a brightness-only threshold would punch
// holes straight through them.
const OPAQUE_FLOOR = 236;

function knockWhiteBackground(png) {
  const { data } = png;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue; // already transparent
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const nearest = Math.min(r, g, b);
    if (nearest <= OPAQUE_FLOOR) continue; // real artwork
    // 0 at pure white, 1 at the opaque floor, eased so the edge is not
    // stair-stepped once it lands on a 16px tray icon.
    let a = (255 - nearest) / (255 - OPAQUE_FLOOR);
    a = a * a * (3 - 2 * a);
    const alpha = Math.round(a * 255);
    if (alpha === 0) { data[i + 3] = 0; continue; }
    // Undo the matte: observed = alpha * artwork + (1 - alpha) * 255.
    const k = 255 / alpha;
    data[i] = Math.min(255, Math.max(0, Math.round((r - 255 + alpha) * k)));
    data[i + 1] = Math.min(255, Math.max(0, Math.round((g - 255 + alpha) * k)));
    data[i + 2] = Math.min(255, Math.max(0, Math.round((b - 255 + alpha) * k)));
    data[i + 3] = alpha;
  }
  return png;
}

// ---------------------------------------------------------------------------
// Wordmark: "Prism" gradient lettering
// ---------------------------------------------------------------------------
// The wordmark arrives with a flat background of unknown colour -- the source
// is literally named "on Black" even when it renders on white -- so the canvas
// is measured instead of assumed. knockEdgeMatte() takes the per-channel median
// of the image's own border ring and clears everything within a tolerance of it.
//
// Measuring beats a hard-coded white threshold here for two reasons. It works
// on a dark background as readily as a light one. And it cannot punch holes in
// the lettering: the pale yellow and pink stops sit within a few counts of
// white, so any brightness-based rule would eat straight through them, while
// every gradient stop is far from a flat canvas colour.
const MATTE_TOLERANCE = 64;

function knockEdgeMatte(png) {
  const { width, height, data } = png;
  // Sample the outermost ring, opaque pixels only. Transparent pixels carry
  // meaningless colour, so including them would bias the estimate toward zero
  // and make a dark canvas look like black.
  const ring = [];
  const consider = (i) => { if (data[i * 4 + 3] > 200) ring.push(i); };
  for (let x = 0; x < width; x++) { consider(x); consider(x + (height - 1) * width); }
  for (let y = 0; y < height; y++) { consider(y * width); consider(y * width + width - 1); }
  // Already-transparent artwork (or a transparent border) has no canvas to find.
  if (ring.length < 16) return png;

  const median = (offset) => {
    const values = ring.map((i) => data[i * 4 + offset]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };
  const cr = median(0), cg = median(1), cb = median(2);
  const tol2 = MATTE_TOLERANCE * MATTE_TOLERANCE;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const dr = data[i] - cr, dg = data[i + 1] - cg, db = data[i + 2] - cb;
    if (dr * dr + dg * dg + db * db <= tol2) data[i + 3] = 0;
  }
  return png;
}

// Area-average resample to an exact size. The wordmark is a wide banner whose
// strokes are thin, and it gets downscaled several times over on the way to a
// 480px-wide render. Box-filtering the entire source footprint is what stops
// those strokes from aliasing into dashes. Colors are premultiplied before
// averaging and un-premultiplied after, so the cleared canvas cannot bleed
// into the glyph edges.
function scaleExact(srcPng, tw, th) {
  const { width: w, height: h, data } = srcPng;
  const out = new PNG({ width: tw, height: th });
  out.data.fill(0);
  for (let y = 0; y < th; y++) {
    const y0 = Math.floor((y * h) / th);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / th));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor((x * w) / tw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / tw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * w + sx) * 4;
          const al = data[i + 3] / 255;
          r += data[i] * al; g += data[i + 1] * al; b += data[i + 2] * al;
          a += al; n++;
        }
      }
      const o = (y * tw + x) * 4;
      if (a > 0) {
        out.data[o] = Math.round(r / a);
        out.data[o + 1] = Math.round(g / a);
        out.data[o + 2] = Math.round(b / a);
        out.data[o + 3] = Math.round((a / n) * 255);
      }
    }
  }
  return out;
}

// Tight-crop, then fit to an exact width. Width is the binding constraint
// here: resize() pads toward a square, which would shrink a ~3:1 banner down
// to almost nothing.
function makeWordmark(png, targetW) {
  const cropped = cropArtwork(png);
  const targetH = Math.max(1, Math.round((cropped.height * targetW) / cropped.width));
  return scaleExact(cropped, targetW, targetH);
}

function artworkBounds(png) {
  const { width, height, data } = png;
  // Callers pass a knocked-out source, so transparency is expected rather than
  // something to police: a fully opaque image here means the matte removal did
  // not run and bounds would silently measure the white canvas.
  const hasTransparency = (() => {
    for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
    return false;
  })();
  if (!hasTransparency) {
    throw new Error('Prism logo still opaque: knockWhiteBackground() must run before artworkBounds().');
  }
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < 8) continue;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) throw new Error('Prism logo contains no visible artwork.');
  return { minX, minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function resize(srcPng, tw, th) {
  const { width: w, height: h, data } = srcPng;
  const bounds = artworkBounds(srcPng);
  const pad = Math.max(1, Math.floor(Math.min(tw, th) * 0.08));
  const scale = Math.min((tw - 2 * pad) / bounds.width, (th - 2 * pad) / bounds.height);
  const drawW = bounds.width * scale, drawH = bounds.height * scale;
  const left = (tw - drawW) / 2, top = (th - drawH) / 2;
  const out = new PNG({ width: tw, height: th });
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const fx = (x + 0.5 - left) / scale + bounds.minX - 0.5;
      const fy = (y + 0.5 - top) / scale + bounds.minY - 0.5;
      if (fx < bounds.minX || fy < bounds.minY || fx >= bounds.minX + bounds.width || fy >= bounds.minY + bounds.height) continue;
      const x0 = Math.max(bounds.minX, Math.floor(fx)), x1 = Math.min(bounds.minX + bounds.width - 1, x0 + 1), dx = fx - x0;
      const y0 = Math.max(bounds.minY, Math.floor(fy)), y1 = Math.min(bounds.minY + bounds.height - 1, y0 + 1), dy = fy - y0;
      const i00 = (y0 * w + x0) * 4, i01 = (y0 * w + x1) * 4;
      const i10 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
      const o = (y * tw + x) * 4;
      // Premultiply colors while interpolating transparent edges to prevent
      // dark fringes when the logo is scaled down for the system tray.
      let alpha = 0;
      const colors = [0, 0, 0];
      for (const [index, weight] of [[i00, (1 - dx) * (1 - dy)], [i01, dx * (1 - dy)], [i10, (1 - dx) * dy], [i11, dx * dy]]) {
        const a = data[index + 3] / 255 * weight;
        alpha += a;
        for (let c = 0; c < 3; c++) colors[c] += data[index + c] * a;
      }
      if (alpha > 0) {
        for (let c = 0; c < 3; c++) out.data[o + c] = Math.round(colors[c] / alpha);
        out.data[o + 3] = Math.round(alpha * 255);
      }
    }
  }
  return out;
}

function makeSquare(png, paddingRatio = 0.08) {
  const bounds = artworkBounds(png);
  const side = Math.max(bounds.width, bounds.height);
  const pad = Math.ceil(side * paddingRatio);
  const square = new PNG({ width: side + 2 * pad, height: side + 2 * pad });
  square.data.fill(0);
  const offsetX = Math.floor((side - bounds.width) / 2) + pad - bounds.minX;
  const offsetY = Math.floor((side - bounds.height) / 2) + pad - bounds.minY;
  for (let y = bounds.minY; y < bounds.minY + bounds.height; y++) {
    for (let x = bounds.minX; x < bounds.minX + bounds.width; x++) {
      const from = (y * png.width + x) * 4;
      const to = ((y + offsetY) * square.width + x + offsetX) * 4;
      png.data.copy ? png.data.copy(square.data, to, from, from + 4) : square.data.set(png.data.subarray(from, from + 4), to);
    }
  }
  return square;
}

function cropArtwork(png) {
  const bounds = artworkBounds(png);
  const cropped = new PNG({ width: bounds.width, height: bounds.height });
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      const from = ((y + bounds.minY) * png.width + x + bounds.minX) * 4;
      const to = (y * bounds.width + x) * 4;
      cropped.data.set(png.data.subarray(from, from + 4), to);
    }
  }
  return cropped;
}

function writePng(png, file) { fs.writeFileSync(file, PNG.sync.write(png)); }

function makeFavicon(sourceFile, outputFile) {
  const source = knockWhiteBackground(PNG.sync.read(fs.readFileSync(sourceFile)));
  writePng(resize(makeSquare(source), 512, 512), outputFile);
}

function writeIco(entries, file) {
  // ICO container with PNG-compressed entries (supported on Windows Vista+).
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const blobs = [];
  for (const e of entries) {
    const s = e.size >= 256 ? 0 : e.size;
    const d = dir.subarray(16 * blobs.length, 16 * blobs.length + 16);
    d[0] = s; d[1] = s; d[2] = 0; d[3] = 0;
    d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6);
    d.writeUInt32LE(e.data.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += e.data.length;
    blobs.push(e.data);
  }
  fs.writeFileSync(file, Buffer.concat([header, dir, ...blobs]));
}

if (require.main === module) {
  // Name the missing file rather than letting readFileSync throw a bare ENOENT.
  // This has already bitten once: the sources arrived under different names.
  if (!fs.existsSync(SRC)) {
    console.error('Missing icon source: ' + SRC);
    process.exit(1);
  }
  const raw = knockWhiteBackground(PNG.sync.read(fs.readFileSync(SRC)));
  const artwork = cropArtwork(raw);
  const square = makeSquare(raw);
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
  const entries = [];
  for (const s of sizes) {
    const buf = PNG.sync.write(resize(square, s, s));
    fs.writeFileSync(path.join(OUT, `icon-${s}.png`), buf);
    if (s <= 256) entries.push({ size: s, data: buf });
  }
  writePng(artwork, path.join(OUT, 'prism-logo.png'));
  writeIco(entries, path.join(OUT, 'prism.ico'));

  // The wordmark is optional and must never be fatal. The icons above are
  // already on disk by this point and are what the installer actually needs;
  // a wordmark that will not process is a cosmetic miss, not a broken build.
  if (fs.existsSync(WORDMARK_SRC)) {
    try {
      const mark = knockEdgeMatte(PNG.sync.read(fs.readFileSync(WORDMARK_SRC)));
      writePng(makeWordmark(mark, 480), path.join(OUT, 'wordmark.png'));
      writePng(makeWordmark(mark, 960), path.join(OUT, 'wordmark@2x.png'));
      console.log('Prism wordmark written (480w + 960w).');
    } catch (err) {
      console.warn('Wordmark skipped: ' + err.message);
    }
  } else {
    console.log('No wordmark source at ' + WORDMARK_SRC + ' - skipped, icons unaffected.');
  }

  console.log('Prism logos and icons written to', OUT);
}

module.exports = {
  makeFavicon, resize, makeSquare, artworkBounds, knockWhiteBackground,
  knockEdgeMatte, scaleExact, makeWordmark, cropArtwork, writeIco,
};
