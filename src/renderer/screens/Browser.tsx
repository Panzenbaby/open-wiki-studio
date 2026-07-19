import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { ExternalLink, FileText, Folder as FolderIcon, Plus, Share2 } from "lucide-react";
import { api } from "../ipc.ts";
import { useT } from "../i18n.ts";
import { reportAddFilesResult } from "../add-files.ts";
import { addFilesSummaryAtom, browserFolderAtom, browserModeAtom, folderVersionAtom, platformAtom, selectedFileAtom, toastAtom } from "../store.ts";
import { MarkdownView } from "../components/MarkdownView.tsx";
import { FileTree } from "../components/FileTree.tsx";
import { ContextMenu, type ContextMenuItem, type ContextMenuPosition } from "../components/ContextMenu.tsx";
import { GraphView } from "./GraphView.tsx";
import { ancestorDirs, buildFileTree, type TreeNode } from "../fileTree.ts";
import type { FileNode, FilePreview, Folder } from "../../shared/ipc-types.ts";

const FOLDERS: ReadonlyArray<{ id: Folder; labelKey: string }> = [
  { id: "input", labelKey: "folder.input.name" },
  { id: "wiki", labelKey: "folder.wiki.name" },
];

/** OS-adaptive i18n key for the "reveal in file manager" action. */
function revealLabelKey(platform: string): string {
  if (platform === "darwin") return "browser.reveal.finder";
  if (platform === "win32") return "browser.reveal.explorer";
  return "browser.reveal.fileManager";
}

interface CtxState {
  readonly node: TreeNode;
  readonly position: ContextMenuPosition;
}

