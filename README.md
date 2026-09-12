# Project Management Dashboard

## Project Overview

A role-based project management dashboard with a React 19 + TypeScript frontend (Vite, Tailwind CSS, React Router) and a Node.js / Express 5 REST API backed by PostgreSQL through the Prisma 7 ORM. Socket.IO pushes a live, permission-filtered activity feed and per-user notifications, while a scheduled `node-cron` job flags overdue tasks in the background.

## Local Setup Instructions

### Prerequisites

- **Node.js** 20.19+, 22.12+ or 24+
- **PostgreSQL**, preferably via **Docker**

### 1. Start PostgreSQL (Docker preferred)

```bash
docker run --name pm-dashboard-db -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=pm_dashboard -p 5432:5432 -d postgres:17
```

This matches the default `DATABASE_URL` in `.env.example`. Without Docker, `npx prisma dev` starts Prisma's local Postgres; put the `postgres://…` URL it prints into `DATABASE_URL`.

### 2. Install dependencies

```bash
npm install
npm --prefix web install
```

> npm 11+ may warn that some install scripts were blocked (bcrypt, prisma, esbuild). They aren't needed: bcrypt ships prebuilt binaries, and the Prisma CLI downloads its engine on first use.

### 3. Configure the environment

```bash
cp .env.example .env
```

Set `JWT_ACCESS_SECRET` in `.env`; the API refuses to start without it. You can generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | *(required)* | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | *(required, ≥ 32 chars)* | HS256 signing key for access tokens |
| `PORT` | `3000` | API + Socket.IO port |
| `ACCESS_TOKEN_TTL_SECONDS` | `900` | Access-token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | `7` | Refresh-token lifetime |
| `OVERDUE_SWEEP_CRON` | `0 * * * *` | Overdue sweep schedule (cron syntax, UTC) |
| `JOBS_ENABLED` | `true` | Set to `false` to run an instance without background jobs |
| `SEED_USER_PASSWORD` | `Password123!` | Password given to every seeded user |
| `SEED_ALLOW_REMOTE` | `false` | Must be `true` for the seed to wipe a non-local database (e.g. the hosted demo) |
| `FRONTEND_URL` | the Vercel URL | Origin allowed by CORS, for clients calling the API directly |

### 4. Create the schema and load demo data

```bash
npm run db:generate   # generate the Prisma client (src/generated is not committed)
npm run db:deploy     # apply the migrations in prisma/migrations
npm run db:seed       # wipe and load realistic demo data (refuses non-local databases)
```

### 5. Start the backend and the frontend (two terminals)

```bash
npm run dev               # API + Socket.IO + overdue job → http://localhost:3000
npm --prefix web run dev  # React app → http://localhost:5173
```

Open **http://localhost:5173**. In development, Vite proxies `/api` and `/socket.io` to port 3000. The browser therefore sees a single origin, so the refresh cookie and the WebSocket work without CORS.

### Seeded accounts (password `Password123!`)

| Role | Email |
| --- | --- |
| Admin | `admin@example.com` |
| Project manager | `priya.sharma@example.com`, `marcus.chen@example.com` |
| Developer | `sofia.alvarez@example.com`, `daniel.okafor@example.com`, `emma.larsen@example.com`, `kenji.tanaka@example.com` |

### Tests and checks

```bash
npm test                   # backend integration tests (wipe and re-seed the database; local databases only)
npm run typecheck          # backend type check
npm --prefix web run build # frontend type check + production build
```

### Repository layout

```
prisma/      schema.prisma, migrations/, seed.ts
src/         Express API: routes, controllers, auth, realtime (Socket.IO), jobs (node-cron)
test/        node:test integration suites (auth/RBAC, jobs and lists, notifications, realtime)
web/src/     React app: api/, features/, components/, hooks/, pages/, realtime/
```

## Database Schema & Indexing

### Conventions

- **Naming:** tables and columns are mapped to `snake_case` (`activity_logs.created_at`), so raw SQL never needs quoted identifiers.
- **Primary keys:** native `UUID`s generated as UUIDv7. They are time-ordered, so new rows append to the primary-key index instead of scattering writes across it.
- **Timestamps:** all `timestamptz`, so comparisons with `now()` are correct in any session time zone.
- **Enums:** `role`, `task_status`, `priority`, `project_status`, `activity_action`, `notification_type`.

### Tables and relations

