// Asks the user what to do with an API key that the OS keychain cannot
// encrypt (typically Linux without a running keyring daemon).
import { BrowserWindow, dialog, type WebContents } from "electron";
import { mainT } from "./i18n.ts";
import type { UnencryptedKeyChoice, UnencryptedKeyDecider } from "./config.ts";

export function askUnencryptedKeyChoice(webContents: WebContents): UnencryptedKeyDecider {
  return async (): Promise<UnencryptedKeyChoice> => {
    const options: Electron.MessageBoxOptions = {
      type: "warning",
      title: mainT("keyFallback.title"),
      message: mainT("keyFallback.message"),
      detail: mainT("keyFallback.detail"),
      buttons: [mainT("keyFallback.sessionOnly"), mainT("keyFallback.storePlaintext")],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    const window = BrowserWindow.fromWebContents(webContents);
    const result = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options);
    return result.response === 1 ? "store-plaintext" : "session-only";
  };
}
