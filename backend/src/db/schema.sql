-- ============================================================
-- PCCA Portal — schema
-- pcca.mha.gov.in
--
-- Design notes:
--   * Nothing is ever hard-deleted. Rows are withdrawn/suspended.
--   * audit_log is insert-only. No UPDATE or DELETE path exists in code.
--   * Totals (85/196/253/912) are NEVER stored. They are computed.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- offices ----------
CREATE TABLE IF NOT EXISTS offices (
  id              text PRIMARY KEY,
  name            text        NOT NULL UNIQUE,
  parent_org      text        NOT NULL,
  station         text        NOT NULL,
  sr_ao           integer     NOT NULL DEFAULT 0 CHECK (sr_ao   >= 0),
  aao             integer     NOT NULL DEFAULT 0 CHECK (aao     >= 0),
  acctt           integer     NOT NULL DEFAULT 0 CHECK (acctt   >= 0),
  status          text        NOT NULL DEFAULT 'Active'
                    CHECK (status IN ('Active', 'Inactive')),
  phone           text,
  email           text,
  address         text,
  -- records which fields the seed parsed rather than read from source,
  -- so a super admin can review them instead of trusting the parser
  derived_fields  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offices_org     ON offices (parent_org);
CREATE INDEX IF NOT EXISTS idx_offices_station ON offices (station);

-- ---------- users ----------
CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text        NOT NULL UNIQUE,
  password_hash   text        NOT NULL,
  full_name       text        NOT NULL,
  role            text        NOT NULL CHECK (role IN ('SUPER_ADMIN', 'PAO_ADMIN')),
  office_id       text        REFERENCES offices (id) ON DELETE RESTRICT,
  mobile          text,
  status          text        NOT NULL DEFAULT 'INVITED'
                    CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED')),
  failed_attempts integer     NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- a PAO admin is meaningless without an office; a super admin must not have one
  CONSTRAINT role_office_consistency CHECK (
    (role = 'PAO_ADMIN'   AND office_id IS NOT NULL) OR
    (role = 'SUPER_ADMIN' AND office_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_users_office ON users (office_id);

-- ---------- login challenges (OTP second step) ----------
-- A verified password creates a challenge, NOT a session.
CREATE TABLE IF NOT EXISTS login_challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  otp_hash    text        NOT NULL,
  attempts    integer     NOT NULL DEFAULT 0,
  consumed    boolean     NOT NULL DEFAULT false,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_challenges_user ON login_challenges (user_id);

-- ---------- refresh tokens ----------
-- Stored hashed. A database leak does not yield usable sessions.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  text        NOT NULL UNIQUE,
  revoked     boolean     NOT NULL DEFAULT false,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens (user_id);

-- ---------- documents ----------
CREATE TABLE IF NOT EXISTS documents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id          text        NOT NULL REFERENCES offices (id) ON DELETE RESTRICT,
  title              text        NOT NULL,
  doc_type           text        NOT NULL,
  doc_date           date,
  visibility         text        NOT NULL DEFAULT 'RESTRICTED'
                       CHECK (visibility IN ('PUBLIC', 'INTERNAL', 'RESTRICTED')),
  status             text        NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('DRAFT','SCANNING','PENDING','PUBLISHED','REJECTED','WITHDRAWN')),
  current_version_id uuid,
  download_count     integer     NOT NULL DEFAULT 0,
  uploaded_by        uuid        REFERENCES users (id) ON DELETE SET NULL,
  moderated_by       uuid        REFERENCES users (id) ON DELETE SET NULL,
  moderation_remark  text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_docs_office     ON documents (office_id);
CREATE INDEX IF NOT EXISTS idx_docs_visibility ON documents (visibility, status);

-- ---------- document versions ----------
-- Replacement inserts a new row. Old bytes are retained.
CREATE TABLE IF NOT EXISTS document_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid        NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  version      integer     NOT NULL,
  storage_key  text        NOT NULL,
  original_name text       NOT NULL,
  mime_type    text        NOT NULL,
  size_bytes   bigint      NOT NULL,
  sha256       text        NOT NULL,
  scan_status  text        NOT NULL DEFAULT 'PENDING'
                 CHECK (scan_status IN ('PENDING', 'CLEAN', 'INFECTED', 'SKIPPED')),
  uploaded_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_current_version_fk;
ALTER TABLE documents
  ADD CONSTRAINT documents_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES document_versions (id) ON DELETE SET NULL;

-- ---------- public queries ----------
CREATE TABLE IF NOT EXISTS queries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid        NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  body          text        NOT NULL,
  author_name   text        NOT NULL,
  -- NEVER returned by a public endpoint. Collected for reply only.
  author_email  text        NOT NULL,
  status        text        NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  moderated_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_queries_doc ON queries (document_id, status);

-- ---------- audit log ----------
-- Insert only. No code path updates or deletes from this table.
CREATE TABLE IF NOT EXISTS audit_log (
  id          bigserial PRIMARY KEY,
  actor_id    uuid        REFERENCES users (id) ON DELETE SET NULL,
  actor_email text,
  action      text        NOT NULL,
  target_type text        NOT NULL,
  target_id   text        NOT NULL,
  detail      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor   ON audit_log (actor_id);

-- ---------- updated_at trigger ----------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_offices_touch ON offices;
CREATE TRIGGER trg_offices_touch BEFORE UPDATE ON offices
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_users_touch ON users;
CREATE TRIGGER trg_users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_docs_touch ON documents;
CREATE TRIGGER trg_docs_touch BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
