// Merge several workspaces into a new one. Sources come from the recent list
// (the active workspace is preselected) and can be extended with any folder on
// disk. On success the merged workspace is opened.
import { useEffect, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { FolderPlus } from "lucide-react";
import { api } from "../ipc.ts";
import { useT } from "../i18n.ts";
import {
  llmConfiguredAtom,
  recentWorkspacesAtom,
  screenAtom,
  toastAtom,
  workspaceAtom,
} from "../store.ts";
import type { MergeReport, WorkspaceInfo } from "../../shared/ipc-types.ts";
import { Modal } from "./Modal.tsx";

export function MergeWorkspacesModal({ onClose }: { onClose: () => void }): JSX.Element {
  const t = useT();
  const recent = useAtomValue(recentWorkspacesAtom);
  const workspace = useAtomValue(workspaceAtom);
  const setWorkspace = useSetAtom(workspaceAtom);
  const setLlmConfigured = useSetAtom(llmConfiguredAtom);
  const setRecent = useSetAtom(recentWorkspacesAtom);
  const setScreen = useSetAtom(screenAtom);
  const setToast = useSetAtom(toastAtom);

  const [extra, setExtra] = useState<readonly string[]>([]);
  const [selected, setSelected] = useState<readonly string[]>(
    workspace ? [workspace.path] : [],
  );
  const [target, setTarget] = useState<string | null>(null);
  const [running, setRunning] = useState<boolean>(false);
  const [report, setReport] = useState<MergeReport | null>(null);

  // The list is loaded at app bootstrap and goes stale as workspaces are
  // opened; re-pull it so the merge picker always offers the current set.
  useEffect(() => {
    void (async () => {
      const result = await api.listRecentWorkspaces();
      if (result.success) setRecent(result.data);
    })();
  }, [setRecent]);

  const candidates: readonly WorkspaceInfo[] = [
    ...recent.filter((entry) => entry.missing !== true),
    ...extra.map((path) => ({ path, name: folderName(path), lastOpened: "" })),
  ];

  function toggle(path: string): void {
    setSelected((current) =>
      current.includes(path) ? current.filter((p) => p !== path) : [...current, path],
    );
  }

  async function addSource(): Promise<void> {
    const picked = await api.pickMergeFolder("source");
    if (!picked.success || !picked.data) return;
    const path = picked.data;
    if (!candidates.some((entry) => entry.path === path)) {
      setExtra((current) => [...current, path]);
    }
    setSelected((current) => (current.includes(path) ? current : [...current, path]));
  }

  async function chooseTarget(): Promise<void> {
    const picked = await api.pickMergeFolder("target");
    if (!picked.success || !picked.data) return;
    setTarget(picked.data);
  }

  async function run(): Promise<void> {
    if (!target) return;
    setRunning(true);
    const result = await api.mergeWorkspaces(selected, target);
    setRunning(false);
    if (!result.success) {
      setToast({ message: result.error.message, kind: "error" });
      return;
    }
    setReport(result.data);
  }

  // Activating the merged workspace mirrors the picker: open it, then route to
  // the app (or first-run when no LLM is configured yet).
  async function openMerged(path: string): Promise<void> {
    const opened = await api.openWorkspace(path);
    if (!opened.success) {
      setToast({ message: `${t("picker.openFailed")}: ${opened.error.message}`, kind: "error" });
      return;
    }
    setWorkspace(opened.data);
    const self = await api.getAppSelf();
    if (self.success) setLlmConfigured(self.data.hasLlmConfig);
    setScreen(self.success && self.data.hasLlmConfig ? "app" : "first-run");
    onClose();
  }

  if (report) {
    return (
      <Modal
        title={t("merge.doneTitle")}
        onClose={onClose}
        footer={
          <button className="btn btn-primary" onClick={() => void openMerged(report.workspace)}>
            {t("merge.close")}
          </button>
        }
      >
        <div className="mono" style={{ fontSize: "var(--text-sm)" }}>{report.workspace}</div>
        <p style={{ marginTop: "var(--space-3)" }}>
          {t("merge.doneSummary", {
            concepts: report.concepts,
            renamed: report.renamed,
            deduplicated: report.deduplicated,
          })}
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title={t("merge.title")}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={running}>
            {t("merge.cancel")}
          </button>
          <button
            className="btn btn-primary"
            disabled={running || selected.length < 2 || target === null}
            onClick={() => void run()}
          >
            {running ? t("merge.running") : t("merge.start")}
          </button>
        </>
      }
    >
      <p className="fg2" style={{ fontSize: "var(--text-sm)" }}>{t("merge.desc")}</p>

      <div className="side-title" style={{ margin: "var(--space-4) 0 var(--space-2)" }}>
        {t("merge.sources")}
      </div>
      <div className="recent-sessions">
        {candidates.map((entry) => (
          <label key={entry.path} className="rs-item" style={{ cursor: "pointer", gap: "var(--space-3)" }}>
            <input
              type="checkbox"
              checked={selected.includes(entry.path)}
              onChange={() => toggle(entry.path)}
              disabled={running}
            />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="rs-title">{entry.name}</div>
              <div className="rs-prev mono">{entry.path}</div>
            </div>
          </label>
        ))}
      </div>
      <button
        className="btn btn-ghost btn-sm"
        style={{ marginTop: "var(--space-2)" }}
        onClick={() => void addSource()}
        disabled={running}
      >
        <FolderPlus size={14} /> {t("merge.addSource")}
      </button>

      <div className="side-title" style={{ margin: "var(--space-5) 0 var(--space-2)" }}>
        {t("merge.target")}
      </div>
      <div className="row" style={{ gap: "var(--space-3)", alignItems: "center" }}>
        <button className="btn btn-sm" onClick={() => void chooseTarget()} disabled={running}>
          {t("merge.chooseTarget")}
        </button>
        <span className="mono fg2" style={{ fontSize: "var(--text-xs)", minWidth: 0, overflowWrap: "anywhere" }}>
          {target ?? t("merge.noTarget")}
        </span>
      </div>
    </Modal>
  );
}

function folderName(path: string): string {
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}
