'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { ServiceManager } = require('../supervisor/manager');
const { Registry } = require('../supervisor/registry');
const { STATUS } = require('../supervisor/stateMachine');
const { checkPort } = require('../supervisor/portProbe');

const BACKEND_DIR = path.join(__dirname, '..');
const DEMO = path.join(BACKEND_DIR, 'supervisor', 'demo-service.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'svc-test-'));
}

function writeConfig(dir, port) {
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({
    services: [{
      id: 'svc',
      name: 'Test Service',
      command: 'node',
      args: [DEMO, '--exit-on-busy'],
      cwd: BACKEND_DIR,
      port,
      readyTimeoutMs: 10000,
    }],
  }));
  return file;
}

async function makeManager(port) {
  const dir = tmpDir();
  const configPath = writeConfig(dir, port);
  const manager = await new ServiceManager({
    dataDir: path.join(dir, 'data'),
    logDir: path.join(dir, 'data', 'logs'),
    configPath,
    stopTimeoutMs: 3000,
  }).init();
  return { manager, dir };
}

// Independent process holding a port (does NOT exit when the port is busy).
function holdPort(port) {
  return spawn('node', [DEMO], {
    cwd: BACKEND_DIR,
    env: { ...process.env, DEMO_PORT: String(port) },
    stdio: 'ignore',
  });
}

async function waitFor(fn, { timeout = 8000, interval = 50 } = {}) {
  const deadline = Date.now() + timeout;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v !== false) return v;
    } catch (err) { lastErr = err; }
    await new Promise(r => setTimeout(r, interval));
  }
  if (lastErr) throw lastErr;
  throw new Error('waitFor timed out');
}

test('start: preparing -> ready, phase-tagged logs agree with status', async () => {
  const { manager } = await makeManager(4201);
  try {
    assert.equal(manager.getService('svc').status, STATUS.STOPPED);
    const rec = await manager.start('svc');
    assert.equal(rec.status, STATUS.READY);
    assert.equal(rec.ready, true);
    assert.equal(rec.phase, STATUS.READY);

    const logs = manager.getLogs('svc');
    const phases = logs.filter(l => l.stream === 'lifecycle').map(l => l.phase);
    assert.ok(phases.includes(STATUS.PREPARING));
    assert.ok(phases.includes(STATUS.READY));
  } finally {
    await manager.close();
  }
});

test('stop: ready -> stopping -> stopped clears ready marker', async () => {
  const { manager } = await makeManager(4202);
  try {
    await manager.start('svc');
    const stopped = await manager.stop('svc');
    assert.equal(stopped.status, STATUS.STOPPED);
    assert.equal(stopped.ready, false);
    assert.equal(stopped.phase, STATUS.STOPPED);
    assert.equal(stopped.pid, null);
    assert.equal(await checkPort(4202), false);

    const phases = manager.getLogs('svc')
      .filter(l => l.stream === 'lifecycle').map(l => l.phase);
    assert.deepEqual(
      phases.slice(-2),
      [STATUS.STOPPING, STATUS.STOPPED]
    );
  } finally {
    await manager.close();
  }
});

test('interrupted initialization during preparing is reported as failed', async () => {
  const holder = holdPort(4203);
  await waitFor(() => checkPort(4203));

  const { manager } = await makeManager(4203);
  try {
    const rec = await manager.start('svc');
    assert.equal(rec.status, STATUS.FAILED);
    assert.equal(rec.ready, false);
    assert.equal(rec.phase, STATUS.FAILED);
    assert.match(rec.error, /interrupted|EADDRINUSE|exited/);

    const lifecycle = manager.getLogs('svc').filter(l => l.stream === 'lifecycle');
    assert.equal(lifecycle.at(-1).phase, STATUS.FAILED);
  } finally {
    await manager.close();
    holder.kill('SIGKILL');
  }
});

