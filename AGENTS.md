---
# AGENTS Guide for Tukan Repository
---

## 📦 Project Overview
Tukan is a **Kanban‑style task manager** for tmux windows/sessions, built as a TypeScript/Node.js TUI using the Ink framework.  The codebase follows a functional‑core / imperative‑shell architecture.

---
### Table of Contents
1️⃣ [Build & Test Commands](#build--test-commands) 
2️⃣ [Running a Single Test](#single-test)
3️⃣ [Linting / Formatting](#lint-format)
4️⃣ [Code Style Guidelines](#code-style-guidelines)
5️⃣ [Naming Conventions](#naming-conventions)
6️⃣ [Error Handling & Types](#error-handling-types)
7️⃣ [Import Order & Module Resolution](#import-order)
8️⃣ [Project‑specific Rules (Cursor / Copilot)](#project‑rules)
9️⃣ [Contribution Checklist](#contribution-checklist)

---
## <a name="build--test-commands"></a>1️⃣ Build & Test Commands
| Command | Description |
|---------|-------------|
| `npm run build` | Bumps patch version (no git tag) and compiles TypeScript to `dist/`. |
| `npm start` | Runs the CLI via `tsx src/index.tsx`. |
| `npm test` or `npm run test` | Executes **all** Vitest suites (`vitest run`). |
| `npm run prepublishOnly` | Alias for `npm run build`; used by npm publish. |

---
## <a name="single-test"></a>2️⃣ Running a Single Test
Vitest supports the `-t/--testNamePattern` flag or file‑specific execution.
```bash
# Run a single test file (fast)
npm exec vitest src/__tests__/card-ops.test.ts

# Or filter by test name (regex)
npm exec vitest -t "should start card" src/__tests__/**/*.test.ts
```
The `npm exec` wrapper ensures the local Vitest binary is used.

---
## <a name="lint-format"></a>3️⃣ Linting / Formatting
The repository does **not** ship an ESLint config yet, but agents should enforce:
- **Prettier** with default settings (`npm i -D prettier`).
- Run `npx prettier --check "src/**/*.ts"` before committing.
- Add a `lint` script later if needed.

---
## <a name="code-style-guidelines"></a>4️⃣ Code Style Guidelines
| Aspect | Guideline |
|--------|-----------|
| **Indentation** | 2 spaces, no tabs. |
| **Line length** | ≤ 120 characters (soft). |
| **Semicolons** | Always use semicolons (`semi: true`). |
| **Quotes** | Prefer double quotes for strings, backticks when interpolation is needed. |
| **Trailing commas** | In multi‑line arrays/objects – always include a trailing comma. |
| **Blank lines** | Separate logical blocks with an empty line; after imports, before `export` statements. |
| **JSX** | Use the automatic JSX runtime (`react-jsx`). Keep components small (< 200 LOC). |
| **Comments** | JSDoc style for exported types/functions. Inline comments only when clarifying non‑obvious logic. |

---
## <a name="naming-conventions"></a>5️⃣ Naming Conventions
- **Files & directories**: kebab‑case (`src/board/types.ts`).
- **Variables / functions**: `camelCase`.
- **Types / Interfaces / Enums**: `PascalCase` (e.g., `BoardConfig`).
- **Constants**: `UPPER_SNAKE_CASE` for compile‑time values (`COL_TODO`).
- **React components**: `PascalCase`, end with `Component` when generic (`CardComponent`).
- **Async functions**: suffix with `Async` if they return a Promise and are not obvious (e.g., `loadConfigAsync`).

---
## <a name="error-handling-types"></a>6️⃣ Error Handling & Types
1. **Strict TypeScript** – `strict: true` in `tsconfig.json`. All new code must compile without `any`.
2. **Never use `any`**; prefer `unknown` and narrow via type guards.
3. **Error objects**: Throw instances of `Error` (or subclasses). Include a helpful message.
4. **Async/await**: Wrap with `try/catch`; propagate errors upward when the caller can handle them.
5. **Result pattern**: For low‑level tmux interactions, consider returning `{ ok: true, value: T } | { ok: false, error: Error }` to avoid uncaught rejections.

---
## <a name="import-order"></a>7️⃣ Import Order & Module Resolution
```ts
// 1. Node built‑ins (none currently)
// 2. External packages (npm modules)
import { CommandDef } from "../board/types"; // external after externals

// 3. Relative imports – grouped by folder depth
import { defaultConfig } from "./board/types";
```
- **Absolute imports** are disabled (`moduleResolution: NodeNext`). Use relative paths.
- Keep a single blank line between groups.
- Prefer named imports over wildcard `* as` unless the module exports many members.

---
## <a name="project-rules"></a>8️⃣ Project‑specific Rules (Cursor / Copilot)
The repository currently has **no** `.cursor/` or `.github/copilot-instructions.md`.  Agents should still:
- Respect any future `/.cursor/rules/*.md` that may dictate UI interaction patterns.
- When a `copilot‑instructions.md` appears, follow its guidance for code generation style (e.g., prefer functional components, avoid side effects in render).

---
## <a name="contribution-checklist"></a>9️⃣ Contribution Checklist
1. **Run tests**: `npm test` – all must pass.
2. **Prettier check**: `npx prettier --check "src/**/*.ts"`.
3. **TypeScript compile**: `npm run build` (no errors).
4. **Update documentation** if public API changes.
5. **Commit message style** – conventional commits (`feat:`, `fix:`, `docs:` etc.).
6. Open a PR with a clear description; link related issue numbers.

---
*This file is intended for autonomous agents (Claude, Copilot, Cursor, etc.) that read and modify the Tukan codebase. It provides a single source of truth for build commands, style conventions, and contribution hygiene.*
