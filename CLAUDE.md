# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## What This Project Is

**native-qa** is a multi-platform autonomous QA skill for Claude Code. It tests any native or web application by:

1. Asking which platform to test (macOS, Web, Windows, iOS, Android)
2. Initializing a typed QA workspace (flow-based / feature-based / risk-based)
3. Reading prior knowledge from `qa/context/` or discovering the app visually
4. **Phase 1** — Seed crawl → build navigation graph → discover user personas → derive E2E journeys (persona + goal + path) → trace each journey end-to-end with screenshots at every action → write `flow.md` per journey → save state checkpoints
5. **Phase 2** — After user provides credentials, tracing auth-gated journeys and generating full test coverage: all scenarios + `TC-NNN-*.md` files with runnable automation scripts

Context is reset after each journey (screenshots fill context fast). A state file `qa/state.md` persists all knowledge across resets.

**Platform support**:
- macOS ✅ production — AppleScript + screencapture + Accessibility API
- Web ✅ beta — Playwright + Chromium
- Windows 🔜 stub — WinAppDriver + UIA3
- iOS 🔜 stub — XCUITest + xcrun simctl
- Android 🔜 stub — UIAutomator2 + ADB
- Browser Extension 🔜 planned

---

## Architecture

### Skill Loading

Claude Code loads skills from committed SKILL.md files at session start. **Changes to SKILL.md take effect only after committing and starting a new session.** Staged changes are not picked up by the skill system.

### Skill Structure

```
SKILL.md                          ← Root orchestrator
                                    Platform selection (Step 0)
                                    Workspace init (Steps 1–3)
                                    Delegates Steps 4+ to platform skill

skills/
├── _registry/registry.json       ← Registered platform skills
├── macos/SKILL.md                ← macOS Steps 4–11 (production)
├── web/SKILL.md                  ← Web Steps W-1–W-12 (beta)
├── ios/SKILL.md                  ← Stub
├── android/SKILL.md              ← Stub
├── windows/SKILL.md              ← Stub
└── extension/SKILL.md            ← Planned
```

Root `SKILL.md` always asks for platform FIRST — before any bash commands or workspace checks. This is enforced by a `## DO THIS NOW` block at the top of the file.

After platform selection, the root skill handles Steps 0–3 (mode detection, workspace init, app selection, prior knowledge), then delegates all automation to the selected `skills/[platform]/SKILL.md`.

### Platform Sub-Skills

Each platform SKILL.md is self-contained — automation code is inlined as instructions. The web skill depends on two committed utility scripts (`scripts/qa-screenshot.js` for atomic screenshot registration, `scripts/allure/generate-phase*-report.js` for Allure report generation) that contain complex reusable logic. Platform skills receive context from the root skill via the workspace config and state file.

---

## How Exploration Works

Exploration scripts are **inlined in each platform's SKILL.md** — not standalone repo files. The agent writes and runs them at runtime, adapting to each app dynamically.

### macOS
The explore script is inlined in `skills/macos/SKILL.md` (Step 5). At runtime the agent writes it to `qa/scripts/explore.py` and runs it. No pip dependencies — uses stdlib only (`subprocess`, `json`, `argparse`, `plistlib`).

### Web
Uses **inline Playwright code blocks** in `skills/web/SKILL.md` (Steps W-2, W-3). The agent takes screenshots, reads them, and decides the next action — no separate explore script. Each step adapts to the specific app's UI.

---

## Prerequisites

### macOS Skill
- macOS 12 Monterey or later
- Python 3.9+
- **Accessibility permission**: System Settings → Privacy & Security → Accessibility → enable Terminal

### Web Skill
- Node.js 20+
- `npm install` (installs `@playwright/test`, `dotenv`, and all dependencies)
- `npx playwright install chromium`
- `.env.qa` at repo root with `QA_APP_URL` set

---

## Skill Workflow (SKILL.md)

The skill detects its mode after platform selection:

| Mode | Trigger | Action |
|------|---------|--------|
| **INIT** | No `qa/` or no `qa/.qa-config.json` | Full init: framework → scaffold → app → discovery → flows → scenarios → TCs |
| **CONFIGURED_NO_FLOWS** | Config exists, no flows yet | Start from app selection |
| **EXPLORATION_COMPLETE** | Flows exist, TC count = 0 | Phase 1 done — awaiting credentials for Phase 2 |
| **HAS_WORKSPACE** | TC files present | Update mode |

