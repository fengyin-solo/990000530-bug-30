'use strict';

// Minimal long-running HTTP service used for supervisor demos/tests.
// Binds its configured port, logs lifecycle lines and shuts down cleanly on
// SIGTERM/SIGINT so the ready -> stopping -> stopped path is exercised.
//
// node demo-service.js [--exit-on-busy] [--exit-after-ms=N]

const http = require('http');

const port = parseInt(process.env.DEMO_PORT || process.env.PORT || '0', 10);
const name = process.env.DEMO_NAME || process.argv[1]?.split('/').pop() || 'demo-service';
const exitOnBusy = process.argv.includes('--exit-on-busy');
const exitAfterArg = process.argv.find(a => a.startsWith('--exit-after-ms='));
const exitAfterMs = exitAfterArg ? parseInt(exitAfterArg.split('=')[1], 10) : 0;

function log(level, msg) {
  const line = { ts: new Date().toISOString(), level, service: name, msg };
  (level === 'error' ? console.error : console.log)(JSON.stringify(line));
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: name, pid: process.pid }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`${name} pid=${process.pid}\n`);
});

server.on('error', err => {
  log('error', `server error: ${err.code || err.message}`);
  // A port conflict while preparing must surface as a process failure.
  if (err.code === 'EADDRINUSE' && exitOnBusy) {
    process.exit(2);
  }
});

server.listen(port, '127.0.0.1', () => {
  const actual = server.address().port;
  log('info', `listening on http://127.0.0.1:${actual}`);
  if (exitAfterMs > 0) {
    setTimeout(() => {
      log('info', 'exit-after timer elapsed, closing');
      shutdown(0);
    }, exitAfterMs).unref();
  }
});

function shutdown(code) {
  server.close(() => process.exit(code));
  // Force-exit if connections keep the server hanging.
  setTimeout(() => process.exit(code), 2000).unref();
}

process.on('SIGTERM', () => { log('info', 'received SIGTERM'); shutdown(0); });
process.on('SIGINT', () => { log('info', 'received SIGINT'); shutdown(0); });
process.on('uncaughtException', err => { log('error', `uncaught: ${err.stack || err.message}`); process.exit(1); });

log('info', `starting ${name} pid=${process.pid}`);
