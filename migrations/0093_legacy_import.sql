-- Legacy data import tool (control panel only): lets platform staff bulk-import a tenant's
-- historical clients/policies/payments/claims from legacy system exports (POL360, Easipol,
-- etc.) via a column-mapping wizard. import_records cross-references each imported row's
-- legacy id to the POL263 row created for it, so a later import (e.g. policies referencing
-- clients imported in an earlier session) can resolve foreign keys.

CREATE TABLE IF NOT EXISTS import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  entity_type text NOT NULL,
  source_system_label text,
  file_name text NOT NULL,
  column_mapping jsonb NOT NULL,
  value_mappings jsonb,
  status text NOT NULL DEFAULT 'previewed',
  total_rows integer NOT NULL DEFAULT 0,
  success_rows integer NOT NULL DEFAULT 0,
  error_rows integer NOT NULL DEFAULT 0,
  preview_snapshot jsonb,
  error_report jsonb,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  committed_at timestamp,
  rolled_back_at timestamp,
  rolled_back_by_user_id uuid REFERENCES users(id),
  rollback_blocked_reason text
);

CREATE INDEX IF NOT EXISTS import_batches_org_idx ON import_batches (organization_id);
CREATE INDEX IF NOT EXISTS import_batches_org_entity_idx ON import_batches (organization_id, entity_type);

CREATE TABLE IF NOT EXISTS import_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES import_batches(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  entity_type text NOT NULL,
  external_key text NOT NULL,
  entity_id uuid NOT NULL,
  source_row_index integer,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS import_records_batch_idx ON import_records (batch_id);
CREATE UNIQUE INDEX IF NOT EXISTS import_records_lookup_idx ON import_records (organization_id, entity_type, external_key);
