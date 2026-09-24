/**
 * Office directory.
 *
 * The totals (85 / 196 / 253 / 912) are COMPUTED by aggregate query here.
 * They are never stored in a column and never written into markup.
 * See docs/rules.md — this is the most common wrong suggestion on this project.
 */
import { query, one } from '../db/pool.js';
import { notFound } from '../utils/AppError.js';
import { recordAudit } from './audit.service.js';

/** Columns safe to expose publicly. Note: no derived_fields, no internals. */
const PUBLIC_COLUMNS = `
  id, name, parent_org AS "parentOrg", station,
  sr_ao AS "srAO", aao, acctt, status,
  phone, email, address,
  (sr_ao + aao + acctt) AS total,
  updated_at AS "updatedAt"
`;

export async function listOffices({ search, parentOrg, station, sort = 'name', dir = 'asc' }) {
  const where = [];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    where.push(`(name ILIKE $${params.length} OR parent_org ILIKE $${params.length} OR station ILIKE $${params.length})`);
  }
  if (parentOrg) { params.push(parentOrg); where.push(`parent_org = $${params.length}`); }
  if (station)   { params.push(station);   where.push(`station = $${params.length}`); }

  // Allowlisted sort columns — the value never reaches SQL as text.
  const sortMap = {
    name: 'name', srAO: 'sr_ao', aao: 'aao',
    acctt: 'acctt', total: '(sr_ao + aao + acctt)', station: 'station',
  };
  const orderBy = sortMap[sort] ?? 'name';
  const orderDir = dir === 'desc' ? 'DESC' : 'ASC';

  const { rows } = await query(
    `SELECT ${PUBLIC_COLUMNS} FROM offices
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY ${orderBy} ${orderDir}, name ASC`,
    params
  );
  return rows;
}

export async function getOffice(id) {
  const office = await one(`SELECT ${PUBLIC_COLUMNS} FROM offices WHERE id = $1`, [id]);
  if (!office) throw notFound('No office with that code.');
  return office;
}

/** Computed on every request. Never cached into a column. */
export async function getTotals() {
  const row = await one(`
    SELECT COUNT(*)::int              AS offices,
           COALESCE(SUM(sr_ao), 0)::int AS "srAO",
           COALESCE(SUM(aao), 0)::int   AS aao,
           COALESCE(SUM(acctt), 0)::int AS acctt
      FROM offices
     WHERE status = 'Active'
  `);
  return row;
}

export async function getFacets() {
  const orgs = await query(`SELECT DISTINCT parent_org AS v FROM offices ORDER BY v`);
  const stations = await query(`SELECT DISTINCT station AS v FROM offices ORDER BY v`);
  return {
    parentOrgs: orgs.rows.map((r) => r.v),
    stations: stations.rows.map((r) => r.v),
  };
}

/** Strength by organisation — feeds the home page chart. */
export async function getStrengthByOrg() {
  const { rows } = await query(`
    SELECT parent_org AS "parentOrg",
           SUM(sr_ao + aao + acctt)::int AS total,
           COUNT(*)::int AS offices
      FROM offices
     GROUP BY parent_org
     ORDER BY total DESC
  `);
  return rows;
}

/**
 * Contact details — editable by the office's own admin.
 * Strength figures deliberately NOT editable here; only a super admin
 * may change those (see updateStrength).
 */
export async function updateContact({ officeId, phone, email, address, actor, ip }) {
  const before = await getOffice(officeId);

  const row = await one(
    `UPDATE offices SET phone = $2, email = $3, address = $4
      WHERE id = $1 RETURNING ${PUBLIC_COLUMNS}`,
    [officeId, phone ?? null, email ?? null, address ?? null]
  );

  await recordAudit({
    actorId: actor.id, actorEmail: actor.email,
    action: 'OFFICE_CONTACT_UPDATED', targetType: 'office', targetId: officeId,
    detail: {
      before: { phone: before.phone, email: before.email },
      after: { phone: row.phone, email: row.email },
    },
    ip,
  });
  return row;
}

/** Super admin only. Strength figures are the system of record. */
export async function updateStrength({ officeId, srAO, aao, acctt, status, parentOrg, station, actor, ip }) {
  const before = await getOffice(officeId);

  const row = await one(
    `UPDATE offices
        SET sr_ao = COALESCE($2, sr_ao),
            aao   = COALESCE($3, aao),
            acctt = COALESCE($4, acctt),
            status = COALESCE($5, status),
            parent_org = COALESCE($6, parent_org),
            station = COALESCE($7, station)
      WHERE id = $1
      RETURNING ${PUBLIC_COLUMNS}`,
    [officeId, srAO ?? null, aao ?? null, acctt ?? null, status ?? null, parentOrg ?? null, station ?? null]
  );

  await recordAudit({
    actorId: actor.id, actorEmail: actor.email,
    action: 'OFFICE_STRENGTH_UPDATED', targetType: 'office', targetId: officeId,
    detail: {
      before: { srAO: before.srAO, aao: before.aao, acctt: before.acctt, station: before.station },
      after: { srAO: row.srAO, aao: row.aao, acctt: row.acctt, station: row.station },
    },
    ip,
  });
  return row;
}

/** Offices whose station/organisation were parsed rather than supplied. */
export async function listDerivedForReview() {
  const { rows } = await query(`
    SELECT id, name, parent_org AS "parentOrg", station, derived_fields AS "derivedFields"
      FROM offices
     WHERE derived_fields <> '{}'::jsonb
     ORDER BY name
  `);
  return rows;
}
