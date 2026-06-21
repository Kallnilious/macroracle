CREATE TYPE sex_enum AS ENUM ('male', 'female');
CREATE TYPE activity_level_enum AS ENUM ('sedentary', 'lightly_active', 'moderately_active', 'very_active', 'extra_active');
CREATE TYPE goal_enum AS ENUM ('cut', 'maintain', 'bulk');

CREATE TABLE profiles (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  age            INTEGER NOT NULL CHECK (age >= 13 AND age <= 120),
  sex            sex_enum NOT NULL,
  height_cm      NUMERIC(5,1) NOT NULL CHECK (height_cm >= 50 AND height_cm <= 300),
  weight_kg      NUMERIC(5,2) NOT NULL CHECK (weight_kg >= 20 AND weight_kg <= 500),
  activity_level activity_level_enum NOT NULL,
  goal           goal_enum NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
