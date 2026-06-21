-- Soft-delete support on foods (no-op if column exists)
ALTER TABLE foods ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Daily food log
CREATE TABLE log_entries (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  food_id    UUID        NOT NULL REFERENCES foods(id),
  grams      NUMERIC(8,2) NOT NULL CHECK (grams > 0),
  logged_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_log_entries_user_date ON log_entries (user_id, logged_at);
