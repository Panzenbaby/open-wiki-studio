import { useAtomValue, useSetAtom } from "jotai";
import { CloudUpload } from "lucide-react";
import { api } from "../../ipc.ts";
import { useT } from "../../i18n.ts";
import { reportAddFilesResult } from "../../add-files.ts";
import { addFilesSummaryAtom, fileDragActiveAtom, toastAtom } from "../../store.ts";
import { CardHeader } from "./CardHeader.tsx";
import { TextLink } from "./TextLink.tsx";

interface AddFilesCardProps {
  onShowFiles: () => void;
}

/** Drop zone + file picker for new input files. The drop itself is handled
 *  window-wide by AppShell (files can land anywhere); the zone lights up while
 *  a file drag is in progress to show where they go. */
export function AddFilesCard(props: AddFilesCardProps): JSX.Element {
  const t = useT();
  const dragActive = useAtomValue(fileDragActiveAtom);
  const setToast = useSetAtom(toastAtom);
  const setSummary = useSetAtom(addFilesSummaryAtom);

  const chooseFiles = async (): Promise<void> => {
    const result = await api.addInputFilesDialog();
    // No refresh here: the FolderWatcher reports the new files in input/.
    reportAddFilesResult(result, { setToast, setSummary, t });
  };

  return (
    <section className="dash-card" aria-labelledby="dashboard-add-files-title">
      <CardHeader
        titleId="dashboard-add-files-title"
        title={t("dashboard.addFiles.title")}
        action={<TextLink label={t("dashboard.addFiles.allFiles")} onClick={props.onShowFiles} />}
      />
      <div className={`dropzone${dragActive ? " is-active" : ""}`}>
        <span className="dropzone-icon" aria-hidden="true"><CloudUpload size={26} strokeWidth={1.75} /></span>
        <span className="dropzone-title">{t("dashboard.addFiles.dropHint")}</span>
        <button type="button" className="btn btn-lg btn-neutral" onClick={() => void chooseFiles()}>
          {t("dashboard.addFiles.choose")}
        </button>
        <span className="dropzone-formats">{t("dashboard.addFiles.formats")}</span>
      </div>
    </section>
  );
}
