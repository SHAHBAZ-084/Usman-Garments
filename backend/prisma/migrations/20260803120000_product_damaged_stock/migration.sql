-- AlterTable
ALTER TABLE "Product" ADD COLUMN "damagedStock" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN "damagedStock" INTEGER NOT NULL DEFAULT 0;
