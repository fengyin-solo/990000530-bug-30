#!/usr/bin/env node
'use strict';

// Command line client for the task-board service supervisor.
//
//   node supervisor/cli.js list
//   node supervisor/cli.js start   <service-id>
//   node supervisor/cli.js stop    <service-id>
//   node supervisor/cli.js restart <service-id>
//   node supervisor/cli.js cleanup <service-id>
//   node supervisor/cli.js logs    <service-id> [--follow] [--phase=ready]
//
// The CLI drives the SAME state machine as the dashboard through the
// backend REST API (default http://127.0.0.1:3002), so a service started on
// the command line and one started from the board can never diverge.
// Set SUPERVISOR_EMBED=1 to run the manager in-process instead.

const BASE = process.env.SUPERVISOR_API || 'http://127.0.0.1:3002';

async function http(method, path) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method });
  } catch (err) {
    throw new Error(
      `Cannot reach supervisor API at ${BASE}. Start the backend (npm run dev) first. (${err.message})`
    );
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

async function runRemote(args) {
  const [command, ...rest] = args;
  const positionals = rest.filter(a => !a.startsWith('--'));
  const flags = Object.fromEntries(
    rest.filter(a => a.startsWith('--')).map(a => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v === undefined ? true : v];
    })
  );

  const id = positionals[0];

  switch (command) {
    case 'list': {
      const services = await http('GET', '/api/services');
      printList(services);
      return 0;
    }
    case 'start':
      requireId(id);
      printOne(await http('POST', `/api/services/${id}/start`));
      return 0;
    case 'stop':
      requireId(id);
      printOne(await http('POST', `/api/services/${id}/stop`));
      return 0;
    case 'restart':
      requireId(id);
      printOne(await http('POST', `/api/services/${id}/restart`));
      return 0;
    case 'cleanup':
      requireId(id);
      printOne(await http('POST', `/api/services/${id}/cleanup`));
      return 0;
    case 'logs': {
      requireId(id);
      const qs = flags.phase ? `?phase=${encodeURIComponent(flags.phase)}` : '';
      const entries = await http('GET', `/api/services/${id}/logs${qs}`);
      printLogs(entries);
      if (flags.follow) await followLogs(id, flags.phase, entries.length);
      return 0;
    }
    default:
      process.stderr.write('Unknown command. Usage: list|start|stop|restart|cleanup|logs <id>\n');
      return 2;
  }
}

async function followLogs(id, phase, initialCount) {
  let shown = initialCount;
  while (true) {
    const qs = phase ? `?phase=${encodeURIComponent(phase)}` : '';
    const entries = await http('GET', `/api/services/${id}/logs${qs}`);
    for (const e of entries.slice(shown)) printLogs([e]);
    shown = entries.length;
    await new Promise(r => setTimeout(r, 1000));
  }
}

async function runEmbedded(args) {
  const { ServiceManager } = require('./manager');
  const manager = await new ServiceManager().init();
  try {
    const { dispatch } = require('./cli-embedded');
    return await dispatch(manager, args);
  } finally {
    await manager.close();
  }
}

function requireId(id) {
  if (!id) {
    process.stderr.write('Service id is required\n');
    process.exit(2);
  }
}

function printList(services) {
  if (!services.length) {
    process.stdout.write('No services configured.\n');
    return;
  }
  for (const s of services) {
    const port = s.port ? `:${s.port}` : '';
    const extra = s.error ? ` error="${s.error}"` : '';
    process.stdout.write(
      `${s.id.padEnd(16)} ${s.status.padEnd(10)} phase=${s.phase.padEnd(10)} ` +
      `ready=${String(s.ready).padEnd(5)} pid=${s.pid ?? '-'}${port}${extra}\n`
    );
  }
}

function printOne(s) {
  process.stdout.write(
    `${s.id} status=${s.status} phase=${s.phase} ready=${s.ready} ` +
    `pid=${s.pid ?? '-'}${s.port ? ` port=${s.port}` : ''}${s.error ? ` error="${s.error}"` : ''}\n`
  );
}

function printLogs(entries) {
  for (const e of entries) {
    process.stdout.write(`${e.ts} [${e.phase || '-'}] (${e.stream}) ${e.msg}\n`);
  }
}

if (require.main === module) {
  const runner = process.env.SUPERVISOR_EMBED === '1' ? runEmbedded : runRemote;
  runner(process.argv.slice(2))
    .then(code => process.exit(code || 0))
    .catch(err => {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    });
}
