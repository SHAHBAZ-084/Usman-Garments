-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProductCategory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_ProductCategory" ("id", "name", "isActive", "createdAt", "code")
SELECT "id", "name", "isActive", "createdAt",
  UPPER(SUBSTR(REPLACE(REPLACE("name", ' ', ''), '-', ''), 1, 3)) || CAST("id" AS TEXT)
FROM "ProductCategory";
DROP TABLE "ProductCategory";
ALTER TABLE "new_ProductCategory" RENAME TO "ProductCategory";
CREATE UNIQUE INDEX "ProductCategory_name_key" ON "ProductCategory"("name");
CREATE UNIQUE INDEX "ProductCategory_code_key" ON "ProductCategory"("code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
