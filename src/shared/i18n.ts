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

    // Provider sub-descriptions shown in the provider selector grid.
    "llf.anthropic.sub": "Claude · anthropic-messages",
    "llf.openai.sub": "GPT · openai-responses",
    "llf.google.sub": "Gemini · google",
    "llf.ollama.sub": "local · openai-completions",
    "llf.openai-compatible.sub": "custom endpoint (e.g. LM Studio)",

    // ── settings ──────────────────────────────────────────────────
    "settings.title": "LLM settings",
    "settings.desc": "Change the provider. Applies globally to all workspaces.",
    "settings.save": "Save",
    "settings.loading": "Loading configuration…",
    "settings.cancel": "Cancel",

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
    "chat.errorNoResponse":
      "The agent did not produce a response. Please try again.",

    // ── browser ───────────────────────────────────────────────────
    "browser.emptyFiles": "No files.",
    "browser.selectFile": "Select a file",
    "browser.addFiles": "Add files",
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
    "ingest.created": "created",
    "ingest.updated": "updated",
    "ingest.leftover": "leftover",
    "ingest.wikiSize": "wiki size",

    // ── main process / shared fallbacks ───────────────────────────
    "session.newDefault": "New question",
    "concept.untyped": "(untyped)",
    "error.allRetriesFailed": "All retry attempts failed",
    "error.ingestTimeout": "Ingest did not finish in time",
    "dialog.addFiles": "Add files to input/",
    "dialog.fileExists": "A file named \"{name}\" already exists in input/",
    "dialog.chooseWorkspace": "Choose a workspace folder",
    "dialog.startupError": "Open Wiki Studio — startup error",
    "error.windowLoad": "Failed to load renderer window",
    "error.windowCreate": "Could not create window",

    // ── session actions ──────────────────────────────────────────
    "session.delete": "Delete",
    "session.confirmDelete":
      "Delete this session? This cannot be undone.",

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

    "llf.anthropic.sub": "Claude · anthropic-messages",
    "llf.openai.sub": "GPT · openai-responses",
    "llf.google.sub": "Gemini · google",
    "llf.ollama.sub": "lokal · openai-completions",
    "llf.openai-compatible.sub":
      "benutzerdefinierter Endpunkt (z. B. LM Studio)",

    // ── settings ──────────────────────────────────────────────────
    "settings.title": "LLM-Einstellungen",
    "settings.desc":
      "Provider ändern. Gilt global für alle Workspaces.",
    "settings.save": "Speichern",
    "settings.loading": "Lade Konfiguration…",
    "settings.cancel": "Abbrechen",

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
    "chat.errorNoResponse":
      "Der Agent hat keine Antwort erzeugt. Bitte versuche es erneut.",

    // ── browser ───────────────────────────────────────────────────
    "browser.emptyFiles": "Keine Dateien.",
    "browser.selectFile": "Datei auswählen",
    "browser.addFiles": "Dateien hinzufügen",
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
    "dialog.addFiles": "Dateien zu input/ hinzufügen",
    "dialog.fileExists": "Eine Datei namens \"{name}\" existiert bereits in input/",
    "dialog.chooseWorkspace": "Workspace-Ordner wählen",
    "dialog.startupError": "Open Wiki Studio — Startfehler",
    "error.windowLoad": "Renderer-Fenster konnte nicht geladen werden",
    "error.windowCreate": "Fenster konnte nicht erstellt werden",

    // ── session actions ──────────────────────────────────────────
    "session.delete": "Löschen",
    "session.confirmDelete":
      "Diese Session löschen? Dies kann nicht rückgängig gemacht werden.",

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
