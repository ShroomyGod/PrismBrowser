// downloads-paths.test.js — the save-path policy. These are the rules that stop
// a download from overwriting a file the user already had, and from writing
// outside the destination folder, so they are worth pinning down directly.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const downloads = require('../src/main/downloads.js');

let failures = 0;
function check(name, condition, detail) {
  if (condition) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

function eq(name, actual, expected) {
  check(name, actual === expected, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

console.log('downloads-paths');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-dl-'));

// ---- filename sanitisation ----
eq('plain name is kept', downloads.safeFileName('report.pdf', 'fallback'), 'report.pdf');
eq('strips directories', downloads.safeFileName('C:\\Users\\janyi\\report.pdf', 'fallback'), 'report.pdf');
eq('strips forward slashes', downloads.safeFileName('../../etc/passwd', 'fallback'), 'passwd');
eq('replaces illegal characters', downloads.safeFileName('a<b>c:d"e|f?g*h.pdf', 'fallback'), 'a_b_c_d_e_f_g_h.pdf');
eq('empty name falls back', downloads.safeFileName('', 'download'), 'download');
eq('dots-only name falls back', downloads.safeFileName('...', 'download'), 'download');
eq('no trailing dot', downloads.safeFileName('report.pdf.', 'download'), 'report.pdf');
eq('no trailing space', downloads.safeFileName('report.pdf ', 'download'), 'report.pdf');

// ---- uniqueness ----
const first = downloads.uniquePath(tmp, 'invoice.pdf');
eq('first download keeps its name', path.basename(first), 'invoice.pdf');
fs.writeFileSync(first, 'x');

const second = downloads.uniquePath(tmp, 'invoice.pdf');
eq('second download is not clobbered', path.basename(second), 'invoice (1).pdf');
check('second path is distinct', second !== first);
check('second path is in the same folder', path.dirname(second) === tmp);
fs.writeFileSync(second, 'x');

const third = downloads.uniquePath(tmp, 'invoice.pdf');
eq('third download increments', path.basename(third), 'invoice (2).pdf');

// The extension must survive dedupe: "report (1).pdf" not "report (1)".
fs.writeFileSync(path.join(tmp, 'README'), 'x');
eq('no-extension files dedupe too', path.basename(downloads.uniquePath(tmp, 'README')), 'README (1)');

fs.writeFileSync(path.join(tmp, 'data.tar.gz'), 'x');
eq('multi-part extension dedupes on the last dot', path.basename(downloads.uniquePath(tmp, 'data.tar.gz')), 'data.tar (1).gz');

// ---- the resolved path must stay inside the destination ----
const escaped = downloads.uniquePath(tmp, '..\\..\\escape.txt');
check('cannot escape the destination folder', path.resolve(escaped).startsWith(path.resolve(tmp) + path.sep), escaped);

console.log(failures ? '\n' + failures + ' check(s) failed' : '\ndownloads-paths: all checks passed');
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failures ? 1 : 0);