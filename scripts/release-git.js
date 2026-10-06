'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

// electron-builder writes these generated artifacts into the repository root.
// They are deliberately left in the worktree, never added to the source commit.
const EXCLUDED_PATHS = [
  ':(exclude,glob)Prism-*.exe',
  ':(exclude,glob)Prism-*.exe.blockmap',
  ':(exclude,glob)ShroomBrowser-*.exe',
  ':(exclude,glob)ShroomBrowser-*.exe.blockmap',
  ':(exclude,glob)prism-browser-*.exe',
  ':(exclude,glob)*.nsis.7z',
  ':(exclude,glob)latest.yml',
  ':(exclude,glob)release-notes.md',
  ':(exclude,glob)win-unpacked/**',
  ':(exclude,glob)dist/**'
];

function formatGitFailure(args, result) {
  const exit = Number.isInteger(result.status)
    ? 'exited with code ' + result.status
    : 'terminated' + (result.signal ? ' by ' + result.signal : ' without an exit code');
  const output = [];
  if (result.stdout && String(result.stdout).trim()) output.push('stdout: ' + String(result.stdout).trim());
  if (result.stderr && String(result.stderr).trim()) output.push('stderr: ' + String(result.stderr).trim());
  return 'git ' + args.join(' ') + ' ' + exit + (output.length ? '\n' + output.join('\n') : '');
}

function git(cwd, args, options) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    ...(options || {})
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(formatGitFailure(args, result));
  return String(result.stdout || '').trim();
}

function selectRemote(cwd) {
  const remotes = git(cwd, ['remote']).split(/\r?\n/).filter(Boolean);
  const remote = remotes.includes('origin') ? 'origin' : remotes[0];
  if (!remote) throw new Error('No Git remote is configured; cannot push the release source.');
  return remote;
}

function checkGitReady(cwd) {
  const root = git(cwd, ['rev-parse', '--show-toplevel']);
  if (path.resolve(root) !== path.resolve(cwd)) {
    throw new Error('Run npm run release from the Git repository root.');
  }
  const branch = git(cwd, ['branch', '--show-current']);
  if (!branch) throw new Error('The current checkout is detached; check out a branch before releasing.');
  // Source changes already in the index are valid release content and should be
  // included rather than blocking a retry after an earlier commit failure.
  // Refuse staged build output because an add exclusion cannot unstage it.
  const stagedFiles = git(cwd, ['diff', '--cached', '--name-only'])
    .split(/\r?\n/)
    .filter(Boolean);
  const stagedArtifacts = stagedFiles.filter(isGeneratedArtifact);
  if (stagedArtifacts.length) {
    throw new Error('Generated build artifacts are staged; unstage them before releasing: ' + stagedArtifacts.join(', '));
  }
  const remote = selectRemote(cwd);
  return { branch, remote };
}

function isGeneratedArtifact(file) {
  const normalized = String(file || '').replace(/\\/g, '/');
  const name = normalized.slice(normalized.lastIndexOf('/') + 1);
  return /^(?:Prism|ShroomBrowser)-.*\.exe(?:\.blockmap)?$/i.test(name) ||
    /^prism-browser-.*\.exe(?:\.blockmap)?$/i.test(name) ||
    /^.*\.nsis\.7z$/i.test(name) ||
    /^(?:latest\.yml|release-notes\.md)$/i.test(name) ||
    /^(?:win-unpacked|dist)(?:\/|$)/i.test(normalized);
}

function changedSourcePaths(cwd) {
  // Stage tracked modifications/deletions and only non-ignored untracked files.
  // This avoids touching ignored model/cache data in the user's checkout.
  const tracked = git(cwd, ['diff', '--name-only', '-z']).split('\0').filter(Boolean);
  const untracked = git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  return [...new Set([...tracked, ...untracked])].filter((file) => !isGeneratedArtifact(file));
}

function commitAndPush(cwd, version) {
  const { branch, remote } = checkGitReady(cwd);
  let committed = false;
  let commit = '';
  const sourcePaths = changedSourcePaths(cwd);
  if (sourcePaths.length) git(cwd, ['add', '-A', '--', ...sourcePaths]);
  const changed = spawnSync('git', ['diff', '--cached', '--quiet'], {
    cwd,
    encoding: 'utf8',
    windowsHide: true
  });
  if (changed.error) throw changed.error;
  if (changed.status !== 0 && changed.status !== 1) {
    throw new Error(formatGitFailure(['diff', '--cached', '--quiet'], changed));
  }
  if (changed.status === 1) {
    commit = 'Release Prism v' + version;
    git(cwd, ['commit', '-m', commit]);
    committed = true;
  }
  // Push only the checked-out branch, not tags or other refs. The release script
  // manages the version tag separately after the branch source is on the remote.
  git(cwd, ['push', '-u', remote, 'HEAD:refs/heads/' + branch]);
  return { branch, remote, committed, commit };
}

module.exports = { EXCLUDED_PATHS, checkGitReady, commitAndPush, formatGitFailure };
