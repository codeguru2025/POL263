-- Links requisitions to funeral cases, and cost-sheet line items to real requisitions —
-- foundation for per-case profit/loss reporting.

ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS funeral_case_id uuid REFERENCES funeral_cases(id);
CREATE INDEX IF NOT EXISTS req_case_idx ON requisitions (funeral_case_id);

ALTER TABLE cost_line_items ADD COLUMN IF NOT EXISTS requisition_id uuid REFERENCES requisitions(id);
CREATE INDEX IF NOT EXISTS cli_requisition_idx ON cost_line_items (requisition_id);
