-- Add department to staff users so requisitions can show requester's department.
ALTER TABLE users ADD COLUMN IF NOT EXISTS department text;

-- Add "when are funds needed" date and approver notes to requisitions.
ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS needed_by_date date;
ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS approver_notes text;
