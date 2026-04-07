---
name: native-qa
description: >
  Generic native application QA skill for Claude Code. Use this skill when the user wants to QA test any native macOS desktop application. Triggers on: "init QA", "/native-qa init", "test my app", "QA this application", "generate test cases for [AppName]", "write test scenarios for my macOS app", "run QA on [AppName]", "set up QA for a native app", "discover flows in my desktop app", or any mention of testing a non-web native application on macOS. The skill initializes a workspace (with framework selection), launches the target app, takes screenshots for visual LLM analysis, discovers all UI sections and flows, asks clarifying questions per section, generates flow documents, generates maximum test scenarios per flow, and creates detailed test case files organized by flow.
---

# Native App QA Skill

An autonomous QA engineer for **any macOS application**. It initializes a typed workspace, launches your app, takes screenshots for visual analysis, discovers every UI flow, and generates comprehensive test cases — organized by flow, feature, or risk priority.

**Supported platforms**: macOS ✅ | iOS 🔜 | Android 🔜 | Windows 🔜

---

## Step 0: Mode Detection

**First action every time** — determine which mode to run:

```bash
if [ ! -d "qa" ] || [ ! -f "qa/.qa-config.json" ]; then
  echo "INIT"
elif [ ! -d "qa/flows" ] && [ ! -d "qa/features" ] && [ ! -d "qa/test-cases/P1-critical" ]; then
  echo "CONFIGURED_NO_FLOWS"
else
  echo "HAS_WORKSPACE"
fi
```

| Result | Action |
|--------|--------|
| `INIT` | → **Step 1: INIT MODE** |
| `CONFIGURED_NO_FLOWS` | → **Step 2: App Selection** (workspace ready, need discovery) |
| `HAS_WORKSPACE` | → **Step 11: UPDATE MODE** |

---

## Step 1: INIT MODE — Initialize QA Workspace

### 1.1 Framework Selection

Tell the user:
> "Welcome to native-qa! Let me set up a QA workspace for your macOS app.
>
> First — how would you like your test cases organized?
>
> **1. Flow-based** *(recommended)*
>    One directory per user journey: `qa/flows/F-001-login/`, `qa/flows/F-002-settings/`, etc.
>    Best for apps with distinct end-to-end user flows.
>
> **2. Feature-based**
>    One directory per feature module: `qa/features/authentication/`, `qa/features/dashboard/`, etc.
>    Best for apps with many independent feature areas.
>
> **3. Risk-based**
>    Organized by severity: `qa/test-cases/P1-critical/`, `qa/test-cases/P2-high/`, etc.
>    Best for regression suites or deadline-driven QA cycles."

Wait for the user's choice. Accept: 1/2/3, "flow", "feature", "risk", or their description. Default to **flow-based** if unclear.

### 1.2 Create Directory Structure

Run the commands for the chosen framework:

#### Common directories (all frameworks)

```bash
mkdir -p qa/planning qa/guardrails qa/credentials qa/scope
mkdir -p qa/knowledgebase/screenshots
```

#### Flow-based

```bash
mkdir -p qa/flows
```

#### Feature-based

```bash
mkdir -p qa/features
```

#### Risk-based

```bash
mkdir -p qa/test-cases/P1-critical
mkdir -p qa/test-cases/P2-high
mkdir -p qa/test-cases/P3-medium
mkdir -p qa/test-cases/P4-low
```

### 1.3 Write `.qa-config.json`

Write `qa/.qa-config.json` with the actual chosen framework value:

```json
{
  "version": "2.0",
  "framework": "flow-based",
  "app_name": null,
  "app_path": null,
  "app_bundle_id": null,
  "app_version": null,
  "platform": "macOS",
  "macos_version": null,
  "architecture": null,
  "created": "YYYY-MM-DD",
  "last_discovery": null,
  "flows_count": 0,
  "test_cases_count": 0
}
```

Tell the user:
> "✅ QA workspace initialized with **[chosen framework]** organization.
> Next — which application do you want to test?"

Proceed to **Step 2**.

---

## Step 2: App Selection

Ask:
> "What macOS application would you like to test? (e.g., 'Slack', 'Figma', 'MyApp')"

