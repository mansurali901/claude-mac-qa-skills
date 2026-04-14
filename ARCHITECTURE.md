# QA Agent — Architecture

> **Version**: 2.1.0
> **Scope**: Internal engineering reference — what actually exists and how it works.
> Aspirational infrastructure (orchestrator, Kubernetes, Redis, MCP server) is tracked in `docs/roadmap.md`, not here.

---

## 1. What This System Is

The QA Agent is an **AI-native QA platform where Claude Code is both the reasoning brain and the execution engine**. It is not a traditional test automation framework. It is a Claude Code skill — a set of markdown instructions, templates, and helper scripts that Claude Code reads and executes using its built-in tools.

```
Traditional QA:  Engineer writes scripts → Test runner executes → Reports results
QA Agent:        Claude Code discovers UI → Plans tests → Executes → Validates visually → Writes evidence
```

### The key architectural decision

This system does not call the Anthropic API directly. It is a skill that Claude Code reads and executes:

```
❌ Wrong:  python3 script.py → import anthropic → client.messages.create() → handle tool use
✅ Right:  claude -p "Run QA for Figma" → Claude Code reads SKILL.md → executes via built-in tools
```

Claude Code already provides every tool this system needs — `Bash`, `Read` (with vision), `Write`, `Edit`, `Glob`, `Grep`, `Agent`. No custom runtime required.

---

## 2. Three-Layer Model

```
┌──────────────────────────────────────────────────────────────┐
│  BRAIN — Claude Code                                          │
│                                                              │
│  Reads: SKILL.md (workflow) · skills/[platform]/SKILL.md    │
│         references/ (knowledge base)                         │
│  Does:  reasons about UI · plans tests · validates visually  │
│  Tools: Read · Write · Edit · Bash · Glob · Grep · Agent     │
└───────────────────────────┬──────────────────────────────────┘
                            │ reads / writes
┌───────────────────────────▼──────────────────────────────────┐
│  MEMORY — File System (qa/)                                   │
│                                                              │
│  .qa-config.json      ← workspace state & counts             │
│  state-[platform].md  ← session checkpoint per platform      │
│  context/             ← prior knowledge placed by user       │
│  knowledgebase/       ← ui-inventory.md/json + screenshots   │
│  flows/F-NNN-*/       ← flow.md · scenarios.md · TC-NNN-*.md │
│  runs/                ← RUN-YYYYMMDD-HHMMSS.md               │
│  evidence/            ← screenshots from execution           │
└───────────────────────────┬──────────────────────────────────┘
                            │ executes via Bash tool
┌───────────────────────────▼──────────────────────────────────┐
│  HANDS — Platform Scripts                                     │
│                                                              │
│  skills/macos/explore.py   ← AppleScript UI enumeration      │
│  osascript                 ← UI interaction + verification   │
│  screencapture             ← evidence capture                │
│  Playwright (inline)       ← web exploration + interaction   │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Two-Phase Workflow

The skill runs in two phases separated by a hard credentials gate. No test cases are generated before the gate.

```
PHASE 1 — Exploration (no credentials needed)
──────────────────────────────────────────────
Step 0.1  Platform selection → user picks macOS / Web / Windows / iOS / Android
Step 0.2  Mode detection → INIT / CONFIGURED_NO_FLOWS / EXPLORATION_COMPLETE / HAS_WORKSPACE
Steps 1–3 Workspace init → framework selection → scaffold qa/ → app selection → prior knowledge
Steps 4–7 Launch app → screenshot every section → trace every public happy flow
          → screenshot at EVERY action → write flow.md with discovery evidence table
          → save checkpoint to qa/state-[platform].md → context reset

          ↓ Phase 1 Complete Gate ↓
          All public flows traced. Tell user which flows need credentials.
          Wait for user to populate .env.qa.

PHASE 2 — Full Coverage (credentials required)
──────────────────────────────────────────────
Step 8    Read auth screenshots from Phase 1 → identify credential fields
          Ask: check .env.qa / provide in chat / self-register (email+password only)
