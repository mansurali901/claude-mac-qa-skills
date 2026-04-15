# native-qa — Multi-Platform Autonomous QA Skill for Claude Code

An autonomous QA engineer for **any native or web application**. Select a platform, point it at an app, and it initializes a workspace, launches the application, takes screenshots for visual analysis, discovers every UI flow end-to-end, and generates comprehensive test cases — organized by flow, feature, or risk priority.

| Platform | Status | Automation |
|----------|--------|-----------|
| macOS | production ✅ | AppleScript + screencapture + Accessibility API |
| Web | beta ✅ | Playwright + Chromium |
| Windows | stub 🔜 | WinAppDriver + UIA3 |
| iOS | stub 🔜 | XCUITest + xcrun simctl |
| Android | stub 🔜 | UIAutomator2 + ADB |
| Browser Extension | planned 🔜 | Playwright + Chrome Extension API |

---

## How It Works

The skill runs in two phases separated by a credentials gate.

```
Phase 1 — Exploration (no credentials needed)
─────────────────────────────────────────────
1. Select platform
2. Choose framework (flow / feature / risk)
3. Scaffold qa/ workspace
4. Name the app / URL to test
5. Read prior knowledge (PRD, Figma, code, or none)
6. Launch app → screenshot every section
7. Trace every public happy flow step-by-step with screenshots
8. Write flow.md + save state checkpoint

Phase 1 Complete Gate → ask for credentials → wait

Phase 2 — Full Coverage (credentials required)
──────────────────────────────────────────────
9. Trace auth-gated flows with screenshots
10. Generate all scenarios (happy + negative + edge + a11y + security)
11. Write TC-NNN-*.md for every scenario
12. Extract runnable test scripts + finalize workspace
```

Context is reset after each flow to prevent overflow — a state file (`qa/state.md`) acts as memory across resets.

---

## Output Structure

### Flow-based (default)

```
qa/
├── .qa-config.json              ← Workspace config (platform, app, counts)
├── state.md                     ← Session checkpoint (resume from here)
├── planning/platforms.md
├── guardrails/do-and-dont.md
├── credentials/access.md
├── scope/contract.md
├── context/                     ← Drop prior knowledge here before init
│   ├── feature-specs/
│   └── figma-screens/
├── knowledgebase/
│   ├── ui-inventory.md
│   ├── ui-inventory.json
│   └── screenshots/             ← Discovery screenshots (gitignored)
└── flows/
    ├── F-001-app-launch/
    │   ├── flow.md              ← Journey map with discovery evidence
    │   ├── scenarios.md         ← All test scenarios
    │   └── test-cases/
    │       ├── TC-001-cold-launch.md
    │       └── TC-002-warm-launch.md
    └── F-NNN-[slug]/
        ├── flow.md
        ├── scenarios.md
        └── test-cases/
            └── TC-NNN-*.md
```

Feature-based and risk-based variants replace `qa/flows/` with `qa/features/[name]/` or `qa/test-cases/P1-critical/`, `P2-high/`, etc.

---

## Repository Structure

```
SKILL.md                          ← Root orchestrator — platform selection + Steps 1–3
skills/
├── _registry/registry.json       ← Platform skill registry
├── macos/
│   ├── SKILL.md                  ← macOS runbook — Steps 4–11 (explore script inlined)
│   ├── templates/
│   │   ├── flow.md
│   │   ├── scenarios.md
│   │   └── test-case.md
│   └── references/
│       ├── macos-automation.md   ← AppleScript patterns + recipes
│       └── test-patterns.md      ← Scenario patterns by UI element type
├── web/
│   ├── SKILL.md                  ← Web runbook — Steps W-1–W-11 (inline Playwright exploration)
│   ├── templates/
│   │   ├── flow.md
│   │   ├── scenarios.md
│   │   ├── test-case.md
│   │   └── playwright.config.ts  ← Copied to qa/ at runtime
│   └── references/
│       ├── playwright-patterns.md
│       ├── selector-strategies.md
│       └── exploration-toolkit.md
├── ios/
│   ├── SKILL.md                  ← Stub (Q3 2026)
│   └── references/xcuitest-patterns.md
├── android/
│   ├── SKILL.md                  ← Stub (Q4 2026)
│   └── references/uiautomator-patterns.md
├── windows/
│   ├── SKILL.md                  ← Stub (Q3 2026)
│   └── references/winapdriver-patterns.md
└── extension/
    └── SKILL.md                  ← Planned (Q4 2026)
```

---

## Installation

### Prerequisites

| Requirement | Details |
|------------|---------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | Latest version |
| macOS (for macOS skill) | 12 Monterey or later |
| Accessibility permission | Terminal → System Settings → Privacy & Security → Accessibility |
| Python 3.9+ | For macOS explore script (inlined in SKILL.md, written to `qa/scripts/` at runtime) — stdlib only, no pip deps |
| Node.js 20+ | For web skill (Playwright) |

### Install the Skill