### 2.1 Locate the App

```bash
APP_NAME="[user input]"

# Try standard locations
if [ -d "/Applications/${APP_NAME}.app" ]; then
  APP_PATH="/Applications/${APP_NAME}.app"
elif [ -d "$HOME/Applications/${APP_NAME}.app" ]; then
  APP_PATH="$HOME/Applications/${APP_NAME}.app"
else
  # Spotlight search
  APP_PATH=$(mdfind "kMDItemKind == 'Application'" | grep -i "${APP_NAME}" | head -1)
fi

echo "Resolved: $APP_PATH"
```

If not found, ask the user to provide the full path or drag the `.app` bundle.

### 2.2 Read App Metadata

```bash
python3 - <<'PYEOF'
import plistlib, sys, subprocess

app_path = "/Applications/APPNAME.app"  # replace with actual path
plist_path = app_path + "/Contents/Info.plist"

with open(plist_path, "rb") as f:
    p = plistlib.load(f)

print("Name:      ", p.get("CFBundleName", p.get("CFBundleExecutable", "N/A")))
print("BundleID:  ", p.get("CFBundleIdentifier", "N/A"))
print("Version:   ", p.get("CFBundleShortVersionString", "N/A"))
print("Build:     ", p.get("CFBundleVersion", "N/A"))
print("Min macOS: ", p.get("LSMinimumSystemVersion", "N/A"))
PYEOF

# System info
sw_vers -productVersion
uname -m
```

### 2.3 Update Config and Create Planning Files

Update `qa/.qa-config.json` with `app_name`, `app_path`, `app_bundle_id`, `app_version`, `macos_version`, `architecture`.

Write `qa/planning/platforms.md` using the template in **Step 1 Templates** section.
Write `qa/guardrails/do-and-dont.md` using the template in **Step 1 Templates** section.
Write `qa/credentials/access.md` using the template in **Step 1 Templates** section.
Write `qa/scope/contract.md` using the template in **Step 1 Templates** section.

Proceed to **Step 3**.

---

## Step 3: Prior Knowledge Interview

Ask the user:
> "Do you have existing knowledge about **[AppName]** I should start from?
>
> For example:
> - Known user flows or journeys (e.g., 'users log in, pick a server, click connect')
> - Feature areas to prioritize or skip
> - Known edge cases or problem areas
> - Any docs, specs, or README I should read first?
>
> Share what you know — it improves flow quality.
> Or say **'no'** / **'discover it yourself'** and I'll explore the app visually."

### If prior knowledge is provided:
- Parse and extract: named flows/features, key user actions, edge cases, priority areas
- Store in memory for use in Step 6 (prioritize these flows in discovery)
- Ask one follow-up: "Is there anything specific you want me to make sure I don't miss?"
- Proceed to **Step 4**

### If no prior knowledge:
- Acknowledge: "Got it — I'll explore [AppName] visually and map every flow I find."
- Proceed to **Step 4**

---

## Step 4: Launch App and Take First Screenshot

### 4.1 Check Accessibility Permission

```bash
osascript -e 'tell application "System Events" to get name of every process' > /dev/null 2>&1 \
  && echo "✅ Accessibility OK" \
  || echo "❌ BLOCKED"
```

If blocked, **stop immediately** and tell the user:
> "I need Accessibility permission to explore [AppName]'s UI.
>
> Please go to: **System Settings → Privacy & Security → Accessibility**
> Enable access for **Terminal** (or your IDE if running from there).
>
> Then let me know when done — I'll continue from here."

Do not attempt any further automation until the user confirms permission is granted.

### 4.2 Launch the App

```bash
# Quit first for a clean slate
osascript -e 'tell application "[AppName]" to quit' 2>/dev/null; sleep 2

# Launch fresh
open -a "[AppName]"; sleep 4

# Verify running
osascript -e 'tell application "System Events" to (name of every process) contains "[AppName]"'
```

If the app doesn't appear running, try by bundle ID:
```bash
open -b "[bundle-id]"; sleep 4
```

### 4.3 Capture Main Window Screenshot