Step 9    Trace auth-gated flows with screenshots
          Generate all scenarios (happy + negative + edge + a11y + security)
          Write TC-NNN-*.md per scenario with runnable automation block
Step 10   Update .qa-config.json counts → print completion summary
```

### Why the gate exists

Phase 1 screenshots reveal exactly which credential fields the UI actually shows — so the agent asks for precisely those fields, not a generic list. Generating test cases before credentials are confirmed produces incomplete TCs with unverifiable auth flows.

---

## 4. Skill Architecture

### Root orchestrator vs platform skills

```
SKILL.md                        ← root orchestrator
                                   Step 0: platform selection + mode detection
                                   Steps 1–3: workspace init, app selection, prior knowledge
                                   Step 3 exit → delegates to selected platform skill

skills/[platform]/SKILL.md      ← platform runbook (self-contained)
                                   Steps 4+: all automation for that platform
                                   All scripts inlined — no external file dependencies
```

The root skill handles everything platform-agnostic. Once a platform is selected, all automation (launch, screenshot, explore, interact, generate) comes from that platform's SKILL.md.

### Skill loading

Claude Code loads skills from **committed** SKILL.md files at session start. Changes to SKILL.md take effect only after committing and starting a new session. Staged changes are not picked up.

### Platform registry

`skills/_registry/registry.json` is read by the root SKILL.md during Step 0 to build the platform selection menu. Each entry has: `id`, `platform`, `status`, `entrypoint`, `capabilities[]`, `automation`.

### Current platform status

| Platform | Status | Automation |
|----------|--------|-----------|
| macOS | production ✅ | AppleScript + screencapture + Accessibility API |
| Web | beta ✅ | Playwright + Chromium (inlined in SKILL.md) |
| Windows | stub 🔜 | WinAppDriver + UIA3 |
| iOS | stub 🔜 | XCUITest + xcrun simctl |
| Android | stub 🔜 | UIAutomator2 + ADB |
| Extension | planned 🔜 | Playwright + Chrome Extension API |

### What each platform skill contains

```
skills/[platform]/
├── SKILL.md              ← complete runbook, all scripts inlined
├── templates/
│   ├── flow.md           ← journey map template for this platform
│   ├── scenarios.md      ← scenario table template
│   └── test-case.md      ← TC template with platform automation block
└── references/
    ├── [platform]-automation.md   ← automation recipes
    └── test-patterns.md           ← scenario patterns by element/app type
```

Web skill additionally has `references/exploration-toolkit.md` — every Playwright API useful during Phase 1 discovery (DOM interrogation, trace recording, network monitoring, storage inspection, axe-core, CDP metrics).

---

## 5. File System Design

### Full `qa/` structure

```
qa/
├── .qa-config.json              ← workspace config (platform, framework, app, counts)
├── state-[platform].md          ← session checkpoint — one file per OS
├── context/                     ← user places prior knowledge here before init
│   ├── feature-specs/           ← PRDs, spec markdown files
│   └── figma-screens/           ← exported Figma PNGs for visual analysis
├── planning/platforms.md
├── guardrails/do-and-dont.md
├── credentials/access.md        ← credential structure only, no real values
├── scope/contract.md
├── knowledgebase/
│   ├── ui-inventory.md
│   ├── ui-inventory.json
│   └── screenshots/             ← gitignored — discovery screenshots
├── flows/                       ← flow-based framework (default)
│   └── F-NNN-[slug]/
│       ├── flow.md              ← journey map + discovery evidence table
│       ├── scenarios.md
│       └── test-cases/
│           └── TC-NNN-[slug].md
├── evidence/                    ← gitignored — execution screenshots
└── runs/
    └── RUN-YYYYMMDD-HHMMSS.md
