# Task Board

A lightweight Trello-like task board application built with Vue 3 and Express.

## Tech Stack

### Frontend
- Vue 3 + Vite
- Vue Router
- Pinia (state management)
- Element Plus (UI components)
- vuedraggable (drag and drop)
- Axios (HTTP client)

### Backend
- Node.js + Express
- better-sqlite3 (SQLite database)
- jsonwebtoken (JWT authentication)
- bcryptjs (password hashing)
- cors

## Project Structure

```
task-board/
├── frontend/          # Vue 3 frontend (port 5174)
│   ├── src/
│   │   ├── api/       # Axios API layer
│   │   ├── components/# Reusable Vue components
│   │   ├── router/    # Vue Router configuration
│   │   ├── stores/    # Pinia stores (auth, board)
│   │   └── views/     # Page-level components
│   └── vite.config.js
├── backend/           # Express API (port 3002)
│   ├── db/            # Database init and seed scripts
│   ├── middleware/    # Auth middleware (JWT)
│   ├── routes/       # API route handlers
│   ├── data/         # SQLite database file
│   └── server.js
└── README.md
```

## Getting Started

### Prerequisites
- Node.js 18+

### Backend Setup

```bash
cd backend
npm install
npm run seed     # Seed database with demo data
npm run dev      # Start server on port 3002
```

### Frontend Setup

```bash
cd frontend
npm install
npm run dev      # Start dev server on port 5174
```

### Demo Account

- Username: `demo`
- Password: `demo123`

The seed script creates a demo user with a sample board "My Project" containing 3 columns (To Do, In Progress, Done) and 7 sample cards.

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login (returns JWT)

### Boards
- `GET /api/boards` - List user's boards
- `POST /api/boards` - Create board
- `DELETE /api/boards/:id` - Delete board

### Columns
- `GET /api/boards/:boardId/columns` - Get columns for a board
- `POST /api/boards/:boardId/columns` - Add column
- `PUT /api/columns/:id` - Update column (rename/reorder)
- `DELETE /api/columns/:id` - Delete column

### Cards
- `GET /api/columns/:columnId/cards` - Get cards in column
- `POST /api/columns/:columnId/cards` - Add card
- `PUT /api/cards/:id` - Update card
- `DELETE /api/cards/:id` - Delete card
- `PUT /api/cards/:id/move` - Move card to another column

## Features

- User authentication with JWT
- Create and manage multiple boards
- Add, rename, and delete columns
- Create cards with title, description, priority (low/medium/high), and due date
- Drag and drop cards between columns
- Drag and drop to reorder columns
- Responsive design with Element Plus UI

## Service Supervisor (服务看板)

A built-in process supervisor keeps every managed backend service in one
canonical lifecycle state:

```
stopped ──start──▶ preparing ──port ready──▶ ready
                       │                        │
                       └──crash/timeout──▶ failed│
                       ◀──start (retry)─────────┘
ready/failed ──stop──▶ stopping ──exit──▶ stopped
start/stop/cleanup from stopped or failed reset the record cleanly
```

There is a **single source of truth**: only `status` is stored
(`backend/data/supervisor/registry.json`). The `phase` field always mirrors
`status` and `ready` is derived from it (`status === 'ready'`), so the
service list page, the board badges and the log page can never disagree.
Every transition goes through one validated funnel (`ServiceManager._commit`)
which persists atomically and appends the matching lifecycle log line.

Recovery rules when the supervisor starts (e.g. after a crash or reboot):

- `preparing` + port serving → `ready`, otherwise `failed` (init interrupted)
- `ready` but the process/port is gone → `stopped` (stale ready marker cleared)
- `failed` but the port has been released → `stopped` (definite, retryable)
- `stopping` with a live port → `failed`, otherwise `stopped`

### Commands (existing npm scripts are unchanged)

```bash
cd backend
npm run svc:list
npm run svc:start   <service-id>   # e.g. demo-web
npm run svc:stop    <service-id>
npm run svc:restart <service-id>
npm run svc:cleanup <service-id>   # stop + clear logs/old state -> stopped
npm run svc:logs    <service-id>
```

The CLI drives the same state machine as the UI through the REST API while
the backend is running. Custom services can be added via
`backend/supervisor.config.json` (see `supervisor/config.js` for the shape).

### Service API (compatible field names)

- `GET  /api/services` — list services (`status`, `phase`, `ready`, `pid`, `port`, ...)
- `GET  /api/services/:id`
- `POST /api/services/:id/start` · `/stop` · `/restart` · `/cleanup`
- `GET  /api/services/:id/logs?phase=ready&since=<ISO timestamp>`
- `POST /api/services/stop-all`