```bash
# Bring app to front
osascript -e 'tell application "[AppName]" to activate'; sleep 1

# Capture
mkdir -p qa/knowledgebase/screenshots
screencapture -x qa/knowledgebase/screenshots/01-main-window.png
```

### 4.4 Visual Analysis (LLM reads the screenshot)

**USE the Read tool** to open `qa/knowledgebase/screenshots/01-main-window.png`.

Analyze the image and document in your response:
- Main window title and overall layout
- Top-level navigation (tabs, sidebar, toolbar, menu bar icon)
- Primary action buttons and their labels
- Status areas and dynamic content zones
- Any secondary windows or panels visible
- **Inferred app type** (e.g., productivity, utility, communication, VPN, media player, developer tool)

Tell the user what you see. Example format:
> "I can see [AppName]'s main window. Here's my initial analysis:
> - **Layout**: [sidebar + content area / single panel / tab-based / etc.]
> - **Navigation areas**: [list with names]
> - **Primary actions**: [list key buttons/controls]
> - **App type**: [inferred]
> - **Sections to explore next**: [N] areas identified — [names]"

Proceed to **Step 5**.

---

## Step 5: Deep Exploration — Navigate, Screenshot, Analyze, Ask

For each major section identified in Step 4, perform a deep exploration loop.

### 5.1 Run AppleScript UI Enumeration

```bash
python3 [path-to]/scripts/qa-explore-macos.py \
  --app "[AppName]" \
  --output qa/knowledgebase \
  --screenshot
```

This generates:
- `qa/knowledgebase/ui-inventory.md`
- `qa/knowledgebase/ui-inventory.json`
- `qa/knowledgebase/screenshots/applescript-main.png`

### 5.2 Deep Navigation Loop

For each major navigation area found (tabs, sidebar items, toolbar buttons, menu entries):

**Navigate there:**
```applescript
tell application "System Events"
    tell process "[AppName]"
        -- Click the navigation item
        click [element]  -- button, tab, sidebar row, etc.
        delay 1
    end tell
end tell
```

**Screenshot:**
```bash
screencapture -x "qa/knowledgebase/screenshots/0N-[section-slug].png"
```

**USE the Read tool** on the screenshot. Analyze:
- What does this section show?
- What user actions are available here?
- Are there sub-sections or nested navigation?
- What data or state is visible?
- Any forms, lists, toggles, or pickers?

Repeat for: Preferences/Settings (open with `Cmd+,`), any visible tabs, sidebar sections, modal dialogs reachable from the main view.

### 5.3 Menu Bar Exploration

```bash
# Get all top-level menu names
osascript -e '
tell application "System Events"
    tell process "[AppName]"
        return name of every menu bar item of menu bar 1 as string
    end tell
end tell'

# For each menu, click and screenshot
osascript -e '
tell application "System Events"
    tell process "[AppName]"
        click menu bar item "View" of menu bar 1
        delay 0.5
    end tell
end tell'
screencapture -x qa/knowledgebase/screenshots/menu-view.png
# Press Escape to dismiss
osascript -e 'tell application "System Events" to key code 53'
```

### 5.4 Status Bar / Menu Bar Extra Check

```bash
osascript -e '
tell application "System Events"
    tell process "[AppName]"
        try
            set extras to name of every menu bar item of menu bar 2
            return extras as string
        on error
            return "none"
        end try
    end tell
end tell'
```

If a menu bar extra exists, click it and screenshot.

### 5.5 Compile Section Inventory

After exploring all sections, build a summary table and present to the user:

> "I've explored [AppName] and found **[N] sections**:
>
> | # | Section | Type | Key Elements |
> |---|---------|------|-------------|
> | 1 | [Name] | [navigation / feature / settings / status] | [N] buttons, [N] fields, [tabs/etc.] |
> | 2 | ... | ... | ... |
> ...
>
> I'll ask you a quick question about each significant section before mapping flows."

### 5.6 Clarifying Questions per Section

For each non-trivial section (skip obvious utility screens like "About"), ask **one focused question**.
Batch 2-3 sections per message — don't ask about every section individually:

> "Quick questions about the sections I found:
>
> **[Section A]**: What's the main user goal here? Any states or conditions I should know (e.g., requires login, premium-only)?
>
> **[Section B]**: Are there multiple ways users reach this section, or only one path?
>
> **[Section C]**: Are there any error states or edge cases specific to this area?"

