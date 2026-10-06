'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { checkGitReady, commitAndPush, formatGitFailure } = require('../scripts/release-git');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-release-git-test-'));
const repo = path.join(temp, 'repo');
const remote = path.join(temp, 'remote.git');
fs.mkdirSync(repo);

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function initFixture() {
  git(repo, 'init', '-b', 'release-test');
  git(repo, 'config', 'user.name', 'Prism Release Test');
  git(repo, 'config', 'user.email', 'release-test@example.invalid');
  fs.writeFileSync(path.join(repo, 'README.md'), 'release baseline\n');
  git(repo, 'add', 'README.md');
  git(repo, 'commit', '-m', 'fixture baseline');
  git(temp, 'init', '--bare', remote);
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-u', 'origin', 'release-test');
}

try {
  const gitFailure = formatGitFailure(['commit', '-m', 'Release Prism v1.1.0'], {
    status: 128,
    stdout: 'fatal: unable to create commit',
    stderr: "warning: in the working copy of 'package.json', LF will be replaced by CRLF the next time Git touches it"
  });
  assert(gitFailure.includes('exited with code 128'), 'failed Git commands report their exit status');
  assert(gitFailure.includes('fatal: unable to create commit'), 'failed Git commands retain stdout diagnostics');
  assert(gitFailure.includes('LF will be replaced by CRLF'), 'failed Git commands retain stderr warnings without hiding the cause');

  initFixture();
  fs.appendFileSync(path.join(repo, '.gitignore'), '\nlatest.yml\nrelease-notes.md\nwin-unpacked/\ndist/\n/resources/models/\n');
  fs.mkdirSync(path.join(repo, 'win-unpacked'));
  fs.mkdirSync(path.join(repo, 'dist'));
  fs.mkdirSync(path.join(repo, 'resources', 'models'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'win-unpacked', 'Prism.exe'), 'generated unpacked app');
  fs.writeFileSync(path.join(repo, 'dist', 'builder-output'), 'generated dist output');
  fs.writeFileSync(path.join(repo, 'resources', 'models', 'runtime-cache.bin'), 'large ignored local model');
  fs.writeFileSync(path.join(repo, 'README.md'), 'release source change\n');
  fs.writeFileSync(path.join(repo, 'prism-browser-1.1.0-x64.nsis.7z'), 'generated installer payload');
  fs.writeFileSync(path.join(repo, 'latest.yml'), 'generated update metadata');
  fs.writeFileSync(path.join(repo, 'release-notes.md'), 'generated release notes');

  assert.deepStrictEqual(checkGitReady(repo), { branch: 'release-test', remote: 'origin' });
  const result = commitAndPush(repo, '1.1.0');
  assert.deepStrictEqual(result, {
    branch: 'release-test', remote: 'origin', committed: true, commit: 'Release Prism v1.1.0'
  });
  assert.strictEqual(git(remote, 'show', 'refs/heads/release-test:README.md'), 'release source change');
  const committedFiles = git(repo, 'show', '--format=', '--name-only', 'HEAD').split(/\r?\n/).filter(Boolean);
  assert.deepStrictEqual(committedFiles, ['.gitignore', 'README.md'], 'source changes commit while generated release artifacts remain excluded');
  assert(fs.existsSync(path.join(repo, 'prism-browser-1.1.0-x64.nsis.7z')), 'excluded artifacts are left untouched in place');
  assert(fs.existsSync(path.join(repo, 'latest.yml')), 'update metadata is left untouched in place');
  assert(fs.existsSync(path.join(repo, 'release-notes.md')), 'release notes are left untouched in place');
  assert(fs.existsSync(path.join(repo, 'win-unpacked', 'Prism.exe')), 'the unpacked installer is left untouched in place');
  assert(fs.existsSync(path.join(repo, 'dist', 'builder-output')), 'dist output is left untouched in place');
  assert(fs.existsSync(path.join(repo, 'resources', 'models', 'runtime-cache.bin')), 'ignored model files remain untouched');
  assert.strictEqual(git(repo, 'status', '--porcelain'), '?? prism-browser-1.1.0-x64.nsis.7z');

  const noChanges = commitAndPush(repo, '1.1.0');
  assert.strictEqual(noChanges.committed, false, 'a second release does not create an empty commit');

  fs.writeFileSync(path.join(repo, 'README.md'), 'staged by user\n');
  git(repo, 'add', 'README.md');
  assert.deepStrictEqual(checkGitReady(repo), { branch: 'release-test', remote: 'origin' },
    'source files staged by the user are valid release content');
  fs.writeFileSync(path.join(repo, 'Prism-1.1.0-x64.exe'), 'staged build output');
  git(repo, 'add', 'Prism-1.1.0-x64.exe');
  assert.throws(() => checkGitReady(repo), /Generated build artifacts are staged/,
    'the release refuses staged installer artifacts instead of committing them');
  git(repo, 'reset', '--', 'README.md', 'Prism-1.1.0-x64.exe');
  fs.rmSync(path.join(repo, 'Prism-1.1.0-x64.exe'));

  git(repo, 'checkout', '--detach');
  assert.throws(() => checkGitReady(repo), /detached/,
    'the release refuses to commit on a detached HEAD');

  git(repo, 'checkout', 'release-test');
  fs.writeFileSync(path.join(repo, 'README.md'), 'staging failure source\n');
  fs.writeFileSync(path.join(repo, 'fail-add'), 'prevent git add from creating its lock');
  fs.mkdirSync(path.join(repo, '.git', 'index.lock'));
  assert.throws(() => commitAndPush(repo, '1.1.0'), /index.lock|Unable to create/,
    'an actual Git add failure is surfaced with diagnostic stderr');
  assert.strictEqual(git(repo, 'diff', '--cached', '--quiet') || '', '',
    'a failed release does not leave its own changes staged');
  fs.rmdirSync(path.join(repo, '.git', 'index.lock'));

  console.log('release-git.test.js: all assertions passed');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
