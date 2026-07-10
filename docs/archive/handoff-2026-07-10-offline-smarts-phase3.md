# Handoff — Offline-Smarts Plan: Phase 3 DONE (2026-07-10)

**Plan:** `.claude/prompts/plan-2026-07-10-offline-smarts.md`
**Builds on:** `docs/archive/handoff-2026-07-10-offline-smarts-phase1.md` (Phases 0–1).
**Next up (per the plan's order):** Phase 2 — descriptive stats + clinical formats (Sonnet).

## What shipped (Phase 3 — everyday-word matching)

The matcher understood column *names*; now it understands the everyday words people
type for them. All new matches are **stretches → a "did you mean this column?"
confirm-chip**, never a silent answer. Pure nonsense still declines.

New files:
- `src/logic/offline/wordforms.js` — folds verb/noun/plural forms to one canonical
  token via a small curated FAMILIES table (treated↔treatment, prescribed↔prescription,
  diagnoses↔diagnosis) + conservative plural stripping. Deliberately NOT a general
  stemmer; keeps `prescriber` (person/column) apart from `prescription` (drug record).
- `src/logic/offline/concepts.js` — CONCEPT seed groups (duration / drug / diagnosis /
  patient / prescriber / lab / date). `conceptColumnCandidates()` proposes ranked header
  candidates by concept overlap; `valueContentCandidates()` is the value-content hint (a
  column whose *values* look like the asked concept, e.g. "antibiotic" → a Med_A column
  full of amoxicillin). `isConceptWord()` gates resolution.
- `src/logic/offline/aliasStore.js` — the **persistent learned-alias store** (see below).

Changed:
- `matcher.js` — new `resolveColumnRef()` (alias → exact → concept → value-content, with
  a strict "no foreign word" gate) drives the aggregation target, group-by, and threshold
  column. A concept hit becomes a `needs_confirm` with `kind:"column"` candidates.
  Filler verbs (`treated`, `prescribed`, …) no longer count as residue that blocks, and
  are stripped before the threshold's exact column match.
- `runOffline.js`/`App.jsx` — thread `columnAliases` through; the confirm box renders
  column chips ("the \"Duration_days\" column"); confirming a column chip persists the
  alias and re-runs immediately.
- `valueMatch.js` — folding is intentionally NOT applied to cell-value scoring (it caused
  "patients" → PatientID false hits); folding lives only in the concept layer.

## What now works that didn't before

- "how long were patients treated on average", "average treatment length",
  "average duration of therapy" → ask "the Duration_days column?" then answer
  (previously: flat decline "couldn't tell which column").
- "how many patients per condition" → offers a Diagnosis group-by chip.
- "how many patients were treated for more than 7 days" → offers a Duration_days
  threshold chip (previously: blocked on "treated … more than" as residue).
- Confirming any chip **teaches** the app: the same wording answers directly next time,
  across sessions.

## Alias-store design (privacy boundary)

- **Where:** `localStorage["tidytable_column_aliases"]`, loaded into App state.
- **What:** `{ version, files: { [fileSignature]: { [foldedPhrase]: columnName } } }`.
  `fileSignature` = sorted folded column keys (schema only), so an alias learned for one
  spreadsheet's shape never bleeds onto an unrelated file.
- **Privacy:** stores ONLY column names + the folded phrase the user typed — **never a
  cell value**. Value confirmations ("e coli" → "ESCHERICHIA COLI") stay session-only in
  the in-memory aliasMap and are deliberately not persisted. A test serializes the store
  and asserts no example cell value (amoxicillin, UTI, P1, Dr. Alavi, …) can appear.

## Tests

- Before: **484**. After: **510** (+26). All green; full `npm test` passes; `npm run build`
  clean.
- `src/logic/offline/phase3-everyday-words.test.js` (23) — folding, concepts,
  value-content, filler verbs, alias-store persistence + privacy + per-shape isolation,
  and non-regression (nonsense declines; "uti duration" still splits, not concept-grabbed).
- `src/phase3-column-alias.dom.test.jsx` (3) — user-visible: chip appears (no silent
  answer), clicking it answers, re-asking no longer asks (persisted, no cell values).
- Phase 1 honesty banks untouched and green.

## Judgment calls & deferrals

- **Folding not applied to value scoring** — the plan suggested folding in
  `valueMatch.js` token scoring, but that regressed real matches ("patients" depluraled
  into "PatientID") and risks false positives. Per the "false positives worse than misses"
  guardrail, folding is confined to the concept layer where it's gated.
- **Concept resolution is gated**: it fires only when every non-stop word is a concept
  word or a filler verb (no foreign word like "uti"/"per"), so a stray word forces the
  fall-through to exact/value/compound machinery instead of a low-signal confirm.
- **Candidate lists preserved & ranked** on every stretch (`candidates` top-3), ready for
  Phase 5's "no → better guess" loop; the UI shows the top one for now.
- **Deferred (Phase 4/5 territory):** concept-as-a-cohort-filter phrasings —
  "how many patients got an antibiotic" and "how many prescriptions" still block, because
  what they filter to (non-blank? any drug?) is genuinely ambiguous and belongs with the
  top-N / count-of-entity family.

## State checkpoint

- Shipped as branch `phase/3-everyday-words` → merged to main → pushed (direct push
  allowed on TidyTable). 510 tests green.
