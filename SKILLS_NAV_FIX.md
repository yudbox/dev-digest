# Skills Lab — Sidebar Navigation Fix

## Проблема

На скрине видно: в сайдбаре есть только секция `WORKSPACE` с двумя пунктами — Pull Requests и Agents.

По дизайну должно быть:
- `WORKSPACE` → только Pull Requests
- `SKILLS LAB` (новая секция) → Skills, Agents
- Breadcrumb уже правильный — оба файла i18n уже содержат "Skills Lab"

---

## Что менять

**Один файл:**

```
client/src/vendor/ui/nav.ts
```

---

## Текущий код (что есть сейчас)

```ts
export const NAV: NavGroup[] = [
  {
    section: "WORKSPACE",
    items: [
      { key: "pulls", label: "Pull Requests", icon: "GitPullRequest", href: "/repos/:repoId/pulls", gKey: "p" },
      { key: "agents", label: "Agents", icon: "Cpu", href: "/agents", gKey: "a" },
    ],
  },
];
```

---

## Что должно быть (итоговый код)

```ts
export const NAV: NavGroup[] = [
  {
    section: "WORKSPACE",
    items: [
      { key: "pulls", label: "Pull Requests", icon: "GitPullRequest", href: "/repos/:repoId/pulls", gKey: "p" },
    ],
  },
  {
    section: "SKILLS LAB",
    items: [
      { key: "skills", label: "Skills", icon: "Sparkles", href: "/skills", gKey: "s" },
      { key: "agents", label: "Agents", icon: "Cpu", href: "/agents", gKey: "a" },
    ],
  },
];
```

**Изменения:**
1. Убрать `agents` из секции `WORKSPACE`
2. Добавить новую секцию `SKILLS LAB` после `WORKSPACE`
3. В `SKILLS LAB` добавить `Skills` (первым) и `Agents` (вторым)

---

## Иконка Sparkles

В `nav.ts` используется тип `IconName` из `./icons`. Проверь что `Sparkles` там есть — открой файл:

```
client/src/vendor/ui/icons.tsx
```

Найди строку с `Sparkles`. Если есть — всё хорошо. Если нет — используй вместо неё `"Zap"` или `"Star"`:

```ts
{ key: "skills", label: "Skills", icon: "Zap", href: "/skills", gKey: "s" },
```

---

## Клавиатурный шорткат — обновить SHORTCUTS

В том же файле `nav.ts` внизу есть массив `SHORTCUTS`. Добавь туда строку для Skills:

### Текущий SHORTCUTS

```ts
export const SHORTCUTS: ShortcutDef[] = [
  { keys: "⌘K", label: "Open command palette", group: "Global" },
  { keys: "?", label: "Show keyboard shortcuts", group: "Global" },
  { keys: "g p", label: "Go to Pull Requests", group: "Navigation" },
  { keys: "g a", label: "Go to Agents", group: "Navigation" },
  { keys: "j / k", label: "Next / previous finding", group: "Findings" },
  { keys: "a", label: "Accept finding", group: "Findings" },
  { keys: "d", label: "Dismiss finding", group: "Findings" },
];
```

### Что добавить (одна строка после `g a`)

```ts
  { keys: "g s", label: "Go to Skills", group: "Navigation" },
```

### Итоговый SHORTCUTS

```ts
export const SHORTCUTS: ShortcutDef[] = [
  { keys: "⌘K", label: "Open command palette", group: "Global" },
  { keys: "?", label: "Show keyboard shortcuts", group: "Global" },
  { keys: "g p", label: "Go to Pull Requests", group: "Navigation" },
  { keys: "g a", label: "Go to Agents", group: "Navigation" },
  { keys: "g s", label: "Go to Skills", group: "Navigation" },
  { keys: "j / k", label: "Next / previous finding", group: "Findings" },
  { keys: "a", label: "Accept finding", group: "Findings" },
  { keys: "d", label: "Dismiss finding", group: "Findings" },
];
```

---

## Итоговый файл целиком

После правки весь `nav.ts` должен выглядеть так:

```ts
/* nav.ts — sidebar nav groups + keyboard shortcut registry.
   hrefs use :repoId token; the web app fills it from the active repo. */
import type { IconName } from "./icons";

export interface NavItemDef {
  key: string;
  label: string;
  icon: IconName;
  /** Route template; :repoId is replaced with the active repo id by the app. */
  href: string;
  /** Optional g-nav shortcut suffix (e.g. "p" → g then p). */
  gKey?: string;
  badge?: string;
}

export interface NavGroup {
  section: string;
  items: NavItemDef[];
}

export const NAV: NavGroup[] = [
  {
    section: "WORKSPACE",
    items: [
      { key: "pulls", label: "Pull Requests", icon: "GitPullRequest", href: "/repos/:repoId/pulls", gKey: "p" },
    ],
  },
  {
    section: "SKILLS LAB",
    items: [
      { key: "skills", label: "Skills", icon: "Sparkles", href: "/skills", gKey: "s" },
      { key: "agents", label: "Agents", icon: "Cpu", href: "/agents", gKey: "a" },
    ],
  },
];

export const SETTINGS_ITEM: NavItemDef = {
  key: "settings",
  label: "Settings",
  icon: "Settings",
  href: "/settings/api-keys",
  gKey: ",",
};

export const SETTINGS_SECTIONS = [
  { key: "api-keys", label: "API Keys" },
  { key: "models", label: "Feature Models" },
] as const;

/** Keyboard shortcut registry. */
export interface ShortcutDef {
  keys: string;
  label: string;
  group: "Navigation" | "Findings" | "Actions" | "Global";
}

export const SHORTCUTS: ShortcutDef[] = [
  { keys: "⌘K", label: "Open command palette", group: "Global" },
  { keys: "?", label: "Show keyboard shortcuts", group: "Global" },
  { keys: "g p", label: "Go to Pull Requests", group: "Navigation" },
  { keys: "g a", label: "Go to Agents", group: "Navigation" },
  { keys: "g s", label: "Go to Skills", group: "Navigation" },
  { keys: "j / k", label: "Next / previous finding", group: "Findings" },
  { keys: "a", label: "Accept finding", group: "Findings" },
  { keys: "d", label: "Dismiss finding", group: "Findings" },
];

/** Resolve an :repoId-templated href against the active repo id. */
export function resolveHref(href: string, repoId: string | null | undefined): string {
  if (!href.includes(":repoId")) return href;
  return href.replace(":repoId", repoId ?? "_");
}
```

---

## Ожидаемый результат после правки

Сайдбар станет выглядеть так:

```
DevDigest
acme/payments-api ▾

WORKSPACE
  ↳ Pull Requests         15

SKILLS LAB
  ↳ Skills                ← активный пункт при /skills
  ↳ Agents

⚙ Settings
```

Breadcrumb на странице Skills: `Skills Lab > Skills`
Breadcrumb на странице Agents: `Skills Lab > Agents > Test Quality Reviewer`

Оба breadcrumb уже правильно настроены в i18n файлах:
- `client/messages/en/skills.json` → `page.crumbLab: "Skills Lab"`
- `client/messages/en/agents.json` → `list.breadcrumbLab: "Skills Lab"`

---

## Проверка после правки

1. Открой `http://localhost:3000`
2. В сайдбаре должна появиться секция `SKILLS LAB`
3. Клик на `Skills` → переход на `/skills`, пункт подсвечивается
4. Клик на `Agents` → переход на `/agents`, пункт подсвечивается
5. В секции `WORKSPACE` должен остаться только `Pull Requests`
6. Шорткат `g s` → переход на `/skills`
