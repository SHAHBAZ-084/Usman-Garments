-- AlterTable: add contact name labels and reset number-only defaults
ALTER TABLE "BusinessSettings" ADD COLUMN "phoneLabel" TEXT NOT NULL DEFAULT 'M Arslan';
ALTER TABLE "BusinessSettings" ADD COLUMN "whatsappLabel" TEXT NOT NULL DEFAULT 'M Usman';

-- Split known combined defaults into label + number
UPDATE "BusinessSettings"
SET
  "phoneLabel" = 'M Arslan',
  "phone" = '03024979697'
WHERE "phone" = 'M Arslan 03024979697';

UPDATE "BusinessSettings"
SET
  "whatsappLabel" = 'M Usman',
  "whatsapp" = '03006195469'
WHERE "whatsapp" = 'M Usman 03006195469';
