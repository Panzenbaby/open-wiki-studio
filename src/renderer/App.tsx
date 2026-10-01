import { useEffect } from "react";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { api } from "./ipc.ts";
import { bindAgentEvents } from "./agent-events.ts";
import {
  platformAtom,
  recentWorkspacesAtom,
  currentVersionAtom,
  homeDirectoryAtom,
  screenAtom,
} from "./store.ts";
import { useT, localeAtom } from "./i18n.ts";
import { useAppearanceSync } from "./appearance.ts";
import { WorkspacePicker } from "./screens/WorkspacePicker.tsx";
import { FirstRun } from "./screens/FirstRun.tsx";
import { AppShell } from "./components/AppShell.tsx";
import { Toast } from "./components/Toast.tsx";

export function App(): JSX.Element {
  const t = useT();
  const locale = useAtomValue(localeAtom);
  useAppearanceSync();

  const [screen, setScreen] = useAtom(screenAtom);
  const setRecent = useSetAtom(recentWorkspacesAtom);
  const setPlatform = useSetAtom(platformAtom);
  const setCurrentVersion = useSetAtom(currentVersionAtom);
  const setHomeDirectory = useSetAtom(homeDirectoryAtom);
  const store = useStore();

  useEffect(() => {
    document.title = t("app.name");
  }, [t]);

  useEffect(() => {
    void (async () => {
      const recent = await api.listRecentWorkspaces();
      if (recent.success) setRecent(recent.data);
      const self = await api.getAppSelf();
      if (self.success) {
        setPlatform(self.data.platform);
        setCurrentVersion(self.data.version);
        setHomeDirectory(self.data.homeDirectory);
      }
      setScreen("picker");
    })();
  }, [setRecent, setScreen, setPlatform, setCurrentVersion, setHomeDirectory]);

  useEffect(() => bindAgentEvents(api, store, locale), [store, locale]);

  if (screen === "loading") {
    return (
      <div className="shell" style={{ placeItems: "center", display: "grid", color: "var(--muted)" }}>
        {t("app.loading")}
      </div>
    );
  }
  if (screen === "picker" || screen === "first-run") {
    return (
      <>
        <div className="shell">{screen === "picker" ? <WorkspacePicker /> : <FirstRun />}</div>
        <Toast />
      </>
    );
  }
  return (
    <>
      <AppShell />
      <Toast />
    </>
  );
}