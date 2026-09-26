# POL263 Product Demo — Production Plan

Status: pre-production. Master (5–8 min) is recorded first; the 60–90 s cut and feature
clips are derived from it with ffmpeg so every deliverable shows the same real product.

## Setup decisions (agreed 2026-09-25)

| Item | Decision |
|---|---|
| Browser | Augustus's real Chrome, driven via Claude in Chrome; window recorded with ffmpeg `gdigrab` at 1920×1080 |
| Cursor | Injected page-only pointer overlay that glides to each target and pulses on click (the extension's clicks don't move the OS cursor) |
| Signup | Real flow on https://pol263.com — Augustus completes the $1.00 PayNow verification live |
| Demo company | **Ubuntu Funeral Assurance**, admin on-screen name **Thabo Moyo** |
| Admin login | A Gmail in Augustus's Chrome that has never been a POL263 user (augustussiziba19@ → Falakhe, gustozw@ → Diaspora; both rejected by the 409 duplicate-admin check) |
| Demo data | Seeded into the new Ubuntu trial tenant after signup (fictional Zimbabwean names, no `Sandbox-` markers); a small "Demonstration company — fictional data" caption is shown when data first appears |
| Narration | Timed script below; Augustus / voice artist records; laid over in edit |
| Cleanup | After final cut: Ubuntu tenant + its DO subdomain removed via the tenant-deletion lifecycle |

## Known product gap surfaced during planning

Self-signup stores an admin **password**, but `/staff/login` is Google-only and the only
password login (`/api/agent-auth/login`) rejects non-agents. A prospect with a non-Google
business email pays the $1 fee and then cannot log in. The video works around this by
using a Gmail; it should be fixed before the video is used to drive signups.

## Feature inventory (verified against real routes / nav)

| Feature | Exists? | In master? | Where |
|---|---|---|---|
| Public website / CTAs | YES | YES | `/` (marketing-home) |
| Registration | YES | YES | `/signup` — 4 steps: business → products/channels → admin → verification |
| Free trial | YES | YES | 14-day trial, $1 PayNow verification (EcoCash/OneMoney/Visa-MC), "Your trial is live" + workspace subdomain |
| Dashboard | YES | YES | `/staff` |
| Customers / clients | YES | YES | `/staff/clients` |
| Policies (create/search/detail/status) | YES | YES | `/staff/policies` (New Policy, policy detail) |
| Dependants / beneficiaries | YES | YES | policy detail |
| Products / versions / pricing | YES | brief | `/staff/products`, `/staff/pricebook` |
| Quote engine | YES | optional | `/quote/:id`, vCard `/card/:refCode` |
| Payments / receipting | YES | YES | `/staff/finance?tab=payments`, cash-up, group receipt, month-end |
| PayNow (mobile/card) | YES | mention only | `/staff/finance?tab=paynow`; tenant needs own PayNow keys — no fabricated transaction |
| Arrears / lapses | YES | YES | policy status + policy reports |
| Agents / commissions | YES | YES | `/staff/admin/agents`, `/staff/finance?tab=commissions`, agent reports |
| Leads pipeline | YES | brief | `/staff/leads` |
| Claims (register → approve) | YES | YES | `/staff/claims`, `/staff/approvals` |
| Funeral cases | YES | YES | `/staff/funerals` |
| Mortuary register | YES | YES | `/staff/mortuary` |
| Pitching schedule | YES | YES | `/staff/pitching-schedule` |
| Fleet tracking (hearses) | YES | YES | `/staff/fleet-tracking` |
| Funeral pricing / cash quotes | YES | brief | `/staff/pricebook`, `/staff/quotations` |
| Tombstones | YES | optional | `/staff/admin/tombstones` |
| Schemes / societies | YES | optional | `/staff/groups` |
| Documents / receipts / PDFs | YES | YES | receipt + policy document PDF from policy detail |
| Member cards | YES | brief | `/staff/admin/member-cards` |
| SMS / notifications | YES | templates only | `/staff/notifications` — Ubuntu has no SMS provider configured, so **do not show a send** |
| Client portal | YES | brief | `/client` |
| Reports | YES | YES | `/staff/reports`, `/staff/daily-report`, `/staff/executive-report` |
| Users / roles / access profiles | YES | YES | `/staff/users`, `/staff/access-profiles` |
| Audit trail | YES | YES | `/staff/audit` |
| MFA | YES | mention | enforced for privileged accounts |
| Settings / branding / branches | YES | YES | `/staff/settings`, `/staff/admin/branches` |
| Payroll / attendance / petty cash | YES | skip | out of scope for a prospect demo |

Anything a trial plan doesn't enable is checked on the live tenant before filming and
dropped from the script if absent.

## Connected scenario (the spine of the video)

Client **Nyasha Chikomo** (Harare) → Family Plan policy with spouse **Tariro** and two
children, beneficiary **Tariro** → cash premium receipted, PDF receipt → policy active →
(pre-seeded) father-in-law **Joseph Mhlanga**, dependant on an older policy, passes away →
claim registered and approved → funeral case opened → mortuary register entry → hearse
assigned in fleet → pitching schedule → claim + premium figures appear in reports → audit
trail shows every step with who did it.

## Master shot list + narration (target ≈ 7:30)

| # | Time | Screen (real) | Narration |
|---|---|---|---|
| 1 | 0:00–0:20 | Chrome opens pol263.com | Running a funeral assurance or funeral services business means policies, members, premiums, agents, claims and the funeral itself — often spread across spreadsheets, receipt books and phone calls. POL263 brings that work into one platform. |
| 2 | 0:20–0:50 | Scroll landing page, nav, CTAs | POL263 is built for funeral assurers and funeral service providers. The website tells you what it covers, and the free-trial button is where a company starts. |
| 3 | 0:50–1:30 | `/signup` steps 1–3 | Signing up takes a few minutes. Ubuntu Funeral Assurance enters its business details, the products it sells and how it sells them, then creates its administrator account. |
| 4 | 1:30–1:50 | Step 4, PayNow $1 | A one-dollar verification confirms the payment method works — EcoCash, OneMoney or card. Nothing else is charged during the trial. |
| 5 | 1:50–2:05 | "Your trial is live" + workspace address | The trial is live immediately, and the company gets its own workspace address for its team. |
| 6 | 2:05–2:20 | Login → dashboard | Thabo signs in to Ubuntu's own environment. Each company's data is kept separate from every other company on the platform. |
| 7 | 2:20–3:00 | Dashboard, sidebar sections | The dashboard is the command centre: policies, collections, claims and funeral activity at a glance. Down the side, the work is organised the way a funeral business runs — sales, clients, policies, payments, claims, funerals, finance and reports. |
| 8 | 3:00–3:35 | New Policy for Nyasha Chikomo | A new member doesn't need to exist in five spreadsheets. One record holds the policyholder, their family, their beneficiary and their cover, and the premium is calculated from the product's rules. |
| 9 | 3:35–4:00 | Receipt a payment → PDF receipt | When Nyasha pays, the premium is receipted against the policy and a proper receipt is produced on the spot. |
| 10 | 4:00–4:20 | Policies list, statuses, arrears | Every policy's status is visible, so the team can see who is up to date and who is falling behind — and act before cover lapses. |
| 11 | 4:20–4:40 | Agents + commissions | Agents, the policies they sell, and the commission they earn are tracked in the same system. |
| 12 | 4:40–5:05 | Claims → approval | When a covered member passes away, the claim is registered, checked and approved with a clear record of each decision. |
| 13 | 5:05–5:40 | Funeral case, mortuary, fleet, pitching | This is where POL263 goes beyond policy administration. The funeral itself is managed here: the case, the mortuary register, the hearse, and the pitching schedule for the service. |
| 14 | 5:40–6:05 | Notifications/SMS templates, receipt/policy PDFs, member card | Members can be kept informed by SMS, and documents such as receipts, policy schedules and member cards are generated from the same data. |
| 15 | 6:05–6:35 | Reports: daily, policy, finance, claims, executive | Management gets reports across the whole business — daily collections, policies, finance, claims and agents — plus an executive view for the directors. |
| 16 | 6:35–7:00 | Users, access profiles, audit trail | Each staff member sees only what their role allows, and the audit trail records who did what, and when. |
| 17 | 7:00–7:20 | Back to dashboard | POL263 connects the commercial, administrative and operational sides of a funeral business in one platform. |
| 18 | 7:20–7:40 | pol263.com, CTA, URL | Your funeral business already has enough moving parts. Bring them together with POL263. Visit pol263.com and start your free trial. |

Callout labels (only while that feature is on screen): POLICY ADMINISTRATION · CUSTOMER
MANAGEMENT · PREMIUM MANAGEMENT · AGENT MANAGEMENT · CLAIMS · FUNERAL OPERATIONS ·
REPORTING & ANALYTICS · ROLE-BASED ACCESS · AUTOMATED COMMUNICATIONS.

## Derived deliverables

- **Short cut (≈75 s):** shots 1, 3 (compressed), 5, 7, 8, 9, 12, 13, 15, 18.
- **Feature clips (20–45 s):** Policy (8+10), Customer (8), Premiums & Payments (9+10),
  Claims (12), Agents (11), Funeral Operations (13), Reporting (15), Admin/Security (16).

## Quality checklist

- [ ] Opened from the real pol263.com
- [ ] Real signup + real trial activation
- [ ] Real dashboard; every feature shown exists on the Ubuntu tenant
- [ ] No fabricated screens, stats or transactions; no SMS "send" shown
- [ ] No real client PII (Falakhe etc. never on screen); no other tabs, devtools or console
- [ ] Narration makes no unsupported claims
- [ ] CTA ends on pol263.com
