-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AccountCategory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Account" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "categoryId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Account_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AccountCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Ledger" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "accountId" INTEGER NOT NULL,
    "balance" DECIMAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Ledger_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ledgerId" INTEGER NOT NULL,
    "voucherId" INTEGER,
    "type" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "balance" DECIMAL NOT NULL,
    "notes" TEXT,
    "isReversal" BOOLEAN NOT NULL DEFAULT false,
    "isOpeningBalance" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LedgerEntry_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "Ledger" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LedgerEntry_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Voucher" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "debitAccountId" INTEGER,
    "creditAccountId" INTEGER,
    "amount" DECIMAL NOT NULL,
    "description" TEXT,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" INTEGER NOT NULL,
    "modifiedById" INTEGER,
    "deletedById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    "financialYearId" INTEGER,
    CONSTRAINT "Voucher_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Voucher_debitAccountId_fkey" FOREIGN KEY ("debitAccountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Voucher_creditAccountId_fkey" FOREIGN KEY ("creditAccountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Voucher_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Voucher_modifiedById_fkey" FOREIGN KEY ("modifiedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Voucher_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FinancialYear" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "label" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "closedAt" DATETIME,
    "closedById" INTEGER,
    CONSTRAINT "FinancialYear_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FinancialYearClosingBalance" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "financialYearId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "balance" DECIMAL NOT NULL,
    CONSTRAINT "FinancialYearClosingBalance_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FinancialYearClosingBalance_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrialBalanceApproval" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "period" TEXT NOT NULL,
    "approvedById" INTEGER NOT NULL,
    "notes" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrialBalanceApproval_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SystemPreference" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "daamiPercent" DECIMAL NOT NULL DEFAULT 0,
    "paleDariPercent" DECIMAL NOT NULL DEFAULT 0,
    "brokeryPercent" DECIMAL NOT NULL DEFAULT 0,
    "marketFeeRate" DECIMAL NOT NULL DEFAULT 0,
    "bardanaRate" DECIMAL NOT NULL DEFAULT 0,
    "taxPercent" DECIMAL NOT NULL DEFAULT 0,
    "kaatPercent" DECIMAL NOT NULL DEFAULT 0,
    "mazduriPercent" DECIMAL NOT NULL DEFAULT 0,
    "commissionPercent" DECIMAL NOT NULL DEFAULT 0,
    "dalaliPercent" DECIMAL NOT NULL DEFAULT 0,
    "sutliRate" DECIMAL NOT NULL DEFAULT 0,
    "markeetFeeRate" DECIMAL NOT NULL DEFAULT 0,
    "kantaRate" DECIMAL NOT NULL DEFAULT 0,
    "closingDate" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Account_code_key" ON "Account"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Ledger_accountId_key" ON "Ledger"("accountId");

-- CreateIndex
CREATE INDEX "LedgerEntry_ledgerId_idx" ON "LedgerEntry"("ledgerId");

-- CreateIndex
CREATE INDEX "LedgerEntry_createdAt_idx" ON "LedgerEntry"("createdAt");

-- CreateIndex
CREATE INDEX "Voucher_financialYearId_type_idx" ON "Voucher"("financialYearId", "type");

-- CreateIndex
CREATE INDEX "Voucher_date_idx" ON "Voucher"("date");

-- CreateIndex
CREATE INDEX "Voucher_createdAt_idx" ON "Voucher"("createdAt");

-- CreateIndex
CREATE INDEX "Voucher_status_idx" ON "Voucher"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_financialYearId_type_number_key" ON "Voucher"("financialYearId", "type", "number");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialYear_label_key" ON "FinancialYear"("label");

-- CreateIndex
CREATE INDEX "FinancialYear_status_idx" ON "FinancialYear"("status");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialYearClosingBalance_financialYearId_accountId_key" ON "FinancialYearClosingBalance"("financialYearId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "TrialBalanceApproval_period_key" ON "TrialBalanceApproval"("period");
