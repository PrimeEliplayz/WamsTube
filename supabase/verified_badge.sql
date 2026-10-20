-- supabase/verified_badge.sql
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS followers integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS has_vbadge boolean DEFAULT false;

CREATE OR REPLACE FUNCTION set_verified_badge()
RETURNS trigger AS $$
BEGIN
  NEW.has_vbadge := NEW.followers > 100;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_verified_badge_trigger ON profiles;

CREATE TRIGGER profiles_verified_badge_trigger
BEFORE INSERT OR UPDATE OF followers
ON profiles
FOR EACH ROW
EXECUTE FUNCTION set_verified_badge();

UPDATE profiles
SET has_vbadge = (followers > 100)
WHERE has_vbadge IS DISTINCT FROM (followers > 100);