export function Browser(): JSX.Element {
  const t = useT();
  const setToast = useSetAtom(toastAtom);
  const setAddFilesSummary = useSetAtom(addFilesSummaryAtom);
  const platform = useAtomValue(platformAtom);
  const [folder, setFolder] = useAtom(browserFolderAtom);
  const [mode, setMode] = useAtom(browserModeAtom);
  const [selected, setSelected] = useAtom(selectedFileAtom);
  const folderVersion = useAtomValue(folderVersionAtom);
  // Derived once so the refresh effect can list it as an honest dependency.
  // Other folders' bumps are ignored to avoid needless re-lists.
  const activeFolderVersion = folderVersion[folder];
  const [nodes, setNodes] = useState<readonly FileNode[]>([]);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [ctx, setCtx] = useState<CtxState | null>(null);
  // Token guarding against stale overwrites: each refreshList call increments
  // it; the response is applied only if the token still matches. Without this,
  // rapid bursts could let a slow, older listFolder response clobber a fresher
  // one.
  const refreshToken = useRef(0);

  // Memoized on `folder` so the effect below can depend on it honestly
  // (no eslint-disable) without re-running on every render.
  const refreshList = useCallback(async (): Promise<void> => {
    const token = ++refreshToken.current;
    const list = await api.listFolder(folder);
    if (refreshToken.current !== token) return; // a newer refresh superseded us
    setNodes(list.success ? list.data : []);
  }, [folder]);

  async function addFiles(): Promise<void> {
    const result = await api.addInputFilesDialog();
    reportAddFilesResult(result, { setToast, setSummary: setAddFilesSummary, t });
    // No manual `refreshList()` here: the dialog writes to `input/`, the
    // FolderWatcher fires, `folderVersion.input` bumps, and the effect below
    // re-lists. Folder refresh stays in one place.
  }

  // Single refresh entry point for BOTH triggers: a folder switch (refreshList
  // identity changes) and a FolderWatcher version bump for the active folder
  // (activeFolderVersion changes). Honest deps, no eslint-disable; the
  // refreshToken guard inside refreshList discards stale responses during
  // rapid bursts.
  useEffect(() => {
    void refreshList();
  }, [refreshList, activeFolderVersion]);

  // Auto-expand all ancestor folders of the selected file so it stays
  // visible after a refresh or folder switch.
  useEffect(() => {
    if (!selected) return;
    // selected is `${folder}/${relativePath}`; strip the folder prefix.
    const prefix = `${folder}/`;
    if (!selected.startsWith(prefix)) return;
    const relativePath = selected.slice(prefix.length);
    const ancestors = ancestorDirs(relativePath);
    if (ancestors.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const dir of ancestors) {
        if (!next.has(dir)) {
          next.add(dir);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [selected, folder]);

  useEffect(() => {
    if (!selected) {
      setPreview(null);
      return;
    }
    void (async () => {
      const result = await api.getPreview(selected);
      setPreview(result.success ? result.data : null);
    })();
  }, [selected]);

  const tree = useMemo(() => buildFileTree(nodes), [nodes]);

  function toggleDir(relativePath: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(relativePath)) next.delete(relativePath);
      else next.add(relativePath);
      return next;
    });
  }

  function handleContextMenu(node: TreeNode, position: ContextMenuPosition): void {
    setCtx({ node, position });
  }

  async function revealInFileManager(node: TreeNode): Promise<void> {
    await api.revealInFileManager(folder, node.relativePath, node.isDirectory);
  }

  const ctxItems: ContextMenuItem[] = ctx
    ? [
        {
          label: t(revealLabelKey(platform)),
          icon: nodeIsDirectory(ctx.node) ? <FolderIcon size={14} /> : <ExternalLink size={14} />,
          onClick: () => void revealInFileManager(ctx.node),
        },
      ]
    : [];

  return (
    <div className="body" style={{ flex: 1, height: "100%" }}>
      <aside className="sidebar" style={{ width: 280 }}>
        <div className="side-head row wrap">
          {FOLDERS.map((f) => (
            <button key={f.id} className={`badge mono${mode === "files" && folder === f.id ? " accent" : ""}`} style={{ border: "1px solid var(--border)", background: "transparent" }} onClick={() => { setFolder(f.id); setMode("files"); setSelected(null); setExpanded(new Set()); }}>
              <span className={`dot`} style={{ display: "inline-block", flexShrink: 0, width: "8px", height: "8px", borderRadius: "50%", background: "currentColor" }} /> {t(f.labelKey)}
            </button>
          ))}
          <button className={`badge mono${mode === "graph" ? " accent" : ""}`} style={{ border: "1px solid var(--border)", background: "transparent" }} onClick={() => { setMode("graph"); setSelected(null); }} title={t("nav.graph")}>
            <Share2 size={12} style={{ display: "inline-block", flexShrink: 0 }} /> {t("nav.graph")}
          </button>
        </div>
        {mode === "files" && (
          <>
            <div className="folder-head">
              <span>{FOLDERS.find((f) => f.id === folder) ? t(FOLDERS.find((f) => f.id === folder)!.labelKey) : ""}</span>
              <span className="count">{nodes.length}</span>
            </div>
            {nodes.length === 0 ? (
              <div className="muted" style={{ flex: 1, padding: "var(--space-3)", fontSize: "var(--text-xs)" }}>{t("browser.emptyFiles")}</div>
            ) : (
              <div style={{ flex: 1, overflow: "auto", padding: "var(--space-2)" }}>
                <FileTree
                  nodes={tree.children}
                  folder={folder}
                  selected={selected}
                  expanded={expanded}
                  onToggleDir={toggleDir}
                  onSelectFile={setSelected}
                  onContextMenu={handleContextMenu}
                />
              </div>
            )}
            {folder === "input" && (
              <div className="side-head">
                <button className="btn btn-sm btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={() => void addFiles()}><Plus size={14} /> {t("browser.addFiles")}</button>
              </div>
            )}
          </>
        )}
      </aside>
      <main className={`pane grow${mode === "graph" ? "" : " preview"}`}>
        {mode === "graph" ? (
          <GraphView />
        ) : (
          <>
            {!preview && <div className="empty"><div className="glyph"><FileText size={28} /></div><div className="e-title">{t("browser.selectFile")}</div></div>}
            {preview && (
              <>
                <div className="pv-head">
                  <div className="pv-id mono">{preview.relativePath}</div>
                </div>
                {preview.frontmatter && (
                  <div className="row wrap" style={{ gap: "var(--space-2)" }}>
                    <span className="badge accent mono">{preview.frontmatter.type}</span>
                    <span className="badge mono">{preview.frontmatter.title}</span>
                  </div>
                )}
                <div className="pv-body">
                  {preview.kind === "markdown" ? (
                    <MarkdownView source={preview.content} />
                  ) : preview.kind === "binary" ? (
                    <div className="empty" style={{ flex: 1 }}>
                      <div className="glyph"><FileText size={28} /></div>
                      <div className="e-title">{t("preview.binaryTitle")}</div>
                      <div className="muted" style={{ maxWidth: 480, textAlign: "center" }}>
                        {preview.content}
                      </div>
                      <button
                        className="btn btn-sm btn-primary"
                        style={{ marginTop: "var(--space-3)" }}
                        onClick={() => {
                          const prefix = `${folder}/`;
                          const relativePath = selected && selected.startsWith(prefix)
                            ? selected.slice(prefix.length)
                            : "";
                          void api.revealInFileManager(folder, relativePath, false);
                        }}
                      >
                        <ExternalLink size={14} /> {t(revealLabelKey(platform))}
                      </button>
                    </div>
                  ) : (
                    <pre style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font-body)", color: "var(--fg-2)", background: "transparent", border: "none", padding: 0 }}>{preview.content}</pre>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </main>
      {ctx && <ContextMenu position={ctx.position} items={ctxItems} onClose={() => setCtx(null)} />}
    </div>
  );
}

/** Type guard kept local so the menu icon reflects folder vs file. */
function nodeIsDirectory(node: TreeNode): boolean {
  return node.isDirectory;
}