-- Preserve current-reference validation while retaining the established foreign-key error contract.
CREATE OR REPLACE FUNCTION enforce_current_user_reference_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  scope_id uuid;
  target_user_id uuid;
  current_scope_id uuid;
BEGIN
  IF TG_OP = $q$UPDATE$q$ AND
    (to_jsonb(NEW)->TG_ARGV[0]) IS NOT DISTINCT FROM (to_jsonb(OLD)->TG_ARGV[0]) AND
    (to_jsonb(NEW)->TG_ARGV[1]) IS NOT DISTINCT FROM (to_jsonb(OLD)->TG_ARGV[1]) THEN RETURN NEW; END IF;
  scope_id := (to_jsonb(NEW)->>TG_ARGV[0])::uuid;
  target_user_id := (to_jsonb(NEW)->>TG_ARGV[1])::uuid;
  IF scope_id IS NULL OR target_user_id IS NULL THEN RETURN NEW; END IF;
  SELECT organization_id INTO current_scope_id FROM users WHERE id=target_user_id FOR SHARE;
  IF current_scope_id IS NOT NULL AND current_scope_id IS DISTINCT FROM scope_id THEN
    RAISE EXCEPTION $q$ADMIN_USER_CURRENT_SCOPE_MISMATCH$q$ USING ERRCODE=$q$23503$q$;
  END IF;
  RETURN NEW;
END;
$$;