```

Feature-based: `qa/flows/` → `qa/features/[name]/`
Risk-based: `qa/flows/` → `qa/test-cases/P1-critical/`, `P2-high/`, etc.

### `.qa-config.json` schema

```json
{
  "version": "2.0",
  "framework": "flow-based",
  "platform": "macOS",
  "app_name": "Figma",
  "app_path": "/Applications/Figma.app",
  "app_identifier": "com.figma.Desktop",
  "app_version": "116.14.0",
  "os_version": "14.4.1",
  "architecture": "arm64",
  "created": "2026-04-14",
  "last_discovery": "2026-04-14T10:32:00",
  "flows_count": 6,
  "test_cases_count": 34
}
```

### State file — `qa/state-[platform].md`

One file per OS. The session checkpoint. Contains:
- App under test (name, path, auth method, quirks)
- Completed flows (screenshot count, key observations)
- Pending flows (priority, auth requirement)
- Exact resume command for the next flow
- Credentials status

A fresh context reading this file has full situational awareness. No information is lost across resets.

| OS being tested | State file |
|----------------|-----------|
| macOS | `qa/state-macos.md` |
| Web | `qa/state-web.md` |
| Windows | `qa/state-windows.md` |
| iOS | `qa/state-ios.md` |
| Android | `qa/state-android.md` |

---

## 6. State Machine

```
No qa/ directory
    → INIT
      Platform selection → framework selection → scaffold → app selection → prior knowledge
      Then → Steps 4+ via platform skill (Phase 1)

qa/.qa-config.json exists, no flows yet
    → CONFIGURED_NO_FLOWS
      Jump to app selection → then Phase 1

flows/ exist, TC count = 0
    → EXPLORATION_COMPLETE
      Phase 1 done. Credentials gate — wait for user to populate .env.qa.
      Then → Phase 2 (scenario gen + TC files)

TC files present
    → HAS_WORKSPACE / UPDATE MODE
      Re-discover, add flow, add scenarios, or full refresh
```

---

## 7. Context Window Management

Screenshots fill context fast — 3–4 flows with screenshots saturates a session. The skill enforces a reset after every completed flow.

### Reset triggers

- Each flow fully traced in Phase 1 (flow.md written + screenshots read)
- Each flow's TCs fully written in Phase 2
- Any time the conversation exceeds ~15 tool calls
- User says "stop", "pause", or "save state"

### Reset protocol

1. Write checkpoint to `qa/state-[platform].md`
2. Tell user the resume command
3. If user says "continue" — proceed but reset at next flow regardless

The state file is the memory. Each reset starts fresh from it with zero context loss.

---

## 8. Agent Topology

### Today — single agent

One Claude Code session executes the full workflow sequentially. Handles any single-app test suite end-to-end. Suitable for suites up to ~8–10 flows before time becomes a concern.

```
User / CI
    ↓
claude -p "task"
    ↓
Claude Code (single session)
    ├── reads SKILL.md + platform SKILL.md
    ├── runs exploration scripts (Bash)
    ├── takes screenshots (Bash)
    ├── reads screenshots (Read tool — vision)
    ├── writes flow.md, scenarios.md, TC files (Write tool)
    └── writes qa/runs/RUN-*.md (Write tool)
```

### Parallel flow execution — subagents

For suites with 5+ flows that can run concurrently, Claude Code uses its native `Agent` tool:

```
Claude Code (primary)
    ├── spawns subagent for F-001
    ├── spawns subagent for F-002
    ├── spawns subagent for F-003
    └── waits → collects results → writes merged run summary
