// Navigation between the app views. One place that knows how "show the files"
// or "show the wiki" maps onto the view + Browser atoms, shared by the app bar
// and the dashboard cards.
import { useCallback } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  browserFolderAtom,
  browserModeAtom,
  selectedFileAtom,
  viewAtom,
  type View,
} from "./store.ts";
import type { Folder } from "../shared/ipc-types.ts";

/** The app-bar destinations. `files` and `wiki` both open the Browser, on its
 *  input and wiki folder respectively. */
export type NavigationTarget = "dashboard" | "chat" | "files" | "wiki";

export interface Navigation {
  showView: (view: View) => void;
  /** Open the Browser on a folder's file tree. Clears a selection that
   *  belongs to the other folder so the preview matches the tree. */
  showBrowser: (folder: Folder) => void;
}

export function useNavigation(): Navigation {
  const setView = useSetAtom(viewAtom);
  const setFolder = useSetAtom(browserFolderAtom);
  const setMode = useSetAtom(browserModeAtom);
  const setSelected = useSetAtom(selectedFileAtom);

  const showBrowser = useCallback(
    (folder: Folder): void => {
      setFolder(folder);
      setMode("files");
      setSelected((selected) => (selected?.startsWith(`${folder}/`) ? selected : null));
      setView("browser");
    },
    [setFolder, setMode, setSelected, setView],
  );

  return { showView: setView, showBrowser };
}

/** Which app-bar destination is active, or `null` for views without one
 *  (ingest log, settings). The Browser counts as "wiki" on its wiki folder
 *  and in graph mode, as "files" on the input folder. */
export function useActiveNavigationTarget(): NavigationTarget | null {
  const view = useAtomValue(viewAtom);
  const folder = useAtomValue(browserFolderAtom);
  const mode = useAtomValue(browserModeAtom);
  if (view === "dashboard" || view === "chat") return view;
  if (view !== "browser") return null;
  return mode === "graph" || folder === "wiki" ? "wiki" : "files";
}