```
users ─┬─< projects        (owner_id → users, ON DELETE RESTRICT)      a PM owns projects
       ├─< tasks           (assignee_id, created_by_id → users, SET NULL)
       ├─< activity_logs   (actor_id → users, SET NULL; NULL = system)
       ├─< notifications   (recipient_id → users, CASCADE)
       └─< refresh_tokens  (user_id → users, CASCADE)

projects ─┬─< tasks          (project_id, CASCADE)
          ├─< activity_logs  (project_id, SET NULL)
          └─< notifications  (project_id, CASCADE)

tasks ─┬─< activity_logs   (task_id, SET NULL)
       └─< notifications   (task_id, CASCADE)
```

| Table | Key columns |
| --- | --- |
| `users` | `email` (unique), `password_hash` (bcrypt), `role` (ADMIN / PROJECT_MANAGER / DEVELOPER), `is_active` |
| `projects` | `name`, `status` (PLANNING → ARCHIVED), `start_date`, `due_date`, `owner_id` |
| `tasks` | `title`, `status` (TODO / IN_PROGRESS / IN_REVIEW / DONE / OVERDUE), `priority` (LOW → URGENT), `due_date`, `completed_at`, `project_id`, `assignee_id` |
| `activity_logs` | Append-only audit trail: `action` (enum), `message` (readable text), `metadata` (JSONB, e.g. `{"from":"IN_PROGRESS","to":"IN_REVIEW"}`), `actor_id`, `project_id`, `task_id` |
| `notifications` | `type`, `message`, `is_read`, `recipient_id`, `project_id`, `task_id` |
| `refresh_tokens` | `token_hash` (SHA-256, unique), `family_id` (one per login session), `expires_at`, `revoked_at` |

Rules a foreign key can't express are enforced in the service layer, for example "a project owner must be a PM" and "an assignee must be a developer". Activity-log foreign keys use `SET NULL`, so deleting a user, project or task never erases history. Deletions also store the deleted item's name in `message` and `metadata`.

### Indexing decisions

PostgreSQL does **not** index foreign keys automatically. Every FK column below leads some index; without one, each `ON DELETE CASCADE` / `SET NULL` would sequentially scan the child table.

| Index | Serves |
| --- | --- |
| `tasks (status, due_date)` | The **overdue cron sweep** (`status IN ('TODO','IN_PROGRESS','IN_REVIEW') AND due_date < now()`), due-soon queries and status filters. `status` comes first so the scan only reads open tasks and never the ever-growing history of DONE ones, which a plain `due_date` index would walk through. |
| `activity_logs (created_at DESC)` | The **admin activity feed** and catch-up: `ORDER BY created_at DESC LIMIT 20` is read straight off the index, with no sort step. |
| `activity_logs (project_id, created_at DESC)` | The PM feed and catch-up, newest first; also backs the project FK. |
| `activity_logs (task_id, created_at DESC)` | The developer feed and task history; also backs the task FK. |
| `activity_logs (actor_id, created_at DESC)` | Per-user activity; also backs the actor FK. |
| `tasks (project_id, status)` | Project boards and per-project status counts (index-only `groupBy`); also backs the project FK. |
| `tasks (assignee_id, status)` | "My tasks" and developer workload; also backs the assignee FK. |
| `tasks (created_by_id)` | Backs the creator FK. |
| `projects (owner_id, status)` | "My projects" for a PM; also backs the owner FK. |
| `notifications (recipient_id, is_read, created_at DESC)` | The unread badge count (index-only scan) and the inbox list; also backs the recipient FK. |
| `notifications (project_id)`, `notifications (task_id)` | Back the cascading FKs. |
| `users (email)` unique | Login lookups. |
| `refresh_tokens (token_hash)` unique, `(family_id)`, `(user_id)` | Token lookup on refresh, revoking a whole session, and the user FK. |

These plans were confirmed with `EXPLAIN`. The cron sweep uses `tasks_status_due_date_idx`, the unread count is an index-only scan, and the PM and developer catch-up queries go through the project and task indexes on `activity_logs`.

## Architectural Decisions

### Socket.IO with room-based RBAC filtering (no global broadcasts)

Real-time data must respect the same permissions as the REST API, so events are filtered **on the server** and a client never receives anything it isn't allowed to see.

- **Authenticated handshake:** the client sends its access token in the Socket.IO `auth` payload, never in the URL. The server verifies the JWT (algorithm pinned, issuer and audience checked) and reloads the user from the database, rejecting deactivated accounts.
- **Rooms assigned by the server:** each socket joins its role room (`global_admin`, `pm_{userId}` or `dev_{userId}`) plus a personal room, `user_{userId}`. Clients have no way to join rooms themselves.
- **Targeted emits:** `logAndEmitActivity(taskId, userId, actionMessage)` saves the activity row in the same transaction as the change. After the commit, it emits only to `global_admin`, the owning PM's room and the assignee's room. Notifications go only to `user_{recipientId}`, along with their new unread count.
- **Emit after commit:** clients never hear about a write that later rolled back.
- **Session hygiene:** a socket is dropped when its access token expires (`session_expired`), and the client refreshes the token and reconnects. `GET /api/feed/catchup` returns the last 20 events a client missed while offline, using the same visibility rules.

