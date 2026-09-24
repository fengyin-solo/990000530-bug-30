'use strict';

const express = require('express');

// REST surface for the supervisor. All fields returned by list/get are kept
// stable (status/phase/ready/pid/port/...); phase mirrors status and ready
// is derived, so clients can keep consuming either name.

module.exports = function createServiceRoutes(manager) {
  const router = express.Router();

  function toSummary(rec) {
    return {
      id: rec.id,
      name: rec.name,
      status: rec.status,
      phase: rec.phase,
      ready: rec.ready,
      pid: rec.pid,
      port: rec.port,
      command: rec.command,
      args: rec.args,
      startedAt: rec.startedAt,
      stoppedAt: rec.stoppedAt,
      exitCode: rec.exitCode,
      signal: rec.signal,
      error: rec.error,
      attempts: rec.attempts,
      updatedAt: rec.updatedAt,
    };
  }

  function handle(fn) {
    return async (req, res) => {
      try {
        await fn(req, res);
      } catch (err) {
        if (err.code === 'ENOSERVICE') return res.status(404).json({ error: 'Service not found' });
        if (err.code === 'EILLEGALTRANSITION') {
          return res.status(409).json({ error: err.message, from: err.from, to: err.to });
        }
        console.error('service route error:', err);
        res.status(500).json({ error: 'Internal supervisor error' });
      }
    };
  }

  // GET /api/services
  router.get('/', handle((req, res) => {
    res.json(manager.listServices().map(toSummary));
  }));

  // GET /api/services/:id
  router.get('/:id', handle((req, res) => {
    res.json(toSummary(manager.getService(req.params.id)));
  }));

  // POST /api/services/:id/start
  router.post('/:id/start', handle(async (req, res) => {
    const rec = await manager.start(req.params.id);
    res.json(toSummary(rec));
  }));

  // POST /api/services/:id/stop
  router.post('/:id/stop', handle(async (req, res) => {
    const rec = await manager.stop(req.params.id);
    res.json(toSummary(rec));
  }));

  // POST /api/services/:id/restart
  router.post('/:id/restart', handle(async (req, res) => {
    const rec = await manager.restart(req.params.id);
    res.json(toSummary(rec));
  }));

  // POST /api/services/:id/cleanup - stop if needed, clear logs, reset state
  router.post('/:id/cleanup', handle(async (req, res) => {
    const rec = await manager.cleanup(req.params.id);
    res.json(toSummary(rec));
  }));

  // GET /api/services/:id/logs?phase=ready&since=ISO
  router.get('/:id/logs', handle((req, res) => {
    const { since, phase } = req.query;
    const entries = manager.getLogs(req.params.id, { since, phase });
    res.json(entries);
  }));

  // POST /api/services/stop-all (defined after '/:id' routes would shadow
  // "stop-all" as an id; keep this before parameterized generic routes is
  // unnecessary in Express 4 for distinct paths, but list it explicitly).
  router.post('/stop-all', handle(async (req, res) => {
    await manager.stopAll();
    res.json(manager.listServices().map(toSummary));
  }));

  return router;
};
