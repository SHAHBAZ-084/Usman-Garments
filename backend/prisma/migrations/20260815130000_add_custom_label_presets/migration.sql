-- CreateTable
CREATE TABLE "CustomLabelPreset" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "rollType" TEXT NOT NULL,
    "widthMm" INTEGER NOT NULL,
    "heightMm" INTEGER NOT NULL,
    "rollWidthMm" INTEGER,
    "rollHeightMm" INTEGER,
    "rollGapMm" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomLabelPreset_key_key" ON "CustomLabelPreset"("key");

-- CreateIndex
CREATE INDEX "CustomLabelPreset_createdAt_idx" ON "CustomLabelPreset"("createdAt");
