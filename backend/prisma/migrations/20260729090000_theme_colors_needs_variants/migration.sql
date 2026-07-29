-- AlterTable
ALTER TABLE "BusinessSettings" ADD COLUMN "primaryColor" TEXT NOT NULL DEFAULT '#111111';
ALTER TABLE "BusinessSettings" ADD COLUMN "secondaryColor" TEXT NOT NULL DEFAULT '#C99618';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "needsVariants" BOOLEAN NOT NULL DEFAULT false;
