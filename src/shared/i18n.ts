// Shared i18n dictionary + pure t() function — usable from both renderer
// and main process without any framework dependency (no React, no Jotai).
export type Locale = "de" | "en";
type Dict = Record<string, string>;
export type I18nParams = Record<string, string | number>;

export const messages: Record<Locale, Dict> = {
  en: {
    // ── app ────────────────────────────────────────────────────────
    "app.name": "Open Wiki Studio",
    "app.loading": "Loading…",
    "app.avatar": "O",
    "app.ellipsis": "…",

    // ── navigation ─────────────────────────────────────────────────
    "nav.chat": "Chat",
    "nav.workspace": "Dashboard",
    "nav.files": "Files",
    "nav.settings": "Settings",
    "nav.switchWorkspace": "Switch workspace",

    // ── workspace picker ───────────────────────────────────────────
    "picker.title": "Choose a workspace",
    "picker.desc":
      "The workspace is the folder containing input/, wiki/ and archive/ (they will be created if missing).",
    "picker.chooseFolder": "Choose folder…",
    "picker.recent": "Recently opened",
    "picker.openFailed": "Could not open workspace",
    "picker.pickFailed": "Could not choose folder",
    "picker.forget": "Remove from list",
    "picker.confirmForget":
      "Remove this workspace from the recent list? The folder itself stays untouched.",
    "picker.forgetFailed": "Could not remove workspace",
    "picker.missing": "Folder no longer exists",

    // ── first run ─────────────────────────────────────────────────
    "firstrun.title": "Connect an LLM",
    "firstrun.desc": "Stored globally and used for all workspaces.",
    "firstrun.submit": "Connect & start",

    // ── LLM config form ────────────────────────────────────────────
    "llf.provider": "Provider",
    "llf.modelId": "Model ID",
    "llf.modelIdHint": "Full model ID of the provider.",
    "llf.baseUrl": "Base URL",
    "llf.apiKey": "API key",
    "llf.apiKeyOptional": "optional",
    "llf.apiKeyRequired": "An API key is required for this provider.",
    "llf.saveFailed": "Could not save configuration",
    "llf.loadModels": "Load models",
    "llf.loadModelsBusy": "Loading models",
    "llf.loadModelsFailed": "Could not load models",
    "llf.noModels": "No models available. Check your key / endpoint and try again.",
    "llf.selectModel": "Model",

    // Provider sub-descriptions shown in the provider selector grid.
    "llf.anthropic.sub": "Claude · anthropic-messages",
    "llf.openai.sub": "GPT · openai-responses",
    "llf.google.sub": "Gemini · google",
    "llf.ollama.sub": "local · openai-completions",
    "llf.openai-compatible.sub": "custom endpoint (e.g. LM Studio)",
    "llf.github-copilot.sub": "Copilot · OAuth (github.com)",

    // ── GitHub Copilot OAuth login ──────────────────────────────────
    "copilot.login": "Log in with GitHub",
    "copilot.logout": "Log out",
    "copilot.loggedIn": "Signed in to GitHub Copilot",
    "copilot.loggingIn": "Signing in…",
    "copilot.cancel": "Cancel login",
    "copilot.deviceCode": "Device code",
    "copilot.deviceCodeHint":
      "Enter this code on GitHub, then authorize. The code refreshes automatically if it expires.",
    "copilot.openUrl": "Open GitHub",
    "copilot.progress": "Preparing models…",
    "copilot.loginFailed": "GitHub login failed",
    "copilot.loginCancelled": "Login cancelled",
    "copilot.noModels": "No Copilot models are available for your account.",
    "copilot.selectModel": "Model",

    // ── auto-update ───────────────────────────────────────────────
    "update.tooltipAvailable": "A new version is available",
    "update.tooltipReady": "Update ready — install on next restart",
    "update.tooltipDownloading": "Downloading update…",
    "update.availableTitle": "Update available",
    "update.availableDesc": "Version {version} is available. You are currently running {current}.",
    "update.availableHint": "The update will be downloaded in the background. You can keep working.",
    "update.install": "Download & prepare",
    "update.later": "Later",
    "update.readyTitle": "Update ready",
    "update.readyDesc": "Version {version} has been downloaded and is ready to install.",
    "update.readyHint": "Restart now to finish the update, or install it automatically on the next launch.",
    "update.restartNow": "Restart & install",
    "update.nextLaunch": "On next launch",
    "update.downloadFailed": "Could not download the update",
    "update.downloadFailedReason": "Could not download the update: {reason}",
    "update.checkFailed": "Could not check for updates",
    "update.installFailed": "Could not install the update",
    "copilot.copyCode": "Copy code",
    "copilot.copied": "Code copied",
    "copilot.copyFailed": "Could not copy code",

    // ── settings ──────────────────────────────────────────────────
    "settings.title": "LLM settings",
    "settings.desc": "Change the provider. Applies globally to all workspaces.",
    "settings.save": "Save",
    "settings.loading": "Loading configuration…",
    "settings.cancel": "Cancel",
    "settings.version": "Version {version}",

    // ── dashboard ─────────────────────────────────────────────────
    "dashboard.kicker": "Workspace · {name}",
    "dashboard.title": "Knowledge base \u201c{name}\u201d",
    "dashboard.summary":
      "{wiki} concepts · {input} pending · {archive} archived originals.",
    "dashboard.newQuestion": "New question",
    "dashboard.inputWaiting": "{n} files waiting in input/",
    "dashboard.ingestHint":
      "Run /wiki-update to ingest them as concepts into the wiki.",
    "dashboard.viewInput": "View input",
    "dashboard.runUpdate": "Run /wiki-update",
    "dashboard.ingestRunning": "/wiki-update is running",
    "dashboard.ingestRunningSub":
      "The agent is transforming input files. Open the ingest view to watch progress.",
    "dashboard.viewProgress": "View progress",

    // ── folder cards ──────────────────────────────────────────────
    "folder.input.name": "Input",
    "folder.wiki.name": "Wiki",
    "folder.archive.name": "Archive",
    "folder.input.count": "{n} files · pending",
    "folder.input.desc": "New, not yet ingested documents.",
    "folder.wiki.count": "{n} concepts",
    "folder.wiki.desc":
      "The OKF knowledge bundle: markdown concepts in wiki/.",
    "folder.archive.count": "{n} originals",
    "folder.archive.desc":
      "Originals after ingest, once their concept exists in the wiki.",
    "folder.pending": "{n} pending",

    // ── chat ──────────────────────────────────────────────────────
    "chat.titleFallback": "New question",
    "chat.command": "/wiki-query",
    "chat.emptyTitle": "Ask a question about the wiki",
    "chat.emptySub":
      "Your input is sent to the agent automatically as /wiki-query. Answers cite wiki/<concept-id>.md sources.",
    "chat.placeholder": "Ask the wiki…",
    "chat.hintSend": "Enter to send · Shift+Enter for a new line",
    "chat.hintAuto": "auto: /wiki-query",
    "chat.roleUser": "You",
    "chat.roleAgent": "Open Wiki Studio",
    "chat.retry": "Retry",
    "chat.stop": "Stop",
    "chat.errorNoResponse":
      "The agent did not produce a response. Please try again.",
    "chat.errorPrefix": "Chat error",

    // ── browser ───────────────────────────────────────────────────
    "browser.emptyFiles": "No files.",
    "browser.selectFile": "Select a file",
    "browser.addFiles": "Add",
    "browser.dropHint": "Drop files or folders to add to input/",
    "browser.dropAdded": "Added {n} file(s) to input/",
    "addFiles.toastAddedSkipped": "Added {n} file(s), {m} skipped",
    "addFiles.toastEmpty": "No files found to add.",
    "addFiles.summaryTitle": "Add files — summary",
    "addFiles.sectionAdded": "Added",
    "addFiles.sectionSkipped": "Skipped",
    "addFiles.sectionFailed": "Failed",
    "addFiles.close": "Close",
    "addFiles.skippedExists": "Already exists in input/",
    "addFiles.skippedSymlink": "Symlink, not followed",
    "browser.reveal.finder": "Reveal in Finder",
    "browser.reveal.explorer": "Reveal in Explorer",
    "browser.reveal.fileManager": "Reveal in file manager",

    // ── sidebar ───────────────────────────────────────────────────
    "sidebar.sessions": "Sessions",
    "sidebar.noSessions": "No sessions yet.",
    "sidebar.newQuestion": "New question",
    "sidebar.toggle": "Show sessions",

    // ── ingest bar ────────────────────────────────────────────────
    "ingestbar.running": "/wiki-update running",
    "ingestbar.runningSub": "Agent transforming non-conformant files…",
    "ingestbar.view": "View",
    "ingestbar.pending": "{n} files pending in input/",
    "ingestbar.pendingSub":
      "Run /wiki-update to ingest them as concepts.",
    "ingestbar.run": "Run /wiki-update",

    // ── ingest view ───────────────────────────────────────────────
    "ingest.title": "/wiki-update",
    "ingest.run": "Run /wiki-update",
    "ingest.stateRunning": "running…",
    "ingest.stateDone": "complete",
    "ingest.stateIdle": "ready",
    "ingest.ready":
      "Ready. Run /wiki-update from the workspace to ingest input/ into the wiki.",
    "ingest.transforming": "Agent transforming non-conformant files…",
    "ingest.processing": "Processing {n} input file(s)…",
    "ingest.processingSub": "The agent reads each input file and writes it into the wiki as a concept.",
    "ingest.done": "Ingest complete.",
    "ingest.errorPrefix": "Ingest failed",
    "error.ingestNoProgress":
      "Ingest produced no changes — the provider may be misconfigured or unreachable",
    "error.modelNotFound": "Model not found in registry: {provider}/{modelId}",
    "error.createAgent": "Failed to create agent: {detail}",
    "error.listModels": "Failed to list models: {detail}",
    "error.cancelLogin": "Failed to cancel login: {detail}",
    "error.logout": "Failed to log out: {detail}",
    "error.listSessions": "Failed to list sessions: {detail}",
    "error.createSession": "Failed to create session: {detail}",
    "error.deleteSession": "Failed to delete session: {detail}",
    "error.openSession": "Failed to open session: {detail}",
    "error.readSession": "Failed to read session: {detail}",
    "error.noActiveSession": "No active session",
    "error.cannotDeleteActiveSession": "Cannot delete the active session",
    "error.baseUrlRequired": "Base URL required",
    "error.ollamaNoModels": "No Ollama models found (is the server running at {baseUrl}?)",
    "error.endpointNoModels": "No models returned by the endpoint at {url}",
    "error.activateWorkspace": "Failed to activate workspace: {detail}",
    "error.openUrl": "Failed to open URL: {detail}",
    "error.unknownProvider": "Unknown provider: {provider}",
    "error.listFolder": "Failed to list {folder}: {detail}",
    "error.readFile": "Failed to read {path}: {detail}",
    "error.addInputFiles": "Failed to add input files: {detail}",
    "error.revealFile": "Failed to reveal {path}: {detail}",
    "error.buildWikiGraph": "Failed to build wiki graph: {detail}",
    "error.rememberWorkspace": "Failed to remember workspace: {detail}",
    "error.forgetWorkspace": "Failed to remove workspace: {detail}",
    "error.saveLlmConfig": "Failed to save LLM config: {detail}",
    "error.invalidPath": "Invalid path: {path}",
    "error.openFolder": "Failed to open folder: {detail}",
    "error.invalidUrl": "Invalid URL",
    "error.notADirectory": "Not a directory: {path}",
    "error.workspaceNotFound": "Workspace not found: {path}",
    "error.invalidWorkspacePath": "Invalid workspace path",
    "ingest.created": "created",
    "ingest.updated": "updated",
    "ingest.leftover": "leftover",
    "ingest.wikiSize": "wiki size",

    // ── main process / shared fallbacks ───────────────────────────
    "session.newDefault": "New question",
    "concept.untyped": "(untyped)",
    "error.allRetriesFailed": "All retry attempts failed",
    "error.ingestTimeout": "Ingest did not finish in time",
    "dialog.addFiles": "Add to input/",
    "dialog.chooseWorkspace": "Choose a workspace folder",
    "dialog.startupError": "Open Wiki Studio — startup error",
    "error.windowLoad": "Failed to load renderer window",
    "error.windowCreate": "Could not create window",

    // ── session actions ──────────────────────────────────────────
    "session.delete": "Delete",
    "session.confirmDelete":
      "Delete this session? This cannot be undone.",
    "session.streaming": "Generating answer…",

    // ── wiki graph ─────────────────────────────────────────────────
    "nav.graph": "Graph",
    "graph.title": "Wiki Graph",
    "graph.desc": "Concepts and the links between them.",
    "graph.loading": "Building graph…",
    "graph.empty": "No concepts yet. Run /wiki-update to build the wiki.",
    "graph.nodes": "{n} concepts",
    "graph.edges": "{n} links",
    "graph.zoomIn": "Zoom in",
    "graph.zoomOut": "Zoom out",
    "graph.fit": "Fit to screen",
    "graph.legend": "Types",
    "graph.type.index": "Index",
    "graph.type.log": "Log",
  },
  de: {
    // ── app ────────────────────────────────────────────────────────
    "app.name": "Open Wiki Studio",
    "app.loading": "Lade…",
    "app.avatar": "O",
    "app.ellipsis": "…",

    // ── navigation ─────────────────────────────────────────────────
    "nav.chat": "Chat",
    "nav.workspace": "Dashboard",
    "nav.files": "Dateien",
    "nav.settings": "Einstellungen",
    "nav.switchWorkspace": "Workspace wechseln",

    // ── workspace picker ───────────────────────────────────────────
    "picker.title": "Wähle einen Workspace",
    "picker.desc":
      "Der Workspace ist der Ordner, der input/, wiki/ und archive/ enthält (oder sie werden angelegt).",
    "picker.chooseFolder": "Ordner wählen…",
    "picker.recent": "Zuletzt geöffnet",
    "picker.openFailed": "Workspace konnte nicht geöffnet werden",
    "picker.pickFailed": "Ordner konnte nicht gewählt werden",
    "picker.forget": "Aus Liste entfernen",
    "picker.confirmForget":
      "Diesen Workspace aus der Liste entfernen? Der Ordner selbst bleibt unangetastet.",
    "picker.forgetFailed": "Workspace konnte nicht entfernt werden",
    "picker.missing": "Ordner existiert nicht mehr",

    // ── first run ─────────────────────────────────────────────────
    "firstrun.title": "LLM verbinden",
    "firstrun.desc":
      "Wird global gespeichert und für alle Workspaces genutzt.",
    "firstrun.submit": "Verbinden & starten",

    // ── LLM config form ────────────────────────────────────────────
    "llf.provider": "Provider",
    "llf.modelId": "Modell-ID",
    "llf.modelIdHint": "Vollständige Modell-ID des Providers.",
    "llf.baseUrl": "Base URL",
    "llf.apiKey": "API-Key",
    "llf.apiKeyOptional": "optional",
    "llf.apiKeyRequired": "Für diesen Anbieter ist ein API-Schlüssel erforderlich.",
    "llf.saveFailed": "Konfiguration konnte nicht gespeichert werden",
    "llf.loadModels": "Modelle laden",
    "llf.loadModelsBusy": "Lade Modelle",
    "llf.loadModelsFailed": "Modelle konnten nicht geladen werden",
    "llf.noModels": "Keine Modelle verfügbar. Schlüssel / Endpunkt prüfen und erneut versuchen.",
    "llf.selectModel": "Modell",

    "llf.anthropic.sub": "Claude · anthropic-messages",
    "llf.openai.sub": "GPT · openai-responses",
    "llf.google.sub": "Gemini · google",
    "llf.ollama.sub": "lokal · openai-completions",
    "llf.openai-compatible.sub":
      "benutzerdefinierter Endpunkt (z. B. LM Studio)",
    "llf.github-copilot.sub": "Copilot · OAuth (github.com)",

    // ── GitHub-Copilot-OAuth-Login ──────────────────────────────────
    "copilot.login": "Mit GitHub anmelden",
    "copilot.logout": "Abmelden",
    "copilot.loggedIn": "Bei GitHub Copilot angemeldet",
    "copilot.loggingIn": "Anmeldung läuft…",
    "copilot.cancel": "Anmeldung abbrechen",
    "copilot.deviceCode": "Gerätecode",
    "copilot.deviceCodeHint":
      "Gib diesen Code auf GitHub ein und autorisiere. Der Code erneuert sich automatisch, falls er abläuft.",
    "copilot.openUrl": "GitHub öffnen",
    "copilot.progress": "Modelle werden vorbereitet…",
    "copilot.loginFailed": "GitHub-Anmeldung fehlgeschlagen",
    "copilot.loginCancelled": "Anmeldung abgebrochen",
    "copilot.noModels": "Für dein Konto sind keine Copilot-Modelle verfügbar.",
    "copilot.selectModel": "Modell",

    // ── auto-update ───────────────────────────────────────────────
    "update.tooltipAvailable": "Eine neue Version ist verfügbar",
    "update.tooltipReady": "Update bereit — beim nächsten Neustart installieren",
    "update.tooltipDownloading": "Update wird heruntergeladen…",
    "update.availableTitle": "Update verfügbar",
    "update.availableDesc": "Version {version} ist verfügbar. Du nutzt aktuell {current}.",
    "update.availableHint": "Das Update wird im Hintergrund heruntergeladen. Du kannst weiterarbeiten.",
    "update.install": "Herunterladen & vorbereiten",
    "update.later": "Später",
    "update.readyTitle": "Update bereit",
    "update.readyDesc": "Version {version} wurde heruntergeladen und ist bereit zur Installation.",
    "update.readyHint": "Jetzt neu starten, um das Update abzuschließen, oder beim nächsten Start automatisch installieren.",
    "update.restartNow": "Neu starten & installieren",
    "update.nextLaunch": "Beim nächsten Start",
    "update.downloadFailed": "Update konnte nicht heruntergeladen werden",
    "update.downloadFailedReason": "Update konnte nicht heruntergeladen werden: {reason}",
    "update.checkFailed": "Update-Prüfung fehlgeschlagen",
    "update.installFailed": "Update konnte nicht installiert werden",
    "copilot.copyCode": "Code kopieren",
    "copilot.copied": "Code kopiert",
    "copilot.copyFailed": "Code konnte nicht kopiert werden",

    // ── settings ──────────────────────────────────────────────────
    "settings.title": "LLM-Einstellungen",
    "settings.desc":
      "Provider ändern. Gilt global für alle Workspaces.",
    "settings.save": "Speichern",
    "settings.loading": "Lade Konfiguration…",
    "settings.cancel": "Abbrechen",
    "settings.version": "Version {version}",

    // ── dashboard ─────────────────────────────────────────────────
    "dashboard.kicker": "Workspace · {name}",
    "dashboard.title": "Wissensbasis \u201e{name}\u201c",
    "dashboard.summary":
      "{wiki} Concepts · {input} ausstehend · {archive} archivierte Originale.",
    "dashboard.newQuestion": "Neue Frage",
    "dashboard.inputWaiting": "{n} Dateien warten in input/",
    "dashboard.ingestHint":
      "Führe /wiki-update aus, um sie als Concepts ins Wiki zu übernehmen.",
    "dashboard.viewInput": "Input ansehen",
    "dashboard.runUpdate": "Run /wiki-update",
    "dashboard.ingestRunning": "/wiki-update wird ausgeführt",
    "dashboard.ingestRunningSub":
      "Der Agent verarbeitet die Input-Dateien. Öffne die Ingest-Ansicht, um den Fortschritt zu sehen.",
    "dashboard.viewProgress": "Fortschritt ansehen",

    // ── folder cards ──────────────────────────────────────────────
    "folder.input.name": "Input",
    "folder.wiki.name": "Wiki",
    "folder.archive.name": "Archive",
    "folder.input.count": "{n} Dateien · ausstehend",
    "folder.input.desc": "Neue, noch nicht ingested Dokumente.",
    "folder.wiki.count": "{n} Concepts",
    "folder.wiki.desc":
      "Der OKF-Wissensbundel: markdown concepts in wiki/.",
    "folder.archive.count": "{n} Originale",
    "folder.archive.desc":
      "Originale nach Ingest, sobald ihr Concept im Wiki existiert.",
    "folder.pending": "{n} ausstehend",

    // ── chat ──────────────────────────────────────────────────────
    "chat.titleFallback": "Neue Frage",
    "chat.command": "/wiki-query",
    "chat.emptyTitle": "Stelle eine Frage ans Wiki",
    "chat.emptySub":
      "Deine Eingabe wird automatisch als /wiki-query an den Agent geschickt. Antworten zitieren wiki/<concept-id>.md-Quellen.",
    "chat.placeholder": "Frage an das Wiki stellen…",
    "chat.hintSend": "Enter senden · Shift+Enter Zeilenumbruch",
    "chat.hintAuto": "auto: /wiki-query",
    "chat.roleUser": "Du",
    "chat.roleAgent": "Open Wiki Studio",
    "chat.retry": "Erneut versuchen",
    "chat.stop": "Stopp",
    "chat.errorNoResponse":
      "Der Agent hat keine Antwort erzeugt. Bitte versuche es erneut.",
    "chat.errorPrefix": "Chat-Fehler",

    // ── browser ───────────────────────────────────────────────────
    "browser.emptyFiles": "Keine Dateien.",
    "browser.selectFile": "Datei auswählen",
    "browser.addFiles": "Hinzufügen",
    "browser.dropHint": "Dateien oder Ordner ablegen, um sie zu input/ hinzuzufügen",
    "browser.dropAdded": "{n} Datei(en) zu input/ hinzugefügt",
    "addFiles.toastAddedSkipped": "{n} Datei(en) hinzugefügt, {m} übersprungen",
    "addFiles.toastEmpty": "Keine Dateien zum Hinzufügen gefunden.",
    "addFiles.summaryTitle": "Dateien hinzufügen — Zusammenfassung",
    "addFiles.sectionAdded": "Hinzugefügt",
    "addFiles.sectionSkipped": "Übersprungen",
    "addFiles.sectionFailed": "Fehlgeschlagen",
    "addFiles.close": "Schließen",
    "addFiles.skippedExists": "Existiert bereits in input/",
    "addFiles.skippedSymlink": "Symlink, nicht gefolgt",
    "browser.reveal.finder": "Im Finder anzeigen",
    "browser.reveal.explorer": "Im Explorer anzeigen",
    "browser.reveal.fileManager": "Im Dateimanager anzeigen",

    // ── sidebar ───────────────────────────────────────────────────
    "sidebar.sessions": "Sessions",
    "sidebar.noSessions": "Noch keine Sessions.",
    "sidebar.newQuestion": "Neue Frage",
    "sidebar.toggle": "Sessions anzeigen",

    // ── ingest bar ────────────────────────────────────────────────
    "ingestbar.running": "/wiki-update läuft",
    "ingestbar.runningSub":
      "Agent transformiert nicht-konforme Dateien…",
    "ingestbar.view": "Ansehen",
    "ingestbar.pending": "{n} Dateien in input/ ausstehend",
    "ingestbar.pendingSub":
      "/wiki-update ausführen, um als Concepts zu übernehmen.",
    "ingestbar.run": "Run /wiki-update",

    // ── ingest view ───────────────────────────────────────────────
    "ingest.title": "/wiki-update",
    "ingest.run": "Run /wiki-update",
    "ingest.stateRunning": "läuft…",
    "ingest.stateDone": "abgeschlossen",
    "ingest.stateIdle": "bereit",
    "ingest.ready":
      "Bereit. Führe /wiki-update aus dem Workspace aus, um input/ ins Wiki zu übernehmen.",
    "ingest.transforming":
      "Agent transformiert nicht-konforme Dateien…",
    "ingest.processing": "Verarbeite {n} Input-Datei(en)…",
    "ingest.processingSub": "Der Agent liest jede Input-Datei und schreibt sie als Concept ins Wiki.",
    "ingest.done": "Ingest abgeschlossen.",
    "ingest.errorPrefix": "Ingest fehlgeschlagen",
    "error.ingestNoProgress":
      "Ingest hat keine Änderungen erzeugt — der Provider ist womöglich falsch konfiguriert oder nicht erreichbar",
    "error.modelNotFound": "Modell nicht in Registry gefunden: {provider}/{modelId}",
    "error.createAgent": "Agent konnte nicht erstellt werden: {detail}",
    "error.listModels": "Modelle konnten nicht geladen werden: {detail}",
    "error.cancelLogin": "Login-Abbruch fehlgeschlagen: {detail}",
    "error.logout": "Abmeldung fehlgeschlagen: {detail}",
    "error.listSessions": "Sitzungen konnten nicht geladen werden: {detail}",
    "error.createSession": "Sitzung konnte nicht erstellt werden: {detail}",
    "error.deleteSession": "Sitzung konnte nicht gelöscht werden: {detail}",
    "error.openSession": "Sitzung konnte nicht geöffnet werden: {detail}",
    "error.readSession": "Sitzung konnte nicht gelesen werden: {detail}",
    "error.noActiveSession": "Keine aktive Sitzung",
    "error.cannotDeleteActiveSession": "Die aktive Sitzung kann nicht gelöscht werden",
    "error.baseUrlRequired": "Base-URL erforderlich",
    "error.ollamaNoModels": "Keine Ollama-Modelle gefunden (läuft der Server unter {baseUrl}?)",
    "error.endpointNoModels": "Der Endpunkt unter {url} hat keine Modelle zurückgegeben",
    "error.activateWorkspace": "Workspace konnte nicht aktiviert werden: {detail}",
    "error.openUrl": "URL konnte nicht geöffnet werden: {detail}",
    "error.unknownProvider": "Unbekannter Provider: {provider}",
    "error.listFolder": "{folder} konnte nicht geladen werden: {detail}",
    "error.readFile": "{path} konnte nicht gelesen werden: {detail}",
    "error.addInputFiles": "Input-Dateien konnten nicht hinzugefügt werden: {detail}",
    "error.revealFile": "{path} konnte nicht angezeigt werden: {detail}",
    "error.buildWikiGraph": "Wiki-Graph konnte nicht erstellt werden: {detail}",
    "error.rememberWorkspace": "Workspace konnte nicht gespeichert werden: {detail}",
    "error.forgetWorkspace": "Workspace konnte nicht entfernt werden: {detail}",
    "error.saveLlmConfig": "LLM-Konfiguration konnte nicht gespeichert werden: {detail}",
    "error.invalidPath": "Ungültiger Pfad: {path}",
    "error.openFolder": "Ordner konnte nicht geöffnet werden: {detail}",
    "error.invalidUrl": "Ungültige URL",
    "error.notADirectory": "Kein Verzeichnis: {path}",
    "error.workspaceNotFound": "Workspace nicht gefunden: {path}",
    "error.invalidWorkspacePath": "Ungültiger Workspace-Pfad",
    "ingest.created": "created",
    "ingest.updated": "updated",
    "ingest.leftover": "leftover",
    "ingest.wikiSize": "wiki size",

    // ── main process / shared fallbacks ───────────────────────────
    "session.newDefault": "Neue Frage",
    "concept.untyped": "(untypisiert)",
    "error.allRetriesFailed":
      "Alle Wiederholungsversuche fehlgeschlagen",
    "error.ingestTimeout": "Ingest wurde nicht rechtzeitig abgeschlossen",
    "dialog.addFiles": "Zu input/ hinzufügen",
    "dialog.chooseWorkspace": "Workspace-Ordner wählen",
    "dialog.startupError": "Open Wiki Studio — Startfehler",
    "error.windowLoad": "Renderer-Fenster konnte nicht geladen werden",
    "error.windowCreate": "Fenster konnte nicht erstellt werden",

    // ── session actions ──────────────────────────────────────────
    "session.delete": "Löschen",
    "session.confirmDelete":
      "Diese Session löschen? Dies kann nicht rückgängig gemacht werden.",
    "session.streaming": "Antwort wird erstellt…",

    // ── wiki graph ─────────────────────────────────────────────────
    "nav.graph": "Graph",
    "graph.title": "Wiki-Graph",
    "graph.desc": "Concepts und ihre Verlinkungen.",
    "graph.loading": "Graph wird erstellt…",
    "graph.empty": "Noch keine Concepts. Führe /wiki-update aus, um das Wiki aufzubauen.",
    "graph.nodes": "{n} Concepts",
    "graph.edges": "{n} Verlinkungen",
    "graph.zoomIn": "Vergrößern",
    "graph.zoomOut": "Verkleinern",
    "graph.fit": "An Bildschirm anpassen",
    "graph.legend": "Typen",
    "graph.type.index": "Index",
    "graph.type.log": "Log",
  },
};

/** Pure, framework-free translation function. */
export function t(
  locale: Locale,
  key: string,
  params?: I18nParams,
): string {
  let s = messages[locale][key] ?? messages.en[key] ?? key;
  if (params) {
    for (const name of Object.keys(params)) {
      s = s.replaceAll(`{${name}}`, String(params[name]));
    }
  }
  return s;
}
