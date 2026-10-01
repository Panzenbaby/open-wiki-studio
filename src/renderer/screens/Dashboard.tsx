import { useEffect, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { MessageSquare, Settings as SettingsIcon } from "lucide-react";
import { api } from "../ipc.ts";
import { useT } from "../i18n.ts";
import { useNavigation } from "../navigation.ts";
import { MergeWorkspacesModal } from "../components/MergeWorkspacesModal.tsx";
import { MigrateWikiModal } from "../components/MigrateWikiModal.tsx";
import { AddFilesCard } from "../components/dashboard/AddFilesCard.tsx";
import { IngestCard } from "../components/dashboard/IngestCard.tsx";
import { MigrationCard } from "../components/dashboard/MigrationCard.tsx";
import { RecentChatsCard } from "../components/dashboard/RecentChatsCard.tsx";
import { WikiCard } from "../components/dashboard/WikiCard.tsx";
import { WorkspaceCard } from "../components/dashboard/WorkspaceCard.tsx";
import { folderVersionAtom, ingestStateAtom, toastAtom, workspaceAtom } from "../store.ts";
import type { MigrationPlan } from "../../shared/ipc-types.ts";

interface DashboardProps {
  onNewChat: () => void;
  onOpenSession: (path: string) => void;
  onSwitchWorkspace: () => void;
}

export function Dashboard(props: DashboardProps): JSX.Element {
  const t = useT();
  const workspace = useAtomValue(workspaceAtom);
  const ingestState = useAtomValue(ingestStateAtom);
  const folderVersion = useAtomValue(folderVersionAtom);
  const setToast = useSetAtom(toastAtom);
  const { showBrowser, showView } = useNavigation();
  const [merging, setMerging] = useState<boolean>(false);
  const [migrationPlan, setMigrationPlan] = useState<MigrationPlan | null>(null);
  const [migrateOpen, setMigrateOpen] = useState<boolean>(false);
  const [migrating, setMigrating] = useState<boolean>(false);
  const running = ingestState === "running";

  // Re-checked whenever the wiki changes on disk: an ingest can add concepts,
  // and a merge can pull legacy ones in from another workspace.
  useEffect(() => {
    void (async () => {
      const result = await api.planMigration();
      setMigrationPlan(result.success ? result.data : null);
    })();
  }, [folderVersion.wiki]);

  const confirmMigration = async (): Promise<void> => {
    setMigrating(true);
    const result = await api.migrateWiki();
    setMigrating(false);
    if (!result.success) {
      setToast({ message: t("migrate.failed", { detail: result.error.message }), kind: "warning" });
      return;
    }
    setMigrateOpen(false);
    setMigrationPlan(null);
    setToast({ message: t("migrate.done", { n: result.data.migrated.length }), kind: "info" });
  };

  return (
    <div className="dashboard">
      <div className="dashboard-inner">
        <header className="dashboard-header">
          <div className="dashboard-heading">
            <span className="dashboard-kicker">{t("dashboard.kicker", { name: workspace?.name ?? "" })}</span>
            <div className="dashboard-title-row">
              <h1>{t("dashboard.heading")}</h1>
              <button
                type="button"
                className="icon-button"
                aria-label={t("dashboard.openSettings")}
                title={t("dashboard.openSettings")}
                onClick={() => showView("settings")}
              >
                <SettingsIcon size={20} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          </div>
          <button type="button" className="btn btn-xl btn-primary" onClick={props.onNewChat}>
            <MessageSquare size={18} aria-hidden="true" /> {t("dashboard.newChat")}
          </button>
        </header>

        {migrationPlan && migrationPlan.conceptIds.length > 0 && (
          <MigrationCard plan={migrationPlan} disabled={running} onUpgrade={() => setMigrateOpen(true)} />
        )}

        <div className="dashboard-grid">
          <div className="dashboard-column">
            <WorkspaceCard
              onSwitch={props.onSwitchWorkspace}
              onMerge={() => setMerging(true)}
              mergeDisabled={running}
            />
            <AddFilesCard onShowFiles={() => showBrowser("input")} />
            <IngestCard />
          </div>
          <div className="dashboard-column">
            <WikiCard />
            <RecentChatsCard onOpenSession={props.onOpenSession} />
          </div>
        </div>
      </div>
      {merging && <MergeWorkspacesModal onClose={() => setMerging(false)} />}
      {migrateOpen && migrationPlan && (
        <MigrateWikiModal
          plan={migrationPlan}
          busy={migrating}
          onConfirm={() => void confirmMigration()}
          onCancel={() => setMigrateOpen(false)}
        />
      )}
    </div>
  );
}
