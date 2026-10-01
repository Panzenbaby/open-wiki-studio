import { useAtomValue, useSetAtom } from "jotai";
import { ArrowLeftRight, ExternalLink, Folder, GitMerge } from "lucide-react";
import { api } from "../../ipc.ts";
import { useT } from "../../i18n.ts";
import { homeDirectoryAtom, platformAtom, toastAtom, workspaceAtom } from "../../store.ts";
import { abbreviateHomePath } from "../../../shared/text.ts";
import { IconTile } from "./IconTile.tsx";

interface WorkspaceCardProps {
  onSwitch: () => void;
  onMerge: () => void;
  /** A merge copies the wiki as it is on disk — refused while an ingest
   *  rewrites it. */
  mergeDisabled: boolean;
}

/** OS-adaptive i18n key for "open the folder in the file manager". */
function openFolderLabelKey(platform: string): string {
  if (platform === "darwin") return "dashboard.workspace.openFolder.finder";
  if (platform === "win32") return "dashboard.workspace.openFolder.explorer";
  return "dashboard.workspace.openFolder.fileManager";
}

/** The active workspace: name, location on disk, switch and merge. */
export function WorkspaceCard(props: WorkspaceCardProps): JSX.Element {
  const t = useT();
  const workspace = useAtomValue(workspaceAtom);
  const homeDirectory = useAtomValue(homeDirectoryAtom);
  const platform = useAtomValue(platformAtom);
  const setToast = useSetAtom(toastAtom);
  const path = workspace?.path ?? "";

  const openFolder = async (): Promise<void> => {
    const result = await api.openWorkspaceFolder();
    if (!result.success) setToast({ message: result.error.message, kind: "warning" });
  };

  return (
    <section className="dash-card workspace-card" aria-labelledby="dashboard-workspace-title">
      <IconTile tone="accent"><Folder size={26} strokeWidth={1.75} /></IconTile>
      <div className="workspace-card-body">
        <span className="dash-eyebrow">{t("dashboard.workspace.label")}</span>
        <h2 id="dashboard-workspace-title">{workspace?.name ?? ""}</h2>
        <div className="workspace-card-meta">
          <span className="workspace-card-path" title={path}>{abbreviateHomePath(path, homeDirectory)}</span>
          <button type="button" className="text-link text-link-small" onClick={() => void openFolder()}>
            <ExternalLink size={14} aria-hidden="true" />
            {t(openFolderLabelKey(platform))}
          </button>
        </div>
      </div>
      <div className="workspace-card-actions">
        <button type="button" className="btn btn-lg btn-secondary" onClick={props.onSwitch}>
          <ArrowLeftRight size={16} strokeWidth={1.75} aria-hidden="true" />
          {t("dashboard.workspace.switch")}
        </button>
        <button type="button" className="btn btn-lg btn-ghost" disabled={props.mergeDisabled} onClick={props.onMerge}>
          <GitMerge size={16} strokeWidth={1.75} aria-hidden="true" />
          {t("dashboard.workspace.merge")}
        </button>
      </div>
    </section>
  );
}
