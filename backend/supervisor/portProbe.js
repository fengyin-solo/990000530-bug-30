'use strict';

const net = require('net');
const fs = require('fs');
const path = require('path');

// Resolve when something is accepting TCP connections on 127.0.0.1:port.
// Used as the readiness probe during the preparing phase.
function checkPort(port, host = '127.0.0.1', timeout = 300) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let done = false;
    const finish = open => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

// Find the pids of processes listening on a local port.
// "Port accepts connections" alone is not proof of readiness: a stale
// orphaned process can hold the port while the freshly spawned child is
// crashing with EADDRINUSE. Readiness must be attributed to OUR child.
function listPortOwnerPids(port) {
  const pids = new Set();
  if (process.platform !== 'linux') return null; // unsupported on this OS

  let inodes;
  try {
    inodes = listeningInodes(port);
  } catch (_) {
    return null;
  }
  if (inodes.size === 0) return pids;

  let entries = [];
  try {
    entries = fs.readdirSync('/proc');
  } catch (_) {
    return null;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const fdDir = `/proc/${entry}/fd`;
    let fds;
    try {
      fds = fs.readdirSync(fdDir);
    } catch (_) {
      continue; // process exited or not ours to inspect
    }
    for (const fd of fds) {
      let link;
      try {
        link = fs.readlinkSync(path.join(fdDir, fd));
      } catch (_) {
        continue;
      }
      const m = link.match(/^socket:\[(\d+)\]$/);
      if (m && inodes.has(Number(m[1]))) {
        pids.add(Number(entry));
        break;
      }
    }
  }
  return pids;
}

// Parse /proc/net/tcp[6] for LISTEN sockets bound to the given local port.
function listeningInodes(port) {
  const inodes = new Set();
  const files = ['/proc/net/tcp', '/proc/net/tcp6'];
  const portHex = port.toString(16).padStart(4, '0').toLowerCase();
  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch (_) {
      continue;
    }
    for (const line of content.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 10) continue;
      const state = cols[3];
      const local = cols[1].toLowerCase();
      const inode = Number(cols[9]);
      if (state !== '0A') continue; // TCP_LISTEN
      if (!local.endsWith(`:${portHex}`)) continue;
      inodes.add(inode);
    }
  }
  return inodes;
}

// Poll until OUR child owns an open port, the process exits, or the deadline
// passes. Attribution is what distinguishes a real ready from a port held by
// an orphan (which must surface as failed).
async function waitForPortOwnedBy(port, ownerPid, {
  host = '127.0.0.1',
  timeoutMs = 15000,
  intervalMs = 100,
  shouldAbort = null,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  // On systems without /proc we cannot attribute the port; require two
  // consecutive successful probes while the child is alive so a child that
  // immediately dies on EADDRINUSE is not mistaken for ready.
  let consecutive = 0;
  const REQUIRED_STREAK = 2;

  while (Date.now() < deadline) {
    if (shouldAbort && shouldAbort()) return { open: false, reason: 'aborted' };

    if (await checkPort(port, host)) {
      const owners = listPortOwnerPids(port);
      if (owners === null) {
        consecutive += 1;
        if (consecutive >= REQUIRED_STREAK) return { open: true };
      } else if (owners.has(ownerPid)) {
        return { open: true };
      }
      // Port open but owned by another process: not ours, keep waiting so
      // the child's EADDRINUSE exit drives the failed transition.
    } else {
      consecutive = 0;
    }

    await new Promise(r => setTimeout(r, intervalMs));
  }
  return { open: false, reason: 'timeout' };
}

module.exports = { checkPort, waitForPortOwnedBy, listPortOwnerPids };
