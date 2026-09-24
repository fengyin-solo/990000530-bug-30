'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');
const {
  STATUS,
  assertTransition,
  isReady,
} = require('./stateMachine');
const { Registry } = require('./registry');
const { LogStore } = require('./logStore');
const { checkPort, waitForPortOwnedBy } = require('./portProbe');
const { loadConfig } = require('./config');

const BACKEND_DIR = path.join(__dirname, '..');
const DEFAULT_DATA_DIR = path.join(BACKEND_DIR, 'data', 'supervisor');
const DEFAULT_LOG_DIR = path.join(DEFAULT_DATA_DIR, 'logs');

// Manages the lifecycle of every configured service.
//
// One status value per service, one mutation funnel (_commit). The registry
// projection and the log lines both derive their phase/ready information
// from that same value, which is what keeps the service list, the board
// badges and the logs page in sync across interrupted init, restart and
// cleanup.
class ServiceManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.dataDir = options.dataDir || DEFAULT_DATA_DIR;
    this.logDir = options.logDir || DEFAULT_LOG_DIR;
    this.configPath = options.configPath;
    this.readyTimeoutMs = options.readyTimeoutMs || 15000;
    this.stopTimeoutMs = options.stopTimeoutMs || 5000;

    this.registry = new Registry(this.dataDir);
    this.logs = new LogStore(this.logDir);

    this.configs = new Map();
    this.children = new Map();      // serviceId -> ChildProcess
    this.mutexes = new Map();        // serviceId -> Promise chain
    this.waiting = new Set();        // serviceIds currently in preparing
    this.stopping = new Set();       // serviceIds currently stopping
    this.closed = false;
  }

  async init() {
    const config = loadConfig(this.configPath);
    for (const svc of config.services) {
      this.configs.set(svc.id, svc);
      if (!this.registry.has(svc.id)) {
        this.registry.init(svc);
      }
    }
    await this.reconcile();
    return this;
  }

  // ---- Internal helpers ---------------------------------------------------

  _withLock(serviceId, fn) {
    const prev = this.mutexes.get(serviceId) || Promise.resolve();
    const result = prev.then(() => fn());
    // Chain on a swallowed variant so one failure doesn't break the queue,
    // while the caller still receives the rejection.
    this.mutexes.set(serviceId, result.then(() => {}, () => {}));
    return result;
  }

  // THE single status mutation point:
  //   validate transition -> persist atomically -> emit -> lifecycle log.
  _commit(serviceId, nextStatus, patch = {}, { recovery = false, reason = null } = {}) {
    const before = this.registry.get(serviceId);
    if (!before) throw Object.assign(new Error(`Service not found: ${serviceId}`), { code: 'ENOSERVICE' });

    if (before.status !== nextStatus) {
      assertTransition(before.status, nextStatus, { recovery });
    }

    const record = this.registry.update(serviceId, { ...patch, status: nextStatus });

    this.emit('status', record);
    this.emit(`status:${serviceId}`, record);

    if (reason) {
      this.logs.append(serviceId, reason, { stream: 'lifecycle', phase: nextStatus });
    }
    return record;
  }

  _config(serviceId) {
    const cfg = this.configs.get(serviceId);
    if (!cfg) throw Object.assign(new Error(`Unknown service: ${serviceId}`), { code: 'ENOSERVICE' });
    return cfg;
  }

  _childLog(serviceId, stream, chunk) {
    const status = this.registry.get(serviceId)?.status;
    const text = chunk.toString('utf8');
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\r$/, '');
      if (!line) continue;
      // phase = canonical status at the moment the output was produced
      this.logs.append(serviceId, line, { stream, phase: status });
    }
  }

  _spawn(serviceId, cfg) {
    const cwd = cfg.cwd || BACKEND_DIR;
    const child = spawn(cfg.command, cfg.args, {
      cwd,
      env: {
        ...process.env,
        DEMO_PORT: cfg.port ? String(cfg.port) : '',
        DEMO_NAME: cfg.name,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', c => this._childLog(serviceId, 'stdout', c));
    child.stderr.on('data', c => this._childLog(serviceId, 'stderr', c));
    child.on('exit', (code, signal) => this._onExit(serviceId, code, signal));
    child.on('error', err => this._onSpawnError(serviceId, err));
    this.children.set(serviceId, child);
    return child;
  }

  _onSpawnError(serviceId, err) {
    const rec = this.registry.get(serviceId);
    if (!rec) return;
    this.children.delete(serviceId);
    // 'error' can be followed by 'exit'; a terminal state was already
    // committed, so don't add a duplicate failed transition/log line.
    if (rec.status !== STATUS.PREPARING) return;
    const detail = `failed to spawn: ${err.code || err.message}`;
    this._commit(serviceId, STATUS.FAILED, {
      pid: null, stoppedAt: new Date().toISOString(),
      exitCode: null, signal: null, error: detail,
    }, { reason: `failed: ${detail}` });
  }

  // Process exit handling driven by the live child event, not polling.
  _onExit(serviceId, code, signal) {
    const rec = this.registry.get(serviceId);
    if (!rec) return;
    this.children.delete(serviceId);

    const detail = signal
      ? `process exited on signal ${signal}`
      : `process exited with code ${code}`;

    if (this.stopping.has(serviceId) || rec.status === STATUS.STOPPING) {
      // stop() requested this: cleanup finished -> terminal stopped state.
      this.stopping.delete(serviceId);
      this._commit(serviceId, STATUS.STOPPED, {
        pid: null, stoppedAt: new Date().toISOString(),
        exitCode: code, signal, error: null,
      }, { reason: `stopped (${detail})` });
      return;
    }

    if (rec.status === STATUS.PREPARING) {
      // Initialization interrupted (crash/port conflict during boot).
      this.waiting.delete(serviceId);
      this._commit(serviceId, STATUS.FAILED, {
        pid: null, stoppedAt: new Date().toISOString(),
        exitCode: code, signal, error: `initialization interrupted: ${detail}`,
      }, { reason: `failed: initialization interrupted (${detail})` });
      return;
    }

    if (isReady(rec.status)) {
      // Unexpected death of a ready service.
      this._commit(serviceId, STATUS.FAILED, {
        pid: null, stoppedAt: new Date().toISOString(),
        exitCode: code, signal, error: detail,
      }, { reason: `failed: ${detail}` });
    }
  }

  // ---- Public operations --------------------------------------------------

  getService(id) {
    const rec = this.registry.get(id);
    if (!rec) throw Object.assign(new Error(`Service not found: ${id}`), { code: 'ENOSERVICE' });
    return rec;
  }

  listServices() {
    return this.registry.list();
  }

  getLogs(serviceId, opts) {
    this.getService(serviceId); // 404 when unknown
    return this.logs.read(serviceId, opts);
  }

  start(serviceId) {
    this._config(serviceId);
    return this._withLock(serviceId, () => this._start(serviceId));
  }

  async _start(serviceId) {
    const cfg = this._config(serviceId);
    const rec = this.registry.get(serviceId);

    if (rec.status === STATUS.PREPARING) return rec;
    if (rec.status === STATUS.READY || rec.status === STATUS.STOPPING) {
      // Already running / shutdown in flight; start again afterwards.
      return rec;
    }
    if (this.children.has(serviceId)) return rec;

    this._commit(serviceId, STATUS.PREPARING, {
      pid: null, startedAt: new Date().toISOString(), stoppedAt: null,
      exitCode: null, signal: null, error: null,
      attempts: (rec.attempts || 0) + 1,
    }, { reason: 'starting: entering preparing phase' });

    let child;
    try {
      child = this._spawn(serviceId, cfg);
    } catch (err) {
      return this._commit(serviceId, STATUS.FAILED, {
        error: `failed to spawn: ${err.message}`,
      }, { reason: `failed to spawn: ${err.message}` });
    }

    if (typeof child.pid === 'number') {
      this.registry.update(serviceId, { pid: child.pid });
    }

    // No port configured: ready as soon as the process is alive.
    if (!cfg.port) {
      return this._commit(serviceId, STATUS.READY, {}, { reason: 'ready: process started' });
    }

    this.waiting.add(serviceId);
    const result = await waitForPortOwnedBy(cfg.port, child.pid, {
      timeoutMs: cfg.readyTimeoutMs || this.readyTimeoutMs,
      shouldAbort: () =>
        !this.children.has(serviceId) ||
        this.registry.get(serviceId)?.status !== STATUS.PREPARING,
    });
    this.waiting.delete(serviceId);

    const current = this.registry.get(serviceId);
    if (current.status !== STATUS.PREPARING) {
      // Exit/stop handler already committed a terminal state; don't fight it.
      return current;
    }

    if (result.open) {
      return this._commit(serviceId, STATUS.READY, { error: null },
        { reason: `ready: port ${cfg.port} accepting connections` });
    }

    // Timeout while preparing -> failed and clean up the half-started proc.
    const reason = `failed: port ${cfg.port} not ready before timeout`;
    const childRef = this.children.get(serviceId);
    this._commit(serviceId, STATUS.FAILED, {
      pid: null, stoppedAt: new Date().toISOString(),
      error: reason,
    }, { reason });
    if (childRef) this._kill(childRef);
    return this.registry.get(serviceId);
  }

  stop(serviceId) {
    this._config(serviceId);
    return this._withLock(serviceId, () => this._stop(serviceId));
  }

  async _stop(serviceId) {
    const rec = this.registry.get(serviceId);
    if (rec.status === STATUS.STOPPED) return rec;

    const child = this.children.get(serviceId);

    // FAILED with no live process (e.g. port released after init died):
    // cleanup is just bookkeeping, resolve to the clear stopped state.
    if (!child) {
      if (rec.status === STATUS.PREPARING) this.waiting.delete(serviceId);
      this.stopping.delete(serviceId);
      return this._commit(serviceId, STATUS.STOPPED, {
        pid: null, stoppedAt: new Date().toISOString(),
        exitCode: rec.exitCode ?? null, signal: rec.signal ?? null, error: null,
      }, { recovery: true, reason: 'stopped: no live process, state reset' });
    }

    this.stopping.add(serviceId);
    this._commit(serviceId, STATUS.STOPPING, {}, { reason: 'stopping: terminating process' });

    const exited = new Promise(resolve => child.once('exit', resolve));
    this._kill(child);

    let timer;
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => resolve(false), this.stopTimeoutMs);
      timer.unref();
    });
    const didExit = await Promise.race([
      exited.then(() => true),
      timeout,
    ]);
    clearTimeout(timer);

    if (!didExit) {
      // SIGTERM ignored: force kill and wait briefly for the exit handler.
      try { child.kill('SIGKILL'); } catch (_) {}
      await Promise.race([
        exited,
        new Promise(r => setTimeout(r, 1000)),
      ]);
    }

    // The exit handler performs the canonical stopping -> stopped commit;
    // cover the edge case where the exit event never reached us.
    const latest = this.registry.get(serviceId);
    this.stopping.delete(serviceId);
    if (latest.status === STATUS.STOPPING) {
      return this._commit(serviceId, STATUS.STOPPED, {
        pid: null, stoppedAt: new Date().toISOString(),
      }, { recovery: true, reason: 'stopped: process terminated' });
    }
    return this.registry.get(serviceId);
  }

  _kill(child) {
    // Graceful signal; _stop escalates to SIGKILL if the deadline passes.
    try { child.kill('SIGTERM'); } catch (_) {}
  }

  async restart(serviceId) {
    this._config(serviceId);
    return this._withLock(serviceId, async () => {
      await this._stop(serviceId);
      return this._start(serviceId);
    });
  }

  // Remove all runtime traces of a service. After cleanup the service is
  // reported as stopped (never failed, no stale ready marker, empty logs).
  async cleanup(serviceId) {
    this._config(serviceId);
    return this._withLock(serviceId, async () => {
      const rec = this.registry.get(serviceId);
      if (this.children.has(serviceId) ||
          [STATUS.READY, STATUS.PREPARING, STATUS.STOPPING].includes(rec.status)) {
        await this._stop(serviceId);
      }
      this.logs.clear(serviceId);
      const cfg = this._config(serviceId);
      return this.registry.init(cfg); // fresh record, status stopped
    });
  }

  async stopAll() {
    const ids = this.registry.list().map(s => s.id);
    await Promise.all(ids.map(id => this.stop(id).catch(() => {})));
  }

  // ---- Recovery at supervisor startup ------------------------------------

  // Decide the real state of every service after an interrupted supervisor
  // run. This is what fixes "port released but list still says failed" and
  // "board still shows ready": every record is re-derived from live process
  // and port evidence, committed through the same guarded transitions.
  async reconcile() {
    for (const rec0 of this.registry.list()) {
      const cfg = this.configs.get(rec0.id);
      const status = rec0.status;

      try {
        if (status === STATUS.STOPPED || status === STATUS.FAILED) {
          if (cfg?.port && await checkPort(cfg.port)) {
            // Orphan process serving the port: adopt and call it ready only
            // when the stored state was already ready-ish; a failed service
            // with its port held by someone else stays failed.
            if (status === STATUS.FAILED) {
              this._commit(rec0.id, STATUS.FAILED, {
                error: 'port still occupied by another process',
              }, { recovery: true, reason: 'recovery: port occupied, remains failed' });
            }
            continue;
          }
          if (status === STATUS.FAILED) {
            // Port released (process gone): clear the failure so the service
            // list shows a definite stopped state instead of stale failed.
            this._commit(rec0.id, STATUS.STOPPED, {
              pid: null, stoppedAt: new Date().toISOString(),
              exitCode: null, signal: null, error: null,
            }, { recovery: true, reason: 'recovery: port released, reset to stopped' });
          }
          continue;
        }

        if (status === STATUS.PREPARING) {
          // Initialization was interrupted by a supervisor restart.
          if (cfg?.port && await checkPort(cfg.port)) {
            this._commit(rec0.id, STATUS.READY, { error: null },
              { recovery: true, reason: 'recovery: port already serving, marked ready' });
          } else {
            this._commit(rec0.id, STATUS.FAILED, {
              pid: null, stoppedAt: new Date().toISOString(),
              error: 'initialization interrupted: supervisor restarted during preparing',
            }, { recovery: true, reason: 'recovery: initialization interrupted, marked failed' });
          }
          continue;
        }

        if (status === STATUS.READY) {
          if (cfg?.port && await checkPort(cfg.port)) {
            continue; // genuinely still ready, nothing to change
          }
          // Process vanished while supervisor was away: stale ready marker.
          this._commit(rec0.id, STATUS.STOPPED, {
            pid: null, stoppedAt: new Date().toISOString(),
            error: null,
          }, { recovery: true, reason: 'recovery: process gone, ready marker cleared' });
          continue;
        }

        if (status === STATUS.STOPPING) {
          if (cfg?.port && await checkPort(cfg.port)) {
            this._commit(rec0.id, STATUS.FAILED, {
              error: 'process survived shutdown',
            }, { recovery: true, reason: 'recovery: shutdown incomplete, marked failed' });
          } else {
            this._commit(rec0.id, STATUS.STOPPED, {
              pid: null, stoppedAt: new Date().toISOString(), error: null,
            }, { recovery: true, reason: 'recovery: shutdown completed, marked stopped' });
          }
        }
      } catch (err) {
        if (err.code !== 'EILLEGALTRANSITION') throw err;
        // Concurrent update moved the record first; skip.
      }
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.stopAll().catch(() => {});
    this.logs.closeAll();
  }
}

module.exports = {
  ServiceManager,
  DEFAULT_DATA_DIR,
  DEFAULT_LOG_DIR,
};
