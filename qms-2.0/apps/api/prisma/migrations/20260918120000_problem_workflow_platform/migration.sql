-- CreateEnum
CREATE TYPE "ProblemStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkflowVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "WorkflowNodeType" AS ENUM ('ACTION', 'APPROVAL', 'VERIFICATION', 'CC', 'REJECT', 'RETURN', 'REOPEN', 'CLOSE');

-- CreateEnum
CREATE TYPE "WorkflowInstanceStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateTable
CREATE TABLE "problem_indexes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "report_number" VARCHAR(100) NOT NULL,
    "domain_code" VARCHAR(100) NOT NULL,
    "problem_type" VARCHAR(100) NOT NULL,
    "source_type" VARCHAR(100) NOT NULL,
    "source_id" UUID,
    "status" "ProblemStatus" NOT NULL DEFAULT 'OPEN',
    "severity" VARCHAR(32) NOT NULL,
    "responsible_party" VARCHAR(200),
    "owner_id" UUID,
    "due_at" TIMESTAMPTZ(3),
    "workflow_instance_id" UUID,
    "closed_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "problem_indexes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_rule_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "rule_code" VARCHAR(100) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "pattern" VARCHAR(255) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "number_rule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "rule_code" VARCHAR(100) NOT NULL,
    "scope_key" VARCHAR(100) NOT NULL DEFAULT '',
    "next_value" BIGINT NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_definitions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "workflow_definition_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "WorkflowVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workflow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_nodes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "workflow_version_id" UUID NOT NULL,
    "node_key" VARCHAR(100) NOT NULL,
    "type" "WorkflowNodeType" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workflow_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_transitions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "workflow_version_id" UUID NOT NULL,
    "transition_key" VARCHAR(100) NOT NULL,
    "from_node_id" UUID NOT NULL,
    "to_node_id" UUID NOT NULL,
    "condition" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workflow_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_instances" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "workflow_definition_id" UUID NOT NULL,
    "workflow_version_id" UUID NOT NULL,
    "instance_key" VARCHAR(150) NOT NULL,
    "status" "WorkflowInstanceStatus" NOT NULL DEFAULT 'RUNNING',
    "current_node_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workflow_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "workflow_instance_id" UUID NOT NULL,
    "workflow_node_id" UUID NOT NULL,
    "assignee_user_id" UUID,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "due_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workflow_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "workflow_task_id" UUID,
    "recipient_user_id" UUID,
    "channel" VARCHAR(50) NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "subject" VARCHAR(255),
    "body" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "read_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "problem_indexes_organization_id_status_idx" ON "problem_indexes"("organization_id", "status");

-- CreateIndex
CREATE INDEX "problem_indexes_organization_id_domain_code_idx" ON "problem_indexes"("organization_id", "domain_code");

-- CreateIndex
CREATE INDEX "problem_indexes_organization_id_due_at_idx" ON "problem_indexes"("organization_id", "due_at");

