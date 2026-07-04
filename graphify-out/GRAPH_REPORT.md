# Graph Report - app  (2026-07-05)

## Corpus Check
- 45 files · ~16,949 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 345 nodes · 798 edges · 15 communities (14 shown, 1 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `effa7814`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Agent Runtime & Repository|Agent Runtime & Repository]]
- [[_COMMUNITY_Dependencies & Manifest|Dependencies & Manifest]]
- [[_COMMUNITY_Config & Recent Workspaces|Config & Recent Workspaces]]
- [[_COMMUNITY_TypeScript Config|TypeScript Config]]
- [[_COMMUNITY_LLM Config Form & IPC|LLM Config Form & IPC]]
- [[_COMMUNITY_Chat Message & Concept Links|Chat Message & Concept Links]]
- [[_COMMUNITY_Electron Builder Packaging|Electron Builder Packaging]]
- [[_COMMUNITY_Architecture & README Concepts|Architecture & README Concepts]]
- [[_COMMUNITY_Renderer State Atoms|Renderer State Atoms]]
- [[_COMMUNITY_App Shell & Sidebar|App Shell & Sidebar]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Wiki Scan & Snapshot Diff|Wiki Scan & Snapshot Diff]]
- [[_COMMUNITY_Auth & Wiki Query|Auth & Wiki Query]]
- [[_COMMUNITY_Wiki Update & Ingest Summary|Wiki Update & Ingest Summary]]

## God Nodes (most connected - your core abstractions)
1. `useT()` - 30 edges
2. `AgentRepository` - 26 edges
3. `ok()` - 26 edges
4. `errorMessage()` - 26 edges
5. `err()` - 24 edges
6. `t()` - 19 edges
7. `mainT()` - 18 edges
8. `Result` - 18 edges
9. `compilerOptions` - 18 edges
10. `Open Wiki Studio` - 13 edges

## Surprising Connections (you probably didn't know these)
- `renderer main.tsx entry` --semantically_similar_to--> `Open Wiki Studio`  [INFERRED] [semantically similar]
  src/renderer/index.html → README.md
- `toConceptInfo()` --calls--> `mainT()`  [EXTRACTED]
  src/main/frontmatter.ts → src/main/i18n.ts
- `Browser()` --calls--> `t()`  [INFERRED]
  src/renderer/screens/Browser.tsx → src/shared/i18n.ts
- `AgentRepository` --references--> `IngestSummary`  [EXTRACTED]
  src/main/agent.ts → src/shared/ipc-types.ts
- `AppState` --references--> `AgentRepository`  [EXTRACTED]
  src/main/index.ts → src/main/agent.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Wiki ingest flow** — readme_workspace_picker, readme_agentrepository, readme_wiki_update_command, readme_ingest_summary [INFERRED 0.85]

## Communities (15 total, 1 thin omitted)

### Community 0 - "Agent Runtime & Repository"
Cohesion: 0.09
Nodes (29): asString(), asStringArray(), ParsedDocument, parseDocument(), parseValue(), parseYaml(), toConceptInfo(), unquote() (+21 more)

### Community 1 - "Dependencies & Manifest"
Cohesion: 0.06
Nodes (34): author, dependencies, @earendil-works/pi-coding-agent, jotai, lucide-react, pi-okf-wiki, react, react-dom (+26 more)

### Community 2 - "Config & Recent Workspaces"
Cohesion: 0.14
Nodes (23): AgentRepository, appAgentDir(), extractText(), PiModule, addInputFiles(), getPreview(), listFolder(), RESERVED (+15 more)

### Community 3 - "TypeScript Config"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, baseUrl, esModuleInterop, isolatedModules, jsx, lib, module (+12 more)

### Community 4 - "LLM Config Form & IPC"
Cohesion: 0.14
Nodes (21): ContextMenu(), ContextMenuItem, ContextMenuPosition, ContextMenuProps, BranchProps, CtxPosition, FileTree(), FileTreeProps (+13 more)

### Community 5 - "Chat Message & Concept Links"
Cohesion: 0.20
Nodes (11): MarkdownView(), MarkdownViewProps, MessageProps, isConceptPath(), MdastNode, remarkConceptLinks(), splitLinks(), walk() (+3 more)

### Community 6 - "Electron Builder Packaging"
Cohesion: 0.15
Nodes (13): build, appId, extraResources, files, linux, mac, productName, win (+5 more)

### Community 7 - "Architecture & README Concepts"
Cohesion: 0.10
Nodes (21): ADR 0002 wiki studio architecture, AgentRepository, Code-Signing (für verteilbare macOS-Releases), Develop, ESM main + Electron caveat, Gebündelte `pi-okf-wiki`-Extension, How it wires together, Isolierung vom Nutzer-Pi-Setup (+13 more)

### Community 8 - "Renderer State Atoms"
Cohesion: 0.09
Nodes (49): AppShell(), IngestBar(), IngestBarProps, LlmConfigForm(), Message(), Sidebar(), SidebarProps, getLocale() (+41 more)

### Community 9 - "App Shell & Sidebar"
Cohesion: 0.10
Nodes (28): LlmConfigFormProps, ProviderDef, PROVIDERS, configPath(), ConfigShape, getLastWorkspace(), getLlmConfig(), listRecentWorkspaces() (+20 more)

### Community 10 - "Community 10"
Cohesion: 0.17
Nodes (11): 1.1 Golden Rule, 1.2 Architecture, 1.3 Renderer Usage, 1.4 Main Process Usage, 1. Internationalization (I18N), 2. Session Default Names, 3. Concept Fallbacks, 4. Provider Descriptions (+3 more)

### Community 12 - "Wiki Scan & Snapshot Diff"
Cohesion: 0.33
Nodes (8): conceptId(), isConcept(), listInputFiles(), RESERVED, snapshotWiki(), walk(), WikiDiff, WikiSnapshot

### Community 16 - "Auth & Wiki Query"
Cohesion: 0.67
Nodes (3): AuthStorage, Streaming chat with citation chips, /wiki-query command

## Knowledge Gaps
- **119 isolated node(s):** `name`, `version`, `description`, `type`, `license` (+114 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AgentRepository` connect `Config & Recent Workspaces` to `Agent Runtime & Repository`, `App Shell & Sidebar`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `mainT()` connect `App Shell & Sidebar` to `Agent Runtime & Repository`, `Renderer State Atoms`, `Config & Recent Workspaces`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `t()` connect `Renderer State Atoms` to `App Shell & Sidebar`, `LLM Config Form & IPC`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _122 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Agent Runtime & Repository` be split into smaller, more focused modules?**
  _Cohesion score 0.09047619047619047 - nodes in this community are weakly interconnected._
- **Should `Dependencies & Manifest` be split into smaller, more focused modules?**
  _Cohesion score 0.05714285714285714 - nodes in this community are weakly interconnected._
- **Should `Config & Recent Workspaces` be split into smaller, more focused modules?**
  _Cohesion score 0.13623188405797101 - nodes in this community are weakly interconnected._