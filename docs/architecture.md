# Architecture

**Project:** PCCA Portal — `pcca.mha.gov.in`
**Companion doc:** `project-requirement.md` for scope, `rules.md` for coding constraints.

---

## 1. Shape of the system

Three tiers, deliberately boring.

```
Browser  ──HTTPS──▶  Nginx  ──▶  Node/Express API  ──▶  PostgreSQL
                       │                │
                       │                └──▶  Object storage (uploaded files)
                       │                          │
                       └──── static React build   └──▶  ClamAV scan queue
```

Nginx terminates TLS, serves the built frontend as static files, and proxies `/api/*` to the Node process. The API is the only thing that touches the database or the file store. The browser never reaches storage directly — downloads are streamed through the API so permission is checked on every request.

Chosen for deployability, not fashion. The target is a government server that may be intranet-only, possibly air-gapped, administered by people who did not build this. That rules out serverless, managed-only databases, and anything that phones home at runtime. Every dependency is vendored into the build.

### Why not a framework with its own server

Next.js, Nuxt, and their kin want a Node process rendering pages. That adds a moving part to a deployment where the operator may not be able to restart a service quickly. A static bundle plus one API process fails in fewer ways, and a static bundle can be served from any web server if the Node side is down.

---

## 2. Request flows

### Public browsing — no auth

```
GET /                     → static index.html
GET /api/offices          → 200, array of 85 office records
GET /api/offices/:id      → 200, one record
GET /api/offices/:id/docs → 200, PUBLIC documents only
GET /api/docs/:id/file    → 302 to signed URL, download counter incremented
```

No token is present, so the API returns only what is public. The visibility filter is applied in the query, not after fetching — a restricted row never leaves the database on an unauthenticated request.

### Admin sign-in

```
POST /api/auth/login      { identifier, password, captchaToken }
   ├─ rate limit checked (5 per 15 min per IP + per account)
   ├─ password verified (argon2id)
   ├─ OTP generated, sent to registered mobile
   └─ 200 { challengeId }           ← no session yet

POST /api/auth/verify-otp { challengeId, code }
   └─ 200, sets two httpOnly cookies:
        access  (15 min, JWT)
        refresh (8 h, rotating, stored hashed in DB)
```

The first call never returns a session. A stolen password alone reaches nothing.

### Upload

```
POST /api/docs/init      { officeId, filename, size, mime }
   ├─ role check: super admin, or PAO admin for that office
   ├─ size ≤ 25 MB, mime in allowlist
   └─ 200 { uploadId, chunkSize }

PUT  /api/docs/:uploadId/chunk/:n   (repeat)

POST /api/docs/:uploadId/complete { type, date, visibility }
   ├─ chunks assembled, sha256 computed
   ├─ magic-byte check — real PDF/DOCX/XLSX, not a renamed file
   ├─ queued for virus scan, status = SCANNING
   └─ 202
```

Scan result decides what happens next. Clean and public, it publishes. Clean and restricted, it enters moderation. Infected, it is deleted and the uploader and super admin are notified.

### Version replacement

Replacing never overwrites. A new `document_versions` row is inserted with `version = max + 1`, and the document's `current_version_id` is repointed. Old bytes stay in storage. The audit log records both version numbers.

---

## 3. Authorisation

Three roles, checked server-side on every request. The frontend hides controls a user cannot use; that is convenience, not security.

| | Public | PAO admin | Super admin |
|---|---|---|---|
| Read office list | Yes | Yes | Yes |
| Read public docs | Yes | Yes | Yes |
| Read internal docs | No | Own office | All |
| Read restricted docs | No | Own office | All |
| Upload | No | Own office | All |
| Edit office contacts | No | Own office | All |
| Edit strength figures | No | No | Yes |
| Approve documents | No | No | Yes |
| Manage accounts | No | No | Yes |
| Read audit log | No | Own office | All |

A PAO administrator's token carries their `office_id`. Every office-scoped handler compares it to the requested office and returns 403 on mismatch — **and this comparison happens in the route handler, never inferred from a request body the client supplied.**

---

## 4. Data model

