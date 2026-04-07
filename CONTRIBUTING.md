# Contributing to native-qa

Thank you for contributing! This guide covers how to add new platform support, improve test patterns, and submit changes.

---

## Repository Structure

```
native-qa-skill/
│
├── skill/
│   └── native-qa/                  ← The installable skill
│       ├── SKILL.md                ← Main workflow (phases 0–6)
│       ├── templates/
│       │   └── test-case-native.md ← Test case file template
│       ├── references/
│       │   ├── macos-automation.md      ← AppleScript deep reference
│       │   ├── test-patterns-native.md  ← Scenario patterns by flow type
│       │   ├── ios-automation.md        ← [Future] XCTest/Instruments
│       │   ├── android-automation.md    ← [Future] adb/UIAutomator
│       │   └── windows-automation.md    ← [Future] WinAppDriver
│       └── scripts/
│           ├── qa-explore-macos.py     ← macOS UI discovery script
│           ├── qa-explore-ios.py       ← [Future]
│           └── qa-explore-android.py   ← [Future]
│
├── examples/
│   ├── purevpn-macos/              ← Example output for PureVPN on macOS
│   └── [app-name]-[platform]/      ← Add your own examples here
│
├── README.md
├── CONTRIBUTING.md
└── LICENSE
```

---

## Development Setup

```bash
git clone https://github.com/your-org/native-qa-skill.git
cd native-qa-skill

# Install the skill (edits take effect after restarting Claude Code)
cp SKILL.md ~/.claude/commands/native-qa.md

# Create a feature branch
git checkout -b feat/ios-xctest-support
```

---

## Adding a New Platform (e.g., iOS)

This is the most impactful contribution. Here's the template:

### 1. Create the automation reference

`skill/native-qa/references/ios-automation.md`

Cover:
- How to check if the iOS simulator/device is connected
- How to launch an app on the simulator (`xcrun simctl launch`)
- How to inspect the UI (Accessibility Inspector, XCTest API)
- How to interact with elements (tap, type, swipe)
- How to take screenshots
- Troubleshooting common issues

### 2. Create the exploration script

`skill/native-qa/scripts/qa-explore-ios.py`

Mirror the structure of `qa-explore-macos.py`:
- Check for simulator/device
- Launch the app
- Dump UI element tree
- Write `ui-inventory.md` and `ui-inventory.json`
- Print a summary

### 3. Update SKILL.md

Add an "iOS" section to Phase 3 (Launch) and Phase 4 (Discover). Use the same phase structure as macOS:

```markdown
## Phase 3: Launch the Application (iOS)

Read `references/ios-automation.md` before executing this step.

### Check for Connected Device / Simulator
...
```

### 4. Add an example

Create `examples/[app-name]-ios/qa/` showing what the skill produces for a real iOS app. Use a real open-source or commonly known app if possible.

### 5. Update README.md

Change `iOS 🔜` to `iOS ✅` once the platform is fully supported.

---

## Improving macOS Automation

### Adding AppleScript Patterns

Add new patterns to `references/macos-automation.md` under the appropriate section. Follow the existing format:

```markdown
### [Pattern Name]

Brief description of when to use this.

```applescript
-- [Comment explaining what this does]
tell application "System Events"
    tell process "[AppName]"
        [code]
    end tell
end tell
```

**Notes**: [Any gotchas or important considerations]
```

### Adding Test Patterns

Add new scenario patterns to `references/test-patterns-native.md`. Use the table format for scenario lists and include AppleScript skeletons:

```markdown
## [N]. [Pattern Category]

### Scenario description

| Scenario | Steps | Pass Criteria |
|----------|-------|--------------|
| ... | ... | ... |

```applescript
-- [automation skeleton]
```
```

---

## Testing Your Changes

### Manually test against a real app

```bash
# Pick any installed macOS app — TextEdit is great for testing since
# it's always available and has a clear UI
open -a TextEdit

# Run your updated exploration script
python3 skill/native-qa/scripts/qa-explore-macos.py --app "TextEdit" --output /tmp/qa-test

# Check the output
cat /tmp/qa-test/ui-inventory.md
```

### Test the full skill in Claude Code

Open Claude Code in a test project and run:

```
"Run QA on TextEdit and generate test cases"
"Run QA on Preview"
"Run QA on [any installed app]"
```

Verify:
- [ ] `qa/` folder created with all 6 subdirectories
- [ ] `flows.md` has at least 3 documented flows
- [ ] `ui-inventory.md` has real UI elements (not empty)
- [ ] At least 3 `TC-NNN-*.md` files created
- [ ] Each test case has at least 3 scenarios
- [ ] AppleScript in test cases actually works
- [ ] No credentials appear in any tracked file

### Test update mode

```bash
# Run once to create workspace
# Then run again and verify it enters update mode:
"Re-run QA for TextEdit"
# → Should ask if you want to update, not start from scratch
```

---

## PR Checklist

- [ ] Changes to `SKILL.md` follow existing phase structure and style
- [ ] New AppleScript is tested against at least one real app
- [ ] No hardcoded app names in generic code (use `[AppName]` as placeholder)
- [ ] New references added to the Table of Contents in their file
- [ ] `qa-explore-*.py` changes tested with `python3 script.py --app "[App]"`
- [ ] Example output added to `examples/` if new platform or app type added
- [ ] No secrets, real emails, or PII in any files
- [ ] README platform table updated if new platform added

---

## Good First Contributions

| Task | Difficulty | Files to Edit |
|------|-----------|--------------|
| Add AppleScript for sheet/dialog handling | Easy | `references/macos-automation.md` |
| Add test patterns for media/audio apps | Easy | `references/test-patterns-native.md` |
| Add test patterns for document editors | Easy | `references/test-patterns-native.md` |
| Improve `qa-explore-macos.py` to handle sheet windows | Medium | `scripts/qa-explore-macos.py` |
| Add iOS Simulator support | Hard | New files + `SKILL.md` update |
| Add `--diff` mode to compare UI inventories | Medium | `scripts/qa-explore-macos.py` |

---

## Code Style

- **SKILL.md**: Imperative voice, second-person ("Read `references/...`", "Run this command")
- **Python scripts**: Type hints, docstrings, `argparse` for CLI, print progress with emoji
- **AppleScript**: Always wrap in `try/on error`, always add comments, always use `delay` after UI actions
- **Templates**: Use `[placeholder]` for fill-in values, keep structure consistent with existing template
- **Examples**: Use realistic but fictional data — never real IPs, real emails, real passwords
