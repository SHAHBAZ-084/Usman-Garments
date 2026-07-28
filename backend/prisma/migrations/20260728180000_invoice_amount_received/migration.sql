-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "amountReceived" DECIMAL NOT NULL DEFAULT 0;

-- Backfill from paid amount for existing invoices
UPDATE "Invoice" SET "amountReceived" = "paidAmount" WHERE "amountReceived" = 0 AND "paidAmount" > 0;
