-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BusinessSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "businessName" TEXT NOT NULL DEFAULT 'Usman Mall',
    "tagline" TEXT NOT NULL DEFAULT 'Quality Clothes, Your Style',
    "ownerName" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '0300-6195469',
    "whatsapp" TEXT NOT NULL DEFAULT '0300-6195469',
    "address" TEXT NOT NULL DEFAULT 'Al-Nisa Road, Chishtian',
    "invoiceFooter" TEXT NOT NULL DEFAULT 'Thank you for shopping at Usman Mall',
    "returnPolicy" TEXT NOT NULL DEFAULT 'Returns accepted within 7 days with original receipt. Items must be unused and in original condition.',
    "invoicePrefix" TEXT NOT NULL DEFAULT 'UM-',
    "nextInvoiceNumber" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL DEFAULT 'PKR',
    "receiptSize" TEXT NOT NULL DEFAULT 'THERMAL_80',
    "a4InvoiceEnabled" BOOLEAN NOT NULL DEFAULT true,
    "printerName" TEXT,
    "barcodeLabelSize" TEXT NOT NULL DEFAULT '50x30',
    "lowStockLimit" INTEGER NOT NULL DEFAULT 5,
    "backupFolderPath" TEXT NOT NULL DEFAULT '',
    "themeMode" TEXT NOT NULL DEFAULT 'LIGHT',
    "logoPath" TEXT,
    "isIdentityLocked" BOOLEAN NOT NULL DEFAULT true,
    "developerPassphraseHash" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_BusinessSettings" ("a4InvoiceEnabled", "address", "backupFolderPath", "barcodeLabelSize", "businessName", "createdAt", "currency", "id", "invoiceFooter", "invoicePrefix", "logoPath", "lowStockLimit", "nextInvoiceNumber", "ownerName", "phone", "printerName", "receiptSize", "returnPolicy", "tagline", "themeMode", "updatedAt", "whatsapp") SELECT "a4InvoiceEnabled", "address", "backupFolderPath", "barcodeLabelSize", "businessName", "createdAt", "currency", "id", "invoiceFooter", "invoicePrefix", "logoPath", "lowStockLimit", "nextInvoiceNumber", "ownerName", "phone", "printerName", "receiptSize", "returnPolicy", "tagline", "themeMode", "updatedAt", "whatsapp" FROM "BusinessSettings";
DROP TABLE "BusinessSettings";
ALTER TABLE "new_BusinessSettings" RENAME TO "BusinessSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
