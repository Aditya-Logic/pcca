# Rules

Constraints for anyone — human or AI assistant — writing code on this project.
Read `architecture.md` first for the structure these rules protect.

---

## 1. Libraries

### Use these

| Need | Use | Not |
|---|---|---|
| Build | Vite | CRA, Webpack by hand, Next.js |
| UI | React 18 + TypeScript | Vue, Svelte, jQuery |
| Routing | React Router v6 | A hand-rolled hash router |
| Server state | TanStack Query | `useEffect` + `fetch` |
| Client state | Context API | Redux, Zustand, MobX |
| Forms | react-hook-form + zod | Formik, Yup, uncontrolled `<form>` |
| Styling | Plain CSS + custom properties | Tailwind, styled-components, Emotion |
| Dates | `date-fns` | Moment.js |
| Tables | Hand-written | AG Grid, TanStack Table |
| Icons | Inline SVG in `components/ui/icons` | Icon font packages |
| API | Express + TypeScript | Fastify, NestJS, Koa |
| DB | Drizzle ORM + PostgreSQL | Prisma, raw `pg` strings, TypeORM |
| Passwords | argon2 | bcrypt, anything hand-rolled |
| Validation | zod, shared browser and server | Two separate validators |
| Tests | Vitest, Playwright | Jest, Cypress, Enzyme |

### Adding anything not on that list

Justify it in the pull request against these four questions. If any answer is no, do not add it.

1. Does it do something we would otherwise write more than 200 lines to do?
2. Is it maintained, and does it have no known unpatched advisories?
3. Does it work offline at runtime, with nothing fetched from a CDN?
4. Does it ship under 50 kB gzipped?

Prefer thirty lines of our own code to a dependency. Every package is something a maintainer in three years has to understand, patch, and justify to an auditor.

### Never

- Anything loading from a CDN at runtime. Bundle it. The deployment may be air-gapped, and a CDN reference to a government site is also a third-party request the security review will reject.
- Analytics, session recording, or telemetry of any kind. Citizens' browsing of a government site is not ours to send anywhere.
- Deprecated or unmaintained packages.
- A package that pulls in more than ten transitive dependencies for a small job.

---

## 2. Hard prohibitions

**Never store the totals.** 85, 196, 253, 912 are computed from the records. Do not add a `totals` column, a constants file, or a number typed into JSX. The moment an office is edited, a stored total is a lie. Any diff containing `const TOTAL_SR_AO = 196` is rejected.

**Never trust the client for authorisation.** Hiding a button is not a permission check. Every office-scoped handler compares the token's `office_id` against the requested office server-side. Never read the office from a request body the client supplied.

**Never hard-delete.** Documents are withdrawn, users are suspended, versions are superseded. `DELETE FROM` appears nowhere outside migrations. This is a government record system; deletion is a compliance problem, not a feature.

**Never write to the audit log from anywhere but `audit.service.ts`.** And never update or delete a row in it.

**Never put a token in `localStorage` or `sessionStorage`.** httpOnly cookies only. An XSS hole should not also be a session theft.

**Never log a password, token, OTP, or full file content.** Log identifiers, not payloads.

**Never trust a file extension.** Check magic bytes. A `.pdf` that is actually a script is the obvious attack on an upload portal.

**Never serve uploaded files from a path that can execute**, and never serve them straight from storage. Stream through the API so permission is checked per request.

**Never expose `queries.author_email` on a public endpoint.** It is collected for reply, not publication.

**Never commit a secret.** `.env` is gitignored; `.env.example` carries the key names with empty values.

---

## 3. Error handling

### The shape

Services throw. Controllers do not catch. One middleware converts everything to a response.

```ts
// service — throws a typed error, knows nothing about HTTP responses
if (!office) {
  throw new AppError('OFFICE_NOT_FOUND', 404, 'No office with that code.');
}

// controller — no try/catch, lets it bubble
export async function getOffice(req: Request, res: Response) {
  const office = await officeService.getById(req.params.id);
  res.json(office);
}
```

### Rules

**Never swallow an error.** `catch {}` and `catch (e) { console.log(e) }` are both bugs. Either handle it meaningfully or let it bubble to the handler.

**Never return an internal detail to the client.** No stack traces, no SQL, no file paths, no dependency names. Log the real cause with a correlation id; return the id and a message a clerk can read.

**Catch only when you add something.** A `try/catch` that rethrows unchanged is noise. Catch to add context, to convert a third-party error into an `AppError`, or to clean up a resource.

**Every message tells the user what to do.** "Invalid input" is useless. "File must be PDF, DOCX or XLSX, and under 25 MB" tells them how to succeed.

