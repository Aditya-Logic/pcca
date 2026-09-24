# Design

The visual system for `pcca.mha.gov.in`. Every token here is already implemented in the prototype's `:root` block and carries over verbatim into `frontend/src/styles/tokens.css`.

---

## 1. What this should feel like

A civil service record, not a product. The people using this are looking something up — an office, a circular, a strength figure — and the interface's job is to get out of the way. Restraint reads as authority here. Anything that looks like a startup dashboard undermines the thing.

Three commitments follow from that:

**Data first.** The three cadre counts are visible on every card without a click. Nothing decorative may push them below the fold.

**Quiet colour.** Navy and brass carry the institutional register. Colour identifies and separates; it never decorates. There are no gradients on content surfaces, no colour used for emphasis where weight would do.

**Density without crowding.** 85 offices on one screen means compact cards — but generous line height and clear separation, because these get read on a phone in a field office.

---

## 2. Colour

### Core palette

| Token | Value | Used for |
|---|---|---|
| `--navy-900` | `#0a2647` | Header, footer, sidebar, headings, hero base |
| `--navy-800` | `#10345c` | Hero gradient end, mobile nav panel |
| `--navy-700` | `#17426f` | Links, chart bars, input focus border |
| `--brass-600` | `#b1791f` | Primary buttons, header rule, active tab, focus ring |
| `--brass-500` | `#c8892a` | Button hover, hero eyebrow text |
| `--paper` | `#f3f5f8` | Page background |
| `--panel` | `#ffffff` | Cards, panels, toolbars |
| `--ink` | `#16202a` | Body text |
| `--slate` | `#55636f` | Secondary text, labels |
| `--slate-light` | `#8894a0` | Metadata, timestamps, empty-field notes |
| `--line` | `#dbe1e7` | Borders, input outlines |
| `--line-soft` | `#eaeef2` | Row dividers, internal separators |

Navy is the Ministry's institutional register. Brass rather than saffron or green — it reads formal without invoking the flag, which would be inappropriate on a departmental portal.

### Status

| Token | Value | Meaning |
|---|---|---|
| `--success` / `--success-bg` | `#1e7145` / `#e7f3ec` | Active office, public document |
| `--alert` / `--alert-bg` | `#a32423` / `#fbeaea` | Restricted document, failure |
| — | `#8a5a00` on `#fff4e0` | Internal-only document |
| — | `--slate` on `#eef1f5` | Pending moderation |

Status always pairs colour with text. "Public" is a word on a badge, not a green dot — colour alone excludes colour-blind users and fails the accessibility requirement.

### Organisation identity

Each card carries a 4 px left border keyed to its parent organisation, so the eye can group a filtered list without reading every name.

| Organisation | Token | Value |
|---|---|---|
| CRPF | `--force-crpf` | `#8a3324` |
| BSF | `--force-bsf` | `#1e5a8a` |
| CISF | `--force-cisf` | `#4a5d23` |
| ITBP | `--force-itbp` | `#6b3fa0` |
| SSB | `--force-ssb` | `#a35d00` |
| NSG | `--force-nsg` | `#1c1c1c` |
| IB | `--force-ib` | `#0a2647` |
| All others | `--force-other` | `#55636f` |

Seven named because those are the organisations with enough offices for the grouping to help. The remaining sixteen share the neutral — an arbitrary colour each would turn the grid into confetti.

This border is redundant reinforcement. The organisation is always also printed as a text tag on the card.

### Contrast

Body `--ink` on `--panel` is 14.8:1. Secondary `--slate` on `--panel` is 6.9:1. `--slate-light` is 3.6:1 and is therefore restricted to metadata at 0.76 rem or larger, never body text. White on `--navy-900` is 14.2:1; white on `--brass-600` is 4.6:1. All pass AA.

---

## 3. Typography

Two families, both open-licensed and self-hosted. No CDN — the deployment may be air-gapped, and a font request to a third party is a privacy leak on a government site.

```css
--font-head: "Source Serif 4", "Noto Serif", Georgia, serif;
--font-body: "IBM Plex Sans", "Noto Sans", -apple-system, sans-serif;
```

**Source Serif 4** for headings and for every number. A serif at heading weight reads as official in a way a geometric sans does not, and Source Serif's figures are well-proportioned at display size — which matters, because the numerals here are the content.

**IBM Plex Sans** for body, labels, and controls. Designed for interfaces, unambiguous at small sizes, and its `1`/`l`/`I` and `0`/`O` are properly distinct. In a directory full of codes and counts, that is a functional requirement.

Both have Devanagari companions — Noto Serif Devanagari and IBM Plex Sans Devanagari — which is why they were chosen over alternatives. The Hindi interface in Phase 4 does not need a different type system.

### Scale