Use the answers to enrich **Step 6** flow documentation.

---

## Step 6: Flow Creation

Map each discovered section/journey to a named flow. Create the directory structure and flow documentation.

### 6.1 Identify Distinct Flows

A **flow** is a sequence of user actions to accomplish one goal. Criteria:
- Has a clear start state and end state
- Maps to one purpose (not a screen — a goal)
- Can be tested independently

**Universal flows** (generate for every app):
- `F-001-app-launch-and-startup` — Cold launch, warm launch, crash recovery
- `F-002-quit-and-state-persistence` — Quit cleanly, verify state on relaunch
- `F-003-preferences-settings` — Open, navigate, change, persist settings
- `F-004-menu-bar-navigation` — All app menus accessible and functional

**App-specific flows** (named from discovery):
- `F-005-[primary-feature]` — The app's core value action
- `F-006-[secondary-feature]`
- `F-00N-[section-slug]`

**Naming convention**: `F-NNN-[lowercase-hyphenated-name]`

### 6.2 Create Flow Directory

**Flow-based framework:**
```bash
mkdir -p "qa/flows/F-NNN-[slug]/test-cases"
```

**Feature-based framework:**
```bash
mkdir -p "qa/features/[feature-name]/test-cases"
```

**Risk-based framework:**
Write flows index in `qa/risk-matrix.md` (group flows by P1/P2/P3 priority).

### 6.3 Write `flow.md`

For flow-based: write to `qa/flows/F-NNN-[slug]/flow.md`
For feature-based: write to `qa/features/[name]/overview.md`

Use the **flow template** (see Templates section at end of this file).

---

## Step 7: Scenario Generation

For each flow, generate **maximum coverage** test scenarios before writing test case files.

### 7.1 Scenario Categories — Apply All Applicable

| Category | Min Scenarios | Priority | When to Apply |
|----------|--------------|----------|---------------|
| Happy Path | 1 | P1 | Every flow |
| Alternative Happy Path | 1+ | P1 | Flows with multiple valid paths |
| Negative / Invalid Input | 2+ | P1 | Any flow with user input |
| Empty / Null Input | 1 | P1 | Any flow with required fields |
| Boundary Values | 2 | P2 | Fields with length/range constraints |
| State Persistence | 1 | P2 | Any flow that changes app state |
| Interrupted Flow | 1 | P2 | Multi-step flows |
| Error Recovery | 1+ | P2 | Flows with network/IO/server calls |
| Offline / No Network | 1 | P2 | Flows that require connectivity |
| Permission Denied | 1 | P2 | Flows requiring OS permissions |
| Concurrent / Double-tap | 1 | P3 | Action buttons, submit triggers |
| Accessibility | 1 | P3 | All flows |

Read `references/test-patterns-native.md` for pattern-specific scenarios by UI element type.

### 7.2 Scenario Count Targets

| Flow Complexity | Minimum Scenarios |
|----------------|-------------------|
| Simple (launch, quit, about) | 3-5 |
| Medium (settings, navigation) | 6-10 |
| Complex (auth, core feature, multi-step) | 10-20 |

**Goal: maximum coverage.** If a flow has 8 buttons, there should be at least 8+ scenarios covering each interactive element.

### 7.3 Write `scenarios.md`

For each flow, write `qa/flows/F-NNN-[slug]/scenarios.md` using the **scenarios template** in the Templates section.

Present the scenario list to the user:
> "For **F-NNN [Flow Name]**, I've mapped **[N] scenarios**. Key ones:
> - S-01: [Happy path description]
> - S-02: [Most important negative case]
> - S-03: [Most important edge case]
> - ...
> Anything I'm missing for this flow?"

---

## Step 8: Test Case Generation

For each scenario in each flow's `scenarios.md`, write a full test case file.

### 8.1 File Placement

**Flow-based**: `qa/flows/F-NNN-[slug]/test-cases/TC-NNN-[scenario-slug].md`
**Feature-based**: `qa/features/[name]/test-cases/TC-NNN-[scenario-slug].md`
**Risk-based**: `qa/test-cases/P[1-4]-[priority-name]/TC-NNN-[scenario-slug].md`

