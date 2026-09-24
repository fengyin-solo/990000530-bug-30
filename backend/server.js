const express = require('express');
const cors = require('cors');
const { initDb } = require('./db/init');
const { ServiceManager } = require('./supervisor/manager');
const createServiceRoutes = require('./routes/services');

const authRoutes = require('./routes/auth');
const boardRoutes = require('./routes/boards');
const columnRoutes = require('./routes/columns');
const cardRoutes = require('./routes/cards');

const app = express();
const PORT = 3002;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database
initDb();

// Health check (before auth-protected routes)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Service supervisor (unified status lifecycle)
const manager = new ServiceManager();

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/services', createServiceRoutes(manager));
app.use('/api/boards', boardRoutes);
app.use('/api', columnRoutes);
app.use('/api', cardRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

let server;

async function main() {
  // Recover service state from the last run BEFORE accepting requests, so
  // every answer reflects a definite status (stopped/ready/failed).
  await manager.init();

  server = app.listen(PORT, () => {
    console.log(`Task Board API running on http://localhost:${PORT}`);
  });
}

// Cleanup: interrupted initialization or termination leaves all services in
// a definite stopped/ready/failed state instead of a stuck preparing.
async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  try {
    if (server) await new Promise(resolve => server.close(resolve));
    await manager.close();
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

module.exports = { app, manager };