```

Each subagent owns one flow, writes to its own `qa/evidence/F-NNN/` subdirectory, and returns PASS/FAIL + evidence paths to the primary. Zero extra infrastructure — Claude Code's Agent tool handles it natively.

**macOS constraint**: Max 3–5 concurrent native subagents — the Accessibility API is single-threaded.

### Multi-platform fan-out (future)

A shell script fans out to separate Claude Code sessions per platform:

```bash
claude -p "Run macOS QA for ${APP}. Follow skills/macos/SKILL.md." &
claude -p "Run Web QA for ${URL}. Follow skills/web/SKILL.md." &
wait
# merge results
```

---

## 9. Failure Classification & Recovery

### Failure taxonomy

| Class | Detection | Recovery | Stop run? |
|-------|-----------|----------|-----------|
| `FLAKY` | Step fails, retry passes | Retry ×2 with extra delay | No |
| `STALE_UI` | Element name not in ui-inventory | Re-discover affected section, update flow | No |
| `STATE_ERROR` | App in wrong state before step | Quit + relaunch, re-run setup script | No |
| `NETWORK` | Timeout on network-dependent step | Wait 10s, retry ×2 | No |
| `CRASH` | Process not found in pgrep output | Relaunch app, flag TC as P1 blocker | No (single TC) |
| `PERMISSION` | osascript returns permission error | Stop — ask user to re-grant Accessibility | Yes |
| `INFRA` | screencapture fails, disk full | Stop — report infrastructure issue | Yes |

### Circuit breaker

If >50% of flows in one run fail with the same class, Claude Code stops and reports a structural issue:

```
❌ Run aborted — 7/10 flows failed with STALE_UI.
The app's UI has changed since last discovery.
Run update mode to re-discover the current UI.
```

### STALE_UI detection

After re-discovery in update mode, Claude Code diffs old vs new `ui-inventory.json` — reports added, removed, and renamed elements, then flags which `flow.md` and `TC-NNN-*.md` files reference the removed/renamed elements. Affected files are updated automatically; complex restructures require human review.

### Deterministic execution

- Name-based element selection always (`button "Save"` not `button 1`)
- App fully quit and relaunched between scenarios — no inherited state
- `delay 1` after every click, `delay 3` after launch/quit (macOS); `waitUntil: 'domcontentloaded'` + `waitForTimeout(2000)` (web — never `networkidle`)

---

## 10. How Claude Code Reasons

Claude Code operates in three modes depending on what's in front of it:

| Mode | Input | What Claude Code Does |
|------|-------|-----------------------|
| **Visual** | Screenshots | Reads pixel content, identifies UI elements by label and position, validates layout state |
| **Logical** | JSON, config files, test results | Validates against schemas and expected values deterministically |
| **Diagnostic** | Failed TC + screenshots + logs | Builds causal chain from failure back through execution history, classifies the failure, attempts recovery |

The Read tool is the vision interface. Every screenshot taken during exploration and execution is immediately read and analyzed — Claude Code does not defer visual validation.

---

## 11. Invoking the System

### Interactive

Open Claude Code and type any natural language trigger, or use the slash command:

```
/native-qa init
"run QA on Figma"
"test my macOS app"
"generate test cases for Slack"
```

### CI / headless

```bash
# Full QA workflow
claude -p "Run the native-qa skill for TextEdit. Follow SKILL.md step by step. \
  Use flow-based framework. Today's date is $(date +%Y-%m-%d)."

# Execute existing test suite
claude -p "Execute the existing QA test suite in qa/flows/. \
  Run each TC file's AppleScript, capture screenshots, write PASS/FAIL. \
  Generate qa/runs/RUN-$(date +%Y%m%d-%H%M%S).md."

# Discovery only (Phase 1, no TC generation)
claude -p "Run Phase 1 discovery for Figma. Follow SKILL.md steps 0–7 only. \
  Take screenshots, trace every flow, write flow.md files. Do not generate TCs."

# Resume from checkpoint
claude -p "Read qa/state-macos.md and continue QA for Figma. \
  Next: trace F-004 — Account Settings."
```

### Cost estimates

| Task | Model | Approx. cost |
|------|-------|-------------|
| Phase 1 discovery (1 app, 6 flows) | claude-opus-4-6 | $1.50–3.00 |
| Phase 2 TC generation (30 TCs) | claude-opus-4-6 | $0.80–1.50 |
| Execution run (10 flows, vision validation) | claude-haiku-4-5 | $0.10–0.40 |
| Monthly (daily smoke + weekly regression) | mixed | $50–150 |

Use `claude-haiku-4-5` for repeatable execution runs (5× cheaper). Reserve `claude-opus-4-6` for discovery, scenario planning, and complex failure diagnosis.
