---
name: native-qa-macos
description: >
  Complete macOS QA runbook. Handles Steps 4–11: app metadata, launch,
  AppleScript UI discovery, happy flow tracing, flow creation, credential
  acquisition, scenario generation, test case generation, HTML reporting,
  and update mode. All automation scripts are inlined — no external file
  dependencies. Invoked by root SKILL.md after platform selection.
platform: darwin
status: production
version: 3.0.0
entrypoint: skills/macos/SKILL.md
---

# macOS Native QA Skill — Complete Runbook

**Platform**: macOS 12 Monterey+
**Automation**: AppleScript + screencapture + Accessibility API
**Invoked by**: Root `SKILL.md` after platform selection (Step 0) and workspace init (Steps 1–3)

This file is self-contained. All scripts are inlined. No external file dependencies.

---

## Pre-Step: Load Prior Knowledge

Before doing anything else, check what the root skill extracted from `qa/context/` in Step 3.

```bash
# Check if prior knowledge was extracted
ls qa/knowledgebase/ui-inventory.md 2>/dev/null && echo "EXISTS" || echo "NONE"
ls qa/context/ 2>/dev/null
```

**If `qa/knowledgebase/ui-inventory.md` exists** — read it now. It contains the candidate flow list and known features extracted from any files the user dropped into `qa/context/`. Use this as your starting map for exploration:
- Prioritize flows named in the inventory — discover these first
- If Figma screens were provided, you already know the screen structure — confirm visually
- If a PRD was provided, you know the features and acceptance criteria — test against them

**If `qa/context/` has unread files** (PNGs, `.md`, `.txt` not yet processed) — read them now before launching the app.

**If nothing exists** — cold start. Discover everything visually from scratch.

---

## STOP / PAUSE / SAVE STATE

Follow the root SKILL.md **"STOP / PAUSE / SAVE STATE — Immediate Handler"** exactly. No macOS-specific differences — the root handler applies as-is.

---

## Step 4: App Metadata

### 4.1 Locate the App

```bash
APP_NAME="[user input from Step 2]"

if [ -d "/Applications/${APP_NAME}.app" ]; then
  APP_PATH="/Applications/${APP_NAME}.app"
elif [ -d "$HOME/Applications/${APP_NAME}.app" ]; then
  APP_PATH="$HOME/Applications/${APP_NAME}.app"
else
  APP_PATH=$(mdfind "kMDItemKind == 'Application'" | grep -i "${APP_NAME}" | head -1)
fi
echo "Resolved: $APP_PATH"
```

If not found, ask the user to provide the full path or drag the `.app` bundle.

### 4.2 Read App Metadata

```bash
python3 - <<'PYEOF'
import plistlib, sys
app_path = "/Applications/APPNAME.app"  # replace with resolved path
with open(app_path + "/Contents/Info.plist", "rb") as f:
    p = plistlib.load(f)
print("Name:      ", p.get("CFBundleName", p.get("CFBundleExecutable", "N/A")))
print("BundleID:  ", p.get("CFBundleIdentifier", "N/A"))
print("Version:   ", p.get("CFBundleShortVersionString", "N/A"))
print("Build:     ", p.get("CFBundleVersion", "N/A"))
print("Min macOS: ", p.get("LSMinimumSystemVersion", "N/A"))
PYEOF

sw_vers -productVersion
uname -m
```

### 4.3 Update Config and Write Planning Files

Update `qa/.qa-config.json` with: `app_name`, `app_path`, `app_identifier` (bundle ID), `app_version`, `os_version`, `architecture`.

Write the following planning files using the templates at the end of this file:
- `qa/planning/platforms.md`
- `qa/guardrails/do-and-dont.md`
- `qa/credentials/access.md`
- `qa/scope/contract.md`

→ **Write checkpoint** to `qa/state.md`. Record: app name, bundle ID, version, macOS version, architecture.

---

## Step 5: Launch App and Take First Screenshot

