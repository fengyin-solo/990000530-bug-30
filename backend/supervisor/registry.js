'use strict';

const fs = require('fs');
const path = require('path');
const { STATUS, isValidStatus } = require('./stateMachine');

// On-disk registry of service runtime state.
//
// Only `status` is persisted. `ready` and `phase` are derived when records
// are read, so a stale "ready" marker can never survive a restart of the
// supervisor or disagree with the service list.

const REGISTRY_FILE = 'registry.json';

function emptyRegistry() {
  return { version: 1, services: {} };
}

class Registry {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, REGISTRY_FILE);
    fs.mkdirSync(dataDir, { recursive: true });
    this.state = this._load();
  }

  _load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || !parsed.services) return emptyRegistry();
      return parsed;
    } catch (err) {
      if (err.code === 'ENOENT') return emptyRegistry();
      // A corrupt registry must not wedge the supervisor: start clean.
      return emptyRegistry();
    }
  }

  // Atomic replace so concurrent CLI/API callers never read a half-written
  // file (this is the persistence side of the single commit funnel).
  _persist() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.file);
  }

  has(id) {
    return Object.prototype.hasOwnProperty.call(this.state.services, id);
  }

  get(id) {
    const rec = this.state.services[id];
    if (!rec) return null;
    return this._view(rec);
  }

  list() {
    return Object.values(this.state.services).map(rec => this._view(rec));
  }

  // Create a record, or reset an existing one back to stopped.
  init(record) {
    const now = new Date().toISOString();
    const stored = {
      id: record.id,
      name: record.name || record.id,
      command: record.command,
      args: record.args || [],
      cwd: record.cwd || null,
      port: Number.isInteger(record.port) ? record.port : null,
      status: STATUS.STOPPED,
      pid: null,
      startedAt: null,
      stoppedAt: null,
      exitCode: null,
      signal: null,
      error: null,
      attempts: 0,
      createdAt: this.state.services[record.id]?.createdAt || now,
      updatedAt: now,
    };
    this.state.services[record.id] = stored;
    this._persist();
    return this.get(record.id);
  }

  // Apply a prepared update atomically. Used by the manager only.
  update(id, patch) {
    const rec = this.state.services[id];
    if (!rec) {
      const err = new Error(`Service not found: ${id}`);
      err.code = 'ENOSERVICE';
      throw err;
    }
    if (patch.status !== undefined && !isValidStatus(patch.status)) {
      throw new Error(`Invalid status: ${patch.status}`);
    }
    Object.assign(rec, patch, { updatedAt: new Date().toISOString() });
    this._persist();
    return this.get(id);
  }

  remove(id) {
    if (this.has(id)) {
      delete this.state.services[id];
      this._persist();
      return true;
    }
    return false;
  }

  // Public projection: ready/phase are computed, never read from disk.
  _view(rec) {
    return {
      ...rec,
      phase: rec.status,
      ready: rec.status === STATUS.READY,
    };
  }
}

module.exports = { Registry, emptyRegistry };