| Element | Size | Weight | Family |
|---|---|---|---|
| Hero heading | `clamp(1.9rem, 3.2vw, 2.7rem)` | 600 | Head |
| Section heading | `clamp(1.4rem, 2vw, 1.9rem)` | 600 | Head |
| Panel heading | 1.05–1.15 rem | 600 | Head |
| Card title | 1 rem | 600 | Head |
| Body | 1 rem / 1.55 | 400 | Body |
| Card stat figure | 1.15 rem | 600 | Head |
| KPI figure | 1.6–1.9 rem | 600 | Head |
| Label | 0.85 rem | 500 | Body |
| Metadata | 0.76–0.83 rem | 400 | Body |
| Tag / badge | 0.68–0.7 rem | 400 | Body |

Headings clamp so they scale with the viewport without a media query at every step. Body stays at 1 rem everywhere — shrinking body text on mobile is the wrong instinct.

Body line height 1.55. Headings 1.2. Prose capped at 62 characters.

### Numerals

Every figure — cadre counts, KPIs, chart values, totals — is set in Source Serif 4 at 600. This is the one consistent typographic signal in the system: if it is a number that matters, it is in the serif. It separates data from label at a glance without any colour.

---

## 4. Space and layout

4 px base. Card padding 16–18 px, panel padding 20–22 px, section rhythm 56 px, container padding 28 px, max width 1240 px.

Border radius is 3 px everywhere. Nearly square. Rounded corners read as consumer software; sharp corners read as a document. The one exception is badges and pills at 20 px, where the shape itself is the affordance.

Two shadows only, both navy-tinted rather than grey so they sit in the palette:

```css
--shadow-sm: 0 1px 2px rgba(10, 38, 71, 0.08);
--shadow-md: 0 4px 16px rgba(10, 38, 71, 0.10);
```

`sm` for resting elevation, `md` for hover and for the summary band that overlaps the hero. Nothing floats higher than that.

### Breakpoints

| Width | Directory grid | Layout |
|---|---|---|
| ≥ 1024 px | 4 columns | Sidebar visible, KPIs 4-up |
| 860–1023 px | 3 columns | Sidebar visible, KPIs 4-up |
| 560–859 px | 2 columns | Sidebar becomes a horizontal strip, nav collapses to a menu, KPIs 2-up |
| < 560 px | 1 column | Toolbar stacks, footer single column |

The grid uses `repeat(auto-fill, minmax(272px, 1fr))` rather than fixed column counts, so it reflows continuously instead of jumping at thresholds. 272 px is the narrowest a card can be while still fitting the three stat figures side by side.

At 860 px and below the list view drops the organisation and station columns, keeping office name and the three counts. Those four are the irreducible content.

---

## 5. Components

**Card.** White panel, 1 px `--line` border, 4 px organisation-coloured left border, 3 px radius. Title and organisation tag on one row, station beneath, then a three-column stat block separated by a hairline rule. Status pill at the base. Hover lifts 1 px and raises the shadow.

**Buttons.** Primary is solid brass on white text. Ghost is transparent with a white border, for use on navy. Outline is transparent with a `--line` border and navy text, for secondary actions on light surfaces. 11 px by 22 px, 2 px radius, 0.94 rem.

**Inputs.** 1 px `--line` border, 2 px radius, 9–10 px padding. Focus moves the border to `--navy-700`. Labels sit above at 0.85 rem / 500 — never placeholder-as-label, which disappears the moment someone types.

**Tabs.** Text buttons with a 2 px bottom border. Active is brass with weight 600. No background fill.

**Badges.** Pill at 20 px radius, 0.7 rem, tinted background with matching darker text. Always carries a word.

**Toast.** Bottom-right, navy panel, 3 px brass left border, 2.6 second dismiss. Confirmation only — anything requiring a decision gets a real interface, not a toast.

**Bar chart.** 7 px track in `--line-soft`, fill in `--navy-700` or `--brass-600`, label and value above. Deliberately not a charting library — these are proportional bars, and 40 lines of CSS beats a 200 kB dependency. See `rules.md`.

---

## 6. Accessibility

Focus is a 2 px `--brass-600` outline at 2 px offset, on every interactive element. It is never removed. Brass was chosen partly because it is visible against both the navy header and the white panels.

A skip link to `#main` is the first focusable element on the page.

Every interactive element is a real `<button>` or `<a>`. Every input has a `<label>` with a matching `for`. Every icon-only control has an `aria-label`.

Colour never carries meaning alone. Every status has a word; every organisation colour is duplicated as a text tag.

`prefers-reduced-motion: reduce` disables all transitions and animations globally.

Minimum touch target 44 × 44 px on mobile.

---

## 7. Implementing this

Tokens live in `frontend/src/styles/tokens.css` and are the single source. Never write a hex value in a component file — if a colour is needed that is not a token, either an existing token fits or a new token is proposed.

No Tailwind, no CSS-in-JS. Plain CSS with custom properties, per `rules.md`. The maintainer in three years can open a stylesheet and read it without learning a build-time abstraction first.

The prototype at `prototype/pcca-mha-gov-in.html` is the reference implementation of every token and component here. When a written description and the prototype disagree, the prototype is correct and this document should be corrected.