test('port released after failure: reconcile flips failed -> stopped', async () => {
  const holder = holdPort(4204);
  await waitFor(() => checkPort(4204));

  const { manager, dir } = await makeManager(4204);
  await manager.start('svc');
  assert.equal(manager.getService('svc').status, STATUS.FAILED);
  await manager.close();

  // Release the port and start a fresh supervisor (simulated restart).
  holder.kill('SIGKILL');
  await waitFor(async () => (await checkPort(4204)) === false ? true : false);

  const manager2 = await new ServiceManager({
    dataDir: path.join(dir, 'data'),
    logDir: path.join(dir, 'data', 'logs'),
    configPath: path.join(dir, 'config.json'),
  }).init();
  try {
    const rec = manager2.getService('svc');
    assert.equal(rec.status, STATUS.STOPPED);
    assert.equal(rec.ready, false);
    assert.equal(rec.error, null);
  } finally {
    await manager2.close();
  }
});

test('start again after failure reaches ready (restart path)', async () => {
  const { manager } = await makeManager(4205);
  try {
    const rec = await manager.restart('svc');
    assert.equal(rec.status, STATUS.READY);
    assert.equal(rec.ready, true);
    assert.equal(await checkPort(4205), true);
  } finally {
    await manager.close();
  }
});

test('cleanup ends stopped and removes stale logs/ready markers', async () => {
  const { manager } = await makeManager(4206);
  try {
    await manager.start('svc');
    assert.ok(manager.getLogs('svc').length > 0);
    const rec = await manager.cleanup('svc');
    assert.equal(rec.status, STATUS.STOPPED);
    assert.equal(rec.ready, false);
    assert.equal(rec.attempts, 0);
    assert.deepEqual(manager.getLogs('svc'), []);
    assert.equal(await checkPort(4206), false);
  } finally {
    await manager.close();
  }
});

test('recovery: stale ready record with dead process becomes stopped', async () => {
  const dir = tmpDir();
  const configPath = writeConfig(dir, 4207);
  const dataDir = path.join(dir, 'data');
  const registry = new Registry(dataDir);
  registry.init({
    id: 'svc', name: 'Test Service', command: 'node',
    args: [DEMO], cwd: BACKEND_DIR, port: 4207,
  });
  registry.update('svc', {
    status: STATUS.READY, pid: 999999,
    startedAt: new Date().toISOString(),
  });

  const manager = await new ServiceManager({
    dataDir, logDir: path.join(dataDir, 'logs'), configPath,
  }).init();
  try {
    const rec = manager.getService('svc');
    assert.equal(rec.status, STATUS.STOPPED);
    assert.equal(rec.ready, false);
    assert.equal(rec.pid, null);
  } finally {
    await manager.close();
  }
});

test('recovery: interrupted preparing with live port becomes ready, else failed', async () => {
  // Port closed -> preparing survives as failed
  {
    const dir = tmpDir();
    const configPath = writeConfig(dir, 4208);
    const dataDir = path.join(dir, 'data');
    const registry = new Registry(dataDir);
    registry.init({
      id: 'svc', name: 'Test Service', command: 'node',
      args: [DEMO], cwd: BACKEND_DIR, port: 4208,
    });
    registry.update('svc', { status: STATUS.PREPARING, pid: null });

    const manager = await new ServiceManager({
      dataDir, logDir: path.join(dataDir, 'logs'), configPath,
    }).init();
    try {
      assert.equal(manager.getService('svc').status, STATUS.FAILED);
    } finally {
      await manager.close();
    }
  }

  // Port serving -> adopted as ready
  {
    const holder = holdPort(4209);
    await waitFor(() => checkPort(4209));
    const dir = tmpDir();
    const configPath = writeConfig(dir, 4209);
    const dataDir = path.join(dir, 'data');
    const registry = new Registry(dataDir);
    registry.init({
      id: 'svc', name: 'Test Service', command: 'node',
      args: [DEMO], cwd: BACKEND_DIR, port: 4209,
    });
    registry.update('svc', { status: STATUS.PREPARING, pid: null });

    const manager = await new ServiceManager({
      dataDir, logDir: path.join(dataDir, 'logs'), configPath,
    }).init();
    try {
      assert.equal(manager.getService('svc').status, STATUS.READY);
    } finally {
      await manager.close();
      holder.kill('SIGKILL');
    }
  }
});