TC numbers are **globally sequential** across all flows. Zero-pad to 3 digits: TC-001, TC-002, …

### 8.2 Quality Standards for Every Test Case

Each `TC-NNN-*.md` must have:
- **Metadata table**: TC ID, flow ref, priority, platform, macOS version, automation method
- **Preconditions**: specific app state needed before this scenario
- **Setup script**: bash/AppleScript to establish preconditions reproducibly
- **Steps table**: Step | Action | AppleScript/Command | Expected Result
- **AppleScript block**: full runnable script for the scenario (happy path minimum)
- **Pass criteria checklist**: binary observable outcomes (UI state, data, no crash)
- **Evidence path**: `qa/evidence/TC-NNN-S1.png`
- **Teardown**: how to restore app state after test completes

Use `templates/test-case-native.md` as the source template for every file.

### 8.3 AppleScript Standards

- Every test case must have a working AppleScript block for at least the happy path
- Include `delay 1` after every click, `delay 3` after launch/quit
- Use pass/fail assertion where detectable:
  ```applescript
  if [condition] then
      log "✅ PASS: [description]"
  else
      error "❌ FAIL: Expected [X], got " & [actual]
  end if
  ```
- Include evidence capture on failure:
  ```applescript
  -- On failure:
  do shell script "screencapture -x qa/evidence/TC-NNN-fail.png"
  ```

---

## Step 9: Finalize and Update Config

### 9.1 Update `qa/knowledgebase/ui-inventory.md`

After all flows are created, append a **flow mapping** section:

```markdown
## Flow Mapping

| UI Element | Element Type | Flow Reference | Test Cases |
|-----------|-------------|----------------|-----------|
| [Element name] | [type] | F-NNN | TC-NNN, TC-NNN |
```

### 9.2 Update `qa/.qa-config.json`

```bash
python3 - <<'PYEOF'
import json, datetime

with open("qa/.qa-config.json", "r") as f:
    config = json.load(f)

import subprocess, os

# Count flows
if config["framework"] == "flow-based":
    flows = [d for d in os.listdir("qa/flows") if d.startswith("F-")] if os.path.isdir("qa/flows") else []
elif config["framework"] == "feature-based":
    flows = os.listdir("qa/features") if os.path.isdir("qa/features") else []
else:
    flows = []

# Count test cases
import glob
tcs = glob.glob("qa/**/TC-*.md", recursive=True)

config["last_discovery"] = datetime.datetime.now().isoformat()
config["flows_count"] = len(flows)
config["test_cases_count"] = len(tcs)

with open("qa/.qa-config.json", "w") as f:
    json.dump(config, f, indent=2)

print(f"Updated config: {len(flows)} flows, {len(tcs)} test cases")
PYEOF
```

### 9.3 Print Summary

```
╔═══════════════════════════════════════════════════════════════╗
  QA Workspace Ready — [AppName] on macOS [version]
╠═══════════════════════════════════════════════════════════════╣
  Framework:       [flow-based / feature-based / risk-based]
  App:             [AppName] v[version] ([bundle-id])
  Architecture:    [arm64 / x86_64]

  Discovery:
    Screenshots:   [N] in qa/knowledgebase/screenshots/
    UI Sections:   [N] explored
    UI Elements:   [N] buttons, [N] fields, [N] menus

  Flows Created:   [N]
  Scenarios:       [N total] ([N] P1, [N] P2, [N] P3)
  Test Cases:      [N files]

  Files created under qa/
    planning/platforms.md
    guardrails/do-and-dont.md
    credentials/access.md
    scope/contract.md
    knowledgebase/ui-inventory.md
    [flows/ or features/ or test-cases/] — [N directories]
╚═══════════════════════════════════════════════════════════════╝
```

---

## Step 10: UPDATE MODE

When `HAS_WORKSPACE` detected in Step 0.

### Show Existing Workspace State

```bash
cat qa/.qa-config.json
# Count flows
ls qa/flows/ 2>/dev/null | wc -l
# Count test cases
find qa -name "TC-*.md" 2>/dev/null | wc -l
```

