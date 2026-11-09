ALTER TABLE integration_credentials
  ALTER COLUMN expires_at DROP NOT NULL,
  ADD COLUMN secret_ciphertext TEXT;