**Phase 1 core loop** (Steps 4–7 in each platform skill):
1. Read prior knowledge from `qa/context/` (if any files exist)
2. Launch app / seed crawl all reachable pages
3. Screenshot → **Read with Read tool** → analyze visually
4. **Build navigation graph** (pages → CTAs → pages, with auth gates)
5. **Discover personas** from auth boundaries, plan tiers, feature sections
6. **Derive E2E journeys** (persona + goal + path through the app = one flow)
7. Present journey inventory to user for confirmation
8. Trace each journey end-to-end with screenshots at every action (use `capture()` for atomic registration)
9. Write `flow.md` with 5-column discovery evidence table (Step | Page/Screen | Action | Screenshot | Observed)
10. Save checkpoint to `qa/state.md` → context reset
11. **Screenshot coverage gate** — every screenshot on disk must be referenced in a flow.md
12. **Generate Phase 1 Allure report** (`npm run allure:phase1:open`) — includes Product name in all labels

**Phase 2 core loop** (Steps 8–9):
1. Read auth screenshots from Phase 1 to identify credential fields
2. Ask user how to provide credentials (check `.env.qa` / provide in chat / self-register)
3. Trace auth-gated flows with screenshots
4. Generate all scenarios per flow
5. Write `TC-NNN-*.md` per scenario
6. **Generate Phase 2 Allure report** (`npm run allure:phase2:open`)

---

## Output Structure

### Flow-based (default)

```
qa/
├── .qa-config.json              ← Workspace config (platform, framework, app, counts)
├── state.md                     ← Session checkpoint — one global state file
├── planning/platforms.md
├── guardrails/do-and-dont.md
├── credentials/access.md
├── scope/contract.md
├── context/                     ← User places prior knowledge here before init
│   ├── README.md
│   ├── feature-specs/
│   └── figma-screens/
├── knowledgebase/
│   ├── ui-inventory.md          ← Page inventory from seed crawl
│   ├── nav-graph.md             ← Navigation graph (page → CTA → page)
│   ├── personas.md              ← Discovered user personas
│   ├── journey-inventory.md     ← All E2E journeys with coverage tracking
│   └── screenshots/             ← Discovery screenshots (gitignored)
└── flows/
    └── F-NNN-[flow-slug]/
        ├── flow.md              ← Journey map + discovery evidence table
        ├── scenarios.md         ← All test scenarios for this flow
        └── test-cases/
            └── TC-NNN-[slug].md ← One file per scenario
```

### Feature-based

`qa/flows/` → `qa/features/[feature-name]/`

### Risk-based

`qa/flows/` → `qa/test-cases/P1-critical/`, `P2-high/`, `P3-medium/`, `P4-low/`

---

## Session State

`qa/state.md` is the memory across context resets. It contains:
- App under test (name, path, auth method, core product, quirks)
- Which E2E journeys are completed (with screenshot counts and key observations)
- Which journeys are pending (with priority and auth requirement)
- Journey coverage: [N traced] / [N total] ([%])
- Exact resume command for the next journey
- Credentials status

**State file**: `qa/state.md` — one global state file shared across all platforms. Testing a different app overwrites it with the new app's context.

---

## Key Reference Files

