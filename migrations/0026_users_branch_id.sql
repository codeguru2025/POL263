-- 0026: Add branch_id to users table for branch-scoped agent assignments
ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