```sql
offices
  id              text PRIMARY KEY          -- 'pao-001'
  name            text NOT NULL UNIQUE      -- exact from source file
  parent_org      text NOT NULL
  station         text NOT NULL
  sr_ao           int  NOT NULL DEFAULT 0
  aao             int  NOT NULL DEFAULT 0
  acctt           int  NOT NULL DEFAULT 0
  status          text NOT NULL DEFAULT 'Active'
  phone           text                      -- null until collected
  email           text
  address         text
  derived_fields  jsonb                     -- which fields were parsed, for review
  updated_at      timestamptz NOT NULL

users
  id              uuid PRIMARY KEY
  email           text NOT NULL UNIQUE
  password_hash   text NOT NULL
  role            text NOT NULL             -- SUPER_ADMIN | PAO_ADMIN
  office_id       text REFERENCES offices   -- null for super admins
  mobile          text NOT NULL
  status          text NOT NULL             -- INVITED | ACTIVE | SUSPENDED
  CONSTRAINT pao_admin_has_office
    CHECK (role <> 'PAO_ADMIN' OR office_id IS NOT NULL)

documents
  id                  uuid PRIMARY KEY
  office_id           text NOT NULL REFERENCES offices
  title               text NOT NULL
  doc_type            text NOT NULL
  doc_date            date
  visibility          text NOT NULL         -- PUBLIC | INTERNAL | RESTRICTED
  status              text NOT NULL         -- DRAFT|SCANNING|PENDING|PUBLISHED|REJECTED|WITHDRAWN
  current_version_id  uuid
  download_count      int NOT NULL DEFAULT 0

document_versions
  id            uuid PRIMARY KEY
  document_id   uuid NOT NULL REFERENCES documents
  version       int  NOT NULL
  storage_key   text NOT NULL
  size_bytes    bigint NOT NULL
  sha256        text NOT NULL
  uploaded_by   uuid REFERENCES users
  uploaded_at   timestamptz NOT NULL
  UNIQUE (document_id, version)

queries
  id            uuid PRIMARY KEY
  document_id   uuid NOT NULL REFERENCES documents
  body          text NOT NULL
  author_name   text NOT NULL
  author_email  text NOT NULL               -- never returned to public endpoints
  status        text NOT NULL               -- PENDING | APPROVED | REJECTED

audit_log
  id            bigserial PRIMARY KEY
  actor_id      uuid REFERENCES users
  action        text NOT NULL
  target_type   text NOT NULL
  target_id     text NOT NULL
  detail        jsonb
  ip            inet
  created_at    timestamptz NOT NULL
```

Three notes on shape. `offices.id` is a readable string rather than a uuid because it appears in URLs and in exported CSVs that humans read. `derived_fields` records which values the seed script parsed rather than read, so a super admin can be shown a review list instead of guessing. `audit_log` has no update or delete path anywhere in the codebase — insert only.

### Totals are never stored

`85 / 196 / 253 / 912` are computed by aggregate query on request and cached for sixty seconds. Storing them guarantees they drift the first time someone edits an office. Any pull request that adds a `totals` column or writes these numbers into markup should be rejected.

---

## 5. Folder structure

```
pcca-portal/
├── README.md
├── docs/
│   ├── project-requirement.md
│   ├── architecture.md
│   ├── rules.md
│   ├── phases.md
│   ├── design.md
│   └── memory.md
│
├── prototype/
│   └── pcca-mha-gov-in.html      # delivered single-file demo, reference only
│
├── frontend/
│   ├── index.html
│   ├── vite.config.ts
│   ├── public/
│   │   └── fonts/                # self-hosted, no CDN
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── routes/
│       │   ├── Home.tsx
│       │   ├── Directory.tsx
│       │   ├── OfficeDetail.tsx
│       │   ├── Login.tsx
│       │   ├── Dashboard.tsx
│       │   ├── Upload.tsx
│       │   └── Admin.tsx
│       ├── components/
│       │   ├── layout/           # Header, Footer, DashShell
│       │   ├── office/           # OfficeCard, OfficeRow, StatTrio, FilterBar
│       │   ├── docs/             # DocRow, Dropzone, VisibilityBadge
│       │   └── ui/               # Button, Field, Select, Tabs, Toast, Badge
│       ├── hooks/
│       │   ├── useOffices.ts
│       │   ├── useAuth.ts
│       │   └── useDebounce.ts
│       ├── lib/
│       │   ├── api.ts            # the only fetch wrapper
│       │   ├── format.ts
│       │   └── i18n.ts
│       ├── context/
│       │   ├── AuthContext.tsx
│       │   └── LangContext.tsx
│       ├── types/
│       │   └── index.ts          # Office, Document, User, Query
│       └── styles/
│           ├── tokens.css        # design variables — see design.md
│           └── global.css
│
├── backend/
│   ├── src/
│   │   ├── server.ts
│   │   ├── routes/
│   │   │   ├── auth.routes.ts
│   │   │   ├── offices.routes.ts
│   │   │   ├── documents.routes.ts
│   │   │   ├── queries.routes.ts
│   │   │   └── admin.routes.ts
│   │   ├── controllers/
│   │   ├── services/
│   │   │   ├── auth.service.ts
│   │   │   ├── office.service.ts
│   │   │   ├── document.service.ts
│   │   │   ├── storage.service.ts
│   │   │   ├── scan.service.ts
│   │   │   └── audit.service.ts
│   │   ├── middleware/
│   │   │   ├── authenticate.ts
│   │   │   ├── authorize.ts
│   │   │   ├── rateLimit.ts
│   │   │   ├── validate.ts
│   │   │   └── errorHandler.ts   # the single error exit
│   │   ├── db/
│   │   │   ├── index.ts
│   │   │   ├── migrations/
│   │   │   └── seed/
│   │   │       ├── Staff_strength.xlsx
│   │   │       └── seedOffices.ts
│   │   ├── schemas/              # zod, shared shape with frontend types
│   │   └── utils/
│   └── tests/
│
└── deploy/
    ├── nginx.conf
    ├── docker-compose.yml
    └── .env.example
```

