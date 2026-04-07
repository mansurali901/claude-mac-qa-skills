# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

**native-qa** is a generic autonomous QA skill for Claude Code that tests any native macOS desktop application. It:
1. Initializes a typed QA workspace (flow-based / feature-based / risk-based)
2. Asks which app to test and reads its metadata
3. Asks for prior product knowledge; if none, auto-discovers by launching the app, taking screenshots, and analyzing them visually
4. Maps every UI section into named flow directories with `flow.md` journey maps
5. Generates maximum test scenarios per flow in `scenarios.md`
6. Creates detailed test case files (`TC-NNN-*.md`) with runnable AppleScript for each scenario

**Current platform support**: macOS ✅ | iOS / Android / Windows 🔜

## Running the Exploration Script

```bash
python3 scripts/qa-explore-macos.py --app "AppName" --output qa/knowledgebase/
python3 scripts/qa-explore-macos.py --app "AppName" --output qa/knowledgebase/ --screenshot
```

No pip dependencies — uses stdlib only (`subprocess`, `json`, `argparse`, `plistlib`).

## Prerequisites

- macOS 12 Monterey or later
- Python 3.9+
- **Accessibility permission**: System Settings → Privacy & Security → Accessibility → enable Terminal

## Skill Workflow (SKILL.md)

The skill detects its mode from workspace state:

| Mode | Trigger | Phases |
|------|---------|--------|
| **INIT** | No `qa/` or no `qa/.qa-config.json` | Framework selection → Scaffold → App selection → Discovery → Flows → Scenarios → Test cases |
| **FRESH** | Config exists, no flows yet | App selection → Discovery → Flows → Scenarios → Test cases |
| **UPDATE** | Flows exist | Re-discover or add flows/scenarios |

**Core discovery loop** (Steps 4-5):
1. Check Accessibility permission
2. Launch app via `open -a`
3. `screencapture -x qa/knowledgebase/screenshots/01-main-window.png`
4. **Read screenshot** with the Read tool — Claude analyzes UI visually
5. Navigate each section, screenshot, analyze, ask clarifying questions
6. Run `qa-explore-macos.py --screenshot` for AppleScript UI enumeration

## Output Structure

### Flow-based (default)

```
qa/
├── .qa-config.json              ← Workspace config (framework, app, counts)
├── planning/platforms.md
├── guardrails/do-and-dont.md
├── credentials/access.md
├── scope/contract.md
├── knowledgebase/
│   ├── ui-inventory.md
│   ├── ui-inventory.json
│   └── screenshots/             ← Discovery screenshots (gitignored for size)
└── flows/
    └── F-NNN-[flow-slug]/
        ├── flow.md              ← Journey map
        ├── scenarios.md         ← All test scenarios for this flow
        └── test-cases/
            └── TC-NNN-[slug].md ← One file per scenario
```

### Feature-based

Same structure except `qa/flows/` → `qa/features/[feature-name]/`.

### Risk-based

Same except `qa/flows/` → `qa/test-cases/P1-critical/`, `P2-high/`, etc.

## Key Reference Files

| File | Purpose |
|------|---------|
| `SKILL.md` | Full 10-step workflow with all inline templates |
| `templates/flow.md` | Template for every `flow.md` journey map |
| `templates/scenarios.md` | Template for every `scenarios.md` |
| `templates/test-case-native.md` | Template for every `TC-NNN-*.md` |
| `references/macos-automation.md` | AppleScript patterns, window/menu enumeration, screenshots |
| `references/test-patterns-native.md` | Scenario patterns by UI element type and app category |

## Manually Testing Changes

```bash
python3 scripts/qa-explore-macos.py --app "TextEdit" --output /tmp/qa-test --screenshot
cat /tmp/qa-test/ui-inventory.md
ls /tmp/qa-test/screenshots/
```

Full skill verification checklist:
- `qa/.qa-config.json` exists with correct `framework` value
- `qa/knowledgebase/screenshots/` contains at least 1 screenshot
- `qa/flows/` (or `features/` or `test-cases/`) has at least 4 flow directories
- Each flow directory has `flow.md`, `scenarios.md`, and `test-cases/` subdirectory
- Each `scenarios.md` has at least 5 scenarios covering multiple categories
- Each `TC-NNN-*.md` has a runnable AppleScript block
- No credentials appear in any tracked file

## Adding Platform Support

To add iOS, Android, or Windows:
1. Create `scripts/qa-explore-<platform>.py`
2. Add platform detection in `SKILL.md` Step 0
3. Add platform-specific patterns to `references/test-patterns-native.md`
4. Update `README.md` platform roadmap

## Environment Variables

Store test credentials in `.env.qa` (gitignored) at the consuming repo root:

```env
QA_APP_NAME=
QA_USERNAME=
QA_PASSWORD=
QA_TEST_EMAIL=
QA_ACCOUNT_TIER=free|premium
QA_SANDBOX_MODE=true
```

## Gitignore Entries

Add to the consuming repo's `.gitignore`:

```gitignore
.env.qa
qa/credentials/.env*
qa/evidence/
qa/knowledgebase/screenshots/
```

Commit `qa/` itself — it is the team's living QA documentation.
Never commit `qa/knowledgebase/screenshots/` (large binary files) or anything under `qa/credentials/` with real values.
