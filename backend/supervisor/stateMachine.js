'use strict';

// Single source of truth for the service lifecycle.
//
// Root cause of the previous "preparing / ready / failed" inconsistencies:
// status, a separate ready flag and a separate phase label were stored and
// updated independently. From now on `status` is the ONLY stored state.
// `phase` always mirrors `status` and `ready` is derived from it, so the
// service list, the board badges and the log page can never disagree.

const STATUS = Object.freeze({
  STOPPED: 'stopped',
  PREPARING: 'preparing',
  READY: 'ready',
  STOPPING: 'stopping',
  FAILED: 'failed',
});

const STATUSES = Object.freeze(Object.values(STATUS));

// Legal transitions during normal runtime. Every state change must pass
// through canTransition(), there is no other code path that mutates status.
const TRANSITIONS = Object.freeze({
  [STATUS.STOPPED]: [STATUS.PREPARING],
  [STATUS.PREPARING]: [STATUS.READY, STATUS.FAILED, STATUS.STOPPING, STATUS.STOPPED],
  [STATUS.READY]: [STATUS.STOPPING, STATUS.FAILED],
  [STATUS.STOPPING]: [STATUS.STOPPED, STATUS.FAILED],
  [STATUS.FAILED]: [STATUS.PREPARING, STATUS.STOPPING, STATUS.STOPPED],
});

// Extra transitions allowed only for supervisor recovery at boot time
// (reconciling processes that changed state while the supervisor was down).
const RECOVERY_TRANSITIONS = Object.freeze({
  [STATUS.STOPPED]: [STATUS.STOPPED, STATUS.PREPARING],
  [STATUS.PREPARING]: [STATUS.READY, STATUS.FAILED, STATUS.STOPPED],
  [STATUS.READY]: [STATUS.STOPPED, STATUS.FAILED, STATUS.PREPARING],
  [STATUS.STOPPING]: [STATUS.STOPPED],
  [STATUS.FAILED]: [STATUS.STOPPED, STATUS.PREPARING],
});

function isValidStatus(status) {
  return typeof status === 'string' && STATUSES.includes(status);
}

function canTransition(from, to, { recovery = false } = {}) {
  if (!isValidStatus(from) || !isValidStatus(to)) return false;
  const table = recovery ? RECOVERY_TRANSITIONS : TRANSITIONS;
  return (table[from] || []).includes(to);
}

function assertTransition(from, to, options = {}) {
  if (!canTransition(from, to, options)) {
    const err = new Error(`Illegal service status transition: ${from} -> ${to}`);
    err.code = 'EILLEGALTRANSITION';
    err.from = from;
    err.to = to;
    throw err;
  }
}

// --- Derived views (never stored independently) ----------------------------

function phaseOf(status) {
  // The log page phase label is always the canonical status.
  return status;
}

function isReady(status) {
  return status === STATUS.READY;
}

// Terminal states from which a service can simply be started again.
function isTerminal(status) {
  return status === STATUS.STOPPED || status === STATUS.FAILED;
}

module.exports = {
  STATUS,
  STATUSES,
  TRANSITIONS,
  RECOVERY_TRANSITIONS,
  isValidStatus,
  canTransition,
  assertTransition,
  phaseOf,
  isReady,
  isTerminal,
};
