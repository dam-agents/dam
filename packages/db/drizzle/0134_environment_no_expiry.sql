-- An Environment can be kept with no expiry (#6318): its owner or Owning
-- Agent sets it to never be deleted, and the expiry sweep skips a null.
ALTER TABLE "environments" ALTER COLUMN "expires_at" DROP NOT NULL;