| File | Purpose |
|------|---------|
| `SKILL.md` | Root orchestrator — platform selection, workspace init, delegation |
| `skills/macos/SKILL.md` | Complete macOS runbook (Steps 4–11) — self-contained |
| `skills/web/SKILL.md` | Complete web runbook (Steps W-1–W-12) — self-contained with inline Playwright config and spec extraction |
| `skills/_registry/registry.json` | Platform skill registry (read by SKILL.md Step 0) |
| `skills/macos/SKILL.md` (Step 5, inlined) | AppleScript UI enumeration — written to `qa/scripts/explore.py` at runtime |
| `skills/macos/templates/flow.md` | Template for every `flow.md` (macOS) |
| `skills/web/templates/flow.md` | Template for every `flow.md` (web) — includes 5-col evidence table for E2E journeys |
| `skills/web/templates/scenarios.md` | Template for every `scenarios.md` |
| `skills/web/templates/test-case.md` | Template for every `TC-NNN-*.md` |
| `skills/macos/references/macos-automation.md` | AppleScript patterns, window/menu enumeration |
| `skills/macos/references/test-patterns.md` | Scenario patterns by UI element type and app category |
| `skills/web/references/playwright-patterns.md` | Playwright patterns for web TCs |
| `skills/web/references/selector-strategies.md` | Selector strategies for SPAs |
| `scripts/qa-screenshot.js` | Atomic screenshot + flow.md registration — prevents orphaned screenshots. Used as CLI and module. |
| `scripts/allure/generate-phase1-report.js` | Phase 1 Allure report — reads flow.md + screenshots → allure-results. Includes screenshot coverage gate and Product naming. |
| `scripts/allure/generate-phase2-report.js` | Phase 2 Allure report — reads TC files → allure-results (standalone or enrich mode) |
| `.env.example` | Template for `.env.qa` — all supported env vars |

---

## Manually Testing Changes

### macOS skill
Run the QA skill on any installed macOS app. The explore script is generated at runtime:
```bash
# In Claude Code, say: "Run QA on TextEdit"
# The skill writes qa/scripts/explore.py and runs it automatically
# After discovery, check output:
cat qa/knowledgebase/ui-inventory.md
ls qa/knowledgebase/screenshots/
```

### Web skill
```bash
cp .env.example .env.qa
# Set QA_APP_URL in .env.qa
# In Claude Code, say: "Run QA on [your web app]"
# The skill runs inline Playwright to explore the app dynamically
```

### Full skill verification checklist

- `qa/.qa-config.json` exists with correct `framework` and `platform` values
- `qa/state.md` exists after first checkpoint with journey coverage %
- `qa/knowledgebase/screenshots/` contains at least 1 screenshot per journey step
- `qa/knowledgebase/nav-graph.md` exists with navigation graph
- `qa/knowledgebase/personas.md` exists with discovered personas
- `qa/knowledgebase/journey-inventory.md` exists with journey count and coverage tracking
- `qa/flows/` (or `features/` or `test-cases/`) has flow directories — one per E2E journey
- Each flow directory has `flow.md`, `scenarios.md`, and `test-cases/` subdirectory
- `flow.md` includes a Discovery Evidence table with screenshot references (5-col for E2E journeys)
- **Screenshot coverage gate passes** — every .png on disk is referenced in a flow.md (enforced by Allure generator)
- Each `scenarios.md` has at least 5 scenarios covering multiple categories
- Each `TC-NNN-*.md` has a runnable automation block (AppleScript or Playwright TypeScript)
- No credentials appear in any tracked file
- `allure-report/index.html` generated after each phase — Product name visible in report labels

---

## Adding Platform Support

To implement a stub platform:
1. Write automation scripts in `skills/<platform>/` (explore, interact, screenshot)
2. Update `skills/<platform>/SKILL.md` status from `stub` to `beta`/`production`
3. Add or update the entry in `skills/_registry/registry.json`
4. Add platform-specific patterns to `skills/<platform>/references/test-patterns.md`
5. Update README.md platform table
6. Commit — the skill system reads from committed files only

---

## Environment Variables

All test credentials live in `.env.qa` (gitignored) at the consuming repo root. See `.env.example` for all supported keys. Key ones:

```env
QA_APP_URL=                   # web: full base URL with trailing slash
QA_APP_NAME=                  # macOS/Windows: app name
QA_TEST_EMAIL=
QA_TEST_PASSWORD=
QA_ACCOUNT_TIER=free
QA_SANDBOX_MODE=true
QA_LLM_PROVIDER=claude
QA_LLM_API_KEY=
```

---

## Gitignore Entries

Add to the consuming repo's `.gitignore`:

```gitignore
.env.qa
qa/credentials/.env*
qa/evidence/
qa/knowledgebase/screenshots/
qa/.auth/
playwright-report/
```

Commit `qa/` itself — it is the team's living QA documentation.
Never commit `qa/knowledgebase/screenshots/` (large binary files), `qa/.auth/` (session tokens), or anything under `qa/credentials/` with real values.
