-- 保留历史摘要；新收件不再计算正文去重摘要。
ALTER TABLE "integration_receipts" ALTER COLUMN "body_digest" DROP NOT NULL;
