// Tests for derived renderer atoms whose semantics are load-bearing for UI
// gates. `wikiExistsAtom` is the predicate the chat composer gates on, so its
// `> 0` semantics are worth locking against a future `>= 0` / `!== 0` typo that
// would silently re-enable the chat on an empty wiki folder.
import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { countsAtom, wikiExistsAtom } from "../src/renderer/store.ts";

describe("wikiExistsAtom", () => {
  it("is false when the wiki folder has no entries", () => {
    const store = createStore();
    store.set(countsAtom, { input: 5, wiki: 0, archive: 12 });
    expect(store.get(wikiExistsAtom)).toBe(false);
  });

  it("is true when the wiki folder has entries", () => {
    const store = createStore();
    store.set(countsAtom, { input: 0, wiki: 3, archive: 0 });
    expect(store.get(wikiExistsAtom)).toBe(true);
  });

  it("flips false → true reactively when countsAtom updates (post-ingest re-enable)", () => {
    const store = createStore();
    store.set(countsAtom, { input: 5, wiki: 0, archive: 0 });
    expect(store.get(wikiExistsAtom)).toBe(false);

    // /wiki-update writes the first concept(s): AppShell's debounced
    // onFolderChanged refresh lands a new wiki count → the gate must open.
    store.set(countsAtom, { input: 0, wiki: 5, archive: 5 });
    expect(store.get(wikiExistsAtom)).toBe(true);

    // And closes again if the wiki is deleted externally.
    store.set(countsAtom, { input: 0, wiki: 0, archive: 5 });
    expect(store.get(wikiExistsAtom)).toBe(false);
  });

  it("is independent of input/archive counts", () => {
    const store = createStore();
    // Input pending but wiki empty → chat stays gated (the whole point of the
    // gate: you can't query a wiki that doesn't exist yet).
    store.set(countsAtom, { input: 99, wiki: 0, archive: 0 });
    expect(store.get(wikiExistsAtom)).toBe(false);

    // No input, no archive, but wiki has concepts → chat open.
    store.set(countsAtom, { input: 0, wiki: 1, archive: 0 });
    expect(store.get(wikiExistsAtom)).toBe(true);
  });
});