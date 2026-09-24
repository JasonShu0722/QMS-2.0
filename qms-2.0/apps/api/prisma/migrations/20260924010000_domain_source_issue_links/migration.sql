DROP INDEX "problem_indexes_organization_id_source_type_source_id_key";
CREATE UNIQUE INDEX "problem_indexes_organization_id_source_type_source_id_key"
  ON "problem_indexes"("organization_id", "source_type", "source_id")
  WHERE "source_id" IS NOT NULL AND "source_type" = 'supplier-quality';

CREATE TABLE "domain_source_issue_links" (
  "id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "problem_index_id" uuid NOT NULL,
  "source_domain" varchar(100) NOT NULL,
  "source_type" varchar(100) NOT NULL,
  "source_id" uuid NOT NULL,
  "source_version" integer NOT NULL,
  "source_snapshot" jsonb NOT NULL,
  "created_by" varchar(128) NOT NULL,
  "linked_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "domain_source_issue_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "domain_source_issue_links_source_version_positive" CHECK ("source_version" > 0),
  CONSTRAINT "domain_source_issue_links_problem_fkey" FOREIGN KEY ("organization_id", "problem_index_id")
    REFERENCES "problem_indexes"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "domain_source_issue_links_problem_source_key"
  ON "domain_source_issue_links"("organization_id", "problem_index_id", "source_domain", "source_type", "source_id");
CREATE INDEX "domain_source_issue_links_source_lookup_idx"
  ON "domain_source_issue_links"("organization_id", "source_domain", "source_type", "source_id");
