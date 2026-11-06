(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DashboardSyncCore = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  function create(owner, key) {
    return { owner: owner, key: key, base: null, dirty: null, localEpoch: 0, inFlight: null, conflict: null };
  }

  function compareRevision(a, b) {
    return a.length === b.length ? (a < b ? -1 : a > b ? 1 : 0) : a.length < b.length ? -1 : 1;
  }

  function validSnapshot(row, key) {
    return !!row && row.key === key && typeof row.exists === 'boolean' &&
      typeof row.revision === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(row.revision) &&
      compareRevision(row.revision, '9223372036854775807') <= 0 &&
      (row.valueText === null || typeof row.valueText === 'string') &&
      (row.updatedAt === null || (typeof row.updatedAt === 'string' && Number.isFinite(Date.parse(row.updatedAt)))) &&
      (row.exists ? row.revision !== '0' : row.revision === '0' && row.valueText === null && row.updatedAt === null);
  }

  function copySnapshot(row) {
    return { key: row.key, exists: row.exists, valueText: row.valueText, revision: row.revision, updatedAt: row.updatedAt };
  }

  function reduce(previous, event) {
    var state = Object.assign({}, previous), effects = [];
    function result() { return { state: state, effects: effects }; }
    function checkedSnapshot(row) {
      if (!validSnapshot(row, state.key)) throw new Error('INVALID_SNAPSHOT');
      return copySnapshot(row);
    }
    function acknowledge(row, flight, finished) {
      if (!state.base || compareRevision(row.revision, state.base.revision) >= 0) state.base = row;
      if (state.dirty && state.dirty.epoch === flight.epoch && !state.conflict) state.dirty = null;
      if (finished) state.inFlight = null;
    }
    if (event.owner && event.owner !== state.owner) return result();
    switch (event.type) {
      case 'local_edit': {
        if (event.valueText !== null && typeof event.valueText !== 'string') throw new Error('INVALID_LOCAL_VALUE');
        if (state.dirty && state.dirty.valueText === event.valueText) return result();
        if (!state.dirty && !state.inFlight && state.base && state.base.valueText === event.valueText) return result();
        if (state.localEpoch >= Number.MAX_SAFE_INTEGER) throw new Error('LOCAL_EPOCH_LIMIT');
        state.localEpoch += 1;
        state.dirty = !state.inFlight && !state.conflict && state.base && state.base.valueText === event.valueText
          ? null : { valueText: event.valueText, epoch: state.localEpoch };
        return result();
      }
      case 'remote': {
        var remote = checkedSnapshot(event.snapshot);
        if (state.base && compareRevision(remote.revision, state.base.revision) < 0) return result();
        if (state.conflict) {
          if (compareRevision(remote.revision, state.conflict.remote.revision) >= 0) {
            state.conflict = { base: state.conflict.base, remote: remote };
          }
          return result();
        }
        if (state.inFlight && remote.valueText === state.inFlight.valueText &&
            (!state.base || compareRevision(remote.revision, state.base.revision) > 0)) {
          acknowledge(remote, state.inFlight, false);
          return result();
        }
        if (state.base && remote.revision === state.base.revision) {
          if (remote.valueText !== state.base.valueText) throw new Error('INCONSISTENT_REVISION');
          return result();
        }
        if (state.dirty && state.dirty.valueText !== remote.valueText) {
          state.conflict = { base: state.base, remote: remote };
          return result();
        }
        state.base = remote;
        if (state.dirty) state.dirty = null;
        effects.push({ type: 'apply', valueText: remote.valueText });
        return result();
      }
      case 'push_started':
        if (!state.dirty || state.inFlight || state.conflict) return result();
        if (!state.base) { effects.push({ type: 'pull' }); return result(); }
        state.inFlight = { valueText: state.dirty.valueText, epoch: state.dirty.epoch, expectedRevision: state.base.revision };
        effects.push({ type: 'save', change: { key: state.key, expectedRevision: state.base.revision, valueText: state.dirty.valueText }, epoch: state.dirty.epoch });
        return result();
      case 'push_ok':
        if (!state.inFlight || state.inFlight.epoch !== event.epoch) return result();
        acknowledge(checkedSnapshot(event.snapshot), state.inFlight, true);
        return result();
      case 'push_failed':
        state.inFlight = null;
        if (event.current) {
          var current = checkedSnapshot(event.current);
          if (state.dirty) state.conflict = { base: state.base, remote: current };
          else return reduce(state, { type: 'remote', snapshot: current });
        }
        return result();
      case 'resolve':
        if (!state.conflict || state.conflict.remote.revision !== event.remoteRevision || state.localEpoch !== event.localEpoch) return result();
        if (event.choice !== 'use_remote' && event.choice !== 'apply_reviewed_local') return result();
        state.base = state.conflict.remote;
        state.conflict = null;
        state.inFlight = null;
        state.localEpoch += 1;
        if (event.choice === 'use_remote') {
          state.dirty = null;
          effects.push({ type: 'apply', valueText: state.base.valueText });
        } else if (state.dirty) {
          state.dirty = state.dirty.valueText === state.base.valueText ? null : { valueText: state.dirty.valueText, epoch: state.localEpoch };
        }
        return result();
      case 'account_changed':
        state.inFlight = null;
        return result();
      default:
        throw new Error('UNKNOWN_SYNC_EVENT');
    }
  }

  return { create: create, reduce: reduce, validSnapshot: validSnapshot, compareRevision: compareRevision };
});
