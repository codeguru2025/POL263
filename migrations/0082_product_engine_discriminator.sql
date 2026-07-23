-- Generalizes the risk/protection product engine beyond funeral cash plans (Phase 3 of the
-- multi-vertical platform work). Additive/nullable: existing products (funeral cash plans) get
-- NULL, which every consumer must treat as {benefitTrigger: 'death', insuredEntityType:
-- 'person_household'} — today's only real behavior — via resolveBenefitTrigger()/
-- resolveInsuredEntityType() in shared/product-types.ts. Never a distinct "unknown" state.

ALTER TABLE products ADD COLUMN IF NOT EXISTS benefit_trigger text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS insured_entity_type text;
