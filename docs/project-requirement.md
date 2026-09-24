# Project Requirements

**Project:** PCCA Portal — MHA Pay & Accounts Offices
**Domain:** `pcca.mha.gov.in`
**Owner:** Office of the Principal Chief Controller of Accounts, Ministry of Home Affairs
**Status:** Prototype delivered (single-file HTML). Backend not started.

---

## 1. What we are building

A single public website that holds one authoritative record for every Pay & Accounts Office under the Ministry of Home Affairs, and lets each office publish its own circulars and orders without routing them through a central webmaster.

Today that information lives in spreadsheets emailed between offices. There is no public page a DDO, a pensioner, or an audit party can look at to find which office handles which force, where it is stationed, or what its sanctioned strength is. This portal is that page.

Three things it must do, in priority order:

1. **Be a directory.** All 85 offices, searchable and filterable, no sign-in required.
2. **Be a document repository.** Each office uploads its own files; the public downloads the ones marked public.
3. **Be accountable.** Every change is logged, every sensitive file is approved before it appears.

### What it is not

Not an accounting system. It does not compute, post, or reconcile anything. It does not talk to COMPACT, PFMS, or e-Lekha. It stores documents and office metadata. If a requirement starts with "and it should also calculate…", it is out of scope.

---

## 2. The data we actually have

Source file: `Staff_strength.xlsx`, 85 rows, four columns.

| Field | Present in source | Notes |
|---|---|---|
| Office name | Yes | e.g. `PAO(CRPF)`, `RPAO(CISF), Kolkata` — unique, used as the key |
| Sr. AOs | Yes | Integer, 0–20 |
| AAOs | Yes | Integer, 0–21 |
| Sr. Acctt / Acctt | Yes | Integer, 0–157 |
| Parent organisation | **Derived** | Parsed from the name string (CRPF, BSF, CISF, ITBP, SSB, NSG, IB, Assam Rifles, Census, DCPW, FCRA, NATGRID, NDMA, NIA, NDRF, Ayushman Bharat, J&K Home Deptt., MHA Secretariat, Police Modernisation, and others). 23 distinct values. |
| Station | **Derived** | Parsed from the location suffix; offices with no suffix default to New Delhi (HQ). 25 distinct values. |
| Status | **Invented** | All seeded as Active. Needs confirmation. |
| Telephone, email | **Missing** | Must be collected from each office during onboarding. |
| Postal address | **Missing** | Blocks map integration. Map is therefore optional, not a launch requirement. |
| Establishment date | **Missing** | Dropped from scope unless supplied. |

Verified totals, which the portal computes rather than hardcodes: **85 offices, 196 Sr. AOs, 253 AAOs, 912 Sr. Accountants/Accountants.**

> **Correction on record.** The original brief described "45 Post Offices." There are no post offices in this project and no postal data in the source file. The subject is 85 Pay & Accounts Offices. If a separate 45-entity dataset exists, it was never supplied and this build does not cover it.

---

## 3. Who uses it

**Public and reviewers — no account.** DDOs in field formations, pensioners and their representatives, audit parties, staff of other ministries, and anyone who lands via search. They arrive knowing a force name ("CRPF") or a city ("Patna") and need to reach the right office. Most are on a phone. Many are on a slow connection. They will not create an account and should never be asked to.

**PAO administrators — one per office, up to 85 accounts.** Typically an AAO or Sr. Accountant given the duty alongside their regular work. Not technical. They log in occasionally, upload a file, and leave. The upload flow has to survive being used once a month by someone who has forgotten how it works. They see only their own office.

**Super administrators — a handful, in the Pr.CCA office.** They create and suspend office accounts, approve restricted documents, correct the derived station and organisation fields, and read the audit log. They are the only people who see the whole system.

---

## 4. Features

### 4.1 Public directory — required for launch

Browse all 85 offices as cards or as a list. Search matches office name, parent organisation, and station in one box. Filter by organisation and by station, combining as AND. Sort by name or by any of the three cadre counts or by total strength. Export the current filtered set to CSV.

Every card shows, without a click: office name, parent organisation, station, and the three cadre counts. This last point is not negotiable — the counts are the reason the directory exists, and hiding them behind a detail page defeats the purpose.

### 4.2 Office detail page — required for launch

Full sanctioned strength with a computed total. Office code, parent organisation, station, contact details, and last-updated date. Document list grouped by category with file type, size, version, upload date, download count, and visibility badge. A query form against a named document.

Contact fields that have not been filled in display as "Not yet filled in" rather than being hidden, so the gap is visible and someone chases it.

