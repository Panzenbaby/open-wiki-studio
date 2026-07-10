<div align="center">

[![Latest release](https://img.shields.io/github/v/release/Panzenbaby/open-wiki-studio?style=flat-square)](https://github.com/Panzenbaby/open-wiki-studio/releases)
[![Downloads](https://img.shields.io/github/downloads/Panzenbaby/open-wiki-studio/total?style=flat-square)](https://github.com/Panzenbaby/open-wiki-studio/releases)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](https://github.com/Panzenbaby/open-wiki-studio)
[![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)](#getting-started)
[![Made with Pi](https://img.shields.io/badge/made%20with-Pi-blue?style=flat-square)](https://github.com/earendil-works/pi-coding-agent)

</div>

# Open Wiki Studio

Open Wiki Studio is a local desktop app (Windows, macOS, Linux) that turns
your documents into a queryable wiki. It runs an AI agent on your machine: you
drop documents into a folder, the agent reads them and writes a knowledge base
of linked Markdown concepts, and you ask questions in a chat whose answers cite
the concepts they came from.

Everything stays local except the calls to the language model (LLM) you
connect. The wiki is plain Markdown following the
[OKF (Open Knowledge Format)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
spec, so your knowledge base is portable and not locked into this app.

---

## User Guide

### Getting started

Open Wiki Studio is distributed as a platform installer via
[GitHub Releases](https://github.com/Panzenbaby/open-wiki-studio/releases):
a `.dmg` for macOS, an NSIS installer for Windows, and an `AppImage` for Linux.

1. Download the installer for your platform and run it.
2. Launch **Open Wiki Studio**.
3. On first launch you choose a **workspace** — a folder that will hold your
   knowledge base. Pick any folder; the app creates the three working folders
   (`input/`, `wiki/`, `archive/`) inside it automatically if they are missing.
4. Each workspace is one independent knowledge base. You can switch between
   workspaces and reopen recently used ones from the picker.

> **macOS note:** builds are not code-signed, so the first launch may be
> blocked by Gatekeeper. Right-click the app → **Open**, then confirm, to run
> it.

Before you can ingest documents or ask questions, you need to connect a
language model — see [Connecting an LLM](#connecting-an-llm) below.

### Connecting an LLM

The agent needs a language model to read documents and answer questions. You
connect one **once** — the configuration is stored globally and applies to all
workspaces. You can change it later in **Settings**.

The app supports six providers. The API-key providers are documented first;
the rest are listed briefly below.

#### Anthropic, OpenAI, and Google (API key)

These three providers share the same flow:

1. Get an API key from your provider account (**Anthropic** for Claude,
   **OpenAI** for GPT, **Google** for Gemini).
2. In the **Connect an LLM** screen (first run) or **Settings**, pick the
   provider.
3. Paste your **API key**.
4. Click **Load models** — the provider's models appear in a dropdown.
5. Select a model, then click **Connect & start** (first run) or **Save**
   (Settings).

#### Other providers

- **Ollama** — runs a model on your own machine. Start the Ollama server
  first (`ollama serve`), then pick **Ollama** (the base URL defaults to
  `http://localhost:11434/v1`, no key needed), load models, and save.
- **OpenAI-compatible** — any endpoint that speaks the OpenAI completions API
  (e.g. LM Studio). Enter its **Base URL** and an optional API key, load
  models, and save.
- **GitHub Copilot** — uses OAuth instead of an API key. Click **Log in with
  GitHub**, open the verification URL, enter the displayed device code on
  GitHub, and authorize. Once signed in, pick a model and save.

### Dashboard

The dashboard is the home of a workspace. It shows:

- The workspace name and a summary of its contents (concepts, pending input,
  archived originals).
- Three folder cards — **Input**, **Wiki**, **Archive** — each showing how
  many files it holds. Click a card to browse that folder.
- An **ingest hero** that appears when files are waiting in `input/` or an
  ingest is running, with a shortcut to run or watch `/wiki-update`.
- Your recent **sessions** — click one to resume it, or start a new question.

Use **Switch workspace** to return to the workspace picker.

### Adding documents & ingesting

To build your wiki you add documents and run an ingest:

1. **Add documents to `input/`.** Drag files onto the app window (they always
   go to `input/`), use the **Add files** button in the Browser's Input view,
   or copy files into the `input/` folder on disk.
2. **Run `/wiki-update`.** From the dashboard (the ingest hero) or the ingest
   view, click **Run /wiki-update**. The agent reads each input file, writes a
   concept into `wiki/`, and moves the original to `archive/` once its concept
   exists.
3. **Read the summary.** When the run finishes, the ingest view shows counts:
   - **created** — new concepts written this run,
   - **updated** — existing concepts whose content changed,
   - **leftover** — files still in `input/` that the agent did not consume,
   - **wiki size** — total concepts now in the wiki.

   The view also lists each created concept and each leftover file by name.

**What "leftover" means:** a leftover file is one that is still in `input/`
after the run — the agent did not turn it into a concept. This usually means
the file format was not understood, the agent turn failed, or the LLM provider
was unreachable or misconfigured. Leftover files are not lost: they stay in
`input/` and you can try again after fixing the cause.

Each ingest runs in its own isolated session, so your chat history is never
touched by the ingest. You can re-run `/wiki-update` anytime; existing concepts
update in place when their source changed.

### Asking questions

Open the **Chat** view to ask questions about your wiki.

- Type a question and press **Enter** to send (**Shift+Enter** for a new line).
  Your text is sent to the agent automatically as `/wiki-query` — you never
  type the command yourself.
- Answers stream live. If the agent cites a concept, the citation appears as a
  clickable chip (e.g. `wiki/foo/bar.md`); clicking it opens that concept.
- If a turn fails, use **Retry** to re-ask the same question. Click **Stop** to
  abort a turn in progress.

### Browsing files & the wiki graph

The **Files** view lets you browse the three workspace folders and the wiki
graph.

- Switch between **Input**, **Wiki**, and **Archive** with the tabs at the
  top of the sidebar.
- Select a file to preview it. Wiki concepts are rendered as Markdown; other
  files are shown as text.
- Right-click a file to **reveal it in your file manager** (Finder on macOS,
  Explorer on Windows).
- The **Graph** tab shows the wiki as a force-directed graph: each concept is a
  node, colored by its type, and cross-references between concepts are edges.
  Click a node to open that concept. Use **+** / **−** to zoom and **Fit to
  screen** to frame the whole graph. A legend lists the types and their colors.

### The workspace contract

Every workspace is a folder containing three working folders:

| Folder | Holds |
|--------|-------|
| `input/` | New documents you have not yet ingested. |
| `wiki/` | The agent-authored knowledge base — a flat tree of Markdown concepts. |
| `archive/` | Originals moved here once their concept exists in the wiki. |

A **concept** is one `.md` file in `wiki/`. Its stable identifier — the
**conceptId** — is the file's path relative to `wiki/` with the `.md` suffix
removed (e.g. `wiki/foo/bar.md` → `foo/bar`). Links between concepts resolve to
conceptIds through that one rule.

Each concept can carry **frontmatter** at the top of the file:

```yaml
---
type: ...
title: ...
description: ...
tags: [...]
```

The files `index.md` and `log.md` are **reserved**: they are generated by the
agent, not hand-authored concepts.

#### What is OKF, and why does it matter?

The wiki follows the **OKF (Open Knowledge Format)** — a Markdown-first,
open specification for portable knowledge bases, originally published by
Google. You can read the full spec at
<https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md>.

This matters because it means your wiki is **not a proprietary database**: it
is a folder of plain Markdown files with a defined structure. You can read and
edit the concepts with any text editor, version them with git, move them
between machines, and use them with other tools that understand OKF. Open Wiki
Studio is one viewer and authoring tool for that format — your knowledge stays
yours.

---

## For developers

### Stack

- **Electron ≥31** main process hosts `@earendil-works/pi-coding-agent`
  in-process via `createAgentSessionServices`. The `pi-okf-wiki` extension
  (`/wiki-query`, `/wiki-update`) is bundled and loaded by the Pi
  `ResourceLoader` at runtime.
- **React 18 + Jotai** renderer (dark-only).
- **`electron-vite`** builds the main / preload / renderer bundles.

### Layout

```
src/
├── shared/      # Result<T>, IPC contract (AgentApi), shared models/text helpers
├── main/        # Electron main: AgentRepository, IPC bridge, config, files,
│                #   concept store, model catalog, chat session pool, wiki scan/graph
├── preload/     # contextBridge typed AgentApi
└── renderer/    # React UI — screens + components + Jotai store + brand.css
```

For the deeper module responsibilities and how the layers wire together, see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Develop & test

```bash
npm install
npm run dev        # electron-vite dev (launches Electron + HMR; dev tools auto-open)
npm run check      # tsc --noEmit (strict)
npm run test       # vitest run
npm run test:watch # vitest in watch mode
```

> **Electron binary:** `npm install` may skip Electron's postinstall under
> `allow-scripts`. If `npm run dev` complains the Electron binary is missing,
> run `npm approve-scripts` (or `node node_modules/electron/install.js` once).

Tests run in a plain Node environment with `electron` mocked in
`test/setup.ts`. There is one test file per deep module: `concept-store`,
`model-catalog`, `chat-session-pool`, and `agent-events`.

### Building locally

```bash
npm run build      # production build to out/
```

Platform installers and code-signing are configured under `build` in
`package.json` (see the `package:*` scripts) but are out of scope for everyday
local development.