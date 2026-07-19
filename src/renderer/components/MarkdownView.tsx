import { useSetAtom } from "jotai";
import { FileText } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkConceptLinks } from "../remark-concept-links.ts";
import { browserFolderAtom, selectedFileAtom, viewAtom } from "../store.ts";

interface MarkdownViewProps {
  /** Raw markdown source to render. */
  readonly source: string;
  /** Extra className(s) added to the wrapping container. */
  readonly className?: string;
}

/** True for any internal wiki/concept link (not http/mailto/anchor). Archive
 *  citations (`/archive/…`, `archive/…`) are NOT concept links — they point at
 *  archived originals inside the OKF bundle and are handled separately by
 *  `openArchiveCitation`. */
function isConceptLink(href: string | undefined): boolean {
  if (!href) return false;
  if (/^(https?:|mailto:|#)/.test(href)) return false;
  if (isArchiveLink(href)) return false;
  // Relative concept reference: "wiki/x.md", "/x.md", "/x", "x/y.md", "x/y".
  return (
    href.startsWith("wiki/") ||
    href.startsWith("/") ||
    href.includes("/") ||
    /\.md$/.test(href)
  );
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

/** Normalize any concept link to a workspace-relative "wiki/<concept-id>.md" path. */
function toWikiPath(href: string): string {
  let p = href.replace(/^\//, "");
  if (p.startsWith("wiki/")) p = p.slice("wiki/".length);
  if (!p.endsWith(".md")) p += ".md";
  return `wiki/${p}`;
}

/**
 * Shared markdown renderer used by the chat view (Message.tsx) and the
 * file Browser preview. Renders GFM + auto-links bare concept paths and
 * turns internal wiki links into clickable chips.
 */
export function MarkdownView(props: MarkdownViewProps): JSX.Element {
  const setView = useSetAtom(viewAtom);
  const setSelected = useSetAtom(selectedFileAtom);
  const setBrowserFolder = useSetAtom(browserFolderAtom);

  function openConcept(href: string): void {
    setSelected(toWikiPath(href));
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
      if (isArchiveLink(href ?? "")) {
        return (
          <button
            type="button"
            className="chip"
            style={{
              border: "1px solid var(--border)",
              background: "var(--glass-bg)",
            }}
            title={toArchivePath(href ?? "")}
            onClick={() => openArchiveCitation(href ?? "")}
          >
            <FileText size={12} />
            {children}
          </button>
        );
      }
      if (isConceptLink(href)) {
        return (
          <button
            type="button"
            className="chip"
            style={{
              border: "1px solid var(--border)",
              background: "var(--glass-bg)",
            }}
            title={toWikiPath(href ?? "")}
            onClick={() => openConcept(href ?? "")}
          >
            <FileText size={12} />
            {children}
          </button>
        );
      }
      return (
        <a href={href} target="_blank" rel="noreferrer noopener">
          {children}
        </a>
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