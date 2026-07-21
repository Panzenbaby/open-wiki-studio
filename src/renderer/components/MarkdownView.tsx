import { useSetAtom } from "jotai";
import { FileText, Folder as FolderIcon } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkConceptLinks } from "../remark-concept-links.ts";
import { browserFolderAtom, selectedFileAtom, viewAtom } from "../store.ts";

interface MarkdownViewProps {
  /** Raw markdown source to render. */
  readonly source: string;
  /** Extra className(s) added to the wrapping container. */
  readonly className?: string;
  /** Wiki-relative path of the file being rendered (e.g.
   *  "wiki/species/index.md"), used to resolve relative links against the
   *  file's own directory — the same way VS Code's markdown preview does.
   *  Omitted in the chat view, where the assistant always writes
   *  wiki-root-relative links (`wiki/<concept-id>.md`). */
  readonly basePath?: string;
  /** Called when the user clicks a folder link (a href ending in "/").
   *  `wikiDir` is the resolved wiki-relative directory with no trailing
   *  slash (e.g. "wiki/species"). Only the Browser supplies this — it can
   *  decide whether to open the folder's `index.md` or navigate into the
   *  folder, because it owns the folder listing. When omitted, folder
   *  links render as non-clickable text. */
  readonly onOpenFolder?: (wikiDir: string) => void;
}

/** True for a citation link into the OKF archive. The extension emits
 *  bundle-relative `/archive/<rel>` links; the leading `/` may or may not be
 *  present in hand-written markdown. The path inside the archive may end in
 *  `.md.orig` (an archived markdown original) or a binary extension (pdf,
 *  docx, …). A bare `archive` (no trailing path) is not a file citation. */
