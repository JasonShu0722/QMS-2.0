ALTER TABLE users ADD COLUMN security_version integer NOT NULL DEFAULT 1, ADD COLUMN mfa_failures integer NOT NULL DEFAULT 0, ADD COLUMN mfa_blocked_until timestamptz(3);
ALTER TABLE roles ADD COLUMN mfa_required boolean NOT NULL DEFAULT false;
ALTER TABLE sessions ADD COLUMN security_version integer NOT NULL DEFAULT 1, ADD COLUMN mfa_verified_at timestamptz(3), ADD COLUMN reauthenticated_at timestamptz(3);
CREATE TABLE mfa_credentials (user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, encrypted_secret text, pending_secret text, pending_expires_at timestamptz(3), last_time_step bigint);
CREATE TABLE mfa_challenges (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash char(64) NOT NULL UNIQUE, security_version integer NOT NULL, password_digest char(64) NOT NULL, policy_digest char(64) NOT NULL, organization_id uuid NOT NULL, enrollment boolean NOT NULL, attempts integer NOT NULL DEFAULT 0, expires_at timestamptz(3) NOT NULL, consumed_at timestamptz(3));
CREATE INDEX mfa_challenges_user_id_expires_at_idx ON mfa_challenges(user_id, expires_at);
CREATE TABLE mfa_recovery_codes (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, code_hash char(64) NOT NULL UNIQUE, consumed_at timestamptz(3));
CREATE INDEX mfa_recovery_codes_user_id_consumed_at_idx ON mfa_recovery_codes(user_id, consumed_at);