**Fail loudly at boot.** A missing environment variable exits the process on startup. It does not default to something plausible and surface as a mystery at 2 a.m.

**Frontend errors are visible.** Every query that can fail renders an error state with a retry. An empty list because the request failed must never look like an empty list because there are no results — these are different states and the user has to be able to tell them apart.

**Wrap each route in an error boundary**, so one broken component does not blank the page.

---

## 4. TypeScript

`strict: true`, and `noUncheckedIndexedAccess: true`.

Never `any`. If a type is genuinely unknown, use `unknown` and narrow it. Never `as` to silence the compiler — if a cast feels necessary, the type is wrong. Never `@ts-ignore` without a comment explaining the upstream bug and a link.

Types for API shapes live in `types/index.ts` and are derived from the zod schemas, so the validator and the type cannot drift apart.

---

## 5. Code conventions

Components stay under 200 lines. Past that, split. Functions stay under 50.

One component per file, named the same as the file. Props typed with an explicit interface, never inline.

No magic numbers. `MAX_UPLOAD_BYTES = 25 * 1024 * 1024` in a constants file, not `26214400` in three places.

No commented-out code. Version control remembers it.

Comments explain why, not what. `// increment i` is noise. `// station is parsed from the name suffix, so it may be wrong — see derived_fields` is worth keeping.

Semantic HTML. `<button>` for actions, `<a>` for navigation. A `<div onClick>` is not keyboard reachable and fails the accessibility requirement.

Every interactive element is reachable by keyboard with a visible focus state. Every input has a real `<label>`. Every image has meaningful `alt`, or `alt=""` if decorative.

Every user-facing string goes through `i18n.ts` with an `en` and `hi` key, from the first line of code. Hindi copy lands in Phase 3, but the keys exist from Phase 1 — retrofitting means touching every file.

---

## 6. Git

Branches: `feature/directory-filters`, `fix/upload-size-check`, `chore/bump-deps`.

Commits in imperative mood, explaining why where it is not obvious. `fix: reject renamed executables by checking magic bytes` beats `fixed bug`.

No direct commits to `main`. Every change arrives by pull request, with tests passing, no new TypeScript errors, and `memory.md` updated in the same PR.

---

## 7. Boundaries for AI assistants

Anyone using an AI assistant on this repository operates under these additional rules. They exist because the failure modes of generated code on this project are specific and predictable.

### Always

**Read `memory.md` first**, at the start of every session, before writing anything. It records what is done, what is in progress, and what is deliberately deferred. Starting without it produces work that duplicates or contradicts what exists.

**Update `memory.md` in the same change**, not at the end of the week. Record what was completed, what file is open, and what is blocked.

**Say when something is unknown.** "The contact fields are not in the source data, so I cannot populate them" is a correct and useful answer. Inventing a phone number is not.

**Ask before changing the data model, adding a dependency, or altering an auth path.** These three areas are where a plausible-looking change causes the most damage.

**Match the existing style.** Read a neighbouring file before writing a new one. A file that is internally excellent but stylistically foreign makes the codebase harder to read.

### Never

**Never invent data.** The source file has no phone numbers, emails, addresses, or establishment dates. Those fields render as "Not yet filled in". Never fill a gap with a realistic-looking placeholder — it will be mistaken for real, and in a government directory that means someone calls a number that does not exist. Sample documents in the prototype are labelled as illustrative; never let sample content leak into anything described as real.

**Never change the office names.** They come from `Staff_strength.xlsx` and are the join key. Do not normalise capitalisation, expand abbreviations, fix apparent typos, or standardise spacing. `Bangaluru` stays as it is written in the source. If a name looks wrong, flag it; do not correct it.

**Never silently alter the derived logic.** Station and parent organisation are parsed from name strings. That parsing is a documented guess recorded in `derived_fields`. Changing the rules changes 85 records at once. Propose, do not apply.

**Never generate code that stores computed totals.** Covered above; it is the single most common suggestion an assistant makes on this project and it is always wrong here.

**Never weaken a security control to make a test pass.** If a check blocks a test, the test is wrong or the feature is wrong. Loosening the check is neither fix.

**Never add a dependency to avoid writing thirty lines.** Section 1 applies to generated code identically.

**Never produce code you cannot explain.** If asked why a line exists and the answer is that it appeared in the output, delete it.

**Never mark something complete that has not been run.** "Should work" is not done. `memory.md` records tested state, not intent.

**Never expand scope unasked.** A request to fix the filter is not licence to restructure the directory. Note the improvement separately and leave the change alone.

### On generated volume

An assistant can produce a thousand lines in a minute, and all thousand have to be reviewed by a person who will maintain them for years. Prefer the smaller change. A hundred lines that are read carefully are worth more here than a thousand that are skimmed and merged.
