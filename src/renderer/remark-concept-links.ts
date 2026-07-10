// Remark plugin: auto-link bare wiki/concept paths in assistant text so that
// references the agent wrote as plain text (e.g. "Quelle: wiki/foo/bar.md")
// become real markdown links rendered as clickable chips by Message.tsx.
// Existing markdown links and inline code are left untouched.

interface MdastNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdastNode[];
}

// A concept path: optional "wiki/" prefix, then at least two slash-separated
// segments of word/dot/dash chars, ending in ".md".
const CONCEPT_RE = /(?:wiki\/)?[A-Za-z0-9_]+(?:\/[A-Za-z0-9_.-]+)+\.md/g;

function splitLinks(value: string): MdastNode[] {
  CONCEPT_RE.lastIndex = 0;
  const out: MdastNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = CONCEPT_RE.exec(value)) !== null) {
    if (match.index > last) {
      out.push({ type: "text", value: value.slice(last, match.index) });
    }
    out.push({
      type: "link",
      url: match[0],
      children: [{ type: "text", value: match[0] }],
    });
    last = match.index + match[0].length;
  }
  if (last === 0) return [{ type: "text", value }];
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

function isConceptPath(value: string): boolean {
  return /^(?:wiki\/)?[A-Za-z0-9_]+(?:\/[A-Za-z0-9_.-]+)+\.md$/.test(value);
}

function walk(node: MdastNode): void {
  const children = node.children;
  if (!children) return;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (node.type !== "link" && child && child.type === "text" && typeof child.value === "string") {
      const replaced = splitLinks(child.value);
      if (replaced.length !== 1 || replaced[0] !== child) {
        children.splice(i, 1, ...replaced);
        i += replaced.length - 1;
      }
    } else if (
      node.type !== "link" &&
      child &&
      child.type === "inlineCode" &&
      typeof child.value === "string" &&
      isConceptPath(child.value)
    ) {
      children.splice(i, 1, {
        type: "link",
        url: child.value,
        children: [{ type: "text", value: child.value }],
      });
    } else {
      walk(child);
    }
  }
}

export function remarkConceptLinks(): (tree: MdastNode) => void {
  return (tree: MdastNode) => walk(tree);
}