### 5.1 Check Accessibility Permission

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

### 5.2 Launch the App

```bash
osascript -e 'tell application "[AppName]" to quit' 2>/dev/null; sleep 2
open -a "[AppName]"; sleep 4
osascript -e 'tell application "System Events" to (name of every process) contains "[AppName]"'
```

If not running, try by bundle ID:
```bash
open -b "[bundle-id]"; sleep 4
```

### 5.3 Capture Main Window Screenshot

```bash
osascript -e 'tell application "[AppName]" to activate'; sleep 1
mkdir -p qa/knowledgebase/screenshots
screencapture -x qa/knowledgebase/screenshots/01-main-window.png
```

### 5.4 Visual Analysis

**USE the Read tool** to open `qa/knowledgebase/screenshots/01-main-window.png`. Analyze and tell the user:
- Main window layout (sidebar / panel / tabs)
- Top-level navigation areas and their names
- Primary action buttons
- Inferred app type
- Sections to explore next

---

## Step 6: Deep Exploration — Navigate, Screenshot, Analyze

### 6.1 Run AppleScript UI Enumeration

Write `qa/scripts/explore.py` at runtime (stdlib only: `subprocess`, `json`, `os`, `time`, `argparse`, `plistlib`) then run:

```bash
python3 qa/scripts/explore.py --app "[AppName]" --output qa/knowledgebase --screenshot
```

**What the script must do (write the full implementation at runtime):**
1. `run_applescript(script)` — wrapper for `subprocess.run(["osascript", "-e", script])`
2. `check_accessibility()` — verify System Events access, print error if blocked
3. `check_app_running(app)` / `launch_app(app)` — ensure app is running
4. `get_windows(app)` — AppleScript to list window names, positions, sizes
5. `get_ui_elements(app, window_index)` — enumerate buttons, text fields, static texts, tabs, groups, checkboxes, pop-up buttons per window via AppleScript
6. `explore_app(app, output_dir)` — orchestrate: get windows → for each window get elements → screenshot → write `ui-inventory.md` + `ui-inventory.json`
7. CLI: `--app NAME --output DIR [--no-launch] [--screenshot]`

Stdlib only (`subprocess`, `json`, `os`, `time`, `argparse`). No pip dependencies.

This generates:
- `qa/knowledgebase/ui-inventory.md`
- `qa/knowledgebase/ui-inventory.json`
- `qa/knowledgebase/screenshots/applescript-main.png`

### 6.2 Deep Navigation Loop

For each major navigation area (tabs, sidebar items, toolbar buttons, menu entries):

```applescript
tell application "System Events"
    tell process "[AppName]"
        click [element]  -- button, tab, sidebar row, etc.
        delay 1
    end tell
end tell
```

```bash
screencapture -x "qa/knowledgebase/screenshots/0N-[section-slug].png"
```

**USE the Read tool** on every screenshot. Analyze: what is visible, what actions are available, are there sub-sections, any forms or pickers?

Repeat for: Preferences (`Cmd+,`), tabs, sidebar sections, any modal dialogs.

### 6.3 Menu Bar Exploration

```bash
osascript -e '
tell application "System Events"
    tell process "[AppName]"
        return name of every menu bar item of menu bar 1 as string
    end tell
end tell'

# Click and screenshot each menu
osascript -e '
tell application "System Events"
    tell process "[AppName]"
        click menu bar item "View" of menu bar 1
        delay 0.5
    end tell
end tell'
screencapture -x qa/knowledgebase/screenshots/menu-view.png
osascript -e 'tell application "System Events" to key code 53'  # Escape
```

### 6.4 Status Bar / Menu Bar Extra Check

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

### 6.5 Happy Flow Tracing — Screenshot at Every Step

**This is the core of Phase 1.** For each happy flow, trace the entire end-to-end path as a real user would — one action at a time, screenshot after every single action.

#### Naming convention

```
qa/knowledgebase/screenshots/flow-[F-slug]-step[NN]-[description].png
```