Tell the user:
> "Found existing QA workspace for **[AppName]** ([framework]):
> - Flows: [N] | Test cases: [N] | Last discovery: [date]
>
> What would you like to do?
> 1. **Re-discover** — Relaunch app, take new screenshots, detect UI changes
> 2. **Add flow** — Add test coverage for a new feature or flow
> 3. **Add scenarios** — Add more scenarios to an existing flow
> 4. **Full refresh** — Regenerate everything from scratch"

### Option 1: Re-Discover

1. Re-run Steps 4-5 (launch, screenshot, full enumeration)
2. Compare new `ui-inventory.json` to existing:
   ```bash
   diff <(python3 -c "import json; d=json.load(open('qa/knowledgebase/ui-inventory.json')); print(sorted(d.get('elements',{}).get('window_1',{}).get('buttons',[])))" 2>/dev/null) \
        <(python3 -c "print([])")
   ```
3. Report new/removed elements: "I found [N] changes since last run: [list]"
4. Ask which changes to incorporate into existing flows
5. Update only affected `flow.md`, `scenarios.md`, `TC-NNN-*.md` files
6. Append changelog entry to each updated file:
   ```markdown
   | [date] | QA Agent | Re-discovery: [what changed] |
   ```

### Option 2: Add Flow

Ask: "Which feature or user journey should I add?" → run targeted discovery for that area → create new `F-NNN-[slug]/` directory → generate scenarios and test cases → update `scope/contract.md`.

### Option 3: Add Scenarios

Ask: "Which flow?" → show existing scenarios.md → generate additional scenarios using uncovered categories → create new TC files → append to scenarios.md.

### Option 4: Full Refresh

Confirm: "This will overwrite existing flows and test cases. Are you sure? (yes/no)"
On confirmation: proceed as FRESH MODE from Step 4.

---

## Step 1 Templates

### `qa/planning/platforms.md`

```markdown
# Testing Platforms & Environments

## Application Under Test
- **App Name**: [AppName]
- **Bundle ID**: [com.company.appname]
- **Version**: [version]
- **Build**: [build number]
- **App Path**: [/Applications/AppName.app]
- **Platform**: macOS

## macOS Environment
- **macOS Version**: [detected via sw_vers -productVersion]
- **Architecture**: [detected via uname -m — arm64 or x86_64]

## Test Environments
| Environment | Details | Notes |
|-------------|---------|-------|
| Local machine | macOS [version] [arch] | Primary |
| Clean user account | [if applicable] | For first-run / onboarding tests |

## QA Framework
- **Organization**: [flow-based / feature-based / risk-based]
- **Automation Method**: AppleScript via osascript
- **Test Case Format**: Markdown + embedded AppleScript

## Platforms — Future Expansion
| Platform | Status |
|----------|--------|
| macOS | ✅ Active |
| iOS | 🔜 Planned |
| Android | 🔜 Planned |
| Windows | 🔜 Planned |

## Last Updated
- **Date**: [date]
- **Updated by**: QA Agent (native-qa v2.0)
```

---

### `qa/guardrails/do-and-dont.md`

```markdown
# QA Guardrails — [AppName]

## ✅ DO

- Launch the app fresh for each test (quit and relaunch for clean state)
- Use **test accounts only** — never personal or production accounts
- Grant **Accessibility permission** to Terminal before any automation run
  (System Settings → Privacy & Security → Accessibility → Enable Terminal)
- Add `delay 1` (minimum) between AppleScript actions — UI is asynchronous
- `delay 3` after app launch, `delay 2` after quit
- Screenshot on failure for evidence:
  `screencapture -x "qa/evidence/TC-NNN-$(date +%s)-fail.png"`
- Verify app state before each scenario — never assume prior state
- Re-enable any changed system settings after tests (Wi-Fi, Bluetooth, etc.)
- Check Console.app for crash logs after any unexpected behavior

## ❌ DO NOT

- Never use personal or production accounts for testing
- Never commit credentials, tokens, or secrets to any git-tracked file
- Never send real traffic to production (use sandbox/test mode if available)
- Never leave system state changed after a test run (e.g., Wi-Fi off)
- Never assume UI element names — discover dynamically each run
- Never skip delays in AppleScript — UI does not respond synchronously
- Never test payment flows with real payment methods
- Never run destructive operations (reset all data, uninstall) without confirming with user

## ⚠️ Important Cautions

- **System dialogs** — Keychain, network, notification permission dialogs may appear;
  handle these in test preconditions (pre-dismiss or pre-authorize)
- **Menu bar apps** — If no window appears after launch, check `menu bar 2`
  (the system status bar area), not `windows`
- **Login items** — Some apps register launch-at-login; don't remove without user consent
- **Network-dependent apps** — Use sandbox/test endpoints; document any network calls
```

