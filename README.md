# Open Wiki Studio

Local cross-platform desktop app (Windows, Linux, macOS) that wraps a Pi agent
running the [`pi-open-wiki`](../pi-open-wiki) extension. Pick a workspace folder,
connect an LLM once, drop documents into `input/`, run `/wiki-update`, and ask
questions in a chat whose input is auto-prefixed with `/wiki-query`.

See [ADR 0002](../docs/adr/0002-okf-wiki-studio-architecture.md) for the
architecture and [../design](../design) for the UI prototype + brand spec.

## Stack

- **Electron** main process hosts `@earendil-works/pi-coding-agent`
  (`createAgentSessionRuntime`) in-process; the `pi-open-wiki` extension is
  bundled and loaded via a `ResourceLoader`.
- **React + Jotai** renderer (dark-only, JOYclub brand — tokens in
  `src/renderer/styles/brand.css`, ported 1:1 from the prototype).
- `electron-vite` builds main / preload / renderer.

## Layout

```
app/
├── electron.vite.config.ts
├── package.json
├── src/
│   ├── shared/            # Result<T>, IPC contract (AgentApi), models
│   ├── main/              # Electron main: AgentRepository, IPC, config, files
│   ├── preload/          # contextBridge typed API
│   └── renderer/         # React UI (screens + components + store + brand.css)
└── tsconfig.json
```

## Develop

```bash
npm install
npm run dev        # electron-vite dev (launches Electron + HMR)
npm run check      # tsc --noEmit (strict, noUnusedLocals)
npm run build      # production build to out/
npm run package    # build + electron-builder (dmg/nsis/AppImage)
```

> **Electron binary:** `npm install` may skip Electron's postinstall under
> `allow-scripts`. If `npm run dev` complains the Electron binary is missing,
> approve scripts (`npm approve-scripts`) or run
> `node node_modules/electron/install.js` once.

Dev tools öffnen sich automatisch im Dev-Modus (`npm run dev`); in produktiven
Builds bleiben sie ausgeblendet.

## Release bauen

```bash
npm version patch          # Version hochziehen (optional)
npm run package            # electron-vite build + electron-builder → dist/
```

Unter `dist/` entsteht das plattformspezifische Artefakt (macOS: `dmg`, Windows:
`nsis`, Linux: `AppImage`). Für einen reinen Entpackt-Test ohne Installer:

```bash
npx electron-builder --dir
```

### Gebündelte `pi-okf-wiki`-Extension

Die Extension (`/wiki-query`, `/wiki-update`) wird als git-Dependency
(`github:Panzenbaby/pi-okf-wiki#0.1.0`) eingebunden; `npm install` checkt
den Tag in `node_modules/pi-okf-wiki` als echte Directory aus. Die Extension
ist selbstenthalten; ihre einzigen externen Imports sind `import type` von
`@earendil-works/pi-coding-agent`, die jiti beim Transpilieren entfernt.

Der Pi ResourceLoader lädt die Extension zur Laufzeit via **jiti** als
TypeScript. jiti liest die `.ts`-Dateien per `fs` direkt vom Datenträger — das
asar-virtual-filesystem wird von jiti nicht zuverlässig unterstützt. Deshalb
wird die Extension **nicht** ins asar gepackt, sondern über `extraResources`
nach `Contents/Resources/pi-okf-wiki/` (bzw. das Plattformäquivalent)
kopiert. `src/main/resource.ts` löst im Dev-Modus via
`require.resolve("pi-okf-wiki/package.json")` auf, im gepackten Build via
`process.resourcesPath`. Dementsprechend steht in `build.files` der Eintrag
`!node_modules/pi-okf-wiki`, damit die Extension nicht zusätzlich ins asar
wandert.

Für ein Extension-Update wird der Pin in `package.json` auf einen neuen
Tag/Commit gesetzt und `npm install` erneut ausgeführt.

### Isolierung vom Nutzer-Pi-Setup

Die App verwendet **nicht** das globale `~/.pi/agent` des Nutzers, sondern einen
eigenen, isolierten agentDir unter `app.getPath("userData")/agent`. Zusätzlich
wird beim ResourceLoader `noExtensions: true` gesetzt, sodass Pi **keine**
project-lokalen (`<workspace>/.pi/extensions/`) oder globalen Extensions lädt —
außer der gebündelten `pi-okf-wiki` via `additionalExtensionPaths`. Das verhindert
Command-Kollisionen (Pi benennt doppelte Commands in `wiki-query:1`/`:2` um,
was den Aufruf kaputt macht), die sonst aufträten, wenn der Nutzer z. B. `pi-okf-wiki`
ebenfalls project-lokal oder global installiert hat. LLM-Config liegt in der
app-eigenen `userData/config.json` und wird bei jeder Workspace-Aktivierung auf die
isolierte `authStorage` angewendet — eine separate Konfiguration des Nutzers
wird nicht berührt.

### Code-Signing (für verteilbare macOS-Releases)

Ohne Signing-Konfiguration baut electron-builder ein ad-hoc-signiertes oder
unsigniertes DMG. Für ein sauberes, notarisiertes Release in `package.json`
unter `build.mac` ergänzen:

```json
"mac": {
  "hardenedRuntime": true,
  "identity": "Developer ID Application: <Name>",
  "notarize": { "teamId": "<Team-ID>" }
}
```

und `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` als
Env-Variablen setzen. Für lokale Test-Builds ohne Signing:
`CSC_IDENTITY_AUTO_DISCOVERY=false npm run package`.

## How it wires together

- **Workspace picker** → `api.pickWorkspace()` (native folder dialog) or a
  recent workspace → `openWorkspace(path)` activates an `AgentRepository`
  (builds Pi services with the bundled extension on the
  `additionalExtensionPaths` list, creates a persistent `SessionManager` and a
  runtime).
- **First-run** → `api.configureLlm()` stores the key in Pi's `AuthStorage`
  (global) and sets the model on the chat + ingest sessions.
- **Chat** → composer sends `api.ask(question)`, which the main process runs as
  `session.prompt("/wiki-query <question>")`. Streaming events
  (`agent_start` / `text_delta` / `agent_end`) are forwarded over IPC and
  rendered live. Citations (`wiki/<concept-id>.md`) become clickable chips that
  open the concept in the Browser.
- **`/wiki-update`** → runs in a dedicated **ephemeral in-memory session** so
  chat sessions stay clean. After the turn, the main process snapshots the wiki
  before/after and emits an `IngestSummary` (created/updated/leftover counts).
- **Sessions** → Pi `SessionManager` per workspace (persistent JSONL);
  new/resume via the runtime.

## v1 scope

In: workspace picker + recents, first-run LLM connection, dashboard (folder
cards + ingest hero), chat (dark, with citation chips + sources list), file
browser (input/wiki/archive tree + markdown preview), add-to-input via the OS
dialog, ingest view with summary.

Out (deferred): light mode, full-text search, citation drawer with passage
highlight, PDF/image preview, advanced settings.

## Known caveats (validate on first run)

- **ESM main + Electron:** the main process is ESM (`"type": "module"`); requires
  Electron ≥ 28. If your Electron version rejects ESM, switch the main build to
  CJS in `electron.vite.config.ts`.
- **LLM provider config:** `configureLlm` supports Anthropic / OpenAI / Google
  via `AuthStorage.set` + `setModel`. OpenAI-compatible / Ollama with a custom
  `baseUrl` need a custom provider registration — wire via
  `services.modelRegistry` / `registerProvider` when you add them.
- The extension's `setWidget`/`notify` are no-ops in this host; the ingest
  summary is computed by the app from a wiki snapshot diff instead.