function isArchiveLink(href: string): boolean {
  const p = href.replace(/^\//, "");
  return p.startsWith("archive/");
}

/** External (http/mailto) or in-page anchor links — never internal wiki
 *  navigation. */
function isExternal(href: string): boolean {
  return /^(https?:|mailto:|#)/.test(href);
}

/** A folder link: href ends in a slash (OKF index.md emits `* [name/](name/)`). */
function isFolderLink(href: string): boolean {
  return href.endsWith("/");
}

/** A concept-file link: href ends in `.md`. Bare names without a slash and
 *  without `.md` are NOT concept links (left as ordinary `<a>`). The suffix
 *  check is case-sensitive to match `isWikiMarkdown` in main/files.ts, so a
 *  `Foo.MD` link falls through to a normal anchor instead of resolving to a
 *  wiki path the store would not treat as a concept. */
function isConceptFileLink(href: string): boolean {
  return /\.md$/.test(href);
}

/** The selection key for an archive citation — the same `${folder}/${rel}`
 *  form the Browser uses. The markdown link is bundle-relative
 *  (`/archive/<rel>`); the archive physically lives at `wiki/archive/<rel>`
 *  and is browsed as a subdirectory of the wiki folder, so the selection key
 *  is `wiki/archive/<rel>`. `isArchiveLink` already guarantees the `archive/`
 *  prefix (after any leading `/`), so we strip the leading slash and prepend
 *  `wiki/`. */
function toArchivePath(href: string): string {
  return `wiki/${href.replace(/^\//, "")}`;
}

/** Resolve an internal wiki link to a wiki-relative path.
 *
 *  - Root-relative hrefs (starting with `wiki/` or `/`) resolve against the
 *    wiki root — e.g. `wiki/foo/bar.md`, `/foo/bar.md`, or the bundle-relative
 *    `/tables/orders.md` the agent writes in concept bodies.
 *  - Relative hrefs (no prefix) resolve against the directory of `basePath`
 *    when present (Browser preview), so `[Chimpanzees](chimpanzees.md)` from
 *    `wiki/species/index.md` becomes `wiki/species/chimpanzees.md`, matching
 *    VS Code preview behavior.
 *  - Relative hrefs with no `basePath` (chat view) fall back to the wiki root
 *    (`wiki/<href>`), so bare concept paths the remark plugin auto-linked in
 *    assistant prose still resolve to a real concept — preserving the old
 *    chat behavior.
 *
 *  For folder links (`kind: "folder"`) the returned path has no trailing
 *  slash and no `.md`; for concept files (`kind: "file"`) it ends in `.md`. */
function resolveWikiPath(
  href: string,
  basePath: string | undefined,
): { wikiPath: string; kind: "file" | "folder" } {
  const isFolder = isFolderLink(href);
  const rootRelative = href.startsWith("/") || href.startsWith("wiki/");
  // Drop a leading "/" and a redundant "wiki/" prefix for root-relative links.
  let h = href.replace(/^\//, "");
  if (h.startsWith("wiki/")) h = h.slice("wiki/".length);
  // Drop the trailing slash for folder links.
  if (isFolder) h = h.replace(/\/+$/, "");
  if (!rootRelative) {
    // Relative link: resolve against the file's own directory when we know
    // it (Browser preview); otherwise fall back to the wiki root.
    const baseDir = basePath && basePath.includes("/")
      ? basePath.slice(0, basePath.lastIndexOf("/"))
      : "";
    h = baseDir ? `${baseDir}/${h}` : h;
  }
  const wikiPath = h.startsWith("wiki/") ? h : `wiki/${h}`;
  return { wikiPath, kind: isFolder ? "folder" : "file" };
}

const chipStyle: Readonly<React.CSSProperties> = {
  border: "1px solid var(--border)",
  background: "var(--glass-bg)",
};

/**
 * Shared markdown renderer used by the chat view (Message.tsx) and the
 * file Browser preview. Renders GFM + auto-links bare concept paths and
 * turns internal wiki links into clickable chips.
 */
export function MarkdownView(props: MarkdownViewProps): JSX.Element {
  const setView = useSetAtom(viewAtom);
  const setSelected = useSetAtom(selectedFileAtom);
  const setBrowserFolder = useSetAtom(browserFolderAtom);

  function openConcept(wikiPath: string): void {
    setSelected(wikiPath);
    setBrowserFolder("wiki");
    setView("browser");
  }

  /** Open a citation into the OKF archive. The link is bundle-relative
   *  (`/archive/<rel>`); the archive lives at `wiki/archive/<rel>` and is
   *  browsed as the `archive/` subdirectory of the wiki folder, so we route
   *  the browser to the `wiki` folder and set the selection key to
   *  `wiki/archive/<rel>` so the existing preview path picks up the archived
   *  original (`.md.orig` rendered as markdown, or a binary placeholder for
   *  pdf/docx/…).
   *
   *  The three setStates are flushed as one batched re-render (React 18
   *  auto-batches event-handler updates), so Browser sees a consistent
   *  `[folder, selected]` pair. `getPreview` is additionally robust to any
   *  folder-atom staleness: it sniffs the `wiki/archive/` prefix on the
   *  selection key itself, so the translation does not depend on
   *  `browserFolder` having propagated first. */
  function openArchiveCitation(href: string): void {
    setSelected(toArchivePath(href));
    setBrowserFolder("wiki");
    setView("browser");
  }

  const components: Components = {
    a({ href, children }) {
      const h = href ?? "";
      if (isArchiveLink(h)) {
        return (
          <button
            type="button"
            className="chip"
            style={chipStyle}
            title={toArchivePath(h)}
            onClick={() => openArchiveCitation(h)}
          >
            <FileText size={12} />
            {children}
          </button>
        );
      }
      if (isExternal(h)) {
        return (
          <a href={h} target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        );
      }
      // Internal concept/folder link. Bare names (no slash, no .md) are not
      // concept links — fall through to an ordinary external anchor.
      if (!isFolderLink(h) && !isConceptFileLink(h)) {
        return (
          <a href={h} target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        );
      }
      const resolved = resolveWikiPath(h, props.basePath);
      if (resolved.kind === "folder") {
        if (!props.onOpenFolder) return <span>{children}</span>;
        return (
          <button
            type="button"
            className="chip"
            style={chipStyle}
            title={resolved.wikiPath}
            onClick={() => props.onOpenFolder!(resolved.wikiPath)}
          >
            <FolderIcon size={12} />
            {children}
          </button>
        );
      }
      return (
        <button
          type="button"
          className="chip"
          style={chipStyle}
          title={resolved.wikiPath}
          onClick={() => openConcept(resolved.wikiPath)}
        >
          <FileText size={12} />
          {children}
        </button>
      );
    },
  };

  return (
    <div className={`markdown${props.className ? ` ${props.className}` : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkConceptLinks]}
        components={components}
      >
        {props.source}
      </ReactMarkdown>
    </div>
  );
}