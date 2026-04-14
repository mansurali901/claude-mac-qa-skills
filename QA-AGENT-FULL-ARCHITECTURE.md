# QA Agent — Complete Architecture

> **Classification**: Internal Engineering Reference
> **Version**: 2.0.0
> **Status**: Living Document — Single Source of Truth
> **Execution Engine**: Claude Code CLI (`claude`)
> **Intelligence Layer**: Claude Code (`claude-opus-4-6`)
> **Last Updated**: April 2026

---

## Table of Contents

1. [What This System Is](#1-what-this-system-is)
2. [System Architecture](#2-system-architecture)
3. [Execution Engine: Claude Code](#3-execution-engine-claude-code)
4. [Agent Topology](#4-agent-topology)
5. [Platform Skill Framework](#5-platform-skill-framework)
6. [File System Design](#6-file-system-design)
7. [Skill Workflow: macOS](#7-skill-workflow-macos)
8. [Test Lifecycle](#8-test-lifecycle)
9. [Failure Classification & Recovery](#9-failure-classification--recovery)
10. [Observability & Reporting](#10-observability--reporting)
11. [CI/CD Integration](#11-cicd-integration)
12. [Cost Model](#12-cost-model)
13. [Security Architecture](#13-security-architecture)
14. [What NOT to Build](#14-what-not-to-build)
15. [Phased Roadmap](#15-phased-roadmap)
16. [State, Memory & Context Management](#16-state-memory--context-management)
17. [Performance, Scalability & Parallelism](#17-performance-scalability--parallelism)
18. [MCP Server Integration](#18-mcp-server-integration)
19. [Project Structure](#19-project-structure)
20. [Infrastructure & Deployment](#20-infrastructure--deployment)
21. [Tool & Framework Recommendations](#21-tool--framework-recommendations)
22. [Client & Stakeholder Perspective](#22-client--stakeholder-perspective)
23. [ROI & Cost Analysis](#23-roi--cost-analysis)
24. [Risk Analysis & Mitigations](#24-risk-analysis--mitigations)
25. [Future Extensions](#25-future-extensions)

---

## 1. What This System Is

### 1.1 Core Identity

The QA Agent is an **AI-native quality assurance platform** where **Claude Code acts as both the reasoning brain and the execution engine**. It is not a traditional test automation framework. It is a reasoning agent that discovers UI, plans tests, executes them, validates outcomes visually, and writes evidence — all autonomously.

The entire system is a **Claude Code skill**: a set of markdown instructions, templates, and helper scripts that Claude Code reads and executes using its built-in tools. No custom agent loop. No SDK wrapper. No orchestration middleware. Claude Code already is the orchestrator.

```
Traditional QA:  Engineer writes scripts → Test runner executes → Reports results
QA Agent:        Claude Code discovers UI → Plans tests → Executes → Validates visually → Learns
```

### 1.2 What Makes It Different

| Dimension | Traditional Frameworks (Selenium, Appium, XCTest) | QA Agent |
|-----------|---------------------------------------------------|----------|
| Test authoring | Engineers write test code manually | Claude Code generates test cases from visual UI discovery |
| Failure diagnosis | Stack trace + screenshot | Claude Code reads screenshot, diagnoses cause, attempts recovery |
| UI changes | Tests break, engineers fix | Claude Code re-discovers changed elements, updates flow maps |
| New platform | Full re-implementation | New `SKILL.md` + exploration script, same workflow |
| Validation | Selector match + attribute assert | Semantic: "does this look correct and correctly labelled?" |
| Knowledge | Zero — only what engineers encode | Grows from every run, accumulates in `qa/` as living docs |

### 1.3 The Key Architectural Decision

**Claude Code CLI is the execution engine.** This is not an application that calls the Anthropic API. This is a skill that Claude Code reads and executes. The difference:

```
❌ Wrong:  python3 script.py → import anthropic → client.messages.create() → handle tool use manually
✅ Right:  claude -p "Run QA for TextEdit" → Claude Code reads SKILL.md → executes via built-in tools
```

Claude Code already provides every tool this system needs:
- `Bash` — runs exploration scripts, AppleScript, screencapture
- `Read` — reads files and views screenshots with vision
- `Write` / `Edit` — creates and updates all `qa/` files
- `Glob` / `Grep` — finds files, searches content
- `Agent` — spawns subagents for parallel flow execution

---

## 2. System Architecture

### 2.1 The Three-Layer Model

```
┌─────────────────────────────────────────────────────────────────────┐
│  BRAIN — Claude Code                                                 │
│                                                                     │
│  Invoked via: claude -p "task"                                      │
│  Reads: SKILL.md (workflow) · references/ (knowledge)              │
│  Does: reasons about UI · plans tests · validates outcomes          │
│  Tools: Read · Write · Edit · Bash · Glob · Grep · Agent            │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ reads / writes
┌───────────────────────────────▼─────────────────────────────────────┐
│  MEMORY — File System (qa/)                                          │
│                                                                     │
│  .qa-config.json    ← workspace state & counts                      │
│  flows/F-NNN-*/     ← flow.md · scenarios.md · TC-NNN-*.md         │
│  knowledgebase/     ← ui-inventory.md · ui-inventory.json           │
│  runs/              ← RUN-YYYYMMDD-HHMMSS.md (run summaries)       │
│  evidence/          ← screenshots captured during execution         │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ executes via Claude Code's Bash tool
┌───────────────────────────────▼─────────────────────────────────────┐
│  HANDS — Platform Scripts                                            │
│                                                                     │
│  scripts/qa-explore-macos.py  ← macOS UI enumeration (AppleScript) │
│  osascript                    ← UI interaction, click, type, verify │
│  screencapture                ← evidence capture                    │
│  scripts/playwright-explore.js ← Web DOM enumeration (Phase 2)     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow — Request to Result

```
1. Trigger
   User: "run QA on TextEdit"  OR  CI: claude -p "Run QA for TextEdit. Follow SKILL.md."
       ↓
2. Mode Detection (Step 0 of SKILL.md)
   Claude Code checks qa/ state → INIT / CONFIGURED_NO_FLOWS / HAS_WORKSPACE
       ↓
3. Discovery (Steps 4–5)
   Claude Code runs qa-explore-macos.py via Bash
   Claude Code takes screenshots via screencapture
   Claude Code reads screenshots with Read tool (vision analysis)
       ↓
4. Planning (Steps 6–7)
   Claude Code creates flow.md files using templates
   Claude Code generates scenarios.md with maximum coverage
       ↓
5. Test Case Generation (Step 8)
   Claude Code writes TC-NNN-*.md files with runnable AppleScript
       ↓
6. Execution (when --mode execute)
   Claude Code runs AppleScript steps via osascript
   Claude Code takes evidence screenshots
   Claude Code reads screenshots to validate outcomes (PASS/FAIL)
   Claude Code writes results back into TC files
       ↓
7. Reporting (Step 9)
   Claude Code generates qa/runs/RUN-*.md summary
   CI reads exit code, uploads artifact
```

---

## 3. Execution Engine: Claude Code

### 3.1 What Claude Code Is in This System

Claude Code is Anthropic's AI coding assistant available as a CLI (`claude`). In this system, it plays every orchestration role:

| Role | What Claude Code Does |
|------|-----------------------|
| **Test Planner** | Analyzes UI screenshots and app metadata to define flows and scenarios |
| **Skill Reader** | Reads `SKILL.md` and follows its step-by-step workflow |
| **Vision Engine** | Opens screenshots with the Read tool and interprets UI state visually |
| **Script Runner** | Executes bash commands, AppleScript, Python helpers via the Bash tool |
| **File Author** | Creates and updates all `qa/` markdown files and JSON configs |
| **Self-Healer** | On test failure, reads current UI state, diagnoses cause, retries |
| **Report Author** | Synthesizes test results into run summaries |

### 3.2 How Claude Code Is Invoked

**Interactive (development use)**

The user opens Claude Code (CLI or desktop app) and types a natural language prompt. The skill triggers automatically via SKILL.md's frontmatter trigger descriptions:

```
"run QA on TextEdit"
"init QA for my app"
"test this macOS application"
"/native-qa init"
```

**Programmatic / CI use**

Claude Code CLI is invoked via shell with `-p` flag (print/headless mode):

```bash
# Full QA workflow
claude -p "Run the native-qa skill for TextEdit. Follow SKILL.md step by step. \
  Use flow-based framework. Today's date is $(date +%Y-%m-%d)."

# Execute existing test suite only
claude -p "Execute the existing QA test suite in qa/flows/. \
  Run each TC file's AppleScript, capture screenshots, write PASS/FAIL results. \
  Generate qa/runs/RUN-$(date +%Y%m%d-%H%M%S).md summary."

# Discovery only
claude -p "Run discovery for TextEdit. Follow SKILL.md steps 4 and 5 only. \
  Take screenshots, run qa-explore-macos.py, create flow.md files. \
  Do not generate test cases yet."
```

### 3.3 Claude Code's Built-in Tools (the "hands")

Claude Code uses these tools when executing the skill — no custom implementation required:

```
Read tool
  → Opens any file, including PNG/JPG screenshots (vision analysis)
  → Used in Step 4.4 and Step 5.2: read screenshot → analyze UI visually

Bash tool
  → Runs shell commands: screencapture, osascript, python3, sw_vers, mdfind
  → Runs qa-explore-macos.py to enumerate UI elements
  → Runs AppleScript test case automation

Write tool
  → Creates qa/.qa-config.json, flow.md, scenarios.md, TC-NNN-*.md, run summaries

Edit tool
  → Updates existing files: adds flow mappings to ui-inventory.md, writes PASS/FAIL to TC files

Glob tool
  → Finds all TC-*.md files, all flow directories, all screenshots

Grep tool
  → Searches flow content, finds test case references, checks existing scenarios

Agent tool
  → Spawns subagents for parallel flow execution (Phase 2)
  → Each subagent runs one flow independently
```

### 3.4 SKILL.md — The Orchestration Layer

`SKILL.md` is the workflow specification that Claude Code reads and follows. It is not configuration — it is instructions. Claude Code reads it the same way a senior engineer reads a runbook: understands the intent, follows the steps, adapts to what it finds.

```
SKILL.md contains:
  - Frontmatter (name, description, trigger phrases) — tells Claude Code when to activate
  - Step 0: Mode detection logic
  - Steps 1–9: Complete workflow with bash, AppleScript, and Python code blocks
  - Step 11: Update mode for existing workspaces
  - All inline templates: flow.md, .qa-config.json, planning files
```

**SKILL.md is the single source of orchestration logic.** When the workflow needs to change, update SKILL.md — nothing else.

---

## 4. Agent Topology

### 4.1 Phase 1: Single Agent (current)

One Claude Code session executes the full workflow sequentially. This handles any single-app test suite end-to-end.

```
User / CI
    ↓
claude -p "task"
    ↓
Claude Code (single session)
    ├── reads SKILL.md
    ├── runs qa-explore-macos.py (Bash)
    ├── takes screenshots (Bash → screencapture)
    ├── reads screenshots (Read tool → vision)
    ├── writes flow.md files (Write tool)
    ├── writes scenarios.md files (Write tool)
    ├── writes TC-NNN-*.md files (Write tool)
    └── writes qa/runs/RUN-*.md (Write tool)
```

**Capacity**: Any app, unlimited flows, sequential. Suitable for suites up to ~10 flows before time becomes a concern.

### 4.2 Phase 2: Subagents for Parallel Flow Execution

When a test suite grows to 5+ flows that need to run concurrently, Claude Code uses its native `Agent` tool to spawn subagents. Each subagent owns one flow.

```
Claude Code (primary session)
    ├── reads .qa-config.json → loads N flows
    ├── spawns subagent for F-001 (via Agent tool)
    ├── spawns subagent for F-002 (via Agent tool)
    ├── spawns subagent for F-003 (via Agent tool)
    └── waits → collects results → writes merged run summary
```

Each subagent:
- Receives its flow path and task description
- Runs that flow's TC files independently
- Writes results to `qa/evidence/F-NNN/` (isolated per flow)
- Returns PASS/FAIL + evidence paths to primary

**Hard limits**:
- Max 3–5 subagents in practice (macOS Accessibility API is single-threaded)
- Each subagent writes to its own evidence subdirectory to avoid collision
- No inter-subagent communication — subagents are independent workers

This requires zero new infrastructure. Claude Code's Agent tool handles it natively.

### 4.3 Phase 3: Multi-Platform Coordinator (future)

When running macOS + Web + Mobile simultaneously, a shell script fans out to separate Claude Code sessions per platform:

```bash
#!/bin/bash
# coordinator.sh — fan out platform agents
claude -p "Run macOS QA for ${APP_NAME}. Follow skills/macos/SKILL.md." &
PID_MACOS=$!

claude -p "Run Web QA for ${APP_URL}. Follow skills/web/SKILL.md." &
PID_WEB=$!

wait $PID_MACOS $PID_WEB

# Merge results
claude -p "Merge QA results from qa/platforms/macos/ and qa/platforms/web/. \
  Generate qa/runs/RUN-$(date +%Y%m%d-%H%M%S)-combined.md."
```

The coordinator is a shell script, not a distributed system.

---

## 5. Platform Skill Framework

### 5.1 Skill Anatomy

Every skill module shares the same internal structure, regardless of platform. Claude Code discovers and invokes skills by reading their `SKILL.md`:

| Component | Purpose |
|-----------|---------|
| **`SKILL.md`** | Natural-language workflow specification. Claude Code reads this to understand what the skill can do, how to invoke it, and what constraints apply. |
| **`skill-manifest.json`** | Machine-readable skill descriptor: id, version, platform, capabilities[], dependencies[], entrypoint, schema. |
| **`explore.py`** | Platform-specific UI discovery script. Enumerates all interactive elements and outputs `ui-inventory.json`. |
| **`interact.py`** | Platform-specific interaction driver. Executes individual test actions: click, type, swipe, scroll, assert. |
| **`screenshot.py`** | Captures visual evidence at any stage. Outputs to `qa/evidence/` with structured naming. |
| **`templates/`** | `flow.md`, `scenarios.md`, and test-case templates pre-populated for the platform's conventions. |
| **`references/`** | Deep automation references: element patterns, known quirks, platform-specific AppleScript / ADB / WinAPI recipes. |

Directory layout:

```
skills/
├── _registry/
│   ├── registry.json               ← Auto-generated skill index
│   └── health.json                 ← Last health check per skill
│
├── macos/                          ← PRODUCTION ✅
│   ├── SKILL.md                    ← Workflow specification (Claude Code reads this)
│   ├── skill-manifest.json         ← Machine-readable capability descriptor
│   ├── explore.py                  ← AppleScript UI discovery
│   ├── interact.py                 ← AppleScript interaction driver
│   ├── screenshot.py               ← screencapture wrapper
│   ├── templates/
│   │   ├── flow.md
│   │   ├── scenarios.md
│   │   └── test-case.md
│   └── references/
│       ├── macos-automation.md     ← AppleScript patterns, window discovery, screenshots
│       └── test-patterns-native.md ← Scenario patterns by app type and element type
│
├── web/                            ← PHASE 2 🔜
│   ├── SKILL.md
│   ├── skill-manifest.json
│   ├── playwright.config.ts
│   ├── explore.ts                  ← DOM + accessibility tree enumeration
│   ├── interact.ts                 ← Playwright action driver
│   ├── visual-diff.ts              ← Pixelmatch-based visual regression
│   └── references/
│       ├── playwright-patterns.md
│       └── selector-strategies.md
│
├── windows/                        ← PHASE 2 🔜
│   ├── SKILL.md
│   ├── skill-manifest.json
│   ├── explore.py                  ← WinAppDriver + UIA3 discovery
│   ├── interact.py
│   └── references/
│       └── winapdriver-patterns.md
│
├── ios/                            ← PHASE 3 🔜
│   ├── SKILL.md
│   ├── skill-manifest.json
│   ├── explore.py                  ← xcrun simctl + XCUITest discovery
│   ├── interact.py
│   └── references/
│       └── xcuitest-patterns.md
│
├── android/                        ← PHASE 3 🔜
│   ├── SKILL.md
│   ├── skill-manifest.json
│   ├── explore.py                  ← ADB + UIAutomator2 discovery
│   ├── interact.py
│   └── references/
│       └── uiautomator-patterns.md
│
└── extension/                      ← PLANNED 📋
    ├── SKILL.md
    └── skill-manifest.json
```

### 5.2 Skill Registration

Skills self-register by placing their `skill-manifest.json` at a path the Skill Registry monitors. Registration is automatic and hot-reloadable — no restart required. The registry maintains a capability index:

```json
{
  "id": "skill-macos-native",
  "version": "2.1.0",
  "platform": "darwin",
  "status": "production",
  "capabilities": [
    "app.launch", "app.quit", "ui.discover",
    "ui.click", "ui.type", "ui.screenshot",
    "menu.enumerate", "accessibility.check"
  ],
  "entrypoint": "skills/macos/SKILL.md",
  "automation": "applescript+screencapture",
  "requires": ["accessibility_permission"]
}
```

### 5.3 Skill Manifest Schema

```json
{
  "id": "skill-macos-native",
  "version": "2.0.0",
  "platform": "darwin",
  "status": "production",
  "capabilities": [
    "app.launch",
    "app.quit",
    "ui.discover",
    "ui.click",
    "ui.type",
    "ui.screenshot",
    "menu.enumerate",
    "accessibility.check",
    "state.persist.verify"
  ],
  "entrypoint": "SKILL.md",
  "automation": "applescript+screencapture",
  "requires": ["accessibility_permission"],
  "exploration_script": "scripts/qa-explore-macos.py",
  "references": [
    "references/macos-automation.md",
    "references/test-patterns-native.md"
  ]
}
```

### 5.4 The Six Platform Skills

| Skill ID | Platform | Status | Core Automation Stack |
|----------|----------|--------|-----------------------|
| `skill-macos` | macOS | **Production** | AppleScript, osascript, screencapture, Accessibility API |
| `skill-windows` | Windows | **In Progress** | WinAppDriver, UIA3, PowerShell, Win32 API |
| `skill-ios` | iOS | **In Progress** | XCTest, XCUITest, xcrun simctl, Xcode Instruments |
| `skill-android` | Android | **In Progress** | ADB, UIAutomator2, Appium, Espresso |
| `skill-web` | Web / SPA | **Production** | Playwright, Chromium/Firefox/WebKit, CDP |
| `skill-extension` | Browser Extension | **Planned** | Playwright + chrome.runtime, manifest inspection, background worker testing |

### 5.5 Platform Detail: macOS Skill

The macOS skill is the most mature and serves as the reference implementation for all other platform skills.

- **Discovery**: Uses `osascript` to enumerate all UI elements via the macOS Accessibility API. Outputs a structured `ui-inventory.json` with element types, names, descriptions, positions, and interaction capabilities.
- **Interaction**: AppleScript-based clicks, text input, keyboard shortcuts, menu navigation, and tab group traversal. All actions include mandatory `delay()` calls calibrated to macOS UI response latency.
- **Visual Analysis**: `screencapture -x` for pixel-perfect screenshots. Claude Code reads screenshots using its vision capabilities to detect UI state, validate layouts, and identify regressions.
- **Menu Bar Apps**: Special handling for apps that live exclusively in the menu bar. The skill detects this pattern automatically and adjusts interaction paths accordingly.
- **Permissions**: Automated Accessibility permission checking and user-guided resolution when permissions are missing.

### 5.6 Platform Detail: Web Skill

The web skill uses Playwright as its automation foundation, providing cross-browser coverage from a single API.

| Capability | Implementation |
|-----------|---------------|
| **Multi-browser** | Chromium, Firefox, WebKit tested in parallel. Same test code, zero duplication. |
| **Visual testing** | Playwright screenshots + pixel diff via Pixelmatch. Visual regression baseline stored per branch. |
| **Network mocking** | Playwright route interception. Simulate 3G, offline, API errors, slow responses without infra changes. |
| **Auth state** | `storageState` persistence. Log in once per session, reuse auth context across tests. |
| **Accessibility** | axe-core integration via `@axe-core/playwright`. WCAG 2.1 AA checks run on every page visited. |
| **Performance** | Chrome DevTools Protocol metrics: FCP, LCP, CLS, TTI captured automatically per navigation. |
| **API testing** | Playwright `APIRequestContext`. REST/GraphQL assertions without a browser — ideal for pre-condition setup. |

### 5.7 Platform Detail: Mobile Skills (iOS & Android)

- **iOS**: XCUITest runs natively on Simulator or physical device. `xcrun simctl` manages simulator lifecycle. Instruments captures memory and CPU profiles per test scenario. Claude Code reads Xcode Accessibility Inspector dumps for element discovery.
- **Android**: UIAutomator2 via Appium drives both emulators and physical devices. ADB handles app install, permission grants, log capture, and device state. Espresso is available for white-box testing within the same codebase.
- **Cross-platform flows**: A single flow specification can target both iOS and Android simultaneously, with the Skill Router dispatching to the appropriate skill per platform. Results are merged in the unified report.

### 5.8 Automation Tool Compatibility Matrix

| Tool | macOS | Win | iOS | Android | Web | Extension | Claude Code MCP |
|------|-------|-----|-----|---------|-----|-----------|-----------------|
| Playwright | — | ✅ | — | — | ✅ | ✅ | `playwright-mcp` |
| Appium | ✅ | ✅ | ✅ | ✅ | ✅ | — | Via HTTP |
| XCUITest | ✅ | — | ✅ | — | — | — | Via xcrun |
| WinAppDriver | — | ✅ | — | — | — | — | Via WinRM |
| AppleScript | ✅ | — | — | — | — | — | Via bash_tool |
| ADB | — | — | — | ✅ | — | — | Via bash_tool |
| axe-core | — | — | — | — | ✅ | ✅ | Via Playwright |

### 5.9 Adding a New Platform

Three files required. Zero core changes:

1. Create `skills/{platform}/SKILL.md` — workflow specification for the platform
2. Create `skills/{platform}/skill-manifest.json` — capabilities and entrypoint
3. Write `skills/{platform}/scripts/qa-explore-{platform}.py` — UI enumeration script

Claude Code discovers the new platform by reading its `skill-manifest.json`. No registry daemon. No service restart. Just files.

---

## 6. File System Design

### 6.1 Directory Structure

The `qa/` directory is the entire state store. Git is the history. Markdown is the format.

```
qa/
├── .qa-config.json                  ← Workspace config + run counts (source of truth)
├── planning/
│   └── platforms.md                 ← App metadata, macOS version, architecture
├── guardrails/
│   └── do-and-dont.md               ← Agent behaviour constraints
├── credentials/
│   └── access.md                    ← Account structure only (real values in .env.qa)
├── scope/
│   └── contract.md                  ← What is and isn't being tested
├── knowledgebase/
│   ├── ui-inventory.md              ← Human-readable UI element map
│   ├── ui-inventory.json            ← Machine-readable (used by scripts and Claude Code)
│   └── screenshots/                 ← gitignored — discovery screenshots
│       ├── 01-main-window.png
│       ├── 02-[section].png
│       └── ...
├── flows/                           ← Flow-based framework (default)
│   └── F-NNN-[slug]/
│       ├── flow.md                  ← Journey map
│       ├── scenarios.md             ← All scenarios for this flow
│       └── test-cases/
│           └── TC-NNN-[slug].md     ← One file per scenario
├── evidence/                        ← gitignored — execution screenshots
│   └── TC-NNN-S1-pass.png
└── runs/
    └── RUN-YYYYMMDD-HHMMSS.md       ← Post-execution run summary
```

### 6.2 `.qa-config.json` — Workspace State Schema

```json
{
  "version": "2.0",
  "framework": "flow-based",
  "app_name": "TextEdit",
  "app_path": "/Applications/TextEdit.app",
  "app_bundle_id": "com.apple.TextEdit",
  "app_version": "1.21",
  "platform": "macOS",
  "macos_version": "14.4.1",
  "architecture": "arm64",
  "created": "2026-04-10",
  "last_discovery": "2026-04-10T14:32:00",
  "last_execution": null,
  "flows_count": 6,
  "test_cases_count": 34,
  "last_run_summary": null,
  "run_history": []
}
```

All counts are updated by Claude Code after each workflow phase. This file is the ground truth for what has been generated.

### 6.3 `ui-inventory.json` — Machine-Readable UI Map

```json
{
  "app": "TextEdit",
  "discovered": "2026-04-10T14:35:12",
  "windows": [
    {
      "name": "Untitled",
      "index": 1,
      "elements": {
        "buttons": ["Close", "Minimize", "Zoom", "Format", "Share"],
        "text_fields": ["document-body"],
        "menus": ["TextEdit", "File", "Edit", "Format", "View", "Window", "Help"]
      }
    }
  ],
  "menu_bar_extra": null,
  "sections_discovered": ["main-editor", "format-panel", "preferences"],
  "flows_mapped": ["F-001", "F-002", "F-003", "F-004", "F-005", "F-006"]
}
```

### 6.4 `.env.qa` — Secrets Layer (gitignored, never tracked)

```env
# .env.qa — test credentials for [AppName]
# Copy this structure. Never commit real values.

QA_APP_NAME=
QA_USERNAME=
QA_PASSWORD=
QA_TEST_EMAIL=
QA_ACCOUNT_TIER=free|premium
QA_SANDBOX_MODE=true
QA_SECONDARY_USERNAME=
QA_SECONDARY_PASSWORD=
```

Real values live only in `.env.qa`. The structure is documented in `qa/credentials/access.md` (committed). The values never are.

### 6.5 State Machine

```
No qa/ directory
    → INIT  (Steps 1–3: framework selection, app selection, prior knowledge)

qa/.qa-config.json exists, no flows/
    → CONFIGURED  (Steps 4–9: discover, map flows, generate test cases)

flows/ exists, test-cases/ populated
    → EXECUTE  (run tests, collect evidence, write results)

Evidence collected
    → REPORT  (generate run summary, flag failures)

UI changed (ui-inventory diff detected)
    → UPDATE  (Step 11: targeted re-discovery, update affected flows)
```

---

## 7. Skill Workflow: macOS

The complete workflow lives in `SKILL.md`. This section documents the architecture of each phase.

### 7.1 Step 0: Mode Detection

Claude Code's first action every run:

```bash
if [ ! -d "qa" ] || [ ! -f "qa/.qa-config.json" ]; then
  echo "INIT"
elif [ ! -d "qa/flows" ] && [ ! -d "qa/features" ] && [ ! -d "qa/test-cases/P1-critical" ]; then
  echo "CONFIGURED_NO_FLOWS"
else
  echo "HAS_WORKSPACE"
fi
```

| Result | Route |
|--------|-------|
| `INIT` | Steps 1–9: full initialization + discovery + generation |
| `CONFIGURED_NO_FLOWS` | Steps 4–9: discovery + generation (workspace already set up) |
| `HAS_WORKSPACE` | Step 11: update mode (re-discover or extend) |

### 7.2 Step 1: Initialize Workspace

Framework selection (user chooses one):

| Framework | Directory Pattern | Best For |
|-----------|------------------|----------|
| Flow-based (default) | `qa/flows/F-NNN-[slug]/` | Apps with distinct end-to-end user journeys |
| Feature-based | `qa/features/[name]/` | Apps with many independent feature modules |
| Risk-based | `qa/test-cases/P1-critical/` etc. | Deadline-driven regression suites |

Claude Code creates the directory structure and writes `.qa-config.json` with the chosen framework.

### 7.3 Step 2: App Selection & Metadata

```bash
# Locate app
APP_PATH=$(mdfind "kMDItemKind == 'Application'" | grep -i "${APP_NAME}" | head -1)

# Read plist metadata
python3 - <<'PYEOF'
import plistlib
app_path = "/Applications/AppName.app"
with open(app_path + "/Contents/Info.plist", "rb") as f:
    p = plistlib.load(f)
print("Bundle ID:", p.get("CFBundleIdentifier"))
print("Version:  ", p.get("CFBundleShortVersionString"))
print("Min OS:   ", p.get("LSMinimumSystemVersion"))
PYEOF

# System info
sw_vers -productVersion && uname -m
```

### 7.4 Steps 4–5: Discovery (The Core Loop)

**Check accessibility permission:**
```bash
osascript -e 'tell application "System Events" to get name of every process' > /dev/null 2>&1 \
  && echo "✅ OK" || echo "❌ BLOCKED — grant Terminal Accessibility permission"
```

**Launch and screenshot:**
```bash
osascript -e 'tell application "AppName" to quit' 2>/dev/null; sleep 2
open -a "AppName"; sleep 4
osascript -e 'tell application "AppName" to activate'; sleep 1
screencapture -x qa/knowledgebase/screenshots/01-main-window.png
```

**Visual analysis (Claude Code reads screenshot):**
Claude Code uses its `Read` tool to open the screenshot image. It analyzes:
- Layout type (sidebar + content / tab-based / single panel)
- Navigation areas and their names
- Primary action buttons
- Inferred app type

**UI enumeration:**
```bash
python3 scripts/qa-explore-macos.py --app "AppName" --output qa/knowledgebase --screenshot
```
Produces `ui-inventory.md` and `ui-inventory.json`.

**Per-section deep navigation:**
For each discovered section, Claude Code:
1. Navigates there via AppleScript click
2. Takes a screenshot
3. Reads the screenshot (vision analysis)
4. Asks the user one clarifying question about that section

**Menu exploration:**
```bash
osascript -e '
tell application "System Events"
  tell process "AppName"
    return name of every menu bar item of menu bar 1 as string
  end tell
end tell'
```

### 7.5 Steps 6–7: Flow Mapping and Scenario Generation

**Universal flows** (every app gets these):
- `F-001-app-launch-and-startup`
- `F-002-quit-and-state-persistence`
- `F-003-preferences-settings`
- `F-004-menu-bar-navigation`

**App-specific flows** derived from discovery sections.

**Scenario categories** (applied per flow):

| Category | Min | Priority | When |
|----------|-----|----------|------|
| Happy Path | 1 | P1 | Every flow |
| Alternative Happy Path | 1+ | P1 | Multiple valid paths |
| Negative / Invalid Input | 2+ | P1 | Any flow with user input |
| Empty / Null Input | 1 | P1 | Required fields |
| Boundary Values | 2 | P2 | Fields with length/range constraints |
| State Persistence | 1 | P2 | State-changing flows |
| Interrupted Flow | 1 | P2 | Multi-step flows |
| Error Recovery | 1+ | P2 | Network/IO calls |
| Offline / No Network | 1 | P2 | Connectivity-dependent |
| Permission Denied | 1 | P2 | OS permission required |
| Concurrent / Double-tap | 1 | P3 | Action buttons |
| Accessibility | 1 | P3 | All flows |

**Count targets**:
- Simple flow (launch, quit): 3–5 scenarios
- Medium (settings, navigation): 6–10
- Complex (auth, core feature): 10–20

### 7.6 Step 8: Test Case Generation

For every scenario, Claude Code writes a `TC-NNN-[slug].md` file. The file template is:

```markdown
# TC-[NNN]: [Feature / Flow Name]

## Metadata

| Field | Value |
|-------|-------|
| **Test Case ID** | TC-[NNN] |
| **Application** | [App Name] |
| **Feature** | [Feature or flow being tested] |
| **Priority** | P1 / P2 / P3 |
| **Type** | Functional / UI / State / Error |
| **Platform** | macOS [version] |
| **Architecture** | arm64 / x86_64 / Both |
| **Automation Method** | AppleScript / Manual / Hybrid |
| **Author** | QA Agent |
| **Created** | [YYYY-MM-DD] |
| **Flow Reference** | F-[NNN] — flow.md |
| **Scenario Reference** | S-[NNN]-[NN] — scenarios.md |

---

## Preconditions

- [ ] App is installed at /Applications/[AppName].app
- [ ] macOS Accessibility permission granted for Terminal
- [ ] App is fully quit before starting
- [ ] [App-specific preconditions]

### Setup Script

```bash
osascript -e 'tell application "[AppName]" to quit' 2>/dev/null || true
sleep 2
open -a "[AppName]"
sleep 3
pgrep -x "[ProcessName]" > /dev/null && echo "✅ App running" || echo "❌ App not running"
```

---

## Scenario 1: Happy Path — [Description]

### Steps

| Step | Action | AppleScript / Command | Expected Result |
|------|--------|-----------------------|----------------|
| 1 | Launch app | `open -a "[AppName]"` | App window appears within 5s |
| 2 | [Action] | `click button "[name]" of window 1` | [Expected response] |

### AppleScript

```applescript
tell application "System Events"
    tell process "[AppName]"
        click button "[ButtonName]" of window 1
        delay 1
        set statusText to value of static text 1 of window 1
        if statusText contains "[expected]" then
            log "✅ PASS: Scenario 1"
        else
            error "❌ FAIL: Expected '[expected]', got '" & statusText & "'"
        end if
    end tell
end tell
```

### Pass Criteria
- [ ] [Observable outcome 1]
- [ ] App does not crash
- [ ] No unexpected system dialogs

### Evidence
- Screenshot: `qa/evidence/TC-[NNN]-S1-pass.png`

---

## Automation Notes

- Method: AppleScript via osascript
- Add `delay 1` after every click, `delay 3` after launch/quit
- Verify exact process name: `ps aux | grep -i [appname]`
- Must quit and relaunch app between scenarios for clean state
```

**AppleScript assertion standard** (used in every TC):
```applescript
-- Evidence capture on failure
do shell script "screencapture -x qa/evidence/TC-NNN-fail.png"

-- Pass/fail assertion
if [condition] then
    log "✅ PASS: [description]"
else
    error "❌ FAIL: Expected [X], got " & [actual]
end if
```

### 7.7 Step 9: Finalize

After all TC files are written, Claude Code:
1. Updates `qa/knowledgebase/ui-inventory.md` with flow mapping table
2. Updates `qa/.qa-config.json` with final counts and timestamps
3. Prints the completion summary

```
╔═══════════════════════════════════════════════════════════════╗
  QA Workspace Ready — [AppName] on macOS [version]
╠═══════════════════════════════════════════════════════════════╣
  Framework:       flow-based
  App:             [AppName] v[version] ([bundle-id])
  macOS:           [version] ([arm64/x86_64])
  Flows:           [N]
  Scenarios:       [N total]
  Test Cases:      [N files]
  P1 cases:        [N]
  P2 cases:        [N]
  P3 cases:        [N]
╚═══════════════════════════════════════════════════════════════╝
```

### 7.8 Step 11: Update Mode

Triggered when `qa/` workspace already exists. Options Claude Code presents:

| Option | Action |
|--------|--------|
| Re-discover | Relaunch app, new screenshots, diff against existing ui-inventory.json |
| Add flow | Targeted discovery of a new section, create new flow directory |
| Add scenarios | Expand existing flow with more scenario coverage |
| Full refresh | Re-run complete discovery, update all affected flow files |

---

## 8. Test Lifecycle

### 8.1 Discovery Run (one-time per app version)

```
Check Accessibility permission
    ↓
Launch app → screencapture → Read screenshot → visual analysis
    ↓
Run qa-explore-macos.py → ui-inventory.json
    ↓
Navigate each section → screenshot → analyze → clarifying question
    ↓
Map sections to flows → write flow.md files
    ↓
Generate scenarios per flow → write scenarios.md files
    ↓
Write TC-NNN-*.md per scenario
    ↓
Update .qa-config.json → print summary
```

**Cost estimate**: $1.50–3.00 (10–15 screenshots × vision analysis)
**Time estimate**: 15–25 minutes (includes human answers to clarifying questions)

### 8.2 Execution Run (repeatable)

```
Read .qa-config.json → load flow list
    ↓
For each flow (or subagent per flow):
    Read flow.md + all TC-NNN-*.md files
        ↓
    For each test case:
        Run setup script
            ↓
        Run AppleScript steps via osascript
            ↓
        screencapture after each step
            ↓
        Claude Code reads screenshot → validates outcome (PASS/FAIL)
            ↓
        Write result + evidence path into TC file
        ↓
Generate qa/runs/RUN-YYYYMMDD-HHMMSS.md
```

**Cost estimate**: $0.10–0.30 per flow (2–4 screenshots × validation)
**Time estimate**: 2–5 minutes per flow

### 8.3 Full Suite Cost Summary

| Suite Type | Flows | Est. Cost | Est. Time |
|-----------|-------|-----------|-----------|
| Smoke (P1 only) | 4 | $0.50–1.20 | 10–20 min |
| Standard (P1+P2) | 10 | $1.20–3.00 | 25–50 min |
| Full regression | 20+ | $2.50–6.00 | 45–90 min |
| Monthly (daily smoke + weekly regression) | — | $50–150/mo | — |

Costs based on `claude-opus-4-6` pricing. Actuals accumulate in `.qa-config.json` run history.

---

## 9. Failure Classification & Recovery

### 9.1 Failure Taxonomy

| Class | Detection | Recovery Strategy | Stop Run? |
|-------|-----------|-------------------|-----------|
| `FLAKY` | Step fails, retry passes | Retry ×2 with `delay 2` injected between steps | No |
| `STALE_UI` | Element name not in ui-inventory | Re-run discovery for affected section, update flow | No — update and continue |
| `STATE_ERROR` | App in wrong state before step | Quit and relaunch app, re-run setup script | No |
| `NETWORK` | Timeout on network-dependent step | Wait 10s, retry ×2 | No |
| `CRASH` | Process not in `pgrep` output | Relaunch app, flag TC as P1 blocker | No (single TC) |
| `PERMISSION` | osascript returns permission error | Stop — ask user to re-grant Accessibility | Yes |
| `INFRA` | screencapture fails, disk full | Stop — report infrastructure issue | Yes |

### 9.2 Circuit Breaker Rule

If more than 50% of flows in a single run fail with the same class, Claude Code stops the run and reports a structural issue rather than continuing:

```
Example output:
"❌ Run aborted — 7/10 flows failed with STALE_UI.
The app's UI appears to have changed significantly since last discovery.
Recommendation: Run update mode (Step 11) to re-discover the current UI."
```

### 9.3 FLAKY Detection and Reporting

Over multiple runs, Claude Code tracks pass/fail history in `.qa-config.json`:

```json
{
  "run_history": [
    {
      "run_id": "RUN-20260410-143200",
      "tc_id": "TC-008",
      "result": "FAIL",
      "class": "FLAKY",
      "retry_passed": true
    }
  ]
}
```

A test case is marked `FLAKY` in its metadata when it fails-then-passes ≥2 times across runs.

### 9.4 STALE_UI Detection

After re-discovery in update mode, Claude Code diffs old vs. new `ui-inventory.json`:

```bash
# Claude Code compares element names
# Reports: added elements, removed elements, renamed elements
# Flags which flow.md and TC files reference removed/renamed elements
```

Affected TC files are updated automatically. Human review is required for complex UI restructures.

### 9.5 Retry Policy Configuration

Retry policies are configurable per flow and per failure class. Defaults are defined in `.qa-config.json` and can be overridden per-flow in `flow.md`:

```json
{
  "retryPolicy": {
    "FLAKY":      { "maxAttempts": 3, "backoffMs": 1000, "backoffMultiplier": 2 },
    "STALE_UI":   { "maxAttempts": 1, "action": "rediscover" },
    "STATE_ERROR":{ "maxAttempts": 2, "action": "reset_state" },
    "NETWORK":    { "maxAttempts": 4, "backoffMs": 2000, "backoffMultiplier": 2 },
    "CRASH":      { "maxAttempts": 1, "action": "relaunch_and_flag" },
    "INFRA":      { "maxAttempts": 2, "action": "requeue_different_worker" }
  }
}
```

### 9.6 Deterministic Execution

To ensure test results are reproducible across runs:

- **Fixed random seeds** for any randomized test data generation
- **Stable element selection**: always prefer name-based selection over index-based — `button "Save"` not `button 1`
- **Environment isolation**: each test run is provisioned with a fresh application state; no test inherits state from a previous test unless `flow.md` explicitly declares a dependency
- **Time freezing**: for flows involving date/time logic, a fixed timestamp is injected via environment variable or platform-specific time mock

---

## 10. Observability & Reporting

### 10.1 Observability Stack

The QA Agent emits rich observability data at every layer, built on open standards (OpenTelemetry) to avoid vendor lock-in:

| Layer | Tool | Data Emitted |
|-------|------|-------------|
| **Traces** | OpenTelemetry + Jaeger | Distributed spans per flow, step, and action — full causal chain from trigger to result |
| **Metrics** | Prometheus + Grafana | Test pass rate, duration, failure class distribution, worker utilization, queue depth |
| **Logs** | Structured JSON → Loki | Per-step action logs with timestamp, worker ID, flow ref, TC ref, outcome, screenshot path |
| **Reports** | Allure + custom HTML | Stakeholder-facing test results with screenshots, step details, trend analysis, failure summaries |
| **Alerts** | Alertmanager → Slack/Email | P0 circuit breaker trips, crash events, SLA breach (suite > threshold duration) |

### 10.2 Structured Log Format

Every event emitted by the agent follows this schema:

```json
{
  "ts": "2026-04-10T10:00:00.000Z",
  "runId": "run-abc123",
  "workerId": "worker-03",
  "platform": "darwin",
  "flowRef": "F-005-connect",
  "tcRef": "TC-012",
  "step": 3,
  "action": "click",
  "target": "button:Connect",
  "outcome": "pass",
  "durationMs": 847,
  "screenshotPath": "qa/evidence/TC-012-step-3.webp",
  "traceId": "4bf92f3577b34da6"
}
```

### 10.3 Allure Report Integration

Allure is the stakeholder-facing reporting layer. Each report includes:

- **Executive dashboard**: pass/fail/skip counts, trend over last N runs, platform breakdown
- **Flow-level results**: each flow shows all test cases with inline screenshots, step details, and duration
- **Failure analysis**: failure classes, most common failure points, Claude Code's diagnostic summary per failure
- **Flakiness index**: tests ranked by instability score over the last 30 days
- **Performance trends**: duration per flow charted over time — regressions highlighted
- **Evidence gallery**: all screenshots organized by run, platform, and TC reference

### 10.4 Real-Time Grafana Dashboard

A Grafana dashboard provides live visibility during long test runs:

- **Worker grid status**: health, current task, and utilization per worker
- **Queue depth**: tasks waiting, in progress, and completed per platform
- **Pass rate**: rolling 5-minute pass rate per platform and per flow
- **Active failures**: live feed of failing tests with failure class and TC reference

### 10.5 Per-Run Summary (Phase 1)

After every execution run, Claude Code writes `qa/runs/RUN-YYYYMMDD-HHMMSS.md`:

```markdown
# Run Summary — [AppName] — 2026-04-10 14:32

| Flow | Result | Duration | TCs Run | Pass | Fail |
|------|--------|----------|---------|------|------|
| F-001 App Launch | ✅ PASS | 1m 42s | 3 | 3 | 0 |
| F-002 Settings | ✅ PASS | 2m 15s | 5 | 5 | 0 |
| F-003 File Save | ❌ FAIL | 3m 01s | 4 | 3 | 1 |

**Result: 2 PASS / 1 FAIL**
**Total TCs**: 12 | **Passed**: 11 | **Failed**: 1

## Failures

### TC-008: File > Save Dialog — Cmd+S
- **Class**: STALE_UI
- **Step failed**: Step 3 — Save dialog did not appear after `keystroke "s" using command down`
- **Evidence**: `qa/evidence/TC-008-S3-fail.png`
- **Diagnosis**: "Save" dialog element name may have changed in this app version.
  Recommendation: run update mode to re-discover the save flow.
```

### 10.6 HTML Dashboard (Phase 2)

A 100-line Python script reads all `RUN-*.md` files and generates a static HTML dashboard:

```python
#!/usr/bin/env python3
"""generate-report.py — reads qa/runs/RUN-*.md, outputs qa/report.html"""
import os, re, glob
from datetime import datetime

def parse_run(path):
    """Parse a RUN-*.md file into a result dict."""
    with open(path) as f:
        content = f.read()
    run_id = os.path.basename(path).replace(".md", "")
    date_match = re.search(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2})", content)
    pass_count = len(re.findall(r"✅ PASS", content))
    fail_count = len(re.findall(r"❌ FAIL", content))
    return {
        "id": run_id,
        "date": date_match.group(1) if date_match else "unknown",
        "pass": pass_count,
        "fail": fail_count,
        "total": pass_count + fail_count,
    }

runs = [parse_run(p) for p in sorted(glob.glob("qa/runs/RUN-*.md"), reverse=True)]
rows = "\n".join(
    f"<tr><td>{r['id']}</td><td>{r['date']}</td>"
    f"<td style='color:green'>{r['pass']}</td>"
    f"<td style='color:red'>{r['fail']}</td>"
    f"<td>{r['total']}</td></tr>"
    for r in runs
)

html = f"""<!DOCTYPE html>
<html><head><title>QA Report</title>
<style>body{{font-family:sans-serif;padding:2rem}}table{{border-collapse:collapse;width:100%}}
th,td{{border:1px solid #ddd;padding:8px;text-align:left}}th{{background:#f4f4f4}}</style>
</head><body>
<h1>QA Agent — Run History</h1>
<p>Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}</p>
<table><tr><th>Run ID</th><th>Date</th><th>Pass</th><th>Fail</th><th>Total</th></tr>
{rows}
</table></body></html>"""

with open("qa/report.html", "w") as f:
    f.write(html)
print("Report written to qa/report.html")
```

### 10.7 CI Integration (Phase 3)

The run summary is uploaded as a build artifact. Claude Code exits with a non-zero code if any TC failed:

```bash
# Claude Code writes exit code to a file
# CI reads it
if grep -q "❌ FAIL" qa/runs/RUN-*.md; then
  exit 1
fi
```

Slack notification via `curl` to a webhook:
```bash
SUMMARY=$(grep -E "Result:|Failures" qa/runs/RUN-*.md | head -5)
curl -X POST "$SLACK_WEBHOOK" \
  -H 'Content-type: application/json' \
  --data "{\"text\": \"QA Run for ${APP_NAME}: ${SUMMARY}\"}"
```

---

## 11. CI/CD Integration

### 11.1 How CI Invokes Claude Code

CI calls the `claude` CLI exactly the same way a developer does. Claude Code reads SKILL.md, uses its built-in tools, and produces the run summary. No SDK, no custom agent loop.

```bash
# Generic CI step
claude -p "Run the native-qa skill for ${APP_NAME}. \
  Execute all flows in qa/flows/. \
  Write PASS/FAIL into each TC file. \
  Generate qa/runs/RUN-$(date +%Y%m%d-%H%M%S).md. \
  Exit with non-zero code if any flow failed."
```

### 11.2 Shell Wrapper Scripts

**`scripts/run-qa.sh` — full workflow**

```bash
#!/bin/bash
# run-qa.sh — Run the full QA workflow via Claude Code
# Usage: ./scripts/run-qa.sh TextEdit
# Usage: ./scripts/run-qa.sh TextEdit execute   (execute-only, no discovery)

set -euo pipefail

APP_NAME="${1:-}"
MODE="${2:-full}"
DATE=$(date +%Y-%m-%d)

if [ -z "$APP_NAME" ]; then
  echo "Usage: $0 <AppName> [full|execute|discover|update]"
  exit 1
fi

case "$MODE" in
  full)
    TASK="Run the native-qa skill for '${APP_NAME}'. \
Follow SKILL.md step by step. \
Use flow-based framework. \
Today's date: ${DATE}."
    ;;
  execute)
    RUN_ID="RUN-$(date +%Y%m%d-%H%M%S)"
    TASK="Execute the existing QA test suite for '${APP_NAME}'. \
Read qa/.qa-config.json to load flows. \
Run each TC file's AppleScript, capture screenshots, write PASS/FAIL results. \
Generate qa/runs/${RUN_ID}.md summary."
    ;;
  discover)
    TASK="Run discovery for '${APP_NAME}'. \
Follow SKILL.md steps 4 and 5 only. \
Take screenshots, run scripts/qa-explore-macos.py, create flow.md files. \
Do not generate test cases yet."
    ;;
  update)
    TASK="Update the existing QA workspace for '${APP_NAME}'. \
Follow SKILL.md Step 11 (UPDATE MODE). \
Re-discover the app UI, diff against existing ui-inventory.json, \
update affected flow.md files, report changes."
    ;;
  *)
    echo "Unknown mode: $MODE. Use: full|execute|discover|update"
    exit 1
    ;;
esac

echo "QA Agent — Claude Code execution"
echo "App:  ${APP_NAME}"
echo "Mode: ${MODE}"
echo "=============================="

claude -p "${TASK}"
```

**`scripts/run-parallel.sh` — parallel flow execution**

```bash
#!/bin/bash
# run-parallel.sh — Execute each flow as a separate Claude Code session
# Usage: ./scripts/run-parallel.sh TextEdit
# Note: max 3 concurrent sessions (macOS Accessibility API constraint)

set -euo pipefail

APP_NAME="${1:-}"
MAX_PARALLEL="${2:-3}"
RUN_ID="RUN-$(date +%Y%m%d-%H%M%S)"

if [ -z "$APP_NAME" ]; then
  echo "Usage: $0 <AppName> [max_parallel]"
  exit 1
fi

# Get all flow directories
FLOWS=($(ls -d qa/flows/F-*/  2>/dev/null))
if [ ${#FLOWS[@]} -eq 0 ]; then
  echo "No flows found in qa/flows/. Run discovery first."
  exit 1
fi

echo "Executing ${#FLOWS[@]} flows (max ${MAX_PARALLEL} parallel)"

PIDS=()
COUNT=0

for FLOW_PATH in "${FLOWS[@]}"; do
  FLOW_NAME=$(basename "$FLOW_PATH")
  
  # Throttle to MAX_PARALLEL concurrent sessions
  if [ ${#PIDS[@]} -ge "$MAX_PARALLEL" ]; then
    wait "${PIDS[0]}"
    PIDS=("${PIDS[@]:1}")
  fi

  TASK="Execute flow ${FLOW_NAME} for '${APP_NAME}'. \
Read ${FLOW_PATH}flow.md and all ${FLOW_PATH}test-cases/TC-*.md files. \
Run each TC's AppleScript steps via osascript. \
Screenshot after each step. \
Read screenshots to validate outcomes. \
Write PASS/FAIL + evidence path back into each TC file. \
Write results to qa/evidence/${FLOW_NAME}/."

  claude -p "$TASK" &
  PIDS+=($!)
  
  COUNT=$((COUNT + 1))
  echo "Spawned session for ${FLOW_NAME} (PID ${PIDS[-1]})"
done

# Wait for remaining sessions
for PID in "${PIDS[@]}"; do
  wait "$PID"
done

echo "All flows complete. Generating merged summary..."

claude -p "Read all TC-*.md files in qa/flows/ that were just executed. \
Compile a summary showing PASS/FAIL per flow and per TC. \
Write the summary to qa/runs/${RUN_ID}.md. \
List all failures with TC ID, step failed, and evidence screenshot path."
```

### 11.3 GitHub Actions Workflow

```yaml
# .github/workflows/qa.yml
name: QA Agent

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 6 * * 1-5'   # Daily smoke test at 06:00 UTC, weekdays
  workflow_dispatch:
    inputs:
      app_name:
        description: 'App to test'
        required: true
        default: 'TextEdit'
      mode:
        description: 'Execution mode'
        required: false
        default: 'execute'
        type: choice
        options: [full, execute, discover, update]

env:
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

jobs:
  qa:
    runs-on: macos-latest   # Must be macOS — AppleScript requires it
    timeout-minutes: 60

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Install Claude Code CLI
        run: npm install -g @anthropic-ai/claude-code

      - name: Load test credentials
        run: |
          echo "QA_APP_NAME=${{ vars.QA_APP_NAME }}" >> .env.qa
          echo "QA_USERNAME=${{ secrets.QA_USERNAME }}" >> .env.qa
          echo "QA_PASSWORD=${{ secrets.QA_PASSWORD }}" >> .env.qa

      - name: Run QA via Claude Code
        run: |
          chmod +x scripts/run-qa.sh
          ./scripts/run-qa.sh "${{ inputs.app_name || 'TextEdit' }}" "${{ inputs.mode || 'execute' }}"

      - name: Upload run summary
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: qa-run-summary
          path: qa/runs/

      - name: Upload evidence screenshots
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: qa-evidence
          path: qa/evidence/

      - name: Check for failures and notify
        if: failure()
        run: |
          SUMMARY=$(grep -E "(FAIL|PASS|Result)" qa/runs/RUN-*.md 2>/dev/null | head -10 || echo "No summary found")
          curl -X POST "${{ secrets.SLACK_WEBHOOK }}" \
            -H 'Content-type: application/json' \
            --data "{\"text\": \"❌ QA Failed — ${{ inputs.app_name }}\n${SUMMARY}\"}"
```

### 11.4 Jenkinsfile

```groovy
pipeline {
    agent { label 'macos' }

    parameters {
        string(name: 'APP_NAME',  defaultValue: 'TextEdit', description: 'macOS app to test')
        choice(name: 'MODE',      choices: ['execute', 'full', 'discover', 'update'])
        booleanParam(name: 'NOTIFY_SLACK', defaultValue: true)
    }

    environment {
        ANTHROPIC_API_KEY = credentials('anthropic-api-key')
        SLACK_WEBHOOK     = credentials('slack-qa-webhook')
    }

    options {
        timeout(time: 60, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '30'))
    }

    stages {
        stage('Setup') {
            steps {
                sh 'npm install -g @anthropic-ai/claude-code'
                sh 'chmod +x scripts/run-qa.sh'
                withCredentials([
                    string(credentialsId: 'qa-username',  variable: 'QA_USER'),
                    string(credentialsId: 'qa-password',  variable: 'QA_PASS')
                ]) {
                    sh '''
                        echo "QA_APP_NAME=${APP_NAME}" > .env.qa
                        echo "QA_USERNAME=${QA_USER}"  >> .env.qa
                        echo "QA_PASSWORD=${QA_PASS}"  >> .env.qa
                    '''
                }
            }
        }

        stage('Run QA') {
            steps {
                sh './scripts/run-qa.sh "${APP_NAME}" "${MODE}"'
            }
        }

        stage('Report') {
            steps {
                archiveArtifacts artifacts: 'qa/runs/RUN-*.md', allowEmptyArchive: true
                archiveArtifacts artifacts: 'qa/evidence/**/*.png', allowEmptyArchive: true
            }
        }
    }

    post {
        failure {
            script {
                if (params.NOTIFY_SLACK) {
                    def summary = sh(script: "grep -E '(FAIL|PASS)' qa/runs/RUN-*.md | head -5 || echo 'No summary'", returnStdout: true).trim()
                    sh """
                        curl -X POST "${SLACK_WEBHOOK}" \
                          -H 'Content-type: application/json' \
                          --data '{"text": "❌ QA Failed — ${APP_NAME} (${MODE})\\n${summary}"}'
                    """
                }
            }
        }
    }
}
```

---

## 12. Cost Model

### 12.1 Per-Activity Estimates

All costs use `claude-opus-4-6` pricing: **$5.00 input / $25.00 output per 1M tokens**.

| Activity | Input Tokens | Output Tokens | Screenshots | Est. Cost |
|----------|-------------|---------------|-------------|-----------|
| Discovery (10 screens) | ~30K | ~15K | 10 | $0.80–1.50 |
| Flow creation (6 flows) | ~8K | ~12K | 0 | $0.35–0.70 |
| Scenario generation (6 flows × 8 avg) | ~12K | ~20K | 0 | $0.55–1.10 |
| TC generation (48 TCs) | ~20K | ~40K | 0 | $1.10–2.20 |
| Full discovery + generation | ~70K | ~87K | 10 | **$2.50–5.00** |
| Execute smoke (P1, 4 flows) | ~15K | ~8K | 16 | **$0.80–1.50** |
| Execute full suite (10 flows) | ~35K | ~20K | 40 | **$1.50–3.50** |

### 12.2 Monthly Cost Estimate

| Run Pattern | Frequency | Cost/Run | Monthly |
|-------------|-----------|----------|---------|
| Daily smoke (P1, 4 flows) | 22×/month | $0.80–1.50 | $18–33 |
| Weekly regression (full) | 4×/month | $1.50–3.50 | $6–14 |
| On-demand PR checks | 10×/month | $1.00–2.00 | $10–20 |
| **Total** | — | — | **$34–67/month** |

Costs drop significantly with model-tier selection. Use `claude-haiku-4-5` for smoke runs (~5× cheaper) and `claude-opus-4-6` for discovery and complex validation.

---

## 13. Security Architecture

### 13.1 Credential Isolation

```
.env.qa (gitignored — NEVER committed)
    ↓ loaded at runtime by test setup scripts
    ↓ never appears in any TC file or qa/ markdown
    ↓ documented by structure only in qa/credentials/access.md

qa/credentials/access.md (committed — structure only)
    Documents: which accounts are needed, what tier, what format
    Contains: placeholder names, never real values

CI credentials: secrets manager only (GitHub Secrets / Jenkins Credentials)
    Never in environment variables visible in logs
    Never in job outputs or artifacts
```

### 13.2 Gitignore Configuration

The following must be in `.gitignore` at the consuming repo root:

```gitignore
# QA Agent — never commit these
.env.qa
qa/credentials/.env*
qa/credentials/*.env
qa/evidence/
qa/knowledgebase/screenshots/
qa/runs/*.md          # optional — commit if runs should be tracked
```

**Always commit**: `qa/flows/`, `qa/knowledgebase/ui-inventory.md`, `qa/.qa-config.json`
These are the living QA documentation for the team.

**Never commit**: Screenshots (large binaries), evidence (per-run artifacts), real credentials.

### 13.3 AppleScript Security Boundaries

- Claude Code only controls apps explicitly specified in the task
- No wildcard access: every AppleScript targets a named process
- All automation runs under the user's own permissions — no privilege escalation
- Destructive operations (delete, reset, format) are flagged in `qa/guardrails/do-and-dont.md` and skipped unless explicitly enabled

---

## 14. What NOT to Build

These are explicitly deferred until the stated condition is true. Build when the problem is real, not when the spec imagines it.

| Deferred Item | Defer Until |
|--------------|-------------|
| Redis job queue | >20 concurrent flows with real queue contention |
| Kubernetes worker grid | >5 parallel platforms with real compute requirements |
| Docker containerisation | CI environment parity problems actually appear |
| OpenTelemetry + Grafana | Production monitoring is a real stakeholder requirement |
| Allure HTML reports | Markdown run summaries are actually insufficient for the team |
| Skill Registry daemon | >10 platform skills are registered and hot-reload is needed |
| WebP screenshot compression | Storage cost becomes a measurable budget item |
| Time freezing / deterministic seeds | Date-dependent test failures are actually observed |
| Custom token accounting | Claude Code's built-in usage is insufficient |
| Distributed tracing | Single-session observability is genuinely insufficient |

---

## 15. Phased Roadmap

### Phase 0 — Baseline (Complete ✅)

All foundational assets exist and are production-ready for manual use:

- [x] `SKILL.md` — 10-step workflow, mode detection, templates
- [x] `scripts/qa-explore-macos.py` — UI enumeration via AppleScript
- [x] `templates/flow.md`, `templates/scenarios.md`, `templates/test-case-native.md`
- [x] `references/macos-automation.md` — AppleScript reference
- [x] `references/test-patterns-native.md` — Scenario pattern library
- [x] `CLAUDE.md` — Claude Code project instructions

### Phase 1 — First End-to-End Run (Now — 2–4 weeks)

**Goal**: A complete QA run against one real app. Evidence collected. Run summary written.

**Exit criteria**: `./scripts/run-qa.sh TextEdit execute` completes end-to-end and produces a `qa/runs/RUN-*.md` with PASS/FAIL per flow.

- [ ] `scripts/run-qa.sh` — Shell wrapper that calls `claude -p`
- [ ] `scripts/run-parallel.sh` — Parallel flow execution wrapper
- [ ] Validate that all TC AppleScript blocks are actually runnable against a real app
- [ ] Verify evidence screenshot naming and paths
- [ ] Test PASS/FAIL write-back into TC files
- [ ] Write first real `qa/runs/RUN-*.md` summary

### Phase 2 — Web Skill (1–2 months)

**Goal**: The same workflow, applied to a web app via Playwright.

**Exit criteria**: `./scripts/run-qa.sh my-web-app.com execute --platform web` runs and produces a run summary.

- [ ] `skills/web/SKILL.md` — web-specific discovery workflow
- [ ] `skills/web/scripts/playwright-explore.js` — DOM + accessibility tree enumeration
- [ ] `skills/web/references/playwright-patterns.md` — web scenario patterns
- [ ] Visual regression baseline (screenshot diff, not pixel-perfect)
- [ ] Parallel execution: macOS + web via `scripts/run-parallel.sh`

### Phase 3 — CI Integration (2–4 months)

**Goal**: Tests run automatically on code push. Failures block merge.

**Exit criteria**: A PR that breaks a P1 flow fails the CI check before it can merge.

- [ ] GitHub Actions workflow (`.github/workflows/qa.yml`)
- [ ] Non-zero exit code when any flow fails
- [ ] Run summary uploaded as build artifact
- [ ] Slack notification on failure
- [ ] Flaky test detection (pass/fail history in `.qa-config.json`)
- [ ] `scripts/generate-report.py` — HTML report from `RUN-*.md` files

### Phase 4 — iOS & Android (4–8 months)

**Goal**: iOS and Android coverage with the same skill model.

**Exit criteria**: One flow definition covers macOS, web, iOS, and Android.

- [ ] `skills/ios/SKILL.md` + `xcrun simctl` exploration script
- [ ] `skills/android/SKILL.md` + ADB/UIAutomator2 exploration script
- [ ] `scripts/coordinator.sh` — multi-platform fan-out shell script
- [ ] Cross-platform flow specification (one flow, multiple platform targets)
- [ ] Device farm integration (if physical devices are required)

---

## 16. State, Memory & Context Management

### 16.1 Three Scopes of State

The QA Agent maintains state at three distinct scopes. Understanding these scopes is critical for writing reliable test scenarios and for understanding how the agent reasons across long-running sessions.

| Scope | Lifetime | What it Holds | Storage |
|-------|----------|---------------|---------|
| **Run Context** | Single test run | Active TestPlan, current flow, step index, retry count, live screenshots | In-memory / Redis |
| **Session State** | Agent session | Auth tokens, browser `storageState`, device session IDs, app launch PID | Redis + filesystem |
| **Persistent Memory** | Cross-run | `ui-inventory.json`, `qa/.qa-config.json`, visual baselines, known flaky test registry | Git + S3/MinIO |

### 16.2 Context Window Management

Claude Code has a finite context window. For long test runs, the Orchestration Layer implements a context management strategy:

- **Summarization**: After every 10 completed flows, Claude Code generates a `CompletionSummary` (compact JSON) replacing verbose flow details in context.
- **Rolling window**: Only the last 5 test events are kept in full detail. Older events are referenced by ID only.
- **Checkpointing**: Full context state is serialized to disk at configurable intervals. On crash or timeout, the run resumes from the last checkpoint.
- **Memory anchors**: `CLAUDE.md`, `qa/.qa-config.json`, and the current `flow.md` are always kept in the context window regardless of size pressure — they are the non-evictable anchors.
- **Max flows per session**: 50 flows per Claude Code session. The orchestrator segments larger suites across multiple sessions automatically.

### 16.3 Cross-Run Memory

Between runs, the agent learns and adapts using its persistent memory layer:

- **Flaky test registry**: Tests that have failed and passed on identical code are flagged as flaky. The planner deprioritizes flaky tests on fast smoke runs and increases their retry budget on nightly runs.
- **Performance baselines**: P95 latency per flow is tracked over time. Regressions (>20% increase) are flagged automatically, even if the test passes functionally.
- **UI change detection**: `ui-inventory.json` diffs between runs detect UI regressions that would otherwise require manual inspection.
- **Failure patterns**: Recurring failures of the same type (e.g., timeout on Step 3 of F-007) are surfaced as structural issues in the report, not individual flakes.

### 16.4 Reasoning Modes

Claude Code operates in three distinct reasoning modes depending on the task context:

| Mode | When Active | What Claude Code Does |
|------|-------------|----------------------|
| **Visual Reasoning** | Screenshots or UI trees are the primary input | Reads pixel-level content, identifies UI elements by position and label, makes decisions based on visual state |
| **Logical Reasoning** | Structured data (JSON logs, test results, config files) is the primary input | Performs deterministic validation against schemas and expectations |
| **Diagnostic Reasoning** | A test has failed and root-cause analysis is needed | Builds a causal chain from the failure event backward through logs, state snapshots, and execution history |

---

## 17. Performance, Scalability & Parallelism

### 17.1 Parallel Execution Architecture

The QA Agent is designed for maximum test throughput through a distributed worker model. Three levels of parallelism operate simultaneously:

| Level | What Runs in Parallel | Orchestration Mechanism |
|-------|----------------------|------------------------|
| **Platform** | macOS + iOS + Web simultaneously | Separate worker pools per platform type. Each pool scales independently. |
| **Flow** | F-001, F-002, F-003 concurrently | Workflow Engine dispatches independent flows to available workers. Dependent flows are serialized via DAG. |
| **Browser/Device** | Chrome + Firefox + WebKit | Playwright's built-in sharding. N browsers per flow, results merged. |

### 17.2 Worker Grid

Workers are containerized processes that each run exactly one test task at a time. The worker grid is managed by a Redis-backed Job Queue and scaled by a Controller that monitors queue depth and worker health:

- **Minimum workers**: 2 per platform (always warm, zero cold-start latency for common platforms)
- **Maximum workers**: Configurable per environment — default: 8 per platform, 32 total
- **Auto-scale trigger**: Queue depth > 3 tasks per worker for > 30 seconds
- **Scale-down trigger**: Queue empty for > 5 minutes
- **Worker health**: Heartbeat every 10 seconds. Missed 3 heartbeats → worker marked dead, task requeued

**macOS/Windows constraint**: Native platform workers (AppleScript, WinAppDriver) cannot be containerised — they run on dedicated Mac mini / Windows Server nodes managed via SSH tunnel from Kubernetes. Max 3–5 concurrent native sessions due to Accessibility API single-thread limitation.

### 17.3 Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Skill dispatch latency | < 50ms | Time from task assignment to first automation action |
| Full smoke suite (P1 flows) | < 5 minutes | Parallel execution across all platforms, 4 workers per platform |
| Full regression suite | < 30 minutes | All flows, all platforms, 8 workers per platform |
| Screenshot capture latency | < 200ms | Native `screencapture` / Playwright screenshot |
| Report generation | < 60 seconds | Allure report from raw JSON results |
| Worker cold-start time | < 10 seconds | Docker container warm from registry cache |
| UI discovery (one app) | < 3 minutes | 10 sections × screenshot + analysis |
| Test case generation (50 TCs) | < 8 minutes | Including scenario planning per flow |

### 17.4 Resource Efficiency

- **Screenshot compression**: WebP format at 85% quality reduces evidence storage by ~60% vs PNG with no meaningful visual fidelity loss.
- **Lazy skill loading**: Skill modules are loaded into memory only when the first task requiring that platform is dispatched. Idle platform skills consume zero memory.
- **Shared browser contexts**: For web testing, a single browser process supports multiple parallel page contexts, reducing memory footprint by 4–6× vs launching one browser per test.
- **Result streaming**: Test results are streamed to the observability pipeline in real time. No batch accumulation — constant memory usage regardless of suite size.
- **Haiku for smoke, Opus for discovery**: Use `claude-haiku-4-5` for repeatable execution runs (5× cheaper), reserve `claude-opus-4-6` for discovery, scenario planning, and complex failure diagnosis.

### 17.5 Scalability Limits & Thresholds

| Dimension | Phase 1 Limit | Phase 3 Limit | Scaling Mechanism |
|-----------|--------------|--------------|-------------------|
| Concurrent flows | 3–5 (macOS API constraint) | 32 (web/mobile) | Worker grid auto-scale |
| Platforms in parallel | 1 | 6 | Shell fan-out / K8s |
| Test cases per suite | Unlimited | Unlimited | Segmented sessions |
| Claude Code sessions | 1 | N (one per platform) | `coordinator.sh` |
| Evidence storage | Local disk | S3 + 90-day retention | S3-MCP upload |

---

## 18. MCP Server Integration

### 18.1 QA Agent MCP Server — Tool Catalogue

Claude Code communicates with the external world through the Model Context Protocol (MCP). The QA Agent exposes its core capabilities as MCP tools, enabling Claude Code to invoke automation actions, read results, and manage state through a uniform, typed interface.

| MCP Tool | Platform | Description |
|----------|----------|-------------|
| `qa_plan` | All | Generate and return a TestPlan JSON for the specified app, platform, and tags |
| `qa_discover` | All | Run UI discovery on the target app. Returns `ui-inventory.json` path and element count summary |
| `qa_run_flow` | All | Execute a specific flow by ID. Returns structured result with pass/fail per step |
| `qa_screenshot` | All | Capture current UI state. Returns base64 screenshot for Claude Code visual analysis |
| `qa_get_report` | All | Return the latest Allure report summary as structured JSON |
| `qa_reset_state` | All | Reset application to a known state (restart, clear data, restore snapshot) |
| `playwright_navigate` | Web | Playwright MCP: navigate to URL, click element, fill form, assert text |
| `playwright_screenshot` | Web | Playwright MCP: capture page screenshot and return to Claude Code for analysis |
| `device_list` | Mobile | List connected iOS/Android devices and simulators |
| `device_install` | Mobile | Install an app build on a specified device or simulator |

### 18.2 Recommended External MCP Servers

| MCP Server | Purpose | Integration Value |
|------------|---------|------------------|
| `playwright-mcp` | Web automation | Direct browser control from Claude Code. Best-in-class for web skill implementation. |
| `github-mcp` | CI/CD trigger | Read PRs, diffs, and workflow runs. Claude Code uses diff to focus test planning on changed surfaces. |
| `jira-mcp` | Bug filing | Automatically create JIRA tickets for P1 failures with screenshots and diagnostic summaries. |
| `slack-mcp` | Notifications | Post run summaries, P0 alerts, and daily test health digests to configured channels. |
| `s3-mcp` | Evidence storage | Upload screenshots and reports to S3-compatible storage for long-term retention. |
| `postgres-mcp` | Historical data | Store test run history for trend analysis, flakiness tracking, and performance baseline comparisons. |

### 18.3 MCP Security Controls

- The QA Agent MCP server requires authentication via API key for all tool calls. Keys are rotated on a 90-day schedule.
- MCP tools that modify system state (`qa_reset_state`, `device_install`) require a second confirmation step before execution.
- All MCP tool calls are logged with full request/response for audit purposes.

---

## 19. Project Structure

### 19.1 Repository Root

```
qa-agent/
├── CLAUDE.md                   ← Claude Code project config & context
├── README.md                   ← Developer onboarding guide
├── CONTRIBUTING.md             ← Contribution guide for new platforms
├── LICENSE
├── package.json                ← Node dependencies (Playwright, Allure)
├── pyproject.toml              ← Python dependencies (Appium, uv)
├── docker-compose.yml          ← Local dev stack
├── docker-compose.prod.yml     ← Production stack override
├── .env.example                ← Environment variable template
├── .env.qa                     ← Test credentials (GITIGNORED)
├── .gitignore
├── .qa-config.json             ← Root workspace config
│
├── skills/                     ← OS-specific skill modules
├── orchestrator/               ← Workflow engine & state management
├── workers/                    ← Parallel worker agents
├── mcp-server/                 ← QA Agent MCP server
├── qa/                         ← Test artifacts (flows, cases, evidence)
├── infra/                      ← Kubernetes, Terraform, Docker
├── observability/              ← Dashboards, alert rules, log config
└── docs/                       ← Architecture docs (this document)
```

### 19.2 Skills Directory

```
skills/
├── _registry/
│   ├── registry.json           ← Auto-generated skill index
│   └── health.json             ← Last health check per skill
│
├── macos/                      ← macOS native skill
│   ├── SKILL.md
│   ├── skill-manifest.json
│   ├── explore.py              ← AppleScript UI discovery
│   ├── interact.py             ← AppleScript interaction driver
│   ├── screenshot.py           ← screencapture wrapper
│   ├── templates/
│   │   ├── flow.md
│   │   ├── scenarios.md
│   │   └── test-case.md
│   └── references/
│       ├── macos-automation.md
│       └── test-patterns.md
│
├── windows/                    ← Windows native skill (mirror structure)
├── ios/                        ← iOS skill (mirror structure)
├── android/                    ← Android skill (mirror structure)
│
├── web/                        ← Web/SPA skill
│   ├── SKILL.md
│   ├── skill-manifest.json
│   ├── playwright.config.ts
│   ├── explore.ts
│   ├── interact.ts
│   ├── visual-diff.ts
│   └── references/
│       ├── playwright-patterns.md
│       └── selector-strategies.md
│
└── extension/                  ← Browser extension skill
```

### 19.3 Orchestrator Directory

```
orchestrator/
├── index.ts                    ← Entry point: starts orchestrator server
├── planner.ts                  ← Claude Code test planning interface
├── skill-router.ts             ← Resolves & dispatches to skill modules
├── workflow-engine.ts          ← DAG-based flow execution engine
├── state-manager.ts            ← Run, session & persistent state
├── context-manager.ts          ← Claude Code context window management
├── recovery-engine.ts          ← Failure classification & recovery
├── validator.ts                ← Result validation (strict + semantic)
├── event-bus.ts                ← Internal pub/sub for test events
└── types.ts                    ← Shared TypeScript interfaces
```

### 19.4 QA Test Artifacts Directory

```
qa/
├── .qa-config.json             ← Workspace config (app, framework, counts)
├── planning/
│   └── platforms.md            ← Target environments & versions
├── guardrails/
│   └── do-and-dont.md          ← Safety rules & constraints
├── credentials/
│   └── access.md               ← Credential structure (no real values)
├── scope/
│   └── contract.md             ← What is & is not in scope
├── knowledgebase/
│   ├── ui-inventory.json       ← Current UI element index
│   ├── ui-inventory.md         ← Human-readable UI inventory
│   └── screenshots/            ← Discovery screenshots (GITIGNORED)
├── flows/
│   ├── F-001-app-launch/
│   │   ├── flow.md
│   │   ├── scenarios.md
│   │   └── test-cases/
│   │       ├── TC-001-cold-launch.md
│   │       └── TC-002-warm-launch.md
│   ├── F-002-authentication/
│   └── F-NNN-[feature]/
├── evidence/                   ← Screenshots from test runs (GITIGNORED)
│   └── YYYY-MM-DD/
│       └── TC-NNN-step-N.webp
└── runs/
    └── RUN-YYYYMMDD-HHMMSS.md ← Post-execution run summary
```

### 19.5 Infrastructure Directory

```
infra/
├── docker/
│   ├── Dockerfile.worker       ← Worker agent container
│   ├── Dockerfile.orchestrator ← Orchestrator container
│   └── Dockerfile.mcp-server   ← MCP server container
├── k8s/
│   ├── namespace.yaml
│   ├── orchestrator-deploy.yaml
│   ├── worker-deploy.yaml      ← HorizontalPodAutoscaler configured
│   ├── redis-deploy.yaml
│   ├── mcp-server-deploy.yaml
│   └── ingress.yaml
└── terraform/
    ├── main.tf                 ← Cloud provider resources
    ├── variables.tf
    └── modules/
        ├── device-farm/        ← AWS Device Farm / BrowserStack config
        └── storage/            ← S3 bucket for evidence & reports
```

---

## 20. Infrastructure & Deployment

### 20.1 Container Architecture

Every component of the QA Agent runs in a Docker container. The production stack is orchestrated by Kubernetes with auto-scaling enabled for the worker tier.

| Component | Count | Notes |
|-----------|-------|-------|
| **Orchestrator** | ×1 (stateful) | Manages workflow engine, state manager, and Claude Code interface. Uses persistent volume for checkpoint storage. |
| **MCP Server** | ×1 (stateless) | API server exposing QA tools to Claude Code. Scales horizontally behind a load balancer. |
| **Workers — Native** | ×2–8 | macOS and Windows workers require dedicated hardware nodes (no Docker). Managed via SSH tunnel from Kubernetes. Mac mini cluster for macOS; Windows Server VMs for Windows. |
| **Workers — Web** | ×2–16 | Playwright workers run in Chromium-based containers with xvfb for headed mode. Fully Docker-compatible. |
| **Workers — Mobile** | ×2–8 | Appium workers connected to physical device farm or cloud device service (BrowserStack, Sauce Labs, AWS Device Farm). |
| **Redis** | ×1 + replica | Job queue, session state, and pub/sub event bus. Persistence enabled with AOF. |
| **PostgreSQL** | ×1 | Historical test run data, flakiness registry, performance baselines. |

### 20.2 Environment Tiers

| Tier | Trigger | Scope | SLA |
|------|---------|-------|-----|
| **Smoke** | Every PR | P1 flows only, 1 platform | < 5 min. Must pass before merge review. |
| **Regression** | Merge to main | All P1+P2 flows, all platforms | < 30 min. Failure blocks release branch creation. |
| **Nightly** | Schedule 02:00 | Full suite including P3, performance | < 60 min. Results in morning standup report. |
| **Release** | Manual trigger | Full suite + exploratory discovery | < 90 min. Required before version tag creation. |

### 20.3 CI/CD Integration Pattern

```yaml
# GitHub Actions — standard QA step
- name: Run QA Agent
  uses: qa-agent/run-action@v2
  with:
    tags: "smoke,regression"
    platforms: "macos,web"
    fail_on_p1: true
    report_to_pr: true
    slack_channel: "#qa-results"
```

The action triggers the orchestrator, polls for completion, and uploads the Allure report as a PR comment. P1 failures cause the CI check to fail, blocking the merge.

### 20.4 Local Development Stack

```bash
# Spin up full local stack
docker-compose up -d

# Run QA against local stack
./scripts/run-qa.sh MyApp full

# Tear down
docker-compose down
```

---

## 21. Tool & Framework Recommendations

### 21.1 Core Framework Stack

| Tool | Layer | Rationale |
|------|-------|-----------|
| **Claude Code** | Intelligence | Only AI coding agent with first-class MCP support and bash/file tools for OS-level automation. |
| **Playwright** | Web automation | Async, multi-browser, network interception, visual regression, accessibility, performance metrics. Best-in-class MCP integration via `playwright-mcp`. |
| **Appium** | Mobile | Cross-platform (iOS + Android) from one API. W3C WebDriver compliant. Integrates with BrowserStack and AWS Device Farm. |
| **AppleScript** | macOS native | Only mechanism for deep macOS Accessibility API access. No external dependency. Claude Code invokes via `osascript` through `bash_tool`. |
| **WinAppDriver** | Windows native | Microsoft-maintained, uses UIA3 which exposes the same accessibility tree model as macOS. REST API compatible with WebDriver protocol. |
| **XCUITest** | iOS native | Apple-native framework. Best stability on physical devices. Integrates with `xcrun simctl` for simulator lifecycle management. |
| **Allure 3** | Reporting | Test-framework-agnostic. Rich HTML reports with history, trends, and screenshot galleries. Native CI integrations. |
| **Redis Stack** | Queue/State | Persistent job queue, session state cache, and pub/sub event bus in one deployment. Sub-millisecond latency. |
| **OpenTelemetry** | Observability | Vendor-neutral. Traces flow from CI trigger through every worker action. Exports to Jaeger, Grafana Tempo, or Datadog. |

### 21.2 Automation-First Criteria

Every tool in the stack meets these requirements:

- **Headless execution**: All web/mobile tools run without a display server in CI environments.
- **Programmatic control**: Zero GUI configuration required. All settings managed via config files or environment variables.
- **MCP compatibility**: Exposed as MCP tools or invokable via Claude Code's `bash_tool` and file tools.
- **Parallel execution**: Native support for running N instances concurrently without port conflicts.
- **Result serialization**: Outputs structured JSON that the observability pipeline can ingest directly.

### 21.3 Cloud Device Services

For mobile testing without on-premise hardware:

| Service | Best For | Integration |
|---------|----------|-------------|
| **BrowserStack** | iOS + Android + Web | Full Appium and Playwright support. Allure upload integration. Highest device variety. |
| **AWS Device Farm** | Android + Web | Deep AWS integration. Cost-effective for teams already in AWS ecosystem. |
| **Sauce Labs** | Web + Mobile | Best performance metrics. Extended debugging. Integrates with GitHub Actions and JIRA. |
| **LambdaTest** | Web | Most cost-effective for web-only. Good Playwright support. HyperExecute for fast parallel runs. |

---

## 22. Client & Stakeholder Perspective

### 22.1 Day-to-Day Experience

From a project team's perspective, the QA Agent operates as a self-managing QA engineer attached to the CI/CD pipeline:

1. A developer opens a PR. The smoke suite runs automatically and posts results as a PR comment within 5 minutes.
2. On merge to main, the full regression suite runs and results are posted to `#qa-results` with a pass/fail summary and Allure report link.
3. If a P1 test fails, a JIRA ticket is automatically created with: failure classification, screenshot evidence, Claude Code's diagnostic summary, and a suggested fix based on similar past failures.
4. Every morning, the team receives a digest summarising the prior night's test run with trend data.
5. Before a release, the QA lead triggers a full release suite run and receives a go/no-go recommendation from the agent based on pass rates and open P1 failures.

### 22.2 Advantages Over Traditional QA Automation

| Dimension | Traditional Automation | QA Agent |
|-----------|----------------------|----------|
| **Test authoring** | Manual: engineers write selectors and assertions for every scenario | AI-generated from UI discovery. Claude Code writes test cases from screenshots and flow analysis. |
| **UI change maintenance** | Major time sink: every UI change breaks selector-based tests | Self-healing via STALE_UI recovery. Re-discovers new element names automatically. |
| **Cross-platform** | Separate test codebases per platform. 4× maintenance burden. | Single flow spec dispatched to all platforms via skill router. |
| **Failure analysis** | Engineer reads logs and screenshots manually | Claude Code classifies failures, diagnoses root causes, and writes human-readable summaries. |
| **Time to first test** | Weeks: setup framework, write page objects, create test data | Hours: INIT mode discovers flows and generates test cases autonomously. |
| **New feature coverage** | QA engineer manually writes tests for new features | Re-discover mode detects new UI sections and generates new flows and test cases. |
| **Reporting** | Raw pass/fail. Engineer interprets trends manually | Allure report with trends, flakiness index, performance regression, and AI-generated insights. |

### 22.3 Known Risks & Trade-offs

| Risk | Mitigation |
|------|-----------|
| **AI non-determinism**: Claude Code may produce slightly different test plans across identical runs | Structured JSON plan schemas and deterministic execution policy lock down execution behaviour |
| **Visual analysis limits**: Screenshot-based validation can produce false positives on minor rendering differences (anti-aliasing, font rendering across OS versions) | Configurable visual diff tolerance thresholds per platform |
| **Platform skill maturity**: Windows, iOS, Android, and extension skills are in development | Do not rely on in-progress skills for critical release blocking until marked stable |
| **Context window limits**: Suites > 200 flows may require manual segmentation | Summarization strategy + checkpointing + automatic session segmentation at 50 flows |
| **Claude Code dependency**: Anthropic API outages halt AI-assisted planning and validation | Pre-generated TestPlan JSON can still execute in deterministic mode without Claude Code |

---

## 23. ROI & Cost Analysis

### 23.1 Quantitative ROI

Estimates based on a team of 3 QA engineers testing a medium-complexity application across 3 platforms (macOS, iOS, Web) with 50 flows:

| Activity | Traditional (hrs/mo) | QA Agent (hrs/mo) | Saving |
|----------|---------------------|-------------------|--------|
| Test case authoring (new features) | 60 hrs | 8 hrs (review only) | 87% |
| Test maintenance (UI changes) | 40 hrs | 4 hrs (oversight) | 90% |
| Manual regression execution | 80 hrs | 0 hrs | 100% |
| Failure investigation | 30 hrs | 6 hrs (complex only) | 80% |
| Reporting | 10 hrs | 1 hr (review only) | 90% |
| **TOTAL** | **220 hrs/mo** | **19 hrs/mo** | **91%** |

At a blended QA engineer rate of $50/hr, the **201 hours saved = $10,050 labour saving/month**.

### 23.2 Infrastructure Cost Estimate

Monthly infrastructure cost for a team running continuous testing (8 workers per platform, 3 platforms):

| Component | Monthly Cost |
|-----------|-------------|
| Orchestrator + MCP Server + Redis + PostgreSQL | ~$150 |
| Web workers (8 × Playwright containers, K8s spot) | ~$200 |
| Mobile device cloud (BrowserStack, 4 concurrent) | ~$400 |
| macOS workers (2 Mac mini nodes, amortized) | ~$100 |
| Claude Code API usage (~50 runs/mo, Opus + Haiku mix) | ~$200 |
| S3 evidence storage + Allure hosting | ~$30 |
| **Total** | **~$1,080/month** |

**Return on infrastructure investment: 9.3×** ($10,050 saved vs $1,080 spend).

### 23.3 Per-Run Cost Breakdown

| Suite Type | Flows | Model | Est. Cost | Est. Time |
|-----------|-------|-------|-----------|-----------|
| Smoke (P1 only) | 4 | Haiku | $0.10–0.30 | 5–10 min |
| Standard (P1+P2) | 10 | Haiku | $0.25–0.75 | 10–20 min |
| Discovery + generation | 1 app | Opus | $2.50–5.00 | 15–25 min |
| Full regression | 20+ | Haiku | $0.50–1.50 | 25–45 min |
| Monthly (daily smoke + weekly regression) | — | Mixed | **$50–150/mo** | — |

---

## 24. Risk Analysis & Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|-----------|
| 1 | **Anthropic API outage** | Low | High | Pre-generated TestPlan JSON can execute deterministically without Claude Code. Fallback mode documented in `SKILL.md`. |
| 2 | **UI framework changes breaking selectors** | Medium | Medium | STALE_UI recovery class auto-re-discovers. Weekly scheduled discovery runs ensure inventory is current. |
| 3 | **False positives from visual diff** | Medium | Low | Configurable tolerance thresholds per platform. P3 classification for visual-only failures by default. |
| 4 | **Context window exhaustion on large suites** | Low | Medium | Summarization strategy + checkpointing. Max 50 flows per Claude Code session; orchestrator segments larger suites automatically. |
| 5 | **Device farm unavailability (cloud)** | Low | Medium | Circuit breaker routes to secondary provider. On-premise device pool as ultimate fallback. |
| 6 | **Test data contamination across parallel runs** | Medium | High | Each worker uses dedicated test account and isolated environment. No shared mutable state between workers. |
| 7 | **Credential leak in logs** | Low | Critical | Log sanitization filter redacts credential-shaped strings. Credentials only in `.env.qa` (gitignored). Regular secret rotation policy. |
| 8 | **Skills registry desync after update** | Low | Low | Hot-reload with 5s polling. Health checks per skill. Orchestrator rejects tasks for unhealthy skills. |

---

## 25. Future Extensions

### 25.1 Platform Skill Completion Roadmap

| Skill | Target Quarter | Key Milestones |
|-------|---------------|----------------|
| `skill-windows` | Q3 2026 | WinAppDriver integration, PowerShell explorer, CI template for Windows Server runners |
| `skill-ios` | Q3 2026 | XCUITest driver, `xcrun simctl` lifecycle, Instruments profiling, Xcode a11y inspector bridge |
| `skill-android` | Q4 2026 | UIAutomator2 driver, ADB lifecycle, Espresso white-box mode, Android Emulator management |
| `skill-extension` | Q4 2026 | Chrome extension manifest parser, background worker testing, content script interaction, popup UI testing |

### 25.2 Intelligence Layer Enhancements

- **Autonomous exploratory testing**: Claude Code navigates the app freely looking for crash paths, unexpected state transitions, and accessibility issues — without a pre-defined flow.
- **Change-impact analysis**: Integration with `git diff`. Claude Code reads code changes and identifies which flows are statistically likely to be affected, focusing test effort on high-risk areas.
- **Natural language test authoring**: Allow product managers and designers to describe desired behaviour in plain English. Claude Code translates to formal `flow.md` and `TC-NNN-*.md` files.
- **A/B test validation**: Automatically verify that both variants of an A/B test meet their defined acceptance criteria simultaneously.
- **Accessibility deep-dive mode**: Full WCAG 2.1 audit per flow, with remediation suggestions authored by Claude Code.

### 25.3 Infrastructure Evolution

- **Serverless workers**: Migrate web workers to AWS Lambda or Google Cloud Run for per-second billing and zero-idle cost.
- **Edge testing**: Deploy lightweight workers to global edge nodes for latency testing of CDN-delivered applications.
- **Visual AI baselines**: Replace pixel-diff with Claude Code vision for visual regression. Understands intent-preserving vs. regression-indicating changes.
- **GitOps for test artifacts**: `qa/` directory managed via GitOps. Pull requests for test case changes, code review for flows, merge requirements for TC updates.

---

*QA Agent Architecture Documentation · v2.0.0 · April 2026*
*Powered by Claude Code (Anthropic) · Internal Engineering Reference*
