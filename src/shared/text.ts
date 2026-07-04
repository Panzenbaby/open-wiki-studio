// Small text helpers shared between main and renderer.

/** Remove a leading "/wiki-query " command prefix from a stored user message. */
export function stripQueryCommand(text: string): string {
  return text.replace(/^\/wiki-query\s+/i, "").trim();
}