'use strict';

const fs = require('fs');
const path = require('path');

// Service definitions. A user-provided backend/supervisor.config.json
// overrides the built-in demo services; CLI/API fields are unaffected.

const DEFAULT_CONFIG = Object.freeze({
  services: [
    {
      id: 'demo-web',
      name: 'Demo Web',
      command: 'node',
      args: ['supervisor/demo-service.js', '--exit-on-busy'],
      cwd: null, // resolved against the backend directory
      port: 4101,
      readyTimeoutMs: 15000,
    },
    {
      id: 'demo-api',
      name: 'Demo API',
      command: 'node',
      args: ['supervisor/demo-service.js', '--exit-on-busy'],
      cwd: null,
      port: 4102,
      readyTimeoutMs: 15000,
    },
    {
      // This service deliberately grabs its port up front, so starting a
      // second copy while the first one runs reliably demonstrates the
      // preparing -> failed path and the "port released" recovery.
      id: 'demo-busy',
      name: 'Demo Busy Port',
      command: 'node',
      args: ['supervisor/demo-service.js', '--exit-on-busy'],
      cwd: null,
      port: 4103,
      readyTimeoutMs: 8000,
    },
  ],
});

function loadConfig(configPath = path.join(__dirname, '..', 'supervisor.config.json')) {
  let custom = null;
  try {
    custom = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw new Error(`Invalid supervisor config at ${configPath}: ${err.message}`);
    }
  }

  const services = (custom?.services || DEFAULT_CONFIG.services).map(svc => {
    if (!svc.id) throw new Error('Service config entry is missing "id"');
    return {
      id: String(svc.id),
      name: svc.name || String(svc.id),
      command: svc.command,
      args: Array.isArray(svc.args) ? svc.args.map(String) : [],
      cwd: svc.cwd || null,
      port: Number.isInteger(svc.port) ? svc.port : (parseInt(svc.port, 10) || null),
      readyTimeoutMs: svc.readyTimeoutMs || 15000,
    };
  });

  return { services };
}

module.exports = { loadConfig, DEFAULT_CONFIG };