```bash
# Global install (available in all projects)
cp SKILL.md ~/.claude/commands/native-qa.md
```

Or project-scoped:

```bash
mkdir -p .claude/commands
cp /path/to/native-qa/SKILL.md .claude/commands/native-qa.md
```

For the web skill, install Node dependencies:

```bash
npm install
npx playwright install chromium
```

Restart Claude Code. Invoke with `/native-qa` or `/native-qa init`.

---

## Usage

```
# Initialize workspace (always run first)
/native-qa init

# Natural language triggers
"test my app"
"set up QA for Figma"
"run QA on Slack and generate test cases"
"generate flows and test cases for my macOS app"

# Resume a saved session
"Read qa/state.md and continue QA for Figma"
"Read qa/state.md and continue Phase 1. Next flow: F-003 — Dashboard"

# Update existing workspace
"update test cases — I added a new feature"
"add test cases for the Settings panel"
"re-discover [AppName] UI"
```

---

## Example First Run

```
/native-qa init

Claude: Which platform would you like to test on?
  1. macOS — production ✅
  2. Web (Playwright) — beta ✅
  3. Windows — stub 🔜
  4. iOS — stub 🔜
  5. Android — stub 🔜

You: 1

Claude: Welcome to native-qa! Setting up a QA workspace for your macOS app.
  How would you like test cases organized?
  1. Flow-based (recommended)  2. Feature-based  3. Risk-based

You: 1

Claude: ✅ Workspace initialized (flow-based). Which application do you want to test?

You: Figma

Claude: Found: /Applications/Figma.app (v116.14.0)
  Do you have prior knowledge about Figma? (PRD / Figma screens / code / no)

You: no

Claude: ✅ Accessibility OK
  🚀 Launching Figma...
  📸 qa/knowledgebase/screenshots/01-main-window.png

  I can see 6 sections: Recent files, Community, Plugins, Account, Teams, Settings.

  Quick questions about what I found:
  [asks 2-3 per batch]

  Phase 1 — Tracing F-001: App Launch...
  📸 Step 1/4 screenshots read. flow.md written.

  ✅ Checkpoint saved to qa/state.md
  Context reset recommended. To continue:
  "Read qa/state.md and continue Phase 1. Next flow: F-002 — File Management"

... (repeat per flow, context reset after each) ...

Phase 1 complete — 6 flows traced, 34 screenshots.
Flows needing credentials: F-004 (Teams), F-005 (Account settings)

Please populate .env.qa with QA_TEST_EMAIL and QA_TEST_PASSWORD, then say "continue Phase 2".

You: [sets .env.qa] continue Phase 2

Claude: ✅ Credentials confirmed. Tracing authenticated flows...

  ╔══════════════════════════════════════════╗
    QA Ready — Figma v116.14.0 on macOS
  ╠══════════════════════════════════════════╣
    Framework:    flow-based
    Flows:        6  |  Scenarios: 43
    Test cases:   28 (P1: 16, P2: 10, P3: 2)
  ╚══════════════════════════════════════════╝
```

---

## Configuration — `.env.qa`

Copy `.env.example` to `.env.qa` (gitignored) and fill in values:

```env
# App under test
QA_APP_URL=                   # web: full base URL with trailing slash
QA_APP_NAME=                  # macOS/Windows: name as it appears in /Applications

# Auth credentials (dedicated test account — never personal)
QA_TEST_EMAIL=
QA_TEST_PASSWORD=
QA_EXISTING_EMAIL=            # for duplicate-email test cases

# Account state
QA_ACCOUNT_TIER=free          # free | premium | etc.
QA_SANDBOX_MODE=true

# LLM keys (pasted INTO the app during onboarding tests — not used to call APIs)
QA_LLM_PROVIDER=claude
QA_LLM_API_KEY=

# Secondary account (multi-user / sharing tests)
QA_SECONDARY_EMAIL=
QA_SECONDARY_PASSWORD=
```

---

## Gitignore

Add to the consuming repo's `.gitignore`:

```gitignore
.env.qa
qa/credentials/.env*
qa/evidence/
qa/knowledgebase/screenshots/
qa/.auth/
playwright-report/
```

Commit `qa/` — it's the team's living QA documentation. Never commit screenshots (large binaries) or real credentials.

---

## Requirements

| Component | Version |
|-----------|---------|
| Claude Code | Latest |
| macOS | 12 Monterey+ |
| Node.js | 20+ |
| Python | 3.9+ |
| Playwright | Installed via `npm install` |

---

## Roadmap

| Platform | Status | ETA |
|----------|--------|-----|
| macOS | production ✅ | — |
| Web (Playwright) | beta ✅ | — |
| Windows (WinAppDriver + UIA3) | stub 🔜 | Q3 2026 |
| iOS (XCUITest + xcrun) | stub 🔜 | Q3 2026 |
| Android (UIAutomator2 + ADB) | stub 🔜 | Q4 2026 |
| Browser Extension | planned 🔜 | Q4 2026 |

---

## License

MIT
