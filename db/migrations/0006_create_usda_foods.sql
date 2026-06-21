CREATE TABLE usda_foods (
  fdc_id        TEXT        PRIMARY KEY,
  description   TEXT        NOT NULL,
  brand_owner   TEXT,
  data_type     TEXT        NOT NULL,
  nutrients     JSONB       NOT NULL,
  cached_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_usda_foods_fts ON usda_foods USING gin(to_tsvector('english', description));
CREATE INDEX idx_usda_foods_cached_at ON usda_foods (cached_at);
