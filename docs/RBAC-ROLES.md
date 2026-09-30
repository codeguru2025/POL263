# Roles and what they can do

Source of truth: `ROLE_PERMISSION_MAP` in `server/constants.ts`. On every start the app resets
each tenant's built-in roles to that map, so a change there reaches every tenant on the next
deploy. Hand edits to built-in roles are overwritten. Reviewed with Augustus on 2026-09-30.

## Rules every role follows

- **Least privilege.** Each role gets what its job needs and nothing else.
- **Two people for money and claims.** The person who takes money in can't correct, delete or
  backdate it afterwards; that's the Finance Manager's job. The person who captures or verifies
  a claim can't approve it or mark it paid.
- **Agents see only their own book.** One check (`server/agent-scope-guard.ts`) stops an agent
  opening another agent's policy, client, claim, lead, receipt or society.
- **Nobody can promote themselves.** You can't change your own roles, can't give a role with
  powers you don't have, and can't reset the password of someone more powerful than you
  (`server/role-assignment-guard.ts`). Only the platform owner edits role definitions.

## The roles

| Role | Job | Can | Can't |
|---|---|---|---|
| **Superuser** | Owner account | Everything | — |
| **Executive** | Directors / board | See everything, including finance, payroll and the audit trail | Change anything |
| **Administrator** | Runs the office | Policies, clients, claims (including approval), receipting, groups and societies, funerals, fleet, products and pricing, settings, users; see finance and commissions | Correct, delete or backdate money; post finance entries; approve finance; payroll; edit commissions |
| **Finance Manager** | Owner / accountant | Correct, delete and backdate payments and receipts; premium overrides; post and approve finance; settlements; waivers; payroll; commissions | Settings, users, pricing (unless also Administrator) |
| **Branch Manager** (`manager`) | Runs a branch | Sales, claims (including approval), funerals, fleet, groups, receipting, staff accounts; see finance | Settings, pricing, money corrections, finance approvals, payroll |
| **Finance Clerk** | Accounts clerk | Capture expenses, requisitions, bank deposits, petty cash; receipting; see finance | Approve anything, correct or delete money, payroll |
| **Cashier** | Counter | Take payments, cash up, bank the day's cash, reprint receipts | Company finance reports, expenses, anything else |
| **HR & Payroll Officer** | People | Staff list, attendance, prepare payroll | Policies, clients, other finance, creating users |
| **Customer Service** | Front desk / call centre | Look up policies and clients, update contact details, log complaints and leads, capture claims | Money, approvals |
| **Sales Team Leader** | Leads agents | See every agent's leads, clients, policies and commissions; sell; receipt mobile and transfer payments | Company finance, approvals |
| **Agent** | Sells | Their own clients, policies and leads; receipt mobile and transfer payments; their own commission | Other agents' records, company finance, cash receipts |
| **Claims Officer** | Claims | Capture, verify and investigate claims; funeral cases | Approve claims or mark them paid |
| **Funeral Ops Manager** | Funerals | Funeral cases, mortuary, fleet, cash-service quotes, service payments | Policies (read only), finance |
| **Fleet Ops** | Vehicles | Fleet, funeral logistics | — |
| **Driver** | Removals / burials | See assigned cases and vehicles; check vehicles out | Edit cases |
| **Mortuary Attendant** | Mortuary | Intake, body care, dispatch | Finance, policies |
| **Staff** | Everyone else | Read-only basics | Change anything |

## Giving people roles

- **Administrators** can give the roles inside their own powers: Agent, Cashier, Customer
  Service, Sales Team Leader, Claims Officer, Funeral Ops Manager, Fleet Ops, Driver, Mortuary
  Attendant, Staff and Branch Manager.
- **The owner (or someone holding Administrator + Finance Manager)** gives Finance Manager,
  Finance Clerk, HR & Payroll Officer and Executive, because those roles hold powers
  administrators don't.
- **A person can hold more than one role.** Their powers add up. An agent who is also an
  Administrator, Branch Manager, Finance Manager, Sales Team Leader or Customer Service person
  isn't limited to their own book.
