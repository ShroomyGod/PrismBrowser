'use strict';

function compareVersions(a, b) {
  const pa = String(a).split(/[.+-]/).map((part) => parseInt(part, 10) || 0);
  const pb = String(b).split(/[.+-]/).map((part) => parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const difference = (pa[i] || 0) - (pb[i] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function timestamp(value) {
  if (value == null) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Prefer checksums/digests for exact build identity. Timestamps are only used
// once to migrate existing installs that predate persisted identity state.
function inspect(state, key, candidateVersion, candidateIdentity, installedVersion, times = {}) {
  const data = state && typeof state === 'object' ? state : { assets: {} };
  if (!data.assets || typeof data.assets !== 'object') data.assets = {};

  const versionOrder = compareVersions(candidateVersion, installedVersion);
  if (versionOrder > 0) {
    if (key && candidateIdentity) {
      data.assets[key] = {
        version: candidateVersion,
        identity: candidateIdentity,
        // Keep it unaccepted until the user launches the installer.
        acceptedIdentity: null
      };
      return { available: true, buildRefresh: false, newlySeen: true, state: data };
    }
    return { available: true, buildRefresh: false, newlySeen: false, state: data };
  }
  if (versionOrder < 0 || !key || !candidateIdentity) {
    return { available: false, buildRefresh: false, newlySeen: false, state: data };
  }

  const previous = data.assets[key];
  if (!previous) {
    const candidateTime = timestamp(times.candidateTime);
    const installedTime = timestamp(times.installedTime);
    const installedIsOlder = candidateTime !== null && installedTime !== null && candidateTime > installedTime;
    data.assets[key] = {
      version: candidateVersion,
      identity: candidateIdentity,
      // A newer published artifact is offered once to legacy installs. Without
      // comparable timestamps, establish a baseline and rely on future hashes.
      acceptedIdentity: installedIsOlder ? null : candidateIdentity
    };
    return { available: installedIsOlder, buildRefresh: installedIsOlder, newlySeen: true, state: data };
  }

  if (previous.version === candidateVersion && previous.identity === candidateIdentity) {
    return {
      available: previous.acceptedIdentity !== candidateIdentity,
      buildRefresh: true,
      newlySeen: false,
      state: data
    };
  }

  const sameVersion = previous.version === candidateVersion;
  data.assets[key] = {
    version: candidateVersion,
    identity: candidateIdentity,
    acceptedIdentity: sameVersion ? previous.acceptedIdentity : candidateIdentity
  };
  return {
    available: data.assets[key].acceptedIdentity !== candidateIdentity,
    buildRefresh: sameVersion,
    newlySeen: true,
    state: data
  };
}

function accept(state, key, version, identity) {
  const data = state && typeof state === 'object' ? state : { assets: {} };
  if (!data.assets || typeof data.assets !== 'object') data.assets = {};
  if (key && identity) data.assets[key] = { version, identity, acceptedIdentity: identity };
  return data;
}

module.exports = { compareVersions, inspect, accept };
