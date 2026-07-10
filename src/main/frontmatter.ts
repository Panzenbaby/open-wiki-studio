// Minimal YAML frontmatter parser (OKF subset) for previews in the app.
// Mirrors pi-okf-wiki/frontmatter.ts; kept local to avoid jiti in main.
const FENCE = "---";

export interface ParsedDocument {
  readonly frontmatter: {
    readonly type: string | undefined;
    readonly title: string | undefined;
    readonly description: string | undefined;
    readonly tags: readonly string[];
  } | null;
  readonly body: string;
}

export function parseDocument(content: string): ParsedDocument {
  if (!content.startsWith(FENCE)) return { frontmatter: null, body: content };
  const lines = content.split(/\r?\n/);
  let i = 1;
  const fmLines: string[] = [];
  let closed = false;
  for (; i < lines.length; i++) {
    if (lines[i].trim() === FENCE) {
      closed = true;
      break;
    }
    fmLines.push(lines[i]);
  }
  if (!closed) return { frontmatter: null, body: content };
  const body = lines.slice(i + 1).join("\n");
  return { frontmatter: parseYaml(fmLines), body };
}

function parseYaml(lines: string[]): ParsedDocument["frontmatter"] {
  const raw: Record<string, unknown> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (key === "") continue;
    raw[key] = parseValue(line.slice(idx + 1).trim());
  }
  const type = asString(raw["type"]);
  const title = asString(raw["title"]);
  const description = asString(raw["description"]);
  const tags = asStringArray(raw["tags"]);
  // Return the partial frontmatter even when `type` is missing — callers
  // fall back to `mainT("concept.untyped")` for the type, and dropping a
  // present `title`/`description`/`tags` just because `type` is absent would
  // hide valid metadata from previews and the graph.
  if (!type && !title && !description && tags.length === 0) return null;
  return {
    type,
    title,
    description,
    tags,
  };
}

function parseValue(value: string): unknown {
  let v = value.trim();
  if (v === "") return "";
  if (!v.startsWith('"') && !v.startsWith("'")) {
    const ci = v.indexOf(" #");
    if (ci !== -1) v = v.slice(0, ci).trim();
  }
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((s) => unquote(s.trim()));
  }
  return unquote(v);
}

function unquote(v: string): string {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((item): item is string => typeof item === "string") : [];
}

