-- Receipt adverts: org-scoped promotional content printed at the bottom of receipts
CREATE TABLE IF NOT EXISTS receipt_adverts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  title TEXT,
  body TEXT,
  image_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ra_org_idx ON receipt_adverts(organization_id);
