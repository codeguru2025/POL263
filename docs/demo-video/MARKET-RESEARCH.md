# POL263 — Market research behind the sales video (2026-09-26)

Purpose: ground the showcase script in real market pain and in what POL263 verifiably does
today (checked against `release/customer-service-api` code and the demo tenant — nothing
claimed that isn't on screen or in the code).

## 1. The Zimbabwean market

| Fact | Figure | Source |
|---|---|---|
| Funeral assurance share of life-assurance revenue | **68%** (9 months to Sep 2025); funeral + group life = 82% | IPEC via The Zimbabwean, Dec 2025 |
| Active life policies / lapses in one quarter | 2,122,824 active at start of Q3 2025; **97,111 lapsed** in the quarter (4.57%; one insurer 27.6%) | same |
| Policies sold but never paid for (NTU) | **19,493** in Q3 2025 alone | same |
| Market concentration | 12 direct life assurers; top 5 hold 84% of revenue; Nyaradzo 39% | same |
| Complaints | Delays in settling claims = **48%** of grievances to IPEC (Jan–Sep 2025); 61% in H1 2023 — a persistent problem | Newsday / IPEC |
| Currency | ZiG vs USD mismatch drives disputes and losses; revaluing premiums, benefits and reserves is an operational burden; IPEC now pegs capital in USD | Newsday, Zimbabwe Independent, ZimEye |
| Mobile money | EcoCash ≈ 99% of mobile-money transfers; insurers already collect premiums through it | Wikipedia / EcoCash |
| Uninsured | **72%** of Zimbabwean adults have no insurance at all | FinScope 2022 via 263Chat |
| Burial societies | Run from a committee notebook; weak when leaders relocate, disputes when rules are informal, funds erode with inflation | 263Chat |
| Diaspora | ~400 bodies a month repatriated from South Africa alone; USD 857–1,973 each | Global Press Journal |

## 2. Why "powerful international software" disappoints African insurers

- **Built for another market.** Core systems assume one stable currency, card/debit-order
  collection, and a formal-employment customer base. Zimbabwe runs on USD + ZiG (+ ZAR),
  EcoCash/OneMoney/InnBucks/O'mari and cash — ~83% of African employment is informal
  (Genasys).
- **Paid in hard currency, earned locally.** Licences, implementation and support are priced
  in USD/EUR while premiums are collected locally — margins get squeezed whenever the local
  currency moves (Genasys).
- **Long, risky implementations.** Up to 20% of African insurance modernisation projects fail
  on under-resourced implementation (Equisoft); customisation ownership disputes are common.
- **Missing the local business.** No concept of burial societies, mortuary registers, hearse
  fleets, tent pitching or tombstones — the parts of a Zimbabwean funeral business that
  actually generate cash and complaints. So companies bolt on spreadsheets and paper again.
- **Legacy and paper.** Manual processes, ageing systems and no real-time data remain the
  top barriers to digitalisation (Insurance Transformation Africa, AIO Africa Insurance Pulse).
- **Regulation.** Local regulators (IPEC) and local ID formats, time zones and reporting
  expectations aren't in a foreign default configuration.

## 3. POL263 answer, module by module (verified)

| Pain | POL263 capability (on screen in the demo tenant) |
|---|---|
| Spreadsheets & receipt books | One record per policy: members, dependants, beneficiary, cover, premium history; printed/PDF receipts on the spot |
| Mobile money reconciliation | PayNow: EcoCash, OneMoney, InnBucks, O'mari, Visa/Mastercard; payment ledger shows method per receipt; cash-up by staff |
| ZiG / USD / ZAR | Per-tenant enabled currencies (USD, ZAR, ZiG + more), FX-rate table consolidating to USD for statements |
| Local fit | Harare time zone, Zimbabwean national-ID format validation, configurable per tenant |
| Lapses & NTU | Grace → pre-lapse → lapse lifecycle, automatic lapse sweep, reinstatement, payment reminders and "prompt payment on saved mobile number", retention-vs-lapse graphs |
| Sales & agents | Lead pipeline (kanban), agent vCard + QR referral link, commission plans (new business / recurring / clawback) |
| Products | Product builder: versions, age bands, add-ons, benefits, bundles, terms |
| Burial societies & schemes | Group ledger per society, lump-sum group receipts, member lists, payouts against balance, historical Excel import |
| Delayed claims (48% of complaints) | Claims register with SLA deadlines, documents, maker-checker approval queue, SMS to the client on every change |
| Funeral operations | Funeral cases, price book, cash-service quotations, mortuary register (storage fees, belongings, release), live fleet map, pitching schedule, tombstone orders |
| Member experience | Client portal (cover, pay, claim, documents), member cards with verification QR, SMS notifications |
| Management & compliance | Daily report, executive report (PDF), income statement, cash flow, IFRS 17 insurance-contract summary (indicative), actuarial export, statistical graphs, AI insights |
| Control | Users & roles, branches, MFA, full audit trail, company data isolated per tenant (dedicated database available) |
| Adoption risk | Self-service sign-up, 14-day free trial ($1 payment-method check), no implementation project |

**Deliberately NOT claimed in the video:** offline mode (not built); WhatsApp member
messaging (WhatsApp is live only as an MFA channel); the IPEC statutory return / persistency /
bordereaux / trial-balance report pack (built on local `main`, 15 commits ahead of
`origin/main`, not on this branch or production); any price.

## Sources

- https://www.thezimbabwean.co/2025/12/zims-life-assurance-sector-shows-growth-but-grapples-with-policy-lapses-and-concentration-risk/
- https://allafrica.com/stories/202504220249.html
- https://www.newsday.co.zw/local-news/article/200056154/insurers-under-fresh-scrutiny-as-grievances-mount
- https://www.newsday.co.zw/business/article/200056009/zig-currency-uncertainty-fuels-insurance-disputes
- https://www.newsday.co.zw/business/article/200057042/undefined
- https://www.theindependent.co.zw/local-news/article/200035284/zig-spawns-upheavals-in-insurance-industry
- https://www.zimeye.net/2025/06/25/govt-snubs-zig-insurance-capital-requirements-now-pegged-in-us-dollars/
- https://www.263chat.com/what-burial-societies-reveal-about-inclusive-insurance-in-zimbabwe/
- https://en.wikipedia.org/wiki/EcoCash
- https://globalpressjournal.com/africa/zimbabwe/zimbabweans-spend-big-repatriate-bodies/
- https://www.genasystech.com/10-defining-challenges-facing-african-insurers/
- https://www.equisoft.com/insights/insurance/out-of-the-box-ootb-solutions-for-fast-life-insurance-modernization-in-africa
- https://insurancetransformationafrica.com/modernising-core-insurance-systems-from-legacy-to-digital/
- https://african-insurance.org/wp-content/uploads/2023/03/603e0a3a18f74_Africa_Insurance_Pulse_e.pdf
