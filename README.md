# PCCA Portal

**pcca.mha.gov.in** — directory and document repository for the 85 Pay & Accounts Offices under the Office of the Principal Chief Controller of Accounts, Ministry of Home Affairs.

One authoritative record per office: sanctioned strength, station, parent organisation, contacts, and the circulars that office publishes. Public browsing needs no account. Each office manages its own files.

---

## Quick start

```bash
cp .env.example .env
cd backend && npm install && npm run keys:generate   # paste output into .env
cd .. && docker compose up -d
```

Open `http://localhost:8080`. Full instructions, demo credentials, and the government deployment path are in **[DEPLOYMENT.md](DEPLOYMENT.md)**.

---

## What is here

```
pcca-portal/
├── README.md               you are here
├── DEPLOYMENT.md           local setup, domain acquisition, gov hosting
├── docs/system-requirements.txt  system and package requirements
├── .env.example            every setting, documented
├── docker-compose.yml      db + clamav + api + nginx
│
├── backend/                Node 20 + Express + PostgreSQL
│   ├── src/
│   │   ├── server.js           helmet, CORS, rate limits, one error exit
│   │   ├── config/env.js       fail-fast config; refuses placeholder secrets
│   │   ├── db/
│   │   │   ├── schema.sql      tables, constraints, insert-only audit log
│   │   │   ├── migrate.js      idempotent; run as a one-shot task
│   │   │   ├── seed.js         85 offices; verifies totals or refuses
│   │   │   └── offices.seed.json
│   │   ├── middleware/         auth, validate, rateLimit, errorHandler
│   │   ├── routes/             auth, offices, documents, queries, admin
│   │   ├── services/           all business logic; only layer touching SQL
│   │   └── utils/              logger (with redaction), AppError
│   └── scripts/generate-secrets.js
│
├── frontend/public/
│   ├── index.html          the portal — self-contained, no build step
│   └── assets/api.js       the only place the frontend calls fetch()
│
├── deploy/
│   ├── nginx.conf          TLS, CSP, rate limits, upload ceiling
│   ├── Dockerfile.api      non-root, healthchecked
│   └── Dockerfile.web
│
└── docs/
    ├── project-requirement.md   scope, users, features, acceptance criteria
    ├── architecture.md          flows, data model, folder structure, stack
    ├── rules.md                 what to do, what not to, AI boundaries
    ├── phases.md                phased delivery plan
    ├── design.md                colour, type, spacing, components
    └── memory.md                progress log — read this first
```

---

## The data

Seeded from `Staff_strength.xlsx`: **85 offices, 196 Sr. AOs, 253 AAOs, 912 Sr. Accountants/Accountants.** The seed script verifies these figures and refuses to complete if they do not match.

Two caveats, both recorded in `derived_fields` on every office row so they surface in the super administrator's review list rather than being quietly trusted:

**Station and parent organisation are parsed from office names**, not supplied. `RPAO(CISF), Kolkata` yields CISF and Kolkata. Offices with no location suffix default to New Delhi (HQ). All 85 need a human check.

**Contact details do not exist in the source.** Phone, email and address render as "Not yet filled in" until each office supplies them. They are never invented — see `docs/rules.md`.

Office names are never normalised. `Bangaluru` stays as the source spells it, because the name is the join key.

---

## Security

What the design refuses to do, as much as what it does.

Passwords are argon2id. Sign-in is two steps — verifying a password creates a challenge, not a session, so a stolen password alone reaches nothing. Tokens live in httpOnly, Secure, SameSite=strict cookies; JavaScript cannot read them, so an XSS hole is not also a session theft. Refresh tokens are stored hashed and rotate on use; presenting a revoked one revokes every session that user has, because that means it was replayed.

Office scope comes from the signed token, never from the request. A PAO administrator sending another office's ID in a body or a URL gets an identical 403 whether that office exists or not, so the endpoint cannot be used to enumerate offices.

Document visibility is applied in the SQL query, not filtered after fetching — a restricted row never leaves the database on a public request. Downloads stream through the API so permission is checked per request; the browser never touches storage.

Uploads are checked by magic bytes, not extension. A shell script renamed `.pdf` is rejected and the attempt is audited. Files are virus-scanned before becoming downloadable, and when ClamAV is not configured the version records `SKIPPED` honestly rather than claiming `CLEAN`.

Nothing is hard-deleted. Documents are withdrawn, users suspended, versions superseded. The audit log is insert-only and is written from exactly one module.

The frontend holds no secrets, no API keys, and no role logic that decides access. It decides what to draw; the server decides what is permitted. Logs redact passwords, tokens, OTPs and cookies. Nothing loads from a CDN, and there is no analytics or telemetry of any kind — citizens' browsing of a government site is not ours to transmit.

The application refuses to start with placeholder secrets, with identical access and refresh secrets, or with `DEMO_MODE=true` under `NODE_ENV=production`.

---

## Status

Backend complete and verified — boots clean, security headers confirmed, guards return correct shapes, magic-byte detection and argon2 hashing tested. Frontend delivered as a working single-file portal wired to the API, falling back to embedded data when the API is absent.

Not yet done: the React rebuild described in `docs/phases.md`, Hindi content, SMS gateway integration, and the GIGW mandatory pages. Current progress and open blockers are tracked in `docs/memory.md` — read it before starting work.
