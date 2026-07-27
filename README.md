# Usman Garments

Offline desktop accounting app for Usman Garments.

## Stack

- **Desktop:** Electron
- **Frontend:** React + TypeScript + Vite + Tailwind CSS
- **Backend:** Node.js + Express + TypeScript (local, inside Electron)
- **Database:** SQLite via Prisma ORM
- **Auth:** Single local login with session cookies (no JWT, no roles)

## Getting started

```bash
cd "Usman Garments"
npm install
npm run db:migrate -w backend
npm run db:seed -w backend
npm run dev
```

Default login (change after first use):

- Username: `admin`
- Password: `admin123`

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start backend, Vite frontend, and Electron |
| `npm run electron:build` | Build backend, frontend, and Electron main process |
| `npm start` | Run packaged Electron app (after build) |
| `npm run db:migrate -w backend` | Run Prisma migrations |
| `npm run db:seed -w backend` | Seed default admin user |

## Architecture

- Express API runs on `http://127.0.0.1:3847`
- In development, Vite serves the UI on port `5173` and proxies `/api` to the backend
- In production, Express serves the built frontend and Electron loads `http://127.0.0.1:3847`
- SQLite database file: `backend/prisma/data/usman-garments.db`

## Accounting core

Double-entry accounting under `/api/accounting/*`:

- Chart of accounts (categories and accounts)
- Payment, receipt, and journal vouchers
- Ledger, trial balance, and financial years
- Default categories on first run: **Bank** and **Cash** (with Cash in Hand account)