Examples:
```
flow-F001-launch-step01-initial-window.png
flow-F001-launch-step02-menu-opened.png
flow-F002-prefs-step01-preferences-opened.png
flow-F002-prefs-step02-general-tab.png
```

#### Tracing protocol (per flow)

1. **Create `flow.md` immediately** — before taking any screenshots, create `qa/flows/F-NNN-[slug]/flow.md` with the header, summary table, and an empty discovery evidence table:

```markdown
# F-NNN: [Flow Name]
> ⚠️ IN PROGRESS — being traced. Do not use until marked complete.

## Summary
| Field | Value |
|-------|-------|
| **Flow ID** | F-NNN |
| **App** | [AppName] |
| **Status** | IN PROGRESS |

## Discovery Evidence

| Step | Action | Screenshot | Observed |
|------|--------|-----------|---------|
```

2. **Reset** — quit and relaunch the app (or navigate to the flow's start state)

3. **Step-by-step** — for each action in the happy path, do ALL of the following before moving to the next step:
   - Execute the action via AppleScript or keyboard shortcut
   - Wait `delay 1` for UI to settle (or `delay 3` if a window opened)
   - `screencapture -x [path]`
   - **Read the screenshot** with the Read tool
   - **Immediately append the observation** to the discovery evidence table in `flow.md`:
   ```markdown
   | 1 | Launch app | `flow-F001-step01-initial.png` | Main window visible; 3 tabs: General, Network, About; Connect button prominent |
   ```
   Write the full observation — element names, labels, state, anything visible. Do not summarize — capture everything Claude sees.

4. **Finalize `flow.md`** — after all steps are traced, fill in the remaining sections (User Journey table, Success Outcome, Playwright skeleton) and remove the `⚠️ IN PROGRESS` warning. Mark status as `COMPLETE`.

#### Mid-Exploration Auth Gate — Credential Prompt

When a flow hits a locked state, login wall, or any access restriction during Phase 1:

1. **Screenshot the gate** — capture exactly what the UI shows
2. **Read the screenshot** — identify the exact credential type required. Do not assume email + password. Read what the UI actually shows:

| What the UI shows | Credential type |
|-------------------|----------------|
| Email + Password fields | Login credentials |
| API key input field | API key (OpenAI, Anthropic, etc.) |
| License key field | License / activation key |
| "Connect your account" OAuth button | OAuth token |
| TOTP / 2FA code input | Time-based one-time password |
| Multiple plan options visible | Plan selection required |
| Account tier / plan gate ("Pro only") | Plan upgrade required |
| Invite code field | Invite / beta access code |
| Webhook URL / secret | Webhook credentials |
| Any other field | Read its label exactly |

3. **Check for plan selection** — if the screenshot shows multiple plans or tiers, ask before anything else:

> "I can see multiple plans available: [list plan names exactly as shown in the UI]
> Which plan should I test with?"

Store the selected plan in `.qa-config.json` as `QA_ACCOUNT_TIER`. Use it throughout to decide which flows to trace and which to mark as plan-gated.

4. **Then ask for credentials** — using the exact field names from the screenshot:

> ⛔ **BEFORE showing any prompt to the user**, silently check `.env.qa` first:

```bash
cat .env.qa 2>/dev/null || echo "File not found"
```

Match what the UI needs to what's in the file:

| UI needs | Look for in .env.qa |
|----------|-------------------|
| Email + password | `QA_TEST_EMAIL`, `QA_TEST_PASSWORD` |
| OpenAI API key | `QA_LLM_API_KEY` or `OPENAI_API_KEY` |
| Anthropic API key | `QA_LLM_API_KEY` or `ANTHROPIC_API_KEY` |
| License key | `QA_LICENSE_KEY` |
| Account tier | `QA_ACCOUNT_TIER` |
| Any other | Read label from screenshot, search `.env.qa` for matching key |

**If matching values found in `.env.qa`** → use them immediately. Do not ask the user. Do not skip. Fill the fields and submit.

**If values are NOT found in `.env.qa`** → ask the user:

> "**[Flow Name]** needs access to continue.
>
> The app is asking for: **[exact credential type from screenshot]**
> `.env.qa` status: **[key] is ❌ not set**
>
> How would you like to provide it?
>
> **1. Tell me in the chat** — paste the value here
> **2. Add to `.env.qa` and say 'ready'** — I'll re-read it
> **3. Self-register** — only available for email + password signup flows
> **4. Skip** — only if you explicitly want to defer this"

> ⛔ **The agent NEVER chooses to skip on its own.** Only the user can decide to skip. The agent must never autonomously click "Skip", "Set up later", "Maybe later", or any bypass button in the app UI.

#### Route Based on Answer

**Option 2 — Value in chat:**
User pastes the credential value. Use it in the current session only via AppleScript/osascript.
Do NOT write it to any tracked file. If it should persist, write to `.env.qa` only (gitignored).

**Option 3 — Self-register:**
Only available when the UI shows an email + password signup form. Generate:
```
email:    qa-test-[timestamp]@mailinator.com
password: QaTest@[random-8chars]
```
Attempt registration. If successful → write to `.env.qa` → proceed to trace.
If gated (invite only, CAPTCHA, paid plan, no signup form) → tell user and fall back to Option 4.

**Option 4 — Skip (only if user explicitly says so):**
- Write to `flow.md` discovery evidence table: `⛔ Access required — [exact credential type from screenshot] — deferred to Phase 2 (user chose to skip)`
- Note in `qa/state.md` under pending flows: flow name + exact credential type needed
- Continue to the next public flow
- ⛔ The agent must NEVER choose this option on its own — only the user can decide to skip

### 6.6 Compile Section Inventory

After all sections are explored, present a summary table:

> "Explored **[AppName]** — found **[N] sections**, traced **[N] happy flows**:
>
> | # | Section | Type | Happy Flow Traced | Screenshots |
> |---|---------|------|------------------|------------|
> | 1 | [Name] | [type] | ✅ / ⛔ needs auth | [N] |

### 6.7 Clarifying Questions

For each non-trivial section, ask one focused question. Batch 2–3 per message:

> "Quick questions:
> **[Section A]**: What's the main user goal? Any conditions I should know?
> **[Section B]**: Are there multiple ways users reach this?"

**Do not ask about negative cases or edge cases at this stage** — that is Phase 2.

---

## Step 7: Flow Creation

### 7.1 Identify Distinct Flows

A **flow** is a sequence of actions to accomplish one goal — not a screen, a goal.

**Universal flows** (create for every macOS app):
- `F-001-app-launch-and-startup` — Cold launch, warm launch, crash recovery
- `F-002-quit-and-state-persistence` — Quit cleanly, verify state on relaunch
- `F-003-preferences-settings` — Open, navigate, change, persist settings
- `F-004-menu-bar-navigation` — All menus accessible and functional

**App-specific flows** (from discovery):
- `F-005-[primary-feature]`, `F-006-[secondary-feature]`, etc.

**Naming**: `F-NNN-[lowercase-hyphenated-name]`

### 7.2 Create Flow Directory

```bash
mkdir -p "qa/flows/F-NNN-[slug]/test-cases"
```

Write `qa/flows/F-NNN-[slug]/README.md`:
```markdown
# F-NNN — [Flow Name]

| Field | Value |
|-------|-------|
| **Flow ID** | F-NNN |
| **Priority** | P1 / P2 / P3 |
| **Auth required** | Yes / No |
| **Scenarios** | [N] |
| **Test cases** | [N] |

## What this flow covers
[One sentence: what user goal this flow tests]

## Files
| File | Purpose |
|------|---------|
| `flow.md` | Journey map |
| `scenarios.md` | All scenarios (happy + negative + edge + a11y) |
| `test-cases/` | One TC-NNN-*.md per scenario |
```

### 7.3 Write `flow.md`

Use the **Flow Template** at the end of this file. Write to `qa/flows/F-NNN-[slug]/flow.md`.

→ **Write checkpoint** to `qa/state.md` after each flow's `flow.md` is written. Then tell the user: "Type `/clear` now to reset context, then paste: `Read qa/state.md and continue QA for [AppName]`"

---

## Phase 1 Complete Gate

**After all flows have `flow.md` with discovery evidence — STOP. Do not generate scenarios or test cases yet.**

→ **Write checkpoint** to `qa/state.md`. Record:
- All flows discovered (every F-NNN slug)
- Happy flows traced (with screenshot counts)
- Auth-gated flows (list which ones need credentials)
- Phase: `EXPLORATION_COMPLETE — awaiting credentials`

### Phase 1 Report

**Phase boundary checkpoint** — write full `qa/state.md` (heavy checkpoint per root SKILL.md). Generate Allure report:

```bash
node scripts/allure/generate-report.js --open
```

Tell the user: `"Phase 1 Complete ✅ — [N] flows, [N] screenshots, [N] need credentials. Report opened. Say 'generate full coverage' when ready."`

**Wait for the user before proceeding to Step 8.**

---

## Step 8: Credential Acquisition + Scenario Generation

### 8.0 Credential Acquisition — Screenshot-Driven

**Never assume email + password.** Read Phase 1 screenshots first.

#### Step 8.0a: Read Auth Screenshots

For each auth-gated flow, read its Phase 1 discovery screenshots using the Read tool. Identify the exact fields visible in the UI:

| UI shows | Credential needed |
|----------|-----------------|
| Email + Password fields | `QA_TEST_EMAIL`, `QA_TEST_PASSWORD` |
| API key input + provider dropdown | `QA_LLM_API_KEY`, `QA_LLM_PROVIDER` |
| Username only | `QA_USERNAME` |
| Bearer token field | `QA_BEARER_TOKEN` |
| OAuth button only | SSO — manual session required |

#### Step 8.0b: Present Options

> "To trace **[F-NNN — Name]**, I need (from UI screenshots):
>
> | Field | Env Key |
> |-------|---------|
> | [exact label from UI] | `QA_[NAME]` |
>
> **Option 1 — Check `.env.qa`**: I'll read it now and report which fields are set.
> **Option 2 — Provide in chat**: Paste values here; I'll save them to `.env.qa`.
> **Option 3 — I'll self-register** *(only if UI shows email + password signup form)*"

#### Option 1: Check `.env.qa`

```bash
node -e "
require('dotenv').config({ path: '.env.qa' });
const needed = process.argv.slice(1);
needed.forEach(k => console.log(k + ':', process.env[k] ? '✅ set' : '❌ MISSING'));
" -- QA_TEST_EMAIL QA_TEST_PASSWORD  # replace with actual fields from screenshots
```

#### Option 2: Credentials in Chat

Parse what the user pastes and append to `.env.qa`:
```bash
echo "QA_TEST_EMAIL=test@mailinator.com" >> .env.qa
echo "QA_TEST_PASSWORD=TestPass123!" >> .env.qa
```

#### Option 3: Self-Registration (email + password only)

Only offer this if Phase 1 screenshots showed an email + password signup form. Do NOT offer for API keys, OAuth, or payment.

```applescript
-- Self-register via the native signup UI
tell application "[AppName]" to activate
delay 2
tell application "System Events"
    tell process "[AppName]"
        -- Navigate to signup (exact path from Phase 1 screenshots)
        -- Fill email field
        set value of text field 1 of window 1 to "qatest-" & (do shell script "date +%s") & "@mailinator.com"
        delay 0.5
        -- Fill password field
        set value of text field 2 of window 1 to "QAtest123!"
        delay 0.5
        -- Click sign up button
        click button "Sign Up" of window 1
        delay 3
    end tell
end tell
```

Screenshot the result → Read it → confirm registration succeeded.

#### Non-automatable Credentials

| Type | Action |
|------|--------|
| Google/Apple/X/GitHub SSO | Provide `playwright codegen` command; mark TC "requires manual session" |
| LLM API keys | User must provide via Option 1 or 2 |
| Payment / credit card | User provides; use Stripe test card `4242 4242 4242 4242` if Stripe detected |
| TOTP / 2FA | User provides seed via Option 2 |
| Enterprise SSO / SAML | Out of scope — note in flow.md |

Never block Phase 2 on a non-automatable credential. Continue with other flows.

### 8.0c: Authenticated Exploration

After credentials resolved — trace every auth-gated flow step-by-step with screenshots (same protocol as Step 6.5). Add screenshots to `flow.md` discovery evidence table.

### 8.1 Scenario Generation

For each flow, generate **maximum coverage** scenarios.

| Category | Min | Priority | When |
|----------|-----|----------|------|
| Happy Path | 1 | P1 | Every flow |
| Alternative Happy Path | 1+ | P1 | Multiple valid paths |
| Negative / Invalid Input | 2+ | P1 | Any flow with user input |
| Empty / Null Input | 1 | P1 | Required fields |
| Boundary Values | 2 | P2 | Length/range constraints |
| State Persistence | 1 | P2 | Any state-changing flow |
| Interrupted Flow | 1 | P2 | Multi-step flows |
| Error Recovery | 1+ | P2 | Network/IO/server calls |
| Offline / No Network | 1 | P2 | Connectivity-dependent flows |
| Permission Denied | 1 | P2 | OS permission flows |
| Concurrent / Double-tap | 1 | P3 | Action buttons |
| Accessibility | 1 | P3 | All flows |

Read `skills/macos/references/test-patterns.md` for patterns by UI element type.

| Flow Complexity | Minimum Scenarios |
|----------------|-------------------|
| Simple (launch, quit) | 3–5 |
| Medium (settings, nav) | 6–10 |
| Complex (auth, core feature) | 10–20 |

### 8.2 Write `scenarios.md`

Use the **Scenarios Template** at the end of this file. Write to `qa/flows/F-NNN-[slug]/scenarios.md`.

→ **Write checkpoint** to `qa/state.md` after all flows have `scenarios.md`.

---

## Step 9: Test Case Generation

### 9.1 File Placement

`qa/flows/F-NNN-[slug]/test-cases/TC-NNN-[scenario-slug].md`

TC numbers are **globally sequential** across all flows. Zero-pad to 3 digits: TC-001, TC-002, …

### 9.2 Quality Standards

Each TC must have:
- Metadata table: TC ID, flow ref, priority, macOS version, automation method
- Preconditions: exact app state before this scenario
- Setup: bash/AppleScript to establish preconditions
- Steps table: Step | Action | AppleScript | Expected Result
- AppleScript block: full runnable script for the happy path
- Pass criteria checklist: binary observable outcomes
- Evidence path: `qa/evidence/TC-NNN-S1.png`
- Teardown: how to restore app state

Use the **Test Case Template** at the end of this file.

### 9.3 AppleScript Standards

```applescript
-- Always delay after every click
click button "OK" of window 1
delay 1

-- Delay 3 after launch/quit
open -a "[AppName]"; sleep 3

-- Assert and log pass/fail
if exists button "Dashboard" of window 1 then
    log "✅ PASS: Dashboard button visible"
else
    do shell script "screencapture -x qa/evidence/TC-NNN-fail.png"
    error "❌ FAIL: Dashboard button not found"
end if
```

### 9.4 Interaction Driver (for execution phase)

When **executing** test cases, write `qa/scripts/interact.py` at runtime. CLI subcommands:

```bash
python3 qa/scripts/interact.py click --app "[AppName]" --element "Save"
python3 qa/scripts/interact.py type --app "[AppName]" --text "Hello"
python3 qa/scripts/interact.py menu --app "[AppName]" --menu "File" --item "Save"
python3 qa/scripts/interact.py assert --app "[AppName]" --element "Dashboard"
```

**What the script must implement** (stdlib only — `subprocess`, `argparse`, `json`, `time`):
- `run_osascript(script)` — wrapper returning (code, stdout, stderr)
- Subcommands: `check-permission`, `launch --app --wait`, `quit --app`, `click --app --element [--type button] [--window 1]`, `type --app --text [--clear]`, `shortcut --app --key [--mod cmd shift]`, `menu --app --menu --item [--submenu]`, `assert --app --element [--type] [--window]`
- Each returns JSON `{"ok": bool, "message": str, "error": str|null}`
- All AppleScript interactions include `delay 1` after clicks, `delay 0.5` after keystrokes

### 9.5 Checkpoint After Every 5 TCs

→ **Write checkpoint** to `qa/state.md`. Record every TC written by ID and every TC pending by ID and flow. Reset context after the checkpoint.

---

## Step 10: Finalize

### 10.1 Update `qa/knowledgebase/ui-inventory.md`

Append a flow mapping section:

```markdown
## Flow Mapping

| UI Element | Type | Flow | Test Cases |
|-----------|------|------|-----------|
| [Element] | [type] | F-NNN | TC-NNN, TC-NNN |
```

### 10.2 Update `qa/.qa-config.json`

```bash
python3 - <<'PYEOF'
import json, datetime, os, glob

with open("qa/.qa-config.json") as f:
    config = json.load(f)

flows = [d for d in os.listdir("qa/flows") if d.startswith("F-")] if os.path.isdir("qa/flows") else []
tcs = glob.glob("qa/**/TC-*.md", recursive=True)
config["last_discovery"] = datetime.datetime.now().isoformat()
config["flows_count"] = len(flows)
config["test_cases_count"] = len(tcs)

with open("qa/.qa-config.json", "w") as f:
    json.dump(config, f, indent=2)
print(f"Updated: {len(flows)} flows, {len(tcs)} test cases")
PYEOF
```

### 10.3 Generate HTML Report

At runtime, write a Python script to `qa/scripts/generate-report.py` that:
- Reads `qa/runs/RUN-*.md` files
- Parses: run ID, date, app name, pass/fail counts, flow results, failure details
- Generates a static HTML dashboard with stats cards + expandable run rows
- Outputs to `qa/report.html`

```bash
python3 qa/scripts/generate-report.py --runs-dir qa/runs --output qa/report.html
```

The script is self-contained (stdlib only: `os`, `re`, `glob`, `json`, `argparse`, `pathlib`). Write it fresh each session — it's gitignored with the rest of `qa/`.

### 10.4 Final Report & Summary

**Phase boundary checkpoint** — write full `qa/state.md` (heavy checkpoint per root SKILL.md). Generate unified Allure report:

```bash
node scripts/allure/generate-report.js --open
```

Tell the user: `"✅ QA complete — [AppName] on macOS [version]. [N] flows, [N] scenarios, [N] TCs. Report opened."`

---

## Step 11: Update Mode

When `HAS_WORKSPACE` detected in root SKILL.md Step 0.2.

```bash
cat qa/.qa-config.json
ls qa/flows/ 2>/dev/null | wc -l
find qa -name "TC-*.md" 2>/dev/null | wc -l
```

> "Found existing QA workspace for **[AppName]**:
> - Flows: [N] | Test cases: [N] | Last discovery: [date]
>
> 1. **Re-discover** — Relaunch, new screenshots, detect UI changes
> 2. **Add flow** — Add coverage for a new feature
> 3. **Add scenarios** — Extend an existing flow
> 4. **Full refresh** — Regenerate everything from scratch
> 5. **Generate full coverage (Phase 2)** — Exploration done; write all TCs now"

### Option 1: Re-Discover

Re-run Steps 5–6, compare new `ui-inventory.json` to existing, report changes, update only affected files.

### Option 2: Add Flow

Ask which feature → targeted discovery → new `F-NNN-[slug]/` → generate scenarios and TCs → update `scope/contract.md`.

### Option 3: Add Scenarios

Ask which flow → show existing `scenarios.md` → generate additional scenarios for uncovered categories → create new TC files.

### Option 4: Full Refresh

Confirm, then restart from Step 5.

### Option 5: Phase 2

1. Read Phase 1 auth screenshots → identify required fields
2. Read `qa/state.md` for all flows and auth status
3. Proceed to Step 8.0 (credential acquisition)
4. Then Step 8.1–8.2 (scenarios)
5. Then Step 9 (TCs)
6. Final checkpoint

---

## Templates

Templates for planning files, flow.md, scenarios.md, and TC files. Write them at runtime using the structure below — do not include full file contents in these instructions.

### Planning Files (Step 4.3)

Write these to `qa/` during workspace init. Each should be short and specific to the app:

- **`qa/planning/platforms.md`** — App name, bundle ID, version, build, path, macOS version, architecture, QA framework type, automation method (AppleScript)
- **`qa/guardrails/do-and-dont.md`** — DOs: fresh launch per test, test accounts only, Accessibility permission, `delay 1` after clicks / `delay 3` after launch, screenshot on failure. DON'Ts: no personal accounts, no committed credentials, no skipped delays, no real payment. Cautions: system dialogs, menu bar apps (check `menu bar 2`)
- **`qa/credentials/access.md`** — Structure only (never real values). Required roles table, `.env.qa` structure template, Accessibility permissions checklist
- **`qa/scope/contract.md`** — App name, platform, framework, in-scope flows (launch, quit, prefs, menus, core features), out-of-scope (other platforms, load/security testing), definition of done

### `flow.md` Template

Each `qa/flows/F-NNN-[slug]/flow.md` includes:
- **Summary table**: Flow ID, App, Description, Start/End State, Window/Panel, Priority, Created date
- **UI Elements table**: Element Type | Name | Role in This Flow
- **User Journey**: Preconditions checklist → Steps table (Step | User Action | System Response | Element) → Success Outcome → Failure Outcomes table
- **AppleScript Navigation Skeleton**: tell app to activate → tell System Events to click/interact → with delays
- **Discovery Evidence table**: Step | Action | Screenshot | Observed

### `scenarios.md` Template

Each `qa/flows/F-NNN-[slug]/scenarios.md` includes:
- Header: flow ref, app name, total count, date
- Per scenario: S-NNN-NN heading → table (Priority, Category, Preconditions, Steps summary, Expected result, TC file link)
- Coverage Summary table: Category | Count | TC Files

### `TC-NNN-[slug].md` Template

Each test case file includes:
- **Metadata table**: TC ID, Flow, Scenario, Priority, Platform (macOS version), Automation (AppleScript), Created
- **Preconditions**: app installed, Accessibility granted, account state
- **Setup script**: quit app → sleep 2 → open → sleep 3
- **Steps table**: Step | Action | AppleScript Command | Expected Result
- **Full AppleScript block**: setup + steps + assertions (`if exists ... then log PASS else screencapture + error FAIL`)
- **Pass Criteria**: observable outcomes checklist + no crash
- **Evidence**: pass/fail screenshot paths
- **Teardown**: quit app, restore system state

---

## Key Reminders — macOS-Specific

- **Accessibility check first** — no automation without it (Step 5.1)
- **AppleScript delays are mandatory** — `delay 1` after clicks, `delay 3` after launch/quit
- **Menu bar apps** — if no window appears, check `menu bar 2` (system status bar)
- **Context reset / credentials / flow structure** — follow root SKILL.md rules (no macOS-specific differences)
- **References**: `skills/macos/references/macos-automation.md` (AppleScript patterns), `skills/macos/references/test-patterns.md` (scenario patterns)
