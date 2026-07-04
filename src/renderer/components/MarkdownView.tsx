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

/** True for any internal wiki/concept link (not http/mailto/anchor). */
function isConceptLink(href: string | undefined): boolean {
  if (!href) return false;
  if (/^(https?:|mailto:|#)/.test(href)) return false;
  // Relative concept reference: "wiki/x.md", "/x.md", "/x", "x/y.md", "x/y".
  return (
    href.startsWith("wiki/") ||
    href.startsWith("/") ||
    href.includes("/") ||
    /\.md$/.test(href)
  );
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

  const components: Components = {
    a({ href, children }) {
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