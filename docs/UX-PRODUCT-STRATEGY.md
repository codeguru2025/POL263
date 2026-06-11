# POL263 — Product & UX Strategy: The Path to World-Class

> **Companion to `SYSTEM-SPEC.md`.** This document answers the advisor's 12 discovery
> questions decisively and lays out a concrete redesign blueprint. Where a question depends on
> business reality not visible in code, I state the **operating assumption** I'm using and the
> reasoning, so you can correct a number and I'll recompute — but nothing here is blocked waiting
> on input.

---

## 0. The One-Sentence Thesis

> **POL263 becomes world-class when every user lands in a workspace built for *their* job, can
> complete the single most common task in under 10 seconds, and never has to guess which menu hides
> a feature.**

Everything below serves that sentence. Today the app is an *analytics dashboard bolted onto a
feature warehouse*. World-class is an *operational command center organized around jobs, not
database tables*.

---

## Operating Assumptions (correct any, I recompute)

These resolve the "only you can answer" questions using domain knowledge of the
Zimbabwean/Southern-African funeral-assurance & micro-insurance market plus what the codebase
reveals. **Treat as defaults, not facts.**

| # | Assumption | Why | If wrong, impact |
|---|---|---|---|
| Branches | **1–10 per tenant typical; design for up to ~20** | Code has branch scoping + a branch filter but no branch-tree UI | If 50+, we need branch-first navigation, not a header switcher |
| Sales mix | **Walk-in/cashier ≈ Burial-society/group > Agent (growing)** | Strong group/settlement + cashier code; agent app is newer | Re-orders which "hero flow" gets the #1 slot |
| Mobile split | **~55% desktop · ~35% Android app · ~10% mobile browser** | Back-office is desktop; dedicated agent app exists | If agents dominate, agent flows go mobile-first |
| Top user | **Cashier (by time-in-system) + Agent (strategic)** | Receipting is the highest-frequency repeated action | Changes which persona we optimize first |

---

## 1. Biggest Pain — Top 3 (decided)

1. **Confusing terminology / broken mental model** (your option F) — *the root cause.* Users cannot
   predict which of Transactions / Finance / Administration / Tools holds a feature (see Q12).
2. **Can't find features** (B) — symptom of #1, plus real bugs (Finance tabs were unreachable until
   today's fix).
3. **Duplicate functions** (I) — same destination under multiple labels (Clients/CRM, Billing/Receipts).

> These three are causally linked: bad naming (F) → can't find (B), and duplication (I) makes it
> worse. Fix the IA and all three collapse together. *Ugly interface and slow performance are NOT
> in your top 3 — the problem is structure, not paint.*

## 2. Most Important User (decided: optimize in this order)

1. **Cashier** — highest time-in-system, most repetitive. Biggest ROI per hour saved.
2. **Sales Agent** — strategic growth engine; mobile-first.
3. **Branch Manager** — oversight + approvals.
4. **Claims/Funeral Officer** — emotionally critical, time-sensitive moments.
5. **Finance Officer**, **Executive**, **Administrator** — important but lower frequency.

**Design rule:** optimize for #1 and #2 first; #5–#7 get clean dashboards, not bespoke speed.

## 3. Current Dashboard — Verdict

It is a **pure KPI/analytics screen (Option B) shown to everyone.** Numbers, four charts, a filter
bar — and *zero actions or work queues*. For a daily operator this is the wrong screen. It's
"prettier," not "Salesforce-level." (Real screenshots available on request — I can run the app and
capture them.)

## 4. What Users Should See After Login (decided: **role-based Command Center**)

Replace the one-size dashboard with a **role-aware landing** = Option C (command center) +
Option A (my tasks), with Option B reserved for executives:

| Role | Landing |
|---|---|
| **Cashier** | Big "Receipt a Payment" action · today's receipts · cash-up status · unallocated payments |
| **Agent** (mobile) | "New Policy" · my leads/follow-ups due · my commission this month · my clients |
| **Manager** | My approvals queue (claims, requisitions) · branch collections vs target · lapsing this week |
| **Claims/Funeral** | Open cases by stage · awaiting-my-approval · tasks due today |
| **Finance** | Collections today · requisitions to approve · month-end status · expenditures |
| **Executive** | The current KPI dashboard (it's genuinely good *for them*) |

All data already exists in the API (approvals, requisitions, leads, lapse, cash-ups). This is
assembly, not new backend.

## 5. Daily Modules — Ranking (decided)

1. Receipts & Payments → 2. Policies → 3. Clients → 4. Claims → 5. Funeral Cases →
6. Requisitions/Approvals → 7. Reports → 8. Leads → 9. Commissions → 10. Payroll.
*(Fleet, Audit, FX, Platform Fees are weekly-or-rarer — they must not compete for daily attention.)*

## 6. What Must Leave the Main Menu (decided)

| Item | Action | New home |
|---|---|---|
| **Platform Fees** | **Remove from tenant UI entirely** | Platform-owner only (it's *your* revenue) |
| App Releases | Remove from tenant UI | Platform-owner only |
| FX Rates | Demote | Setup → Finance config |
| Audit Trail · System Issues/Diagnostics | Demote | Setup → Security |
| Terms & Conditions · Security Questions | Demote | Setup |
| Statistics · Statistical Graphs | Fold | into Insights/Reports |
| EasyPay · Transport Companies · Order SMS · Member Cards · Terminals | Demote | Setup (rare config) |

**Rule:** configured less than monthly ⇒ not a top-level item.

## 7. Branches (assumption: ≤20) → **header branch switcher + branch column in lists**

A persistent branch selector in the top bar (already half-built — there's a branch filter on the
dashboard). No branch-tree navigation needed unless tenants exceed ~20 branches.

## 8. Sales Model — **Model D (all three), hero flow = the highest-volume one**

Build all three flows but make **one** the one-click hero on the Cashier/Agent landing:
- **Walk-in → Cashier → Receipt** (Model A): the 10-second receipting path.
- **Burial society → bulk register → group payment** (Model C): batch-first screens.
- **Agent → Lead → Client → Policy → Payment** (Model B): mobile wizard, one screen per step.

## 9. Mobile vs Desktop — **responsive, agent-flows mobile-first**

Back-office stays desktop-dense; **agent journeys (new policy, receipt, my clients) are designed
mobile-first** because they ship in the native app. One responsive codebase (already the case).

## 10. The "World-Class" Sentence × 5 (decided)

When a user logs into POL263 they should immediately be able to:
1. **Receipt a payment and print/SMS the receipt in under 10 seconds.**
2. **See everything awaiting their action today** — approvals, follow-ups, unallocated payments — in one queue.
3. **Find any policy, client, or member by name / number / phone** from one global search box.
4. **Register a new policy end-to-end on a single screen** (walk-in or agent).
5. **Know today's collections vs target and which policies lapse this week.**

These five become the product's North-Star tasks. Every release is judged: *did we make one of
these faster?*

## 11. Visual Direction — **50% Linear · 30% Stripe · 20% Salesforce**

- **Linear (50%)** — keyboard-first speed, clean density, fast lists. Serves the cashier/agent reality.
- **Stripe (30%)** — premium, trustworthy money screens (finance, receipts, executive).
- **Salesforce (20%)** — dense sortable tables only where lists are unavoidable (policies, claims).
- **Avoid** full Salesforce: its menu sprawl is exactly the trap you're escaping.

Concrete tokens: generous whitespace, one accent color + neutral grays, `tabular-nums` for all
money, sticky table headers, command palette (`⌘K`/`Ctrl-K`) for global search & actions.

## 12. Can Users Tell the 4 Menus Apart? — **No. This is the #1 problem. Here is the fix.**

The current buckets are named after *system internals*. The fix is to name them after the *user's
job*. **Collapse to four self-explanatory verbs:**

```
WORK      → do my job        (Policies, Clients, Claims, Funerals, Quotations, Receipting)
MONEY     → handle money      (Receipts, Requisitions, Expenditures, Commissions, Payroll, Close)
INSIGHTS  → understand        (Dashboards, Reports, Statistics)
SETUP     → configure         (Products, Pricing, Users/RBAC, Branches, Reference data, Security)
```

Every former "never-touch" item from Q6 falls naturally into **SETUP**. Daily work lives in **WORK**
and **MONEY**. A brand-new cashier can guess where receipting is on day one — that is the test of
world-class IA.

---

## The Redesign Blueprint (what to actually build)

### A. New top-level navigation

| Menu | Contains | Primary roles |
|---|---|---|
| **Home** | Role-based command center (Q4) | all |
| **Work** | Policies · Clients · Claims · Funeral Cases · Quotations · Leads | cashier, agent, manager, claims |
| **Money** | Receipts & Payments · Cash-up · Group Receipt · Requisitions · Expenditures · Commissions · Payroll · Month-End | cashier, finance, manager |
| **Insights** | Dashboards · Reports (policy/finance/employee) · Statistics | manager, exec, finance |
| **Setup** | Products · Price Book · Users & Roles · Branches · Partners (agents/brokers/underwriters/undertakers) · FX · Terms · Audit · Security · System | admin only |

Reduces the daily cognitive load from **6 overlapping menus** to **4 verbs + Home**, with rarely-used
config quarantined in Setup.

### B. Global capabilities (the world-class multipliers)
1. **Command palette (`Ctrl-K`)** — search any policy/client + run any action ("receipt payment",
   "new claim"). Single biggest perceived-speed upgrade.
2. **One global search** in the header (already exists for policies — extend to clients/members).
3. **Universal "+ New" button** — context-aware create.
4. **Work-queue widgets** — approvals, follow-ups, unallocated payments, surfaced on Home.

### C. Persona landing pages — see Q4 table. Build Cashier + Agent first.

### D. Hero flows to make one-screen / one-click
- Receipt-a-payment (≤10s) · New policy wizard · Group/society batch receipt · Approve queue.

---

## Phased Roadmap

**Phase 1 — Stop the bleeding (days)**
- ✅ Fix Finance tab deep-linking (done).
- ✅ De-duplicate menus, add Finance group (done — interim).
- Remove Platform Fees / App Releases from tenant UI.

**Phase 2 — Re-architect navigation (1–2 weeks)**
- Implement Work / Money / Insights / Setup IA.
- Add `Ctrl-K` command palette + extended global search.

**Phase 3 — Role-based Home (2–3 weeks)**
- Replace single dashboard with persona command centers + work queues.

**Phase 4 — Hero-flow polish (ongoing)**
- One-screen receipting, new-policy wizard, batch society receipt; mobile-first agent journeys.

**Phase 5 — Visual system (parallel)**
- Apply 50/30/20 Linear/Stripe/Salesforce tokens; money typography; sticky tables.

---

## How We'll Know It Worked (success metrics)
- **Time-to-receipt** < 10s (from login).
- **Clicks-to-task** for top-5 flows ↓ 50%.
- **Support/training questions** about "where is X" → ~0.
- **Zero duplicate** menu destinations.
- New cashier productive **without training** on receipting.

---

*Assumptions are flagged and adjustable. Give me the four real numbers (branches, sales mix, mobile
split, top user) and I'll lock every recommendation to your reality — but you can start building
Phase 1–2 today on these defaults with confidence.*
