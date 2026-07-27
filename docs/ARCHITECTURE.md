# USMAN MALL — Architecture

Offline Windows desktop app for a single garment shop (Usman Mall). Stack today still uses the package name **Usman Garments**; branding rename is Phase 2.

## Current stack

| Layer | Technology |
|-------|------------|
| Desktop | Electron 34 (`electron/main.ts`, `preload.ts`) |
| Frontend | React 19 + TypeScript + Vite 6 + Tailwind CSS |
| Backend | Node.js + Express + TypeScript (bound to `127.0.0.1`) |
| Database | SQLite via Prisma 6 (`backend/prisma/data/usman-garments.db`) |
| Auth | Single local user, express-session cookies (no roles) |

```
/
├── electron/          # Main process + preload
├── backend/           # Express API + Prisma
│   ├── prisma/        # Schema, migrations, seed
│   └── src/modules/   # auth, accounting
├── frontend/          # React SPA
└── docs/              # Architecture and phase notes
```

## Existing modules (today)

- Auth / login
- Chart of accounts (categories + accounts)
- Payment, Receipt, Journal vouchers (create, view, cancel)
- Ledger, account balance, voucher report, trial balance
- Financial years (backend; limited UI)
- Dashboard (accounting summary)
- System preferences (light/dark theme only)

## Planned modules (all 13)

1. **Business Settings** — shop identity, invoice/receipt options, backup folder, theme  
2. **Products and Inventory** — garments, simple variants, stock  
3. **Barcode System** — Code 128 labels + scanner  
4. **POS and Billing** — New Sale, invoices, printing  
5. **Returns and Exchanges** — good/damaged returns, exchanges  
6. **Purchases and Suppliers** — purchases, payables, purchase returns  
7. **Customers and Udhaar** — customers, credit sales, payments  
8. **Stock Management** — movements, low stock, damaged stock  
9. **Expenses and Other Income** — simple forms with auto vouchers  
10. **Accounting Integration** — auto balanced posting into existing vouchers/ledgers  
11. **Dashboard** — shop KPIs (sales, stock, udhaar, etc.)  
12. **Reports** — sales/stock/customer/supplier/expense + keep accounting reports  
13. **Backup and Restore** — manual/auto backup, AppData storage, Windows packaging  

## Database strategy

- Extend the existing Prisma schema incrementally.
- **Never** create a second accounting system.
- Reuse `AccountCategory`, `Account`, `Ledger`, `LedgerEntry`, `Voucher`, `FinancialYear`.
- Add retail models (Product, StockMovement, Invoice, Customer, Supplier, BusinessSettings, etc.) in later phases and post into the existing voucher/ledger tables.

## Transaction rule (future phases)

Every completed business operation that touches money or stock must save in **one Prisma `$transaction`**:

- business record (invoice / purchase / payment / return / expense)
- stock movement(s) when applicable
- customer or supplier balance update when applicable
- accounting voucher(s) + ledger entries

If any part fails, roll back everything. Prefer `createVoucherInTx` (and future multi-leg helpers) inside that transaction.

## Legacy voucher types

Schema still contains `KACHI` and `PURCHASE_MAAL` (inherited from a grain-market POS). Standard Payment/Receipt/Journal API blocks creating them. `maal-khata-legacy.ts` remains as a guard. Phase 3 will generalize multi-leg / source-linked posting for retail; these enum values stay until then and must not be deleted in early phases.

## Production data path

Development stores SQLite under `backend/prisma/data/`. **Phase 12** moves production database, images, logo, settings, and backups to a safe Windows AppData location (not the install folder).

## Development phases (1–13)

1. Repository audit and stabilization  
2. Branding and business settings  
3. Accounting transaction foundation (retail chart + linked multi-leg posting)  
4. Products and stock foundation  
5. Suppliers and purchases  
6. Barcode system  
7. POS and billing  
8. Customers and udhaar  
9. Returns and exchanges  
10. Expenses and other income  
11. Dashboard and reports  
12. Backup, restore, and Windows packaging  
13. Final complete-system testing  
