# Phases

Four phases. Each ends with something deployable and independently useful, so if funding, staff, or attention runs out partway, what exists still has value.

Ordering principle: the public directory ships first and needs no accounts. It is the part most people will use and the part that needs the least infrastructure. Authentication, uploads, and administration build on top of it. Building sign-in first would mean months before anyone outside the project sees anything.

> Estimates assume one full-time developer. Adjust for the real team.

---

## Phase 0 — Foundation
**~1 week. Nothing user-visible.**

Repository, tooling, and the data pipeline. Nothing here ships, but everything after it depends on this being right.

- Repo with the folder structure from `architecture.md`
- Vite + React + TypeScript, `strict: true`
- Express + TypeScript skeleton, health endpoint
- PostgreSQL via docker-compose, migrations running
- `tokens.css` from `design.md`, fonts self-hosted
- ESLint, Prettier, Vitest, CI running on every push
- **Seed script**: parse `Staff_strength.xlsx` → 85 office rows, deriving parent organisation and station, recording what was derived in `derived_fields`
- `errorHandler.ts` and `AppError` in place before any feature uses them
- `i18n.ts` with the `en`/`hi` key structure, even though Hindi copy comes later

**Done when:** `docker compose up` gives a running API and database; the seed produces exactly 85 offices whose counts sum to 196 / 253 / 912; CI is green.

**Deliberately included here:** the error handler and the i18n layer. Both are near-impossible to retrofit once forty components exist.

---

## Phase 1 — Public directory
**~3 weeks. Ships to the public.**

Everything a visitor can do without an account. This is the largest slice of user value in the project.

### 1.1 Shell
Header with branding and language toggle, footer, responsive navigation, route structure, error boundaries.

### 1.2 Home
Hero, computed summary band, strength-by-organisation chart, section explaining what the site is for.

### 1.3 Directory
The centre of the phase. Card and list layouts with a toggle. Search across name, organisation, and station, debounced. Filters for organisation and station, combining as AND. Sort by name or any cadre count or total. Sortable columns in list view. CSV export of the filtered set. Empty state that distinguishes "no matches" from "request failed".

Cards show name, organisation, station, and all three cadre counts without a click.

### 1.4 Office detail
Sanctioned strength with computed total, office record with contact fields showing "Not yet filled in" where absent, document list placeholder for Phase 2.

### 1.5 Quality pass
Keyboard navigation end to end. Screen-reader pass on directory and detail. Contrast audit. 360 px width check. Lighthouse over 90 on performance and accessibility.

**Done when:** all 85 offices browsable and filterable by an anonymous visitor; summary figures computed live; CSV matches the visible rows; keyboard-only operation works throughout; site is live at `pcca.mha.gov.in`.

**Deferred:** anything requiring an account.

---

## Phase 2 — Authentication and documents
**~4 weeks. The longest phase.**

Offices can sign in and publish. Two halves — auth must be complete before uploads start, because upload permission depends on it.

### 2.1 Authentication
Users table and roles. argon2id hashing. Sign-in with CAPTCHA. OTP as a second step; the password alone never creates a session. JWT in httpOnly cookies, 15-minute access with rotating 8-hour refresh. Password reset by expiring email link. Session timeout at 30 minutes idle with a warning at 25. Rate limiting: five attempts per fifteen minutes, per IP and per account.

Accounts are created by a super administrator and activated through an invitation link. There is no public sign-up.

### 2.2 Authorisation
`authenticate` and `authorize` middleware. Office scoping on every office-bound handler. A PAO administrator reaching another office's data gets 403 whether by URL or by direct API call — tested explicitly, both ways.

### 2.3 PAO dashboard
Own office only: strength, own documents, editable contact fields.

### 2.4 Upload
Drag-and-drop and file picker. Browser validation of type and size, then server validation of the same, then a magic-byte check. Chunked upload with progress. Metadata — type, date, visibility — required before submission. ClamAV scan before anything becomes downloadable.

### 2.5 Versions and visibility
Replacement creates a new version; old versions retained and retrievable. Public, Internal, and Restricted enforced in the query, not filtered after fetch. Downloads streamed through the API with the permission checked per request, counter incremented.

**Done when:** an office administrator signs in with OTP, uploads a file, replaces it to produce version 2 with version 1 still retrievable, and cannot reach any other office's data; oversized, wrong-type, and renamed-executable uploads are all rejected; restricted files are invisible to the public.

**Riskiest phase.** Chunked upload, virus scanning, and storage all have environment-specific failure modes. Budget for the on-premise storage and ClamAV setup to take longer than expected.

---

## Phase 3 — Administration and queries
**~3 weeks.**

Oversight, and the public feedback loop.

### 3.1 Account management
List of all 85 offices with account status. Invite, suspend, reactivate. Role assignment. Every action audited.

### 3.2 Moderation
Queue for restricted documents and pending queries. Publish or send back with remarks. Notification to the submitting office either way.

### 3.3 Audit log
Filterable by actor, action, target, and date range. Insert-only. Exportable for audit parties.

### 3.4 Public queries
Submit against a named document. Spam filtering, then the moderation queue. Approved queries appear on the office page. Author email stored for reply, never exposed publicly.

### 3.5 Usage figures
Uploads over time, most-downloaded documents, offices that have never published. Aggregate only — no per-visitor tracking, ever.

### 3.6 Data correction
Super administrators edit strength figures, station, organisation, and status. The `derived_fields` review list surfaces the 85 parsed values for human confirmation — this closes the open question from `project-requirement.md`.

**Done when:** a super administrator can invite and suspend accounts, approve and reject documents and queries, read a complete audit trail, and correct any derived field; no public endpoint returns an author email.

---

## Phase 4 — Hardening and handover
**~2 weeks.**

The phase that gets cut under pressure and should not be.

- Full Hindi copy across every screen; layout checked at longer Devanagari string lengths
- Independent WCAG 2.1 AA audit, findings fixed
- Penetration test: auth bypass, office-scope escape, upload abuse, injection
- Load test at expected peak
- Backup and **restore rehearsal** — a backup that has never been restored is not a backup
- Air-gapped install dry run from `docker save` images
- Runbook: deploy, roll back, rotate secrets, restore, common failures
- Handover session with the team who will operate it

**Done when:** audit findings closed, a restore has been performed successfully from a backup, and the operating team has deployed it once themselves without help.

---

## Timeline

| Phase | Duration | Cumulative | Public visibility |
|---|---|---|---|
| 0 — Foundation | 1 wk | 1 wk | None |
| 1 — Directory | 3 wk | 4 wk | **Live** |
| 2 — Auth + documents | 4 wk | 8 wk | Offices publishing |
| 3 — Admin + queries | 3 wk | 11 wk | Full feature set |
| 4 — Hardening | 2 wk | 13 wk | Production-ready |

Roughly three months for one developer. Phase 1 alone is useful and could stand as the deliverable if the rest is delayed.

---

## Blockers by phase

| Phase | Needs, from the Pr.CCA office |
|---|---|
| 0 | Confirmation that 85 offices is correct |
| 1 | Review of the 85 derived station and organisation values |
| 1 | Telephone and email per office, or acceptance that they ship blank |
| 2 | SMS gateway for OTP; storage and ClamAV provisioned |
| 2 | Named super administrators and how their accounts are issued |
| 3 | File retention policy for superseded versions |
| 4 | Server access for the air-gapped dry run |

Chase items 1, 2, and 5 now. Each of them blocks a phase and none can be resolved by the development team alone.
