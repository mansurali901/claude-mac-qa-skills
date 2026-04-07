# native-qa — Generic Native App QA Skill for Claude Code

An autonomous QA engineer for **any installed macOS application**. Point it at any `.app` and it initializes a workspace, launches the application, takes screenshots for visual analysis, discovers every UI flow, and generates comprehensive test cases — organized by flow, feature, or risk priority.

> **Current platform**: macOS ✅ | iOS 🔜 | Android 🔜 | Windows 🔜

---

## How It Works

```
Init                        Fresh Run                    Update
────────────────────        ────────────────────         ────────────────────
1. Choose framework         1. Name the app to test      1. Detect existing qa/
   (flow/feature/risk)      2. Ask for prior knowledge   2. Re-discover UI changes
2. Scaffold qa/ dirs        3. Launch app via AppleScript 3. Diff against existing
3. Write .qa-config.json    4. Screenshot → LLM analysis    flows
                            5. Navigate each section     4. Update affected files
                            6. Ask questions per section
                            7. Generate flow.md per flow
                            8. Generate scenarios.md
                            9. Generate TC-NNN-*.md
```

---

## Output Structure

### Flow-based (default — recommended)

```
qa/
├── .qa-config.json
├── planning/platforms.md
├── guardrails/do-and-dont.md
├── credentials/access.md
├── scope/contract.md
├── knowledgebase/
│   ├── ui-inventory.md
│   └── screenshots/
└── flows/
    ├── F-001-app-launch/
    │   ├── flow.md           ← Journey map
    │   ├── scenarios.md      ← All test scenarios
    │   └── test-cases/
    │       ├── TC-001-cold-launch.md
    │       └── TC-002-warm-launch.md
    ├── F-002-authentication/
    │   ├── flow.md
    │   ├── scenarios.md
    │   └── test-cases/
    │       └── TC-NNN-*.md
    └── F-NNN-[feature]/
```

### Feature-based

Same structure but organized under `qa/features/[feature-name]/` directories.

### Risk-based

Test cases under `qa/test-cases/P1-critical/`, `P2-high/`, `P3-medium/`, `P4-low/`.

---

## Installation

### Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed
- macOS 12+ (Accessibility API requirement)
- Terminal granted **Accessibility** permission (one-time setup)

### One-Time: Grant Accessibility Permission

```
System Settings → Privacy & Security → Accessibility → Enable Terminal
```

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

Restart Claude Code, then invoke with `/native-qa`.

---

## Usage

```
# Initialize workspace (run first)
/native-qa init
"set up QA for my app"

# Test a specific app (auto-detects init need)
"run QA on Figma"
"test Slack and generate test cases"
"generate flows and test cases for my macOS app"

# Update existing workspace
"update test cases — I added a new feature"
"add test cases for the Settings panel"
"re-discover [AppName] UI"
```

---

## Example First Run

```
You: set up QA for my app

Claude:
  Welcome to native-qa! How would you like test cases organized?
  1. Flow-based (recommended)  2. Feature-based  3. Risk-based

You: 1

Claude:
  ✅ Workspace initialized (flow-based). Which app do you want to test?

You: Figma

Claude:
  Found: /Applications/Figma.app (v116.14.0)
  ✅ Config updated.

  Do you have existing knowledge about Figma's flows?

You: no, discover it yourself

Claude:
  ✅ Accessibility OK
  🚀 Launching Figma...
  📸 Screenshot: qa/knowledgebase/screenshots/01-main-window.png

  [Reads screenshot]

  I can see Figma's main window:
  - Navigation: Recent files, Community, Plugins
  - Primary actions: New design file, Import, Open
  - Sections to explore: 5 areas identified

  🔍 Exploring each section...
  📸 Screenshots captured for each section

  I found 6 sections. Quick questions:
  [Asks 2-3 targeted questions per batch]

You: [answers]

Claude:
  Creating flow directories...
  ✅ F-001-app-launch/flow.md
  ✅ F-002-file-management/flow.md
  ✅ F-003-design-canvas/flow.md
  ...

  Generating scenarios...
  ✅ F-001: 5 scenarios | F-002: 9 scenarios | F-003: 14 scenarios

  Generating test cases...
  ✅ 28 TC-NNN-*.md files created

  ╔═════════════════════════════════════════╗
    QA Ready — Figma v116.14.0 on macOS
  ╠═════════════════════════════════════════╣
    Framework:   flow-based
    Flows:       6
    Scenarios:   43
    Test Cases:  28 (P1: 16, P2: 10, P3: 2)
  ╚═════════════════════════════════════════╝
```

---

## Key Files

| File | Purpose |
|------|---------|
| `SKILL.md` | Full 10-step workflow — the skill's brain |
| `templates/flow.md` | Template for `flow.md` journey maps |
| `templates/scenarios.md` | Template for `scenarios.md` |
| `templates/test-case-native.md` | Template for `TC-NNN-*.md` files |
| `scripts/qa-explore-macos.py` | AppleScript UI enumeration + screenshot |
| `references/macos-automation.md` | AppleScript patterns and recipes |
| `references/test-patterns-native.md` | Scenario patterns by app type |

---

## Gitignore

```gitignore
.env.qa
qa/credentials/.env*
qa/evidence/
qa/knowledgebase/screenshots/
```

Commit `qa/` — it's your team's living QA documentation. Never commit screenshots (large) or real credentials.

---

## Requirements

| Requirement | Details |
|------------|---------|
| macOS | 12 Monterey or later |
| Claude Code | Latest version |
| Accessibility | Terminal → Accessibility permission (one-time) |
| Python | 3.9+ (for `qa-explore-macos.py`) |
| App | Any macOS `.app` bundle |

---

## Roadmap

- [ ] iOS support — XCUITest / Instruments-based discovery
- [ ] Android support — UIAutomator / adb-based discovery
- [ ] Windows support — WinAppDriver / UIA-based discovery
- [ ] Export to Playwright / XCTest format
- [ ] CI/CD integration template
- [ ] Visual regression between runs

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add platform support, new app-type patterns, and test templates.

---

## License

MIT
