ALTER TABLE "domain_source_issue_links"
  ADD COLUMN "removed_at" timestamptz(3),
  ADD COLUMN "removed_by" uuid;

ALTER TABLE "domain_source_issue_links"
  ADD CONSTRAINT "domain_source_issue_links_removed_by_fkey" FOREIGN KEY ("removed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "domain_source_issue_link_history" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL,
  "problem_index_id" uuid NOT NULL,
  "source_domain" varchar(100) NOT NULL,
  "source_type" varchar(100) NOT NULL,
  "source_id" uuid NOT NULL,
  "action" varchar(16) NOT NULL CHECK ("action" IN ('LINKED', 'UNLINKED', 'PRIMARY_SELECTED')),
  "source_version" integer NOT NULL CHECK ("source_version" > 0),
  "source_snapshot" jsonb NOT NULL,
  "actor_user_id" uuid,
  "changed_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "domain_source_link_history_problem_fkey" FOREIGN KEY ("organization_id", "problem_index_id") REFERENCES "problem_indexes"("organization_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "domain_source_link_history_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE INDEX "domain_source_link_history_problem_idx" ON "domain_source_issue_link_history"("organization_id", "problem_index_id", "changed_at");

INSERT INTO "domain_source_issue_link_history" ("id", "organization_id", "problem_index_id", "source_domain", "source_type", "source_id", "action", "source_version", "source_snapshot", "actor_user_id", "changed_at")
SELECT gen_random_uuid(), l."organization_id", l."problem_index_id", l."source_domain", l."source_type", l."source_id", 'LINKED', l."source_version", l."source_snapshot", NULL, l."linked_at"
FROM "domain_source_issue_links" l;

INSERT INTO "domain_source_issue_link_history" ("id", "organization_id", "problem_index_id", "source_domain", "source_type", "source_id", "action", "source_version", "source_snapshot", "actor_user_id", "changed_at")
SELECT gen_random_uuid(), l."organization_id", l."problem_index_id", l."source_domain", l."source_type", l."source_id", 'PRIMARY_SELECTED', l."source_version", l."source_snapshot", NULL, l."linked_at"
FROM "domain_source_issue_links" l
JOIN "problem_indexes" p ON p."organization_id" = l."organization_id" AND p."id" = l."problem_index_id"
WHERE p."domain_code" = l."source_domain" AND p."source_type" = l."source_type" AND p."source_id" = l."source_id";
