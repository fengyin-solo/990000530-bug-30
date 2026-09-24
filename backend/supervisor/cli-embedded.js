'use strict';

// In-process CLI dispatch used by SUPERVISOR_EMBED=1 and by tests.
// The regular CLI talks to the REST API instead; see cli.js.

async function dispatch(manager, args) {
  const [command, ...rest] = args;
  const positionals = rest.filter(a => !a.startsWith('--'));
  const flags = Object.fromEntries(
    rest.filter(a => a.startsWith('--')).map(a => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v === undefined ? true : v];
    })
  );

  switch (command) {
    case 'list':
      printList(manager.listServices());
      return 0;
    case 'start':
      requireId(positionals);
      printOne(await manager.start(positionals[0]));
      return 0;
    case 'stop':
      requireId(positionals);
      printOne(await manager.stop(positionals[0]));
      return 0;
    case 'restart':
      requireId(positionals);
      printOne(await manager.restart(positionals[0]));
      return 0;
    case 'cleanup':
      requireId(positionals);
      printOne(await manager.cleanup(positionals[0]));
      return 0;
    case 'logs': {
      requireId(positionals);
      const entries = manager.getLogs(positionals[0], { phase: flags.phase || null });
      printLogs(entries);
      return 0;
    }
    default:
      process.stderr.write('Unknown command. Usage: list|start|stop|restart|cleanup|logs <id>\n');
      return 2;
  }
}

function requireId(positionals) {
  if (!positionals[0]) {
    process.stderr.write('Service id is required\n');
    process.exit(2);
  }
}

function printList(services) {
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

module.exports = { dispatch };
