-- 0023: Client documents table for storing uploaded ID copies, proof of address, etc.
-- Apply with: npm run db:migrate   |   Status: npm run db:migrate:status
CREATE TABLE IF NOT EXISTS client_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  document_type text NOT NULL,
  label text,
  file_name text NOT NULL,
  mime_type text,
  file_url text NOT NULL,
  storage_key text,
  file_size integer,
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_docs_org_idx ON client_documents (organization_id);
CREATE INDEX IF NOT EXISTS client_docs_client_idx ON client_documents (client_id);
