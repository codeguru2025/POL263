-- Free-text UI grouping for the add-on catalogue (e.g. "Personalisation & Memorial"). Display-only
-- — no pricing logic reads it. Null for every add-on that existed before this.
ALTER TABLE add_ons
  ADD COLUMN IF NOT EXISTS category TEXT;
