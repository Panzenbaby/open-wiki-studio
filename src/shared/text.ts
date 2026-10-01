// Small text helpers shared between main and renderer.

/** Remove a leading "/wiki-query " command prefix from a stored user message. */
export function stripQueryCommand(text: string): string {
  return text.replace(/^\/wiki-query\s+/i, "").trim();
}

/** Longest session preview sent over IPC. The UI truncates visually anyway;
 *  this only keeps a long answer from travelling to the renderer in full. */
export const SESSION_PREVIEW_MAX_LENGTH = 160;

/** Reduce markdown to readable plain text for one-line previews: link and
 *  image syntax collapse to their label, emphasis/heading/quote/list/code
 *  markers disappear, and all whitespace collapses to single spaces. */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n?/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Build the session-list preview from Pi's session metadata.
 *
 *  `allMessagesText` is every user and assistant message joined with spaces,
 *  starting with `firstMessage` (the first question, already shown as the
 *  session title). Dropping that prefix leaves the first answer up front. */
export function buildSessionPreview(allMessagesText: string, firstMessage: string): string {
  const rest = allMessagesText.startsWith(firstMessage)
    ? allMessagesText.slice(firstMessage.length)
    : allMessagesText;
  const plain = markdownToPlainText(rest);
  return plain.length > SESSION_PREVIEW_MAX_LENGTH
    ? plain.slice(0, SESSION_PREVIEW_MAX_LENGTH).trimEnd()
    : plain;
}

/** Show a path below the home directory as `~/…`. Paths elsewhere, an empty
 *  home directory, and Windows-style homes (where `~` is not a convention) are
 *  returned unchanged. */
export function abbreviateHomePath(path: string, homeDirectory: string): string {
  if (homeDirectory === "" || homeDirectory.includes("\\")) return path;
  const home = homeDirectory.endsWith("/") ? homeDirectory.slice(0, -1) : homeDirectory;
  if (path === home) return "~";
  if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
  return path;
}
