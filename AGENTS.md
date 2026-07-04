# Open Wiki Studio — Coding Rules

This document extends the global coding standards with project-specific
rules for **Open Wiki Studio**. Pi loads this file automatically as
project instructions.

---

## 1. Internationalization (I18N)

### 1.1 Golden Rule
**Every string that can appear in the UI, in a dialog, or as a
user-visible message MUST go through i18n — no hardcoded text.**

This applies to:
- React component text (labels, placeholders, hints, buttons, headings,
  empty states, errors)
- Electron dialog titles
- Electron `dialog.showErrorBox()` messages
- Fallback/default values for user-facing concepts (session names,
  concept types, etc.)
- The `document.title` / `BrowserWindow` title

### 1.2 Architecture
The i18n system is split into three layers:

| Layer | File | API |
|-------|------|-----|
| Shared dictionary | `src/shared/i18n.ts` | `messages`, `t(locale, key, params?)` |
| Renderer (React) | `src/renderer/i18n.ts` | `useT()` hook, `localeAtom` |
| Main process (Node) | `src/main/i18n.ts` | `mainT(key, params?)` |

All translations live in a single dictionary in `src/shared/i18n.ts`
with `en` and `de` locales. Adding a new string requires:
1. Add the key + English + German value to `messages` in
   `src/shared/i18n.ts`.
2. Use `t("your.key")` / `mainT("your.key")` in the code.

### 1.3 Renderer Usage

```tsx
import { useT } from "../i18n.ts";

function MyComponent(): JSX.Element {
  const t = useT();
  return <button>{t("my.button")}</button>;
}
```

Parameters use `{name}` placeholders:

```tsx
t("folder.count", { n: 5 }); // → "5 files" (en) / "5 Dateien" (de)
```

### 1.4 Main Process Usage

```typescript
import { mainT } from "./i18n.ts";

dialog.showErrorBox(mainT("dialog.startupError"), detail);
```

Locale detection: `app.getLocale()` (Electron), falling back to `en`.

---

✅ **Preferred:**
```tsx
<div>{t("app.loading")}</div>
```

❌ **Avoid:**
```tsx
<div>Loading…</div>
```
```tsx
<div>Lade…</div>
```

---

## 2. Session Default Names
Session names that appear in the UI (sidebar, dashboard) must never be
hardcoded. Use `mainT("session.newDefault")` in the main process and
`t("chat.titleFallback")` in the renderer.

---

## 3. Concept Fallbacks
When concept metadata is missing (e.g. no frontmatter `type`), use
`mainT("concept.untyped")` instead of `"(untyped)"`.

---

## 4. Provider Descriptions
The `LlmConfigForm` provider grid uses i18n keys (`llf.*.sub`) for
sub-descriptions. Provider *names* (Anthropic, OpenAI, …) are proper
nouns and do not need translation.

---

## 5. Ellipsis / Typographic Characters
The truncation ellipsis `…` is defined as `"app.ellipsis"` and reused
across components. Do not inline `"…"` or `"..."`.

---

## 6. Build
- **Build**: `npm run build`
- **Type-check**: `npx tsc --noEmit -p tsconfig.json`
