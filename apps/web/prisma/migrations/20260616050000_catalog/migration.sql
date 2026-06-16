-- Local mirror of the static card + set catalogue (synced from the game APIs).
CREATE TABLE "CatalogCard" (
  "id" TEXT NOT NULL,
  "game" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "setId" TEXT NOT NULL,
  "setName" TEXT NOT NULL,
  "series" TEXT,
  "number" TEXT NOT NULL,
  "rarity" TEXT,
  "supertype" TEXT,
  "types" TEXT[],
  "hp" TEXT,
  "artist" TEXT,
  "flavorText" TEXT,
  "text" TEXT[],
  "imageSmall" TEXT,
  "imageLarge" TEXT,
  "releaseDate" TEXT,
  "priceEur" DOUBLE PRECISION,
  "priceUsd" DOUBLE PRECISION,
  "variants" JSONB,
  "priceUpdatedAt" TIMESTAMP(3),
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogCard_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CatalogCard_game_name_idx" ON "CatalogCard"("game", "name");
CREATE INDEX "CatalogCard_game_setId_idx" ON "CatalogCard"("game", "setId");
CREATE INDEX "CatalogCard_game_setId_number_idx" ON "CatalogCard"("game", "setId", "number");

CREATE TABLE "CatalogSet" (
  "id" TEXT NOT NULL,
  "game" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "series" TEXT,
  "total" INTEGER NOT NULL DEFAULT 0,
  "releaseDate" TEXT,
  "logo" TEXT,
  "symbol" TEXT,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogSet_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CatalogSet_game_idx" ON "CatalogSet"("game");
CREATE INDEX "CatalogSet_game_releaseDate_idx" ON "CatalogSet"("game", "releaseDate");