---

### `qa/credentials/access.md`

```markdown
# Credentials & Access

> ⚠️ This file defines STRUCTURE only. Never store actual values here.
> Store actual credentials in `.env.qa` (gitignored).

## Required Test Accounts

| Role | Purpose | How to Obtain |
|------|---------|--------------|
| Standard user | Core functional testing | Create a dedicated test account |
| [Premium/Paid tier] | Premium features | Use test/sandbox subscription |
| New/unauthenticated user | Onboarding, first-run | Use fresh account or private profile |

## `.env.qa` Structure

Create `.env.qa` at the project root (add to `.gitignore`):

```env
QA_APP_NAME=[AppName]
QA_USERNAME=
QA_PASSWORD=
QA_TEST_EMAIL=
QA_ACCOUNT_TIER=free|premium
QA_SANDBOX_MODE=true
```

## Accessibility Permissions Required

- [ ] **Terminal.app** → System Settings → Privacy & Security → Accessibility → ✅
- [ ] **[IDE/tool name]** (if running from an IDE) → same path above
```

---

### `qa/scope/contract.md`

```markdown
# QA Scope Contract

**Application**: [AppName]
**Platform**: macOS [version]
**Framework**: [flow-based / feature-based / risk-based]
**Contract Date**: [date]
**App Version in Scope**: [version]

---

## In Scope ✅

### Flows / Features
> (Auto-populated after flow generation in Step 6)

- [ ] App launch and startup
- [ ] App quit and state persistence
- [ ] Preferences and settings
- [ ] Menu bar navigation
- [ ] [Core feature 1]
- [ ] [Core feature 2]
- [ ] Error handling and offline states

### Test Types
- [x] Functional (does it work?)
- [x] UI / Navigation (can users reach everything?)
- [x] Edge cases (boundary values, invalid input)
- [ ] Performance / memory *(future)*
- [ ] Accessibility / VoiceOver *(future)*
- [ ] Localization *(future)*

---

## Out of Scope ❌

- iOS / Android / Windows versions (separate skill runs)
- Load or stress testing
- Security penetration testing
- Backend / API testing (separate test suites)

---

## Definition of Done

A flow is QA-complete when:
1. `flow.md` (or `overview.md`) fully documents the user journey
2. `scenarios.md` covers all P1 and P2 categories
3. Test case files exist for all P1 scenarios with runnable AppleScript
4. Test cases reviewed by a human QA engineer or developer
5. Known bugs referenced in affected test case files
```

---

## Flow Template

**File**: `qa/flows/F-NNN-[slug]/flow.md`
Also at `templates/flow.md`

```markdown
# F-[NNN]: [Flow Name]

## Summary

| Field | Value |
|-------|-------|
| **Flow ID** | F-[NNN] |
| **Application** | [AppName] |
| **Description** | [One sentence: what goal does this flow accomplish?] |
| **Start State** | [App state before flow begins, e.g., "App launched, user logged out"] |
| **End State** | [App state when flow completes successfully] |
| **Window / Panel** | [e.g., Main window / Preferences > General / Menu bar dropdown] |
| **Priority** | P1 / P2 / P3 |
| **Discovered via** | Screenshot analysis + AppleScript enumeration |
| **Created** | [YYYY-MM-DD] |
| **Last Updated** | [YYYY-MM-DD] |

---

## UI Elements Involved

| Element Type | Name / Description | Role in This Flow |
|-------------|-------------------|--------------------|
| [Button / Field / Tab / etc.] | "[name]" | [what it does in this flow] |

---

## User Journey

### Preconditions
- [ ] [What must be true before this flow starts]
- [ ] [Required account state, permissions, network, etc.]

### Steps

| Step | User Action | System / UI Response | Element Involved |
|------|------------|---------------------|-----------------|
| 1 | [User does this] | [App responds like this] | [Element name] |
| 2 | ... | ... | ... |

### Success Outcome
> [What the user sees / what has changed when the flow completes successfully]

### Failure Outcomes

| What Goes Wrong | Expected App Behavior |
|----------------|----------------------|
| [Failure condition] | [How app should handle it] |

---

## Sub-Flows / Variants

- **[F-NNN-a]**: [Variant name] — [Brief description of how this differs]

---

## Discovery Evidence

- Screenshot: `qa/knowledgebase/screenshots/0N-[section-slug].png`

---

## AppleScript Navigation Skeleton

```applescript
-- Navigate F-[NNN]: [Flow Name]
tell application "[AppName]"
    activate
