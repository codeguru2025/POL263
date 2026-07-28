-- Payment automation now triggers off each policy's actual due date (its own billing-cycle
-- date, computed by advancePolicyCycle()) instead of a flat "days since last payment" that
-- ignored payment schedule (30 days is right for monthly but wrong for weekly/yearly policies).
-- days_after_last_payment is reinterpreted in place as "days past due date" (0 = charge exactly
-- on the due date) — see server/routes.ts's runPaymentAutomationForOrg(). Only the column
-- default changes here (new orgs get 0); existing orgs' configured values are left as-is since
-- that's tenant configuration, not something to silently rewrite — staff can adjust it from
-- /staff/notifications, which now explains the new meaning.

ALTER TABLE payment_automation_settings ALTER COLUMN days_after_last_payment SET DEFAULT 0;
