'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STATUS,
  canTransition,
  assertTransition,
  phaseOf,
  isReady,
} = require('../supervisor/stateMachine');

test('normal lifecycle follows preparing -> ready -> stopping -> stopped', () => {
  assert.ok(canTransition(STATUS.STOPPED, STATUS.PREPARING));
  assert.ok(canTransition(STATUS.PREPARING, STATUS.READY));
  assert.ok(canTransition(STATUS.READY, STATUS.STOPPING));
  assert.ok(canTransition(STATUS.STOPPING, STATUS.STOPPED));
});

test('preparing may fail, and a failed service can start or be cleaned', () => {
  assert.ok(canTransition(STATUS.PREPARING, STATUS.FAILED));
  assert.ok(canTransition(STATUS.FAILED, STATUS.PREPARING));
  assert.ok(canTransition(STATUS.FAILED, STATUS.STOPPING));
  assert.ok(canTransition(STATUS.FAILED, STATUS.STOPPED));
});

test('ready cannot jump directly to stopped (must pass stopping)', () => {
  assert.ok(!canTransition(STATUS.READY, STATUS.STOPPED));
  assert.ok(!canTransition(STATUS.STOPPED, STATUS.READY));
  assert.ok(!canTransition(STATUS.STOPPED, STATUS.FAILED));
});

test('assertTransition throws on illegal moves', () => {
  assert.throws(() => assertTransition(STATUS.READY, STATUS.STOPPED), /Illegal/);
});

test('ready marker and phase are derived solely from status', () => {
  assert.equal(phaseOf(STATUS.PREPARING), 'preparing');
  assert.equal(phaseOf(STATUS.READY), 'ready');
  assert.equal(phaseOf(STATUS.FAILED), 'failed');
  assert.equal(isReady(STATUS.READY), true);
  for (const s of [STATUS.STOPPED, STATUS.PREPARING, STATUS.STOPPING, STATUS.FAILED]) {
    assert.equal(isReady(s), false);
  }
});

test('recovery allows stale-ready -> stopped and failed -> stopped', () => {
  assert.ok(!canTransition(STATUS.READY, STATUS.STOPPED));
  assert.ok(canTransition(STATUS.READY, STATUS.STOPPED, { recovery: true }));
  assert.ok(canTransition(STATUS.FAILED, STATUS.STOPPED, { recovery: true }));
  assert.ok(canTransition(STATUS.PREPARING, STATUS.FAILED, { recovery: true }));
});
