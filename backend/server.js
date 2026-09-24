const express = require('express');
const cors = require('cors');
const { initDb } = require('./db/init');

const authRoutes = require('./routes/auth');
const boardRoutes = require('./routes/boards');
const columnRoutes = require('./routes/columns');
const cardRoutes = require('./routes/cards');

const app = express();
const PORT = 3002;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database — fail fast with a clear state if startup can't proceed
try {
  initDb();
  console.log('Database initialized');
} catch (err) {
  console.error('Startup failed: could not initialize database:', err.message);
  process.exit(1);
}

// Health check (before auth-protected routes)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/boards', boardRoutes);
app.use('/api', columnRoutes);
app.use('/api', cardRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(`Task Board API running on http://localhost:${PORT}`);
});

// Startup failures (e.g. port already in use on restart) get a clear
// failed state instead of an unhandled exception
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Startup failed: port ${PORT} is already in use`);
  } else {
    console.error('Startup failed:', err.message);
  }
  process.exit(1);
});

// Graceful shutdown: stop accepting requests, release the port, and exit
// with a definite final state
function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  server.close(() => {
    console.log('Server closed, port released');
    process.exit(0);
  });
  // Don't hang on lingering keep-alive connections
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
