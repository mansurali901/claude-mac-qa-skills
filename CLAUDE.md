# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## What This Project Is

**native-qa** is a multi-platform autonomous QA skill for Claude Code. It tests any native or web application by:

1. Asking which platform to test (macOS, Web, Windows, iOS, Android)
2. Initializing a typed QA workspace (flow-based / feature-based / risk-based)
3. Reading prior knowledge from `qa/context/` or discovering the app visually
4. **Phase 1** — Launching the app, tracing every public happy flow step-by-step with screenshots at every action, writing `flow.md` per flow, saving state checkpoints
5. **Phase 2** — After user provides credentials, tracing auth-gated flows and generating full test coverage: all scenarios + `TC-NNN-*.md` files with runnable automation scripts

Context is reset after each flow (screenshots fill context fast). A state file `qa/state-[platform].md` persists all knowledge across resets.

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
├── web/SKILL.md                  ← Web Steps W-1–W-11 (beta)
├── ios/SKILL.md                  ← Stub
├── android/SKILL.md              ← Stub
├── windows/SKILL.md              ← Stub
└── extension/SKILL.md            ← Planned
```

Root `SKILL.md` always asks for platform FIRST — before any bash commands or workspace checks. This is enforced by a `## DO THIS NOW` block at the top of the file.

After platform selection, the root skill handles Steps 0–3 (mode detection, workspace init, app selection, prior knowledge), then delegates all automation to the selected `skills/[platform]/SKILL.md`.

### Platform Sub-Skills

Each platform SKILL.md is self-contained — all automation scripts are inlined, no external file dependencies. Platform skills receive context from the root skill via the workspace config and state file.

---

## Running the macOS Exploration Script

```bash
python3 skills/macos/explore.py --app "AppName" --output qa/knowledgebase/
python3 skills/macos/explore.py --app "AppName" --output qa/knowledgebase/ --screenshot
```

No pip dependencies — uses stdlib only (`subprocess`, `json`, `argparse`, `plistlib`).

## Running Web Exploration

```bash
npm install
npx playwright install chromium
npm run explore:web              # runs skills/web/explore.ts
```

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
2. Launch app
3. Screenshot → **Read with Read tool** → analyze visually
4. Navigate each section, screenshot, analyze, ask clarifying questions
5. Trace each happy flow step-by-step with a screenshot after every action
6. Write `flow.md` with discovery evidence table
7. Save checkpoint to `qa/state-[platform].md` → context reset

**Phase 2 core loop** (Steps 8–9):
1. Read auth screenshots from Phase 1 to identify credential fields
2. Ask user how to provide credentials (check `.env.qa` / provide in chat / self-register)
3. Trace auth-gated flows with screenshots
4. Generate all scenarios per flow
5. Write `TC-NNN-*.md` per scenario

---

## Output Structure

### Flow-based (default)

```
qa/
├── .qa-config.json              ← Workspace config (platform, framework, app, counts)
├── state-[platform].md          ← Session checkpoint — one per platform
├── planning/platforms.md
├── guardrails/do-and-dont.md
├── credentials/access.md
├── scope/contract.md
├── context/                     ← User places prior knowledge here before init
│   ├── README.md
│   ├── feature-specs/
│   └── figma-screens/
├── knowledgebase/
│   ├── ui-inventory.md
│   ├── ui-inventory.json
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

`qa/state-[platform].md` is the memory across context resets. Each file contains:
- App under test (name, path, auth method, core product, quirks)
- Which flows are completed (with screenshot counts and key observations)
- Which flows are pending (with priority and auth requirement)
- Exact resume command for the next flow
- Credentials status

**State file naming**:
| Platform | State file |
|----------|-----------|
| macOS | `qa/state-macos.md` |
| Web | `qa/state-web.md` |
| Windows | `qa/state-windows.md` |
| iOS | `qa/state-ios.md` |
| Android | `qa/state-android.md` |

One file per OS. Testing a different app on the same platform overwrites the state file.

---

## Key Reference Files

| File | Purpose |
|------|---------|
| `SKILL.md` | Root orchestrator — platform selection, workspace init, delegation |
| `skills/macos/SKILL.md` | Complete macOS runbook (Steps 4–11) — self-contained |
| `skills/web/SKILL.md` | Complete web runbook (Steps W-1–W-11) — self-contained |
| `skills/_registry/registry.json` | Platform skill registry (read by SKILL.md Step 0) |
| `skills/macos/explore.py` | AppleScript UI enumeration + screenshot — no pip deps |
| `skills/macos/templates/flow.md` | Template for every `flow.md` |
| `skills/macos/templates/scenarios.md` | Template for every `scenarios.md` |
| `skills/macos/templates/test-case.md` | Template for every `TC-NNN-*.md` |
| `skills/macos/references/macos-automation.md` | AppleScript patterns, window/menu enumeration |
| `skills/macos/references/test-patterns.md` | Scenario patterns by UI element type and app category |
| `skills/web/references/playwright-patterns.md` | Playwright patterns for web TCs |
| `skills/web/references/selector-strategies.md` | Selector strategies for SPAs |
| `.env.example` | Template for `.env.qa` — all supported env vars |

---

## Manually Testing Changes

### macOS skill

```bash
python3 skills/macos/explore.py --app "TextEdit" --output /tmp/qa-test --screenshot
cat /tmp/qa-test/ui-inventory.md
ls /tmp/qa-test/screenshots/
```

### Web skill

```bash
cp .env.example .env.qa
# Set QA_APP_URL in .env.qa
npm run explore:web
```

### Full skill verification checklist

- `qa/.qa-config.json` exists with correct `framework` and `platform` values
- `qa/state-[platform].md` exists after first checkpoint
- `qa/knowledgebase/screenshots/` contains at least 1 screenshot per flow
- `qa/flows/` (or `features/` or `test-cases/`) has at least 4 flow directories
- Each flow directory has `flow.md`, `scenarios.md`, and `test-cases/` subdirectory
- `flow.md` includes a Discovery Evidence table with screenshot references
- Each `scenarios.md` has at least 5 scenarios covering multiple categories
- Each `TC-NNN-*.md` has a runnable automation block (AppleScript or Playwright TypeScript)
- No credentials appear in any tracked file

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
