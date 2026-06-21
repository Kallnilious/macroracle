CREATE TABLE foods (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT        NOT NULL,
  brand             TEXT,
  calories_per_100g NUMERIC(7,2) NOT NULL CHECK (calories_per_100g >= 0 AND calories_per_100g <= 9000),
  protein_g         NUMERIC(7,2) NOT NULL CHECK (protein_g   >= 0 AND protein_g   <= 100),
  carbs_g           NUMERIC(7,2) NOT NULL CHECK (carbs_g     >= 0 AND carbs_g     <= 100),
  fat_g             NUMERIC(7,2) NOT NULL CHECK (fat_g       >= 0 AND fat_g       <= 100),
  serving_size_g    NUMERIC(7,2) CHECK (serving_size_g > 0),
  serving_name      TEXT,
  tags              TEXT[]      NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_foods_user_id ON foods (user_id);
CREATE INDEX idx_foods_user_name ON foods (user_id, name);
