# ADR 0003 — ConceptStore: one deep module for concept identity + metadata

Date: 2026-07-10

## Status

Accepted. Implemented in `src/main/concept-store.ts`.

> Note: source comments and `README.md` reference ADR 0001 (model-fetch
> graceful degradation) and ADR 0002 (OKF wiki studio architecture), but
> those files are not present in `docs/adr/`. This is the first ADR actually
> committed; the 0001/0002 gap is tracked separately and should be closed by
> reconstructing those decisions from the code comments that cite them.

## Context

Three main-process modules each reimplemented the same wiki-concept machinery:

- `wiki-scan.ts` — `walk()`, `RESERVED`, `isConcept`, `conceptId`, hashing
- `wiki-graph.ts` — `walk()`, `conceptId`, `loadConcept` (frontmatter parse),
  `toConceptId` (link normalization)
- `files.ts` — `walk()`, `RESERVED`, `conceptId` derivation, `ConceptInfo`
  from frontmatter

The knowledge of *what a concept is, how to name it (conceptId), which files
are reserved, and how to read its frontmatter metadata* was smeared across
three shallow modules. Each module's interface was nearly as wide as its
implementation (depth ≈ 0). The real bugs hid in the *differences* between the
copies (e.g. `wiki-scan`/`files` treat `sub/index.md` as reserved by basename,
while `wiki-graph`'s `specialFileType` only matches top-level `index`/`log`
by conceptId).

This surfaced during an architecture review as candidate C1; the deletion test
passed unambiguously — deleting the three copies and concentrating them
*concentrates* complexity rather than moving it.

## Decision

Introduce **ConceptStore** — one deep module that owns concept identity,
metadata, and body for a workspace's `wiki/`. Its interface is the test surface
for everything concept-shaped:

```ts
class ConceptStore {
  listConcepts(): Promise<readonly Concept[]>;   // excludes reserved (kind === "concept")
  listAll(): Promise<readonly Concept[]>;         // includes index/log, tagged with kind
  readConcept(relativePath: string): Promise<Concept | null>;  // single wiki .md
  normalizeRef(ref: string): string | null;       // shared link/path → conceptId
}
```

`Concept = { conceptId, kind, title, type, description, tags, body, frontmatterType }`.

Callers thin to their actual unique work (their own policies, not concept
knowledge):

- `wiki-scan` — hashes `body` and diffs snapshots (`diffSnapshots` stays:
  diffing is a caller policy). `listInputFiles` keeps its own `input/` walk
  (a different folder, a different shape — relative paths only).
- `wiki-graph` — extracts links (graph policy) via its own `extractLinks`, but
  normalizes each ref through `store.normalizeRef` so the `wiki/` + `.md`
  stripping rule is not duplicated. Keeps `specialFileType` to localize the
  `index`/`log` labels — **graph vocabulary stays out of the store**; the store
  tags `kind` only.
- `files.ts` — `getPreview` delegates wiki `.md` reads to `readConcept`; drops
  its `RESERVED` set and frontmatter parsing. Keeps `safeResolve`, the
  text/binary fallback for non-wiki files, `listFolder` (its own `FileNode`
  walk — different shape, with `size`), `addInputFiles`, `revealInFileManager`.

### Design choices resolved during grilling

- **Concept-shaped, not folder-walk-shaped.** The deep module owns the
  *concept* (identity + metadata); the generic recursive walk is internal
  plumbing, not the interface. A shared `walkFiles` helper was considered and
  declined — it would share the walk but leave concept identity smeared
  (fails the deletion test).
- **Two enumerators, not a tagged list.** `listConcepts()` (excludes reserved)
  and `listAll()` (includes them) centralize the reserved set in the store;
  each caller picks the method matching its policy. (A single tagged list with
  a `kind` field was the alternative; two methods were preferred for caller
  clarity.)
- **`readConcept` owns single-file reads too**, closing the last duplication
  in the preview path. `files.ts` keeps only the non-wiki/text/binary fallback.
- **`Concept` carries `body`.** `wiki-scan` hashes it; `files.ts` displays it;
  `wiki-graph` runs its own `extractLinks` over it. Links are graph policy, not
  concept metadata, so they stay in `wiki-graph` (only the ref-normalization
  rule is shared).
- **`kind` (basename-based) vs `specialFileType` (conceptId-based).** The
  store's `kind` is basename-based — `sub/index.md` is `kind: "index"`, so
  `listConcepts` excludes it (matches `wiki-scan`'s reserved semantics).
  `wiki-graph`'s `specialFileType` stays conceptId-based (top-level only) for
  labeling. These are deliberately different policies; the store does not
  absorb the graph's labeling.
- **`frontmatterType` field** lets `wiki-graph` distinguish "no type declared"
  from "type equals the untyped label" when applying its localized fallback,
  without a fragile localized-string comparison.

## Consequences

**Positive**

- Two `walk()` copies removed (the `wiki-graph` walk and the `snapshotWiki`
  walk); two `RESERVED` sets removed (`wiki-scan`, `files`); three `conceptId`
  derivations collapsed into one (`conceptIdOf` + `normalizeRef`).
- Concept-reading bugs now have locality — they live in one module.
- The interface is directly testable: `vitest` was added with first tests
  against `listConcepts` / `listAll` / `readConcept` / `normalizeRef` over a
  temp `wiki/` tree. `electron` is mocked in `test/setup.ts` (the store's real
  dependency is the filesystem + the untyped label; Electron is an internal
  i18n detail).
- Future concept-shaped features (search, term-frequency, structure preview)
  get one seam to sit behind.

**Negative / accepted**

- The recursive walk is still duplicated between `ConceptStore` (wiki/) and
  `files.ts` (`FileNode` listing, with `size`) and `wiki-scan` (`input/`
  listing). This is accepted — those are genuinely different shapes (a deep
  module + two shallow callers), and a shared `walkFiles` helper was
  explicitly declined during the design review.
- `readConcept` swallows read errors (returns `null`); `files.ts getPreview`
  falls through to a direct read on `null` to surface the error. Acceptable
  (rare path, single extra read).
- Non-wiki `.md` files (in `input/`/`archive/`) now preview as raw markdown
  without concept metadata, where before they parsed frontmatter. This is
  more correct (input documents are not concepts) and was the agreed design.