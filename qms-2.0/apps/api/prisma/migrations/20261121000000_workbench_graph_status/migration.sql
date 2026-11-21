BEGIN;

CREATE TYPE "workbench_graph_node_status" AS ENUM ('idea', 'development', 'live');

CREATE TABLE "workbench_graph_statuses" (
    "node_id" VARCHAR(128) PRIMARY KEY,
    "status" "workbench_graph_node_status" NOT NULL,
    "version" INTEGER NOT NULL CHECK ("version" > 0),
    "evidence" VARCHAR(500),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CHECK ("status" <> 'live' OR COALESCE("evidence" ~ '[^[:space:]]', false))
);

COMMIT;
