'use strict';

const fs = require('fs');
const path = require('path');

// Per-service ring-buffered log files.
//
// Every line records the service phase at the moment it was produced. The
// phase comes from the single canonical status, so the logs page always
// matches the current stage instead of carrying a stale label.

const MAX_BYTES = 2 * 1024 * 1024; // keep the last ~2MB per service

class LogStore {
  constructor(logDir) {
    this.logDir = logDir;
    fs.mkdirSync(logDir, { recursive: true });
    this.streams = new Map();
  }

  _file(serviceId) {
    return path.join(this.logDir, `${serviceId}.log`);
  }

  append(serviceId, message, { stream = 'stdout', phase = null } = {}) {
    const entry = {
      ts: new Date().toISOString(),
      stream,
      phase,
      msg: message == null ? '' : String(message),
    };
    const line = `${JSON.stringify(entry)}\n`;

    let out = this.streams.get(serviceId);
    if (!out) {
      out = fs.createWriteStream(this._file(serviceId), { flags: 'a' });
      this.streams.set(serviceId, out);
    }
    out.write(line);

    // Cheap bound: if the file grows past the cap, drop the oldest half on
    // the next rotation check (done synchronously enough for a local tool).
    try {
      if (fs.statSync(this._file(serviceId)).size > MAX_BYTES) {
        this._rotate(serviceId);
      }
    } catch (_) { /* ignore stat races */ }
  }

  _rotate(serviceId) {
    const old = this.streams.get(serviceId);
    if (old) { old.end(); this.streams.delete(serviceId); }
    const file = this._file(serviceId);
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    const kept = lines.slice(Math.floor(lines.length / 2)).join('\n') + '\n';
    fs.writeFileSync(file, kept);
  }

  // Read parsed entries. `since` filters by ISO timestamp, `phase` filters
  // by the lifecycle stage the line was produced in.
  read(serviceId, { since = null, phase = null, limit = 5000 } = {}) {
    let content;
    try {
      content = fs.readFileSync(this._file(serviceId), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const entries = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch (_) {
        continue;
      }
      if (since && entry.ts && entry.ts <= since) continue;
      if (phase && entry.phase !== phase) continue;
      entries.push(entry);
    }
    return entries.slice(-limit);
  }

  clear(serviceId) {
    const stream = this.streams.get(serviceId);
    if (stream) { stream.end(); this.streams.delete(serviceId); }
    try {
      fs.unlinkSync(this._file(serviceId));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  closeAll() {
    for (const stream of this.streams.values()) stream.end();
    this.streams.clear();
  }
}

module.exports = { LogStore };