end tell
delay 2

tell application "System Events"
    tell process "[AppName]"
        -- Step 1: [description]
        click [element] of window 1
        delay 1

        -- Step 2: [description]
        -- ...
    end tell
end tell
```

---

## Notes / Observations

- [Anything unusual observed during discovery — timing issues, inconsistencies, etc.]
```

---

## Scenarios Template

**File**: `qa/flows/F-NNN-[slug]/scenarios.md`
Also at `templates/scenarios.md`

```markdown
# Scenarios — F-[NNN]: [Flow Name]

**Flow**: [F-NNN — link to flow.md]
**Application**: [AppName]
**Total scenarios**: [N]
**Generated**: [YYYY-MM-DD]

---

## S-[NNN]-01: Happy Path — [Short Description]

| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Category** | Happy Path |
| **Preconditions** | [Specific state for this scenario] |
| **Steps summary** | [1-line description of what the user does] |
| **Expected result** | [What success looks like] |
| **Test Case** | [TC-NNN-[slug].md](test-cases/TC-NNN-[slug].md) |

---

## S-[NNN]-02: Alternative Path — [Short Description]

| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Category** | Alternative Happy Path |
| **Preconditions** | [State] |
| **Steps summary** | [1-line] |
| **Expected result** | [Outcome] |
| **Test Case** | [TC-NNN-[slug].md](test-cases/TC-NNN-[slug].md) |

---

## S-[NNN]-03: Negative — [Short Description]

| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Category** | Negative / Invalid Input |
| **Preconditions** | [State] |
| **Steps summary** | [1-line] |
| **Expected result** | [Error shown, action blocked, app stable] |
| **Test Case** | [TC-NNN-[slug].md](test-cases/TC-NNN-[slug].md) |

---

## [Continue for all scenarios — use same table format]

---

## Coverage Summary

| Category | Count | TC Files |
|----------|-------|---------|
| Happy Path | [N] | TC-NNN, ... |
| Alternative Happy Path | [N] | TC-NNN, ... |
| Negative / Invalid Input | [N] | TC-NNN, ... |
| Boundary / Edge Cases | [N] | TC-NNN, ... |
| State Persistence | [N] | TC-NNN, ... |
| Interrupted Flow | [N] | TC-NNN, ... |
| Error Recovery | [N] | TC-NNN, ... |
| Offline / Network | [N] | TC-NNN, ... |
| **Total** | **[N]** | |
```

---

## Key Reminders

- **Step 0 is mandatory** — always detect mode before doing anything
- **Accessibility check comes first** — no automation is possible without it
- **Screenshot → Read → Analyze** is the core discovery loop; use it for every new section
- **One flow per user goal**, not per screen
- **Scenarios before test cases** — write `scenarios.md` first, then expand each into `TC-NNN-*.md`
- **AppleScript delays are not optional** — always `delay 1` after clicks, `delay 3` after launch/quit
- **Menu bar apps** — if no window found after launch, check `menu bar 2` (system status bar)
- **Credentials** — `.env.qa` is always gitignored; never write real credentials to tracked files
- **Read `references/macos-automation.md`** before writing any AppleScript not covered here
- **Read `references/test-patterns-native.md`** for scenario patterns by UI element type and app category
