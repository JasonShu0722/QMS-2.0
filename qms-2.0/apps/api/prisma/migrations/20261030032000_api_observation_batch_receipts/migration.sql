ALTER TABLE "api_observation_collectors"
  ADD COLUMN "committed_batch" INTEGER NOT NULL DEFAULT 0;