### Rules this structure enforces

A route file declares paths and middleware and nothing else. A controller reads the request, calls one service, shapes the response. A service holds the business logic and is the only layer that touches the database. Controllers do not write SQL. Services do not know what an HTTP request is — which is what makes them testable without spinning up a server.

`lib/api.ts` is the only place `fetch` appears in the frontend. Components call hooks, hooks call `api.ts`. A component with a raw fetch in it is a bug, because it bypasses the shared error handling and the auth refresh.

---

## 6. Tech stack

| Layer | Choice | Reason |
|---|---|---|
| Build | Vite | Fast, outputs plain static files, no runtime server |
| UI | React 18 + TypeScript | Types catch the field-name mistakes that dominate data-heavy forms |
| Routing | React Router v6 | Standard, no server requirement |
| Server state | TanStack Query | Caching, retries, and stale handling for free |
| Client state | Context API | Only auth and language are global — Redux would be overhead |
| Styling | Plain CSS + custom properties | Tokens in `design.md`, no build-time theme layer, readable by any maintainer |
| Forms | react-hook-form + zod | One schema validates in browser and on server |
| API | Node 20 + Express + TypeScript | Widely understood, easy to hand over |
| Database | PostgreSQL 15 | Constraints, transactions, JSONB where useful |
| DB access | Drizzle ORM | Typed queries, readable SQL, honest migrations |
| Auth | argon2id + JWT in httpOnly cookies | No token in localStorage |
| Files | S3-compatible (MinIO on-prem) | Works air-gapped |
| Virus scan | ClamAV | Standard, self-hosted |
| Tests | Vitest + Playwright | Unit and a thin end-to-end layer |

Deliberately absent: a component library. Chakra, MUI, and shadcn all arrive with visual opinions that then have to be fought to reach the look in `design.md`. The component set here is small — button, field, select, card, tabs, badge, toast — and writing it is cheaper than overriding someone else's.

---

## 7. Error handling path

Everything funnels to one place.

```
service throws AppError(code, httpStatus, message)
        ↓
controller does not catch — lets it bubble
        ↓
errorHandler.ts
        ├─ known AppError  → { error: { code, message } } at its status
        ├─ zod error       → 400 with field-level detail
        └─ anything else   → log full trace server-side,
                             return 500 with a generic message
```

The client never receives a stack trace, a SQL fragment, or a file path. The server always logs the real cause with a correlation id that the generic response carries, so a user can quote the id and support can find the trace.

On the frontend, `api.ts` converts a non-2xx into a typed error, TanStack Query surfaces it, and the component renders a message. A failed request shows what failed and what to do next. No silent catch blocks. See `rules.md`.

---

## 8. Deployment

```
docker compose up -d      # nginx, api, postgres, minio, clamav
```

Frontend builds to static files copied into the Nginx image. Environment comes from `.env`, never from committed files. Migrations run on deploy through a one-shot container, not from application startup, so a crash-looping app cannot half-apply a migration.

For an air-gapped target: images are exported with `docker save`, carried in, and loaded with `docker load`. No registry pull at deploy time. Fonts, icons, and every JS dependency are already inside the frontend bundle, which is why the no-CDN rule matters in `rules.md`.

Backups: nightly `pg_dump` plus object-store sync, held 30 days. Restore is rehearsed before launch, not after the first incident.