Socket.IO was chosen over raw WebSockets or Server-Sent Events for its built-in rooms, reconnection handling and handshake authentication.

### `node-cron` with a PostgreSQL lock (no Redis required)

The overdue sweep runs inside the API process: hourly in UTC by default, plus once at startup. It needs no separate queue infrastructure.

- **Only one instance sweeps:** every batch takes `pg_try_advisory_xact_lock`. The lock is transaction-scoped, so it releases automatically on commit, rollback or crash. Within a process, `noOverlap` plus a guard ensure a slow run is never doubled up.
- **Database-friendly:**
  - Candidates are read through the `tasks (status, due_date)` index, 100 at a time, with keyset pagination.
  - Each batch is one short transaction: one bulk `UPDATE` per previous status, re-checking the same `WHERE`. A task changed by someone in the meantime is simply skipped.
  - There is a short pause between batches, so hundreds of overdue tasks never become one huge transaction.
- **Auditable:** every flagged task goes through `logAndEmitActivity` with a system actor, so the change is logged and broadcast after each batch commits.

This avoids adding Redis or BullMQ just for one hourly job. PostgreSQL is already the source of truth, and its locks are reliable.

### HttpOnly cookie strategy with refresh-token rotation

- **Access token:** a 15-minute HS256 JWT that carries only the user id. It lives in memory on the client (never `localStorage`) and is sent as `Authorization: Bearer`. The API reloads the user on every request, so deactivation and role changes take effect immediately.
- **Refresh token:** 32 random bytes, stored server-side only as a SHA-256 hash. It is delivered **only** as an `HttpOnly; Secure; SameSite=Strict; Path=/api/auth` cookie and never appears in a JSON response.
  - JavaScript, and therefore an XSS payload, cannot read it.
  - It is never sent cross-site, which blocks CSRF.
  - It is only sent to the auth endpoints.
- **Rotation with reuse detection:** every `POST /api/auth/refresh` revokes the presented token and issues a new one in the same session "family". Presenting an already-used token signals theft, so the whole family is revoked. Logout revokes the family too.
- **Client side:** an Axios interceptor catches a 401, refreshes once (guarded by a `_retry` flag) and retries the original request. The refresh is single-flight, so concurrent 401s share one refresh call and never trip reuse detection. If the refresh fails, the user is logged out.

### Also worth noting

- **Two-layer RBAC:**
  - `requireRole([...])` decides who may call an endpoint at all.
  - The controllers then compare `req.user.id` with owner and assignee ids read from the database, repeating that condition in the `UPDATE`'s `WHERE`. A valid token never grants access to someone else's data.
- **Validation:** every request is validated with Zod (strict objects, so unknown fields are rejected). Errors share one JSON envelope, `{ error: { code, message, details[] } }`, with no stack traces. The frontend shows those `details` when a hand-edited URL filter is invalid.
- **URL as filter state:** dashboard filters live in the query string (`useSearchParams`), so every filtered view is shareable.

## Known Limitations

- **Socket.IO is in-memory.** Rooms live in a single Node.js process, so events only reach clients connected to the instance that made the change. Scaling horizontally requires the Socket.IO Redis adapter (`@socket.io/redis-adapter`). The client already uses the WebSocket transport only, so sticky sessions aren't needed.
- **Multi-instance cron locking is untested.** It relies on a PostgreSQL advisory lock, which the local test database can't simulate, so it hasn't been exercised across real instances yet.
- **Deployment constraints:** the refresh cookie is `Secure` and `SameSite=Strict`, so production must use HTTPS, and the frontend must be served from the same site as the API. Otherwise CORS must be configured for both Express and Socket.IO.
- **Not yet implemented:**
  - rate limiting on `POST /api/auth/login`
  - pruning of expired refresh tokens and old notifications
  - `TASK_OVERDUE` / `TASK_DUE_SOON` notifications (the enum values exist)
- **Frontend tests:** the backend has 41 integration tests; the frontend was verified manually in the browser and has no automated tests yet.

## Explanation

> **PLACEHOLDER: 150–250 word explanation to be written by the author.**
