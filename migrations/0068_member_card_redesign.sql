-- Member Card Admin: redesign to match the Falakhe reference layout (policy holder name,
-- surname, ID number, date of birth, and plan, instead of the generic photo box / member
-- since / valid until fields), plus a tagline and footer slogan for the card's branding text.

ALTER TABLE member_card_settings DROP COLUMN IF EXISTS show_photo_box;
ALTER TABLE member_card_settings DROP COLUMN IF EXISTS show_member_since;
ALTER TABLE member_card_settings DROP COLUMN IF EXISTS show_valid_until;

ALTER TABLE member_card_settings ADD COLUMN IF NOT EXISTS show_surname BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE member_card_settings ADD COLUMN IF NOT EXISTS show_id_number BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE member_card_settings ADD COLUMN IF NOT EXISTS show_date_of_birth BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE member_card_settings ADD COLUMN IF NOT EXISTS show_plan BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE member_card_settings ADD COLUMN IF NOT EXISTS tagline TEXT;
ALTER TABLE member_card_settings ADD COLUMN IF NOT EXISTS footer_slogan TEXT;
