# Usman Mall

Offline desktop accounting and shop management app for **Usman Mall**.

## Stack

- **Desktop:** Electron
- **Frontend:** React + TypeScript + Vite + Tailwind CSS
- **Backend:** Node.js + Express + TypeScript (local, inside Electron)
- **Database:** SQLite via Prisma ORM
- **Auth:** Single local login with session cookies (no JWT, no roles)

## Getting started

```bash
cd Usman-Garments-main
npm install
npm run setup
npm run dev
```

`npm run setup` copies `backend/.env.example` → `backend/.env` if missing, creates the SQLite data directory, applies Prisma migrations, and seeds the default admin user plus business settings. Do not commit `backend/.env`.

Default login (change after first use):

- Username: `admin`
- Password: `admin123`

## Scripts

| Command | Description |
|---------|-------------|
| `npm run setup` | Create `.env` if missing, migrate DB, seed admin |
| `npm run dev` | Start backend, Vite frontend, and Electron |
| `npm run electron:build` | Build backend, frontend, and Electron main process |
| `npm start` | Run packaged Electron app (after build) |
| `npm run db:migrate -w backend` | Run Prisma migrations (dev) |
| `npm run db:seed -w backend` | Seed default admin user |
| `npm run test -w backend` | Run backend Vitest suite |
| `npm run test -w frontend` | Run frontend Vitest suite |

## Architecture

- Express API runs on `http://127.0.0.1:3847`
- In development, Vite serves the UI on port `5173` and proxies `/api` to the backend
- In production, Express serves the built frontend and Electron loads `http://127.0.0.1:3847`
- SQLite database file: `backend/prisma/data/usman-garments.db`

See `docs/ARCHITECTURE.md` for the full system plan.

## Accounting core

Double-entry accounting under `/api/accounting/*`:

- Chart of accounts (categories and accounts)
- Payment, receipt, and journal vouchers
- Ledger, trial balance, and financial years
- Default categories on first run: **Bank** and **Cash** (with Cash in Hand account)

Business settings (name, logo, invoice options, theme) live under `/api/settings`.

## Auto-updates (desktop)

Installed Windows builds check GitHub Releases for a newer `package.json` version via `electron-updater`.

### Release a new version

1. Bump `"version"` in the root `package.json` (this drives update detection).
2. If the database schema changed, create a Prisma migration under `backend/prisma/migrations/` and commit it with the release.
3. Commit and push to `main` on GitHub.
4. Publish the Windows installer (requires a GitHub token with `repo` scope):

```bash
# PowerShell
$env:GH_TOKEN = "ghp_..."   # or GITHUB_TOKEN
npm run dist:win -- --publish always
```

This uploads `Usman-Mall-Setup-<version>.exe` and `latest.yml` to a GitHub Release tagged with that version.

### What happens on the user’s PC

1. App detects a newer Release → shows **Update Available**.
2. After download → button becomes **Restart to Update**.
3. Click installs the new build and restarts.
4. On next launch, `backend/src/startup.ts`:
   - Detects pending migrations (or missing core tables)
   - Runs a **pre-migration backup** of the existing SQLite DB
   - Applies `prisma migrate deploy`
   - Verifies `BusinessSettings` is queryable before serving traffic
5. Existing shop data is preserved (migrations are additive). If migrate fails, the user gets an error dialog instead of a silently broken app.
