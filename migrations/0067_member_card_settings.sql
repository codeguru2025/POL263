-- Member Card Admin: org-wide membership-card template settings.

CREATE TABLE IF NOT EXISTS member_card_settings (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  card_title TEXT NOT NULL DEFAULT 'Membership Card',
  show_logo BOOLEAN NOT NULL DEFAULT true,
  show_photo_box BOOLEAN NOT NULL DEFAULT true,
  show_policy_number BOOLEAN NOT NULL DEFAULT true,
  show_member_since BOOLEAN NOT NULL DEFAULT true,
  show_valid_until BOOLEAN NOT NULL DEFAULT true,
  show_qr_code BOOLEAN NOT NULL DEFAULT true,
  footer_note TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
