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
