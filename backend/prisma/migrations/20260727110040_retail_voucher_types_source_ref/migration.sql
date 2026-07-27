-- AlterTable
ALTER TABLE "Voucher" ADD COLUMN "sourceRef" TEXT;
ALTER TABLE "Voucher" ADD COLUMN "sourceType" TEXT;

-- CreateIndex
CREATE INDEX "Voucher_sourceType_sourceRef_idx" ON "Voucher"("sourceType", "sourceRef");

-- CreateIndex
CREATE INDEX "Voucher_reference_idx" ON "Voucher"("reference");

-- Idempotency: one ACTIVE voucher per (sourceType, sourceRef, type).
-- Cancelled rows are excluded so intentional re-post after cancel remains possible.
CREATE UNIQUE INDEX "Voucher_sourceType_sourceRef_type_active_uidx"
ON "Voucher"("sourceType", "sourceRef", "type")
WHERE "status" = 'ACTIVE' AND "sourceType" IS NOT NULL AND "sourceRef" IS NOT NULL;