-- CreateIndex
CREATE INDEX "problem_indexes_workflow_instance_id_idx" ON "problem_indexes"("workflow_instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "problem_indexes_organization_id_report_number_key" ON "problem_indexes"("organization_id", "report_number");

-- CreateIndex
CREATE INDEX "number_rule_versions_organization_id_rule_code_active_idx" ON "number_rule_versions"("organization_id", "rule_code", "active");

-- CreateIndex
CREATE UNIQUE INDEX "number_rule_versions_organization_id_rule_code_version_key" ON "number_rule_versions"("organization_id", "rule_code", "version");

-- CreateIndex
CREATE INDEX "number_sequences_organization_id_rule_code_idx" ON "number_sequences"("organization_id", "rule_code");

-- CreateIndex
CREATE UNIQUE INDEX "number_sequences_organization_id_rule_code_scope_key_key" ON "number_sequences"("organization_id", "rule_code", "scope_key");

-- CreateIndex
CREATE INDEX "workflow_definitions_organization_id_name_idx" ON "workflow_definitions"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_definitions_organization_id_code_key" ON "workflow_definitions"("organization_id", "code");

-- CreateIndex
CREATE INDEX "workflow_versions_organization_id_status_idx" ON "workflow_versions"("organization_id", "status");

-- CreateIndex
CREATE INDEX "workflow_versions_organization_id_workflow_definition_id_idx" ON "workflow_versions"("organization_id", "workflow_definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_versions_workflow_definition_id_version_key" ON "workflow_versions"("workflow_definition_id", "version");

-- CreateIndex
CREATE INDEX "workflow_nodes_organization_id_workflow_version_id_idx" ON "workflow_nodes"("organization_id", "workflow_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_nodes_workflow_version_id_node_key_key" ON "workflow_nodes"("workflow_version_id", "node_key");

-- CreateIndex
CREATE INDEX "workflow_transitions_organization_id_workflow_version_id_idx" ON "workflow_transitions"("organization_id", "workflow_version_id");

-- CreateIndex
CREATE INDEX "workflow_transitions_from_node_id_idx" ON "workflow_transitions"("from_node_id");

-- CreateIndex
CREATE INDEX "workflow_transitions_to_node_id_idx" ON "workflow_transitions"("to_node_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_transitions_workflow_version_id_transition_key_key" ON "workflow_transitions"("workflow_version_id", "transition_key");

-- CreateIndex
CREATE INDEX "workflow_instances_organization_id_status_idx" ON "workflow_instances"("organization_id", "status");

-- CreateIndex
CREATE INDEX "workflow_instances_organization_id_workflow_definition_id_v_idx" ON "workflow_instances"("organization_id", "workflow_definition_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_instances_organization_id_instance_key_key" ON "workflow_instances"("organization_id", "instance_key");

-- CreateIndex
CREATE INDEX "workflow_tasks_organization_id_status_idx" ON "workflow_tasks"("organization_id", "status");

-- CreateIndex
CREATE INDEX "workflow_tasks_organization_id_due_at_idx" ON "workflow_tasks"("organization_id", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_tasks_workflow_instance_id_workflow_node_id_key" ON "workflow_tasks"("workflow_instance_id", "workflow_node_id");

-- CreateIndex
CREATE INDEX "notifications_organization_id_status_idx" ON "notifications"("organization_id", "status");

-- CreateIndex
CREATE INDEX "notifications_organization_id_recipient_user_id_status_idx" ON "notifications"("organization_id", "recipient_user_id", "status");

-- CreateIndex
CREATE INDEX "notifications_workflow_task_id_idx" ON "notifications"("workflow_task_id");

-- AddForeignKey
ALTER TABLE "problem_indexes" ADD CONSTRAINT "problem_indexes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_indexes" ADD CONSTRAINT "problem_indexes_workflow_instance_id_fkey" FOREIGN KEY ("workflow_instance_id") REFERENCES "workflow_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "number_rule_versions" ADD CONSTRAINT "number_rule_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "number_sequences" ADD CONSTRAINT "number_sequences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_definition_id_fkey" FOREIGN KEY ("workflow_definition_id") REFERENCES "workflow_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_workflow_version_id_fkey" FOREIGN KEY ("workflow_version_id") REFERENCES "workflow_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_workflow_version_id_fkey" FOREIGN KEY ("workflow_version_id") REFERENCES "workflow_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_from_node_id_fkey" FOREIGN KEY ("from_node_id") REFERENCES "workflow_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_to_node_id_fkey" FOREIGN KEY ("to_node_id") REFERENCES "workflow_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_workflow_definition_id_fkey" FOREIGN KEY ("workflow_definition_id") REFERENCES "workflow_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_workflow_version_id_fkey" FOREIGN KEY ("workflow_version_id") REFERENCES "workflow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_current_node_id_fkey" FOREIGN KEY ("current_node_id") REFERENCES "workflow_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_workflow_instance_id_fkey" FOREIGN KEY ("workflow_instance_id") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_workflow_node_id_fkey" FOREIGN KEY ("workflow_node_id") REFERENCES "workflow_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workflow_task_id_fkey" FOREIGN KEY ("workflow_task_id") REFERENCES "workflow_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
