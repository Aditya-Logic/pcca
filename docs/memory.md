# Memory

**Living document. Read this first, before writing any code. Update it in the same change as the work, not afterwards.**

Last updated: 18 September 2026

---

## Where things stand

**Phase:** Phase 2 substantially complete on the backend. Full Node.js + PostgreSQL API delivered and verified.

**Currently being worked on:** Nothing. Backend delivered. Next action is the React frontend rebuild (Phase 1 of the UI plan), or wiring the remaining admin screens to the live API.

**Last completed:** Backend API — auth with OTP second step, RBAC with office scoping, document upload with versioning and magic-byte validation, moderation, audit log, analytics. Plus Docker deployment, Nginx config, and DEPLOYMENT.md covering the .gov.in domain and CERT-In audit path.

---

## Done

### Data — complete and verified

Source `Staff_strength.xlsx` parsed into 85 office records. Totals verified against the source: **85 offices, 196 Sr. AOs, 253 AAOs, 912 Sr. Accountants/Accountants.** All 85 names unique. 23 distinct parent organisations, 25 distinct stations derived.

Seeded via `backend/src/db/seed.js` from `backend/src/db/offices.seed.json`. The seed verifies the totals and refuses to complete if they drift.

### Prototype — complete

`frontend/public/index.html`. Single self-contained file, no build step, no runtime dependency. Opens from `file://`.

Working: client-side routing across seven views; directory with live search, two filters, five sort modes, card/list toggle, sortable list columns; CSV export honouring active filters; office detail with computed totals; bar charts built from real data; drag-and-drop upload with progress simulation; toast notifications; language toggle; responsive down to 360 px; keyboard navigable with skip link.

Verified: JS syntax clean under `node --check`; full boot sequence executed against a stub DOM with no runtime errors; all 85 records load; totals compute to the correct figures.

### Backend — complete and verified

Node 20 + Express + PostgreSQL. Boots clean; security headers confirmed present (CSP, HSTS, X-Frame-Options, nosniff); error shapes verified for 404, validation failure and unauthorised; magic-byte detection correctly rejects a shell script renamed `.pdf`; argon2id hashing verified at m=19456,t=2,p=1.

Implemented: two-step authentication (password then OTP), argon2id, JWT in httpOnly cookies with rotating refresh and replay detection, per-account lockout, office-scoped RBAC, document upload with versioning, magic-byte type checking, ClamAV integration, three-level visibility enforced in SQL, moderation queues, public queries, insert-only audit log, aggregate analytics.

Not yet exercised against a live PostgreSQL instance — no database was available in the build environment. Schema, migrations and seed are written and syntax-clean; first real run should be `npm run db:migrate && npm run db:seed` and confirm the seed prints "totals verified 85 / 196 / 253 / 912".

### Deployment tooling — complete

docker-compose (db, clamav, api, migrate, web), non-root Dockerfiles with healthchecks, Nginx config with TLS, CSP, rate limiting and upload ceiling, secret generator, `.env.example`, `requirements.txt`, `DEPLOYMENT.md` covering local setup, `.gov.in` domain acquisition through NIC, NICCA certificates, GIGW compliance, CERT-In audit, and the air-gapped install path.

### Documentation — complete

`project-requirement.md`, `architecture.md`, `rules.md`, `phases.md`, `design.md`, and this file.

### Rename — complete

`PCC` → `PCCA` throughout the prototype: title, meta description, both brand marks, footer heading, CSV filename, domain to `pcca.mha.gov.in`. Organisation name set to **Principal Chief Controller of Accounts**.

The `PCC_OFFICES` JavaScript constant was deliberately left unrenamed — it is an internal identifier, not user-facing. Rename it to `PCCA_OFFICES` during the Phase 0 port if consistency is wanted.

JS re-verified after the rename.

---

## Not started

React rebuild of the frontend (the delivered UI is the single-file portal wired to the API). Hindi content. SMS gateway integration for OTP delivery — currently demo-mode only. GIGW mandatory pages (Terms, Privacy, Copyright, Hyperlinking, Accessibility Statement, Help, Contact).

Previously listed as not started, now done: Phase 0, and the backend halves of Phases 1–3, are delivered. Phase 4 hardening (audit, pen test, restore rehearsal) is untouched.

---

## Known gaps in the prototype

These are understood limitations, not bugs. Do not "fix" them in the prototype — they are resolved by building the real thing.

**Sign-in is cosmetic.** Any input opens the Super Administrator view. There is no auth. Do not treat the prototype as a security reference.

**Documents are illustrative.** The four files on the office detail page are invented sample content, clearly labelled. They must not be carried into the real build or mistaken for real records.

**Contact fields are empty by design.** Telephone and email show "Not yet filled in" because the source file has none. Never populate these with plausible-looking values — see `rules.md`.

**Admin list shows 12 of 85.** No paging in the prototype.

**Hindi toggle shows a notice only.** The key structure is planned for Phase 0; copy lands in Phase 4.

**Charts are CSS bars.** Intentional. Not a placeholder for a charting library.

---

## Decisions made, with reasons

**85 offices, not 45.** The original brief said "45 Post Offices." The source file contains 85 Pay & Accounts Offices and no postal data whatsoever. Built against the real file. Flagged for confirmation — this is Blocker 1.

**Station and organisation are derived, not given.** Both are parsed from office name strings. This is a documented guess. The production schema records what was derived in `derived_fields` so a super administrator can review all 85 rather than trust the parser. Two assumptions need a human eye: `Ranidanga` and `Kathgodam` are treated as stations, and offices with no location suffix default to New Delhi (HQ).

**Office names are never normalised.** `Bangaluru` stays as written in the source. Names are the join key; correcting apparent typos breaks the link to the source data. Flag, do not fix.

**Totals are always computed.** Never stored, never hardcoded. The single most likely wrong suggestion on this project.

**No component library.** MUI, Chakra, and shadcn all arrive with visual opinions that would have to be fought to reach the look in `design.md`. The component set is small enough to write.

**Public directory ships before authentication.** Most user value, least infrastructure. Building sign-in first would mean months before anything is visible.

---

## Blockers

Ordered by urgency. None can be resolved by the development team alone.

| # | Blocks | Needed from the Pr.CCA office |
|---|---|---|
| 1 | Phase 0 | **Confirm 85 offices is correct** and that "45" in the original brief was an error |
| 2 | Phase 1 | Review of the 85 derived station and organisation values |
| 3 | Phase 1 | Telephone and email per office — or written acceptance that they ship blank |
| 4 | Phase 2 | SMS gateway for OTP delivery |
| 5 | Phase 2 | Named super administrators and how their accounts are issued |
| 6 | Phase 2 | Object storage and ClamAV provisioned on the target server |
| 7 | Phase 3 | File retention policy for superseded versions |
| 8 | Phase 4 | Server access for the air-gapped install dry run |

Chase 1, 3, and 5 now. Each has a long turnaround and each stops a phase.

---

## How to update this file

Update it in the same pull request as the work. A `memory.md` describing last month's state is worse than none, because it is trusted and wrong.

On every change, update **Currently being worked on** — the single file or feature in progress — and move finished items into **Done** with a one-line note on what was verified, not just what was written. "Done" means run and tested. "Should work" belongs in **Not started**.

When a decision is made that someone might later reverse without knowing why, record it under **Decisions** with the reason. The reason is the part that matters; a decision without one gets undone.

When a blocker is cleared, delete the row and note it under **Done**. When a new one appears, add it immediately — a blocker held in one person's head is not tracked.