### 4.3 Authentication — Phase 2

Username or office email plus password. CAPTCHA on the form. One-time code to the registered mobile for every admin sign-in. Password reset by link to the registered office email, expiring in 30 minutes. Session expires after 30 minutes idle, with a warning at 25. Five failed attempts locks the account for 15 minutes.

No public account creation exists. Accounts are created by a super administrator and activated by the recipient through an invitation link.

### 4.4 Document management — Phase 2

Upload by drag-and-drop or file picker. PDF, DOCX, XLSX only, 25 MB ceiling, validated in the browser and again on the server. Metadata required before submission: document type, document date, visibility.

Three visibility levels. **Public** is downloadable by anyone. **Internal** is visible only to signed-in office accounts. **Restricted** requires super-administrator approval before it becomes visible to anyone.

Replacing a file creates a new version. Old versions are retained and remain retrievable. Nothing is ever hard-deleted; withdrawal marks a file inactive.

### 4.5 Administration — Phase 3

Account list for all 85 offices showing which are active, invited, or suspended. Moderation queue for restricted documents and public queries, each with publish and send-back-with-remarks actions. Audit log of every account change, visibility change, strength revision, and file version, showing actor, action, target, and timestamp. Usage figures: uploads over time, most-downloaded documents, offices that have never published.

### 4.6 Public queries — Phase 3

Anyone may submit a query against a published document. Queries are held for review by the issuing office and appear publicly only after approval. Basic spam filtering before queueing. The submitter leaves a name and email; the email is never published.

---

## 5. Non-functional requirements

**Accessibility.** WCAG 2.1 AA. Full keyboard operation. Visible focus states. Text contrast at 4.5:1 or better. Screen-reader labels on every control. This is a government site and accessibility is a legal obligation, not a nice-to-have.

**Bilingual.** English and Hindi across all interface text. Every user-facing string carries an `en` and `hi` pair from the start. Retrofitting this later means touching every file, so it is designed in from Phase 1 even though Hindi copy arrives in Phase 3.

**Responsive.** Mobile first. Field staff use phones and tablets. The directory and the office detail page are the two screens that must be flawless on a small screen; the admin panel may assume a desktop.

**Performance.** First meaningful paint under two seconds on a 3G connection. The directory renders 85 cards without stutter. No external CDN at runtime — every asset is bundled and served from the government host, because the deployment target may be intranet-only or air-gapped.

**Security.** HTTPS enforced. Tokens in httpOnly cookies. Every input sanitised server-side. CSRF tokens on state-changing requests. Rate limiting on sign-in. Uploaded files virus-scanned before they become downloadable and served from a path that cannot execute.

**Browsers.** Latest two versions of Chrome, Firefox, Edge, Safari. Graceful degradation below that — the directory must remain readable even where a newer CSS feature is unsupported.

---

## 6. Acceptance criteria

The build is accepted when all of the following hold.

- All 85 offices appear in the directory, with names matching `Staff_strength.xlsx` exactly.
- The summary figures read 85, 196, 253, 912 and are computed from the records, not written into the markup. Editing an office's counts changes the totals.
- Searching "Patna" returns every office stationed at Patna. Filtering organisation CRPF and station Patna together returns only offices matching both.
- CSV export contains exactly the rows currently visible after filters.
- A PAO administrator signing in reaches their own office only, and any attempt to reach another office's data returns 403 whether by URL or by API call.
- Uploading a file over 25 MB, or of a type outside PDF/DOCX/XLSX, is rejected in the browser and again at the server.
- Replacing a file produces version 2 while version 1 remains retrievable.
- A restricted document is invisible to the public until a super administrator publishes it.
- A public query is invisible until approved.
- Every account change, visibility change, and strength revision appears in the audit log with actor and timestamp.
- Keyboard-only navigation reaches every control on the directory, detail, and sign-in pages.
- The directory is usable at 360 px width.

---

## 7. Open questions

These block parts of the build and need answers from the Pr.CCA office.

1. Confirm 85 offices is correct and the "45" in the original brief was an error.
2. Supply telephone and email for each office. Without these the detail page ships with visible gaps.
3. Supply postal addresses if maps are wanted. Otherwise maps are dropped.
4. Confirm every office is Active, or supply the exceptions.
5. Review the derived station and organisation values. `Ranidanga` and `Kathgodam` are treated as stations; offices without a suffix are assumed to be New Delhi. Both assumptions need a human check.
6. Confirm who the super administrators are and how their accounts are issued.
7. Confirm the file retention policy — how long superseded versions are kept.
