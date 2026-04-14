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

## STOP / PAUSE / SAVE STATE — Always Active

**This handler is active at every step. Whenever the user says "stop", "pause", "save state", or any equivalent — write the state file immediately. Do not just acknowledge.**

1. **Write `qa/state-macos.md` now** — capture everything known at this exact moment:
   - Completed flows (with screenshot counts and key observations)
   - In-progress flow (if mid-trace: note the `flow.md` already exists with observations up to the stopped step — resume will continue appending from here)
   - Pending flows (names, priority, auth requirement)
   - App metadata (name, bundle ID, version, macOS version)
   - Credentials status
   - Next action (exact resume point — e.g. "Resume F-003 trace from step 5, flow.md has steps 1-4 already written")

2. **Tell the user**:

> "✅ Checkpoint saved to `qa/state-macos.md`
>
> | Saved | Value |
> |-------|-------|
> | Flows completed | [N] — [names] |
> | In progress | [flow name, step reached] or None |
> | Flows pending | [N] — [names] |
> | Screenshots taken | [N] |
> | TCs written | [N] |
>
> **To resume**: open a new conversation and say:
> `Read qa/state-macos.md and continue QA for [AppName]`"

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

→ **Write checkpoint** to `qa/state-macos.md`. Record: app name, bundle ID, version, macOS version, architecture.

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

**Write** the following script to `qa/scripts/explore.py` using the Write tool (create `qa/scripts/` if it doesn't exist), then run:

```bash
python3 qa/scripts/explore.py --app "[AppName]" --output qa/knowledgebase --screenshot
```

```python
#!/usr/bin/env python3
"""QA Explorer — macOS UI discovery via AppleScript. Inline; no external file dependency."""
import subprocess, json, sys, os, time, argparse
from datetime import datetime

def capture_screenshot(label, output_dir):
    screenshots_dir = os.path.join(output_dir, "screenshots")
    os.makedirs(screenshots_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%H%M%S")
    path = os.path.join(screenshots_dir, f"{label}-{timestamp}.png")
    result = subprocess.run(["screencapture", "-x", path], capture_output=True, text=True)
    if result.returncode == 0 and os.path.exists(path):
        print(f"📸 Screenshot: {path}"); return path
    print(f"⚠️  Screenshot failed: {result.stderr.strip()}"); return None

def run_applescript(script):
    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=30)
    return result.stdout.strip(), result.stderr.strip(), result.returncode

def check_accessibility():
    _, _, code = run_applescript('tell application "System Events" to get name of every process')
    if code != 0:
        print("❌ Accessibility permission not granted.")
        print("   → System Settings → Privacy & Security → Accessibility → Enable Terminal")
        return False
    print("✅ Accessibility permission OK"); return True

def check_app_running(app_name):
    out, _, _ = run_applescript(f'tell application "System Events" to (name of every process) contains "{app_name}"')
    return "true" in out.lower()

def launch_app(app_name, wait_seconds=4):
    print(f"🚀 Launching {app_name}...")
    _, err, code = run_applescript(f'tell application "{app_name}" to activate')
    if code != 0: print(f"❌ Failed to launch: {err}"); return False
    time.sleep(wait_seconds)
    running = check_app_running(app_name)
    print(f"{'✅' if running else '❌'} {app_name} {'is running' if running else 'did not start'}")
    return running

def get_windows(app_name):
    script = f'''
tell application "System Events"
    tell process "{app_name}"
        set windowData to {{}}
        repeat with w in windows
            try
                set wName to name of w
                set wPos to position of w
                set wSize to size of w
                set end of windowData to wName & "|" & (item 1 of wPos as string) & "," & (item 2 of wPos as string) & "|" & (item 1 of wSize as string) & "x" & (item 2 of wSize as string)
            end try
        end repeat
        return windowData
    end tell
end tell'''
    out, _, code = run_applescript(script)
    if code != 0: return []
    windows = []
    for line in out.split(","):
        line = line.strip().strip('"').strip("{").strip("}")
        if "|" in line:
            parts = line.split("|")
            windows.append({"name": parts[0].strip(), "position": parts[1].strip() if len(parts) > 1 else "", "size": parts[2].strip() if len(parts) > 2 else ""})
    return windows

def get_ui_elements(app_name, window_index=1):
    script = f'''
tell application "System Events"
    tell process "{app_name}"
        try
            tell window {window_index}
                set btnList to {{}}
                repeat with b in buttons
                    try
                        set end of btnList to name of b as string
                    end try
                end repeat
                set fieldList to {{}}
                repeat with f in text fields
                    try
                        set end of fieldList to description of f as string
                    end try
                end repeat
                set labelList to {{}}
                repeat with t in static texts
                    try
                        set tv to value of t as string
                        if length of tv > 0 and length of tv < 200 then
                            set end of labelList to tv
                        end if
                    end try
                end repeat
                set checkList to {{}}
                repeat with c in checkboxes
                    try
                        set end of checkList to name of c as string
                    end try
                end repeat
                set popupList to {{}}
                repeat with p in pop up buttons
                    try
                        set end of popupList to name of p as string
                    end try
                end repeat
                set tabList to {{}}
                repeat with tg in tab groups
                    repeat with tab in tabs of tg
                        try
                            set end of tabList to name of tab as string
                        end try
                    end repeat
                end repeat
                return "BUTTONS:" & (btnList as string) & "||FIELDS:" & (fieldList as string) & "||LABELS:" & (labelList as string) & "||CHECKS:" & (checkList as string) & "||POPUPS:" & (popupList as string) & "||TABS:" & (tabList as string)
            end tell
        on error errMsg
            return "ERROR:" & errMsg
        end try
    end tell
end tell'''
    out, _, code = run_applescript(script)
    elements = {"buttons": [], "text_fields": [], "labels": [], "checkboxes": [], "popups": [], "tabs": [], "raw": out}
    if "ERROR:" in out or code != 0: return elements
    key_map = {"BUTTONS": "buttons", "FIELDS": "text_fields", "LABELS": "labels", "CHECKS": "checkboxes", "POPUPS": "popups", "TABS": "tabs"}
    for section in out.split("||"):
        if ":" in section:
            key, _, value = section.partition(":")
            items = [v.strip().strip('"').strip("{").strip("}") for v in value.split(",") if v.strip() and v.strip() not in ('{}', '""', '')]
            if key.strip() in key_map:
                elements[key_map[key.strip()]] = items
    return elements

def get_menu_bar_items(app_name):
    out, _, code = run_applescript(f'''
tell application "System Events"
    tell process "{app_name}"
        try
            return name of every menu bar item of menu bar 1 as string
        on error e
            return "ERROR:" & e
        end try
    end tell
end tell''')
    menus = [m.strip().strip('"') for m in out.split(",") if m.strip()] if code == 0 else []
    status_out, _, _ = run_applescript(f'''
tell application "System Events"
    tell process "{app_name}"
        try
            return name of every menu bar item of menu bar 2 as string
        on error
            return ""
        end try
    end tell
end tell''')
    return {"app_menus": menus, "has_menu_bar_extra": bool(status_out.strip())}

def write_ui_inventory(app_name, discovery, output_dir):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = [f"# UI Inventory — {app_name}", "", f"> Discovered by QA Agent on {timestamp}", ""]
    for i, w in enumerate(discovery.get("windows", []), 1):
        lines += [f"### Window {i}: {w.get('name', 'Unnamed')}", f"- **Size**: {w.get('size', 'unknown')}", ""]
        els = discovery.get("elements", {}).get(f"window_{i}", {})
        for label, key in [("Buttons", "buttons"), ("Text Fields", "text_fields"), ("Checkboxes", "checkboxes"), ("Dropdowns", "popups"), ("Tabs", "tabs")]:
            if els.get(key):
                lines.append(f"#### {label}")
                lines += [f"- `{v}`" for v in els[key] if v]
                lines.append("")
        if els.get("labels"):
            lines.append("#### Visible Labels")
            lines += [f"- {l}" for l in els["labels"][:20] if l and len(l) > 1]
            lines.append("")
    menus = discovery.get("menus", {})
    if menus.get("app_menus"):
        lines += ["## Menu Bar", ""]
        lines += [f"- {m}" for m in menus["app_menus"] if m]
        lines.append("")
    if menus.get("has_menu_bar_extra"):
        lines.append("### ✅ App has a Status Bar icon (menu bar extra)")
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, "ui-inventory.md")
    with open(output_path, "w") as f:
        f.write("\n".join(lines))
    print(f"📄 Written: {output_path}")

def explore_app(app_name, output_dir="qa/knowledgebase", take_screenshot=False):
    print(f"\n🔍 Exploring {app_name}...")
    discovery = {"app_name": app_name, "timestamp": datetime.now().isoformat(), "windows": [], "elements": {}, "menus": {}}
    windows = get_windows(app_name)
    discovery["windows"] = windows
    print(f"📐 Windows found: {len(windows)}")
    for i, w in enumerate(windows, 1):
        print(f"🔎 Scanning window {i}: {w['name']}...")
        els = get_ui_elements(app_name, i)
        discovery["elements"][f"window_{i}"] = els
        print(f"   Buttons: {len(els['buttons'])}, Fields: {len(els['text_fields'])}, Checkboxes: {len(els['checkboxes'])}, Tabs: {len(els['tabs'])}")
    print("📋 Scanning menus...")
    menus = get_menu_bar_items(app_name)
    discovery["menus"] = menus
    if take_screenshot:
        run_applescript(f'tell application "{app_name}" to activate')
        time.sleep(1)
        shot_path = capture_screenshot("applescript-main", output_dir)
        if shot_path:
            discovery.setdefault("screenshots", []).append(shot_path)
    write_ui_inventory(app_name, discovery, output_dir)
    json_path = os.path.join(output_dir, "ui-inventory.json")
    with open(json_path, "w") as f:
        json.dump(discovery, f, indent=2)
    print(f"📄 Written: {json_path}")
    return discovery

def main():
    parser = argparse.ArgumentParser(description="Explore a macOS app's UI for QA")
    parser.add_argument("--app", required=True)
    parser.add_argument("--output", default="qa/knowledgebase")
    parser.add_argument("--no-launch", action="store_true")
    parser.add_argument("--screenshot", action="store_true")
    args = parser.parse_args()
    print(f"\n{'='*50}\n  QA Explorer — {args.app}\n{'='*50}\n")
    if not check_accessibility(): sys.exit(1)
    if not args.no_launch:
        if not check_app_running(args.app):
            if not launch_app(args.app): sys.exit(1)
        else:
            print(f"✅ {args.app} already running")
    discovery = explore_app(args.app, args.output, take_screenshot=args.screenshot)
    total_buttons = sum(len(v.get("buttons", [])) for v in discovery["elements"].values())
    total_fields = sum(len(v.get("text_fields", [])) for v in discovery["elements"].values())
    print(f"\n{'='*50}\n  Discovery Complete\n{'='*50}")
    print(f"  Windows: {len(discovery['windows'])}, Buttons: {total_buttons}, Fields: {total_fields}")
    print(f"  Output:  {args.output}/\n{'='*50}\n")

if __name__ == "__main__":
    main()
```

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

> "**[Flow Name]** needs access to continue.
>
> The app is asking for: **[exact credential type from screenshot — e.g. "an OpenAI API key", "email + password", "a license key", "Pro plan access"]**
>
> How would you like to provide it?
>
> **1. Check `.env.qa`** — I'll look for the relevant key right now
> **2. Tell me in the chat** — paste the value here (used this session only, never written to tracked files)
> **3. Self-register** — only available for email + password signup flows
> **4. Skip for now** — document this gate and come back in Phase 2"

#### Route Based on Answer

**Option 1 — Check `.env.qa`:**

Read `.env.qa` and look for keys matching the credential type identified from the screenshot — not just `QA_TEST_EMAIL`:

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

If found → proceed to trace the flow immediately using the value.
If missing → tell the user exactly which key is missing, offer Options 2 or 4.

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

**Option 4 — Skip:**
- Write to `flow.md` discovery evidence table: `⛔ Access required — [exact credential type from screenshot] — deferred to Phase 2`
- Note in `qa/state-macos.md` under pending flows: flow name + exact credential type needed
- Continue to the next public flow

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

→ **Write checkpoint** to `qa/state-macos.md` after each flow's `flow.md` is written. Then reset context.

---

## Phase 1 Complete Gate

**After all flows have `flow.md` with discovery evidence — STOP. Do not generate scenarios or test cases yet.**

→ **Write checkpoint** to `qa/state-macos.md`. Record:
- All flows discovered (every F-NNN slug)
- Happy flows traced (with screenshot counts)
- Auth-gated flows (list which ones need credentials)
- Phase: `EXPLORATION_COMPLETE — awaiting credentials`

Tell the user:

> "## Phase 1 Complete ✅
>
> | Flow | Happy Path Traced | Auth Required | Screenshots |
> |------|------------------|---------------|------------|
> | F-001 [name] | ✅ [N] steps | No | [N] |
> | F-002 [name] | ✅ [N] steps | Yes | [N] public |
>
> **[N] flows** · **[N] screenshots** · **[N] flows** need credentials for Phase 2
>
> Say **'generate full coverage'** when ready. I'll read the auth screenshots first to identify exactly what credentials the UI requires, then ask how to provide them."

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

→ **Write checkpoint** to `qa/state-macos.md` after all flows have `scenarios.md`.

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

When **executing** test cases (not just writing them), write the interaction driver to `qa/scripts/interact.py` and call it per step for cleaner, structured execution:

```bash
python3 qa/scripts/interact.py click --app "[AppName]" --element "Save"
python3 qa/scripts/interact.py type --app "[AppName]" --text "Hello"
python3 qa/scripts/interact.py menu --app "[AppName]" --menu "File" --item "Save"
python3 qa/scripts/interact.py assert --app "[AppName]" --element "Dashboard"
```

```python
#!/usr/bin/env python3
"""macOS QA interaction driver. Inline; no external file dependency."""
import subprocess, argparse, json, sys, time
from pathlib import Path

def run_osascript(script, timeout=30):
    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=timeout)
    return result.returncode, result.stdout.strip(), result.stderr.strip()

def check_permission():
    code, _, err = run_osascript('tell application "System Events" to get name of every process')
    if code == 0: return {"ok": True, "message": "Accessibility permission granted"}
    return {"ok": False, "message": "Grant Accessibility permission in: System Settings → Privacy & Security → Accessibility → Terminal", "error": err}

def launch_app(app_name, wait_seconds=4):
    run_osascript(f'tell application "{app_name}" to quit'); time.sleep(2)
    result = subprocess.run(["open", "-a", app_name], capture_output=True, text=True)
    if result.returncode != 0: return {"ok": False, "message": f"Could not launch {app_name}", "error": result.stderr}
    time.sleep(wait_seconds)
    run_osascript(f'tell application "{app_name}" to activate'); time.sleep(1)
    check = subprocess.run(["pgrep", "-x", app_name.replace(" ", "")], capture_output=True, text=True)
    return {"ok": True, "message": f"{app_name} launched", "pid": check.stdout.strip()}

def quit_app(app_name):
    code, _, err = run_osascript(f'tell application "{app_name}" to quit')
    time.sleep(2)
    return {"ok": code == 0, "message": f"{app_name} quit" if code == 0 else f"Could not quit", "error": err if code != 0 else None}

def click_element(app_name, element, element_type="button", window=1):
    selector_map = {"button": f'button "{element}"', "checkbox": f'checkbox "{element}"', "radio": f'radio button "{element}"'}
    selector = selector_map.get(element_type, f'{element_type} "{element}"') + f" of window {window}"
    script = f'tell application "System Events"\n    tell process "{app_name}"\n        click {selector}\n        delay 1\n    end tell\nend tell'
    code, _, err = run_osascript(script)
    return {"ok": code == 0, "message": f"Clicked '{element}'" if code == 0 else f"Could not click '{element}'", "error": err if code != 0 else None}

def type_text(app_name, text, clear_first=False):
    clear = '\n        keystroke "a" using command down\n        delay 0.3\n        key code 51\n        delay 0.3' if clear_first else ""
    script = f'tell application "System Events"\n    tell process "{app_name}"{clear}\n        keystroke "{text}"\n        delay 0.5\n    end tell\nend tell'
    code, _, err = run_osascript(script)
    return {"ok": code == 0, "message": f"Typed {len(text)} chars" if code == 0 else "Could not type", "error": err if code != 0 else None}

def keyboard_shortcut(app_name, key, modifiers=None):
    mod_map = {"command": "command down", "cmd": "command down", "shift": "shift down", "option": "option down", "alt": "option down", "control": "control down", "ctrl": "control down"}
    if modifiers:
        mod_str = ", ".join(mod_map.get(m.lower(), f"{m} down") for m in modifiers)
        script = f'tell application "System Events"\n    tell process "{app_name}"\n        keystroke "{key}" using {{{mod_str}}}\n        delay 1\n    end tell\nend tell'
    else:
        script = f'tell application "System Events"\n    tell process "{app_name}"\n        keystroke "{key}"\n        delay 0.5\n    end tell\nend tell'
    code, _, err = run_osascript(script)
    return {"ok": code == 0, "message": f"Shortcut: {modifiers}+{key}" if modifiers else f"Key: {key}", "error": err if code != 0 else None}

def menu_navigate(app_name, menu, item, submenu=None):
    if submenu:
        script = f'tell application "System Events"\n    tell process "{app_name}"\n        click menu bar item "{menu}" of menu bar 1\n        delay 0.5\n        click menu item "{submenu}" of menu "{menu}" of menu bar item "{menu}" of menu bar 1\n        delay 0.5\n        click menu item "{item}" of menu "{submenu}" of menu item "{submenu}" of menu "{menu}" of menu bar item "{menu}" of menu bar 1\n        delay 1\n    end tell\nend tell'
    else:
        script = f'tell application "System Events"\n    tell process "{app_name}"\n        click menu bar item "{menu}" of menu bar 1\n        delay 0.5\n        click menu item "{item}" of menu "{menu}" of menu bar item "{menu}" of menu bar 1\n        delay 1\n    end tell\nend tell'
    code, _, err = run_osascript(script)
    return {"ok": code == 0, "message": f"Menu: {menu} > {item}" if code == 0 else f"Menu failed", "error": err if code != 0 else None}

def assert_element_exists(app_name, element, element_type="button", window=1):
    script = f'tell application "System Events"\n    tell process "{app_name}"\n        if exists {element_type} "{element}" of window {window} then\n            return "EXISTS"\n        else\n            return "NOT_FOUND"\n        end if\n    end tell\nend tell'
    code, out, err = run_osascript(script)
    exists = code == 0 and out == "EXISTS"
    return {"ok": exists, "exists": exists, "message": f"'{element}' {'found' if exists else 'not found'}", "error": err if not exists else None}

def main():
    parser = argparse.ArgumentParser(description="macOS QA interaction driver")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("check-permission")
    p = subparsers.add_parser("launch"); p.add_argument("--app", required=True); p.add_argument("--wait", type=int, default=4)
    p = subparsers.add_parser("quit"); p.add_argument("--app", required=True)
    p = subparsers.add_parser("click"); p.add_argument("--app", required=True); p.add_argument("--element", required=True); p.add_argument("--type", default="button", dest="element_type"); p.add_argument("--window", type=int, default=1)
    p = subparsers.add_parser("type"); p.add_argument("--app", required=True); p.add_argument("--text", required=True); p.add_argument("--clear", action="store_true")
    p = subparsers.add_parser("shortcut"); p.add_argument("--app", required=True); p.add_argument("--key", required=True); p.add_argument("--mod", nargs="*", default=[])
    p = subparsers.add_parser("menu"); p.add_argument("--app", required=True); p.add_argument("--menu", required=True); p.add_argument("--item", required=True); p.add_argument("--submenu", default=None)
    p = subparsers.add_parser("assert"); p.add_argument("--app", required=True); p.add_argument("--element", required=True); p.add_argument("--type", default="button", dest="element_type"); p.add_argument("--window", type=int, default=1)
    args = parser.parse_args()
    dispatch = {"check-permission": lambda: check_permission(), "launch": lambda: launch_app(args.app, args.wait), "quit": lambda: quit_app(args.app), "click": lambda: click_element(args.app, args.element, args.element_type, args.window), "type": lambda: type_text(args.app, args.text, args.clear), "shortcut": lambda: keyboard_shortcut(args.app, args.key, args.mod), "menu": lambda: menu_navigate(args.app, args.menu, args.item, args.submenu), "assert": lambda: assert_element_exists(args.app, args.element, args.element_type, args.window)}
    result = dispatch[args.command]()
    print(json.dumps(result, indent=2))
    sys.exit(0 if result.get("ok") else 1)

if __name__ == "__main__":
    main()
```

### 9.5 Checkpoint After Every 5 TCs

→ **Write checkpoint** to `qa/state-macos.md`. Record every TC written by ID and every TC pending by ID and flow. Reset context after the checkpoint.

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

Write the following script to `qa/scripts/generate-report.py` using the Write tool, then run:

```bash
python3 qa/scripts/generate-report.py --runs-dir qa/runs --output qa/report.html
```

```python
#!/usr/bin/env python3
"""QA HTML Report Generator. Reads qa/runs/RUN-*.md → static HTML dashboard. Inline; no external dependencies."""
import os, re, glob, json, argparse
from datetime import datetime
from pathlib import Path

def parse_run(path):
    with open(path, encoding="utf-8") as f:
        content = f.read()
    run_id = Path(path).stem
    date_match = re.search(r"(\d{4}-\d{2}-\d{2}[T ]?\d{2}:\d{2})", content)
    app_match = re.search(r"(?:App(?:lication)?|app)[:\s—–-]+([A-Za-z0-9\s.]+?)(?:\n|—|–|-)", content)
    pass_count = len(re.findall(r"✅\s*PASS", content))
    fail_count = len(re.findall(r"❌\s*FAIL", content))
    flows = []
    for row in re.findall(r"\|\s*(F-\d+[^\|]*)\|\s*(✅[^\|]*|❌[^\|]*)\|\s*([^\|]*)\|\s*(\d+)\|\s*(\d+)\|\s*(\d+)", content):
        flow_name, result, duration, tcs, passed, failed = [x.strip() for x in row]
        flows.append({"name": flow_name, "result": "PASS" if "✅" in result else "FAIL", "duration": duration, "tcs": int(tcs) if tcs.isdigit() else 0, "passed": int(passed) if passed.isdigit() else 0, "failed": int(failed) if failed.isdigit() else 0})
    failures = []
    for tc_id, block in re.findall(r"###\s+(TC-\d+[^\n]*)\n(.*?)(?=###\s+TC-|\Z)", content, re.DOTALL):
        class_match = re.search(r"\*\*Class\*\*[:\s]+(\w+)", block)
        step_match = re.search(r"\*\*Step[^:]*\*\*[:\s]+(.+?)(?:\n|$)", block)
        diag_match = re.search(r"\*\*Diag[^:]*\*\*[:\s]+(.+?)(?:\n|$)", block)
        ev_match = re.search(r"evidence[/\\][^\s\)]+\.png", block, re.IGNORECASE)
        failures.append({"tc_id": tc_id.strip(), "class": class_match.group(1) if class_match else "UNKNOWN", "step": step_match.group(1).strip() if step_match else "", "diagnosis": diag_match.group(1).strip() if diag_match else "", "evidence": ev_match.group(0) if ev_match else ""})
    total = pass_count + fail_count
    return {"id": run_id, "date": date_match.group(1) if date_match else "unknown", "app": app_match.group(1).strip() if app_match else "Unknown", "pass": pass_count, "fail": fail_count, "total": total, "pass_rate": round((pass_count / total * 100) if total > 0 else 0, 1), "flows": flows, "failures": failures, "verdict": "PASS" if fail_count == 0 else "FAIL"}

def build_html(runs, generated_at):
    def run_row(r):
        vc = "#22863a" if r["verdict"] == "PASS" else "#cb2431"
        rc = "#22863a" if r["pass_rate"] >= 90 else ("#e36209" if r["pass_rate"] >= 70 else "#cb2431")
        icon = "✅" if r["verdict"] == "PASS" else "❌"
        detail_rows = "".join(f"<tr><td>{f['name']}</td><td style='color:{'#22863a' if f['result']=='PASS' else '#cb2431'}'>{'✅' if f['result']=='PASS' else '❌'} {f['result']}</td><td>{f['duration']}</td><td>{f['tcs']}</td><td>{f['passed']}</td><td>{f['failed']}</td></tr>" for f in r.get("flows", []))
        fail_rows = "".join(f"<tr><td><code>{fa['tc_id']}</code></td><td>{fa['class']}</td><td>{fa['step']}</td><td>{fa['diagnosis']}</td></tr>" for fa in r.get("failures", []))
        fail_html = f"<h4 style='margin:12px 0 6px;color:#cb2431'>Failures ({len(r['failures'])})</h4><table><tr><th>TC</th><th>Class</th><th>Step</th><th>Diagnosis</th></tr>{fail_rows}</table>" if r.get("failures") else ""
        detail = f"<div style='padding:12px 24px;background:#f6f8fa'><h4>Flow Results</h4><table><tr><th>Flow</th><th>Result</th><th>Duration</th><th>TCs</th><th>Pass</th><th>Fail</th></tr>{detail_rows or '<tr><td colspan=6>No flow data</td></tr>'}</table>{fail_html}</div>"
        return f"<tr onclick=\"toggleDetail('{r['id']}')\" style='cursor:pointer'><td><code>{r['id']}</code></td><td>{r['date']}</td><td>{r['app']}</td><td style='color:{vc};font-weight:bold'>{icon} {r['verdict']}</td><td style='color:#22863a'>{r['pass']}</td><td style='color:#cb2431'>{r['fail']}</td><td>{r['total']}</td><td style='color:{rc};font-weight:bold'>{r['pass_rate']}%</td></tr><tr id='detail-{r['id']}' style='display:none'><td colspan='8'>{detail}</td></tr>"
    total_runs = len(runs)
    passed_runs = sum(1 for r in runs if r["verdict"] == "PASS")
    total_tcs = sum(r["total"] for r in runs)
    avg_rate = round(sum(r["pass_rate"] for r in runs) / total_runs, 1) if total_runs > 0 else 0
    rows_html = "\n".join(run_row(r) for r in runs) if runs else '<tr><td colspan="8" style="text-align:center;padding:2rem;color:#586069">No run summaries found in qa/runs/</td></tr>'
    return f"""<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>QA Agent — Run History</title>
<style>*{{box-sizing:border-box;margin:0;padding:0}}body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f6f8fa;color:#24292e;padding:2rem}}h1{{font-size:1.6rem;font-weight:600;margin-bottom:.25rem}}.subtitle{{color:#586069;font-size:.9rem;margin-bottom:2rem}}.stats{{display:flex;gap:1.5rem;margin-bottom:2rem;flex-wrap:wrap}}.stat-card{{background:white;border:1px solid #e1e4e8;border-radius:6px;padding:1rem 1.5rem;min-width:140px}}.stat-card .value{{font-size:2rem;font-weight:700}}.stat-card .label{{font-size:.8rem;color:#586069;margin-top:4px}}table{{width:100%;border-collapse:collapse;background:white;border:1px solid #e1e4e8;border-radius:6px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.07)}}th{{background:#f6f8fa;padding:10px 14px;text-align:left;font-size:.8rem;font-weight:600;color:#586069;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e1e4e8}}td{{padding:10px 14px;border-bottom:1px solid #f0f0f0;font-size:.9rem}}tr:hover td{{background:#f6f8fa}}code{{font-family:monospace;font-size:.85em;background:#f6f8fa;padding:1px 5px;border-radius:3px}}footer{{margin-top:2rem;color:#586069;font-size:.8rem;text-align:center}}</style>
</head><body>
<h1>QA Agent — Run History</h1><p class="subtitle">Generated: {generated_at} · Powered by Claude Code</p>
<div class="stats"><div class="stat-card"><div class="value">{total_runs}</div><div class="label">Total Runs</div></div><div class="stat-card"><div class="value" style="color:#22863a">{passed_runs}</div><div class="label">Passed</div></div><div class="stat-card"><div class="value" style="color:#cb2431">{total_runs-passed_runs}</div><div class="label">Failed</div></div><div class="stat-card"><div class="value">{total_tcs}</div><div class="label">TCs Executed</div></div><div class="stat-card"><div class="value">{avg_rate}%</div><div class="label">Avg Pass Rate</div></div></div>
<table><thead><tr><th>Run ID</th><th>Date</th><th>App</th><th>Result</th><th>Pass</th><th>Fail</th><th>Total</th><th>Rate</th></tr></thead><tbody>{rows_html}</tbody></table>
<footer>QA Agent · Claude Code · {generated_at}</footer>
<script>function toggleDetail(id){{var el=document.getElementById('detail-'+id);if(el)el.style.display=el.style.display==='none'?'table-row':'none';}}</script>
</body></html>"""

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs-dir", default="qa/runs")
    parser.add_argument("--output", default="qa/report.html")
    args = parser.parse_args()
    run_files = sorted(glob.glob(os.path.join(args.runs_dir, "RUN-*.md")), reverse=True)
    runs = []
    for path in run_files:
        try:
            run = parse_run(path)
            runs.append(run)
            print(f"  {'✅' if run['verdict']=='PASS' else '❌'} {run['id']} — {run['pass']}/{run['total']} passed")
        except Exception as e:
            print(f"  ⚠️  Could not parse {path}: {e}")
    html = build_html(runs, datetime.now().strftime("%Y-%m-%d %H:%M"))
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"\n✅ Report: {args.output}")

if __name__ == "__main__":
    main()
```

### 10.4 Print Summary

```
╔═══════════════════════════════════════════════════════════════╗
  QA Workspace Ready — [AppName] on macOS [version]
╠═══════════════════════════════════════════════════════════════╣
  Platform:        macOS [version] ([arm64/x86_64])
  Framework:       [flow-based / feature-based / risk-based]
  App:             [AppName] v[version] ([bundle-id])

  Discovery:
    Screenshots:   [N] in qa/knowledgebase/screenshots/
    UI Sections:   [N] explored

  Flows Created:   [N]
  Scenarios:       [N total] ([N] P1, [N] P2, [N] P3)
  Test Cases:      [N files]
  HTML Report:     qa/report.html
╚═══════════════════════════════════════════════════════════════╝
```

→ **Write final checkpoint** to `qa/state-macos.md`.

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
2. Read `qa/state-macos.md` for all flows and auth status
3. Proceed to Step 8.0 (credential acquisition)
4. Then Step 8.1–8.2 (scenarios)
5. Then Step 9 (TCs)
6. Final checkpoint

---

## Templates

### `qa/planning/platforms.md`

```markdown
# Testing Platforms & Environments

## Application Under Test
- **App Name**: [AppName]
- **Bundle ID**: [com.company.appname]
- **Version**: [version]
- **Build**: [build number]
- **App Path**: [/Applications/AppName.app]
- **Platform**: macOS [version]
- **Architecture**: [arm64 / x86_64]

## QA Framework
- **Organization**: [flow-based / feature-based / risk-based]
- **Automation**: AppleScript via osascript + screencapture
- **Test Format**: Markdown + embedded AppleScript
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
- Screenshot on failure: `screencapture -x "qa/evidence/TC-NNN-$(date +%s)-fail.png"`
- Verify app state before each scenario — never assume prior state

## ❌ DO NOT

- Never use personal or production accounts for testing
- Never commit credentials or tokens to any git-tracked file
- Never send real traffic to production (use sandbox/test mode if available)
- Never skip delays in AppleScript — UI does not respond synchronously
- Never test payment flows with real payment methods
- Never run destructive operations without confirming with the user

## ⚠️ Cautions

- **System dialogs** — Keychain, network, notification dialogs may appear; pre-dismiss in preconditions
- **Menu bar apps** — If no window appears after launch, check `menu bar 2` (system status bar)
```

---

### `qa/credentials/access.md`

```markdown
# Credentials & Access

> ⚠️ Structure only. Never store real values here. Use `.env.qa` (gitignored).

## Required Test Accounts

| Role | Purpose | How to Obtain |
|------|---------|--------------|
| Standard user | Core testing | Create dedicated test account |
| [Premium tier] | Premium features | Use test/sandbox subscription |

## `.env.qa` Structure

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
```

---

### `qa/scope/contract.md`

```markdown
# QA Scope Contract

**Application**: [AppName]
**Platform**: macOS [version]
**Framework**: [flow-based / feature-based / risk-based]
**Contract Date**: [date]

## In Scope ✅

- App launch and startup
- App quit and state persistence
- Preferences and settings
- Menu bar navigation
- [Core feature 1]
- Error handling and offline states

## Out of Scope ❌

- iOS / Android / Windows / Web versions
- Load or stress testing
- Security penetration testing
- Backend / API testing

## Definition of Done

A flow is QA-complete when:
1. `flow.md` fully documents the user journey
2. `scenarios.md` covers all P1 and P2 categories
3. TC files exist for all P1 scenarios with runnable AppleScript
4. Evidence screenshots captured for at least the happy path
```

---

## Flow Template

**File**: `qa/flows/F-NNN-[slug]/flow.md`

```markdown
# F-[NNN]: [Flow Name]

## Summary

| Field | Value |
|-------|-------|
| **Flow ID** | F-[NNN] |
| **Application** | [AppName] |
| **Description** | [One sentence: what goal does this flow accomplish?] |
| **Start State** | [App state before flow begins] |
| **End State** | [App state when flow completes successfully] |
| **Window / Panel** | [e.g., Main window / Preferences > General] |
| **Priority** | P1 / P2 / P3 |
| **Discovered via** | Screenshot analysis + AppleScript enumeration |
| **Created** | [YYYY-MM-DD] |

## UI Elements Involved

| Element Type | Name | Role in This Flow |
|-------------|------|-------------------|
| [Button / Field / Tab] | "[name]" | [what it does] |

## User Journey

### Preconditions
- [ ] [What must be true before this flow starts]

### Steps

| Step | User Action | System / UI Response | Element |
|------|------------|---------------------|---------|
| 1 | [User does this] | [App responds] | [Element] |

### Success Outcome
> [What the user sees when the flow completes successfully]

### Failure Outcomes

| What Goes Wrong | Expected Behavior |
|----------------|------------------|
| [Failure condition] | [How app should handle it] |

## AppleScript Navigation Skeleton

```applescript
tell application "[AppName]"
    activate
end tell
delay 2

tell application "System Events"
    tell process "[AppName]"
        -- Step 1: [description]
        click button "[ButtonName]" of window 1
        delay 1
    end tell
end tell
```

## Discovery Evidence — Happy Path Screenshots

| Step | Action | Screenshot | Observed |
|------|--------|-----------|---------|
| 1 | [action] | `flow-F[NNN]-[slug]-step01-[desc].png` | [what was visible] |
```

---

## Scenarios Template

**File**: `qa/flows/F-NNN-[slug]/scenarios.md`

```markdown
# Scenarios — F-[NNN]: [Flow Name]

**Total scenarios**: [N] | **Generated**: [YYYY-MM-DD]

---

## S-[NNN]-01: Happy Path — [Short Description]

| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Category** | Happy Path |
| **Preconditions** | [State] |
| **Steps summary** | [1-line] |
| **Expected result** | [Success outcome] |
| **Test Case** | [TC-NNN-[slug].md](test-cases/TC-NNN-[slug].md) |

---

## [Continue for all scenarios — same table format]

## Coverage Summary

| Category | Count | TC Files |
|----------|-------|---------|
| Happy Path | [N] | TC-NNN, ... |
| Negative / Invalid Input | [N] | TC-NNN, ... |
| Boundary / Edge Cases | [N] | TC-NNN, ... |
| State Persistence | [N] | TC-NNN, ... |
| **Total** | **[N]** | |
```

---

## Test Case Template

**File**: `qa/flows/F-NNN-[slug]/test-cases/TC-NNN-[slug].md`

```markdown
# TC-[NNN]: [Test Case Title]

| Field | Value |
|-------|-------|
| **TC ID** | TC-[NNN] |
| **Flow** | [F-NNN — Flow Name](../flow.md) |
| **Scenario** | [S-NNN-NN] |
| **Priority** | P1 / P2 / P3 |
| **Platform** | macOS [version] |
| **Automation** | AppleScript via osascript |
| **Created** | [YYYY-MM-DD] |

## Preconditions

- [ ] [AppName] is installed at [path]
- [ ] Accessibility permission granted for Terminal
- [ ] [Any account state, network, etc.]

## Setup

```bash
# Ensure clean state
osascript -e 'tell application "[AppName]" to quit' 2>/dev/null
sleep 2
open -a "[AppName]"
sleep 3
```

## Steps

| Step | Action | AppleScript / Command | Expected Result |
|------|--------|----------------------|----------------|
| 1 | [User action] | `click button "[Name]" of window 1` | [Expected UI response] |

## AppleScript

```applescript
-- TC-[NNN]: [Title]
-- Setup
tell application "[AppName]" to quit
delay 2
open location "file:///Applications/[AppName].app"
delay 3
tell application "[AppName]" to activate
delay 1

tell application "System Events"
    tell process "[AppName]"
        -- Step 1
        click button "[ButtonName]" of window 1
        delay 1

        -- Assert
        if exists button "[ExpectedElement]" of window 1 then
            log "✅ PASS: TC-[NNN] — [description]"
        else
            do shell script "screencapture -x qa/evidence/TC-[NNN]-fail.png"
            error "❌ FAIL: Expected [X]"
        end if
    end tell
end tell
```

## Pass Criteria

- [ ] [Observable outcome 1]
- [ ] [Observable outcome 2]
- [ ] No crash or error dialog

## Evidence

- Pass: `qa/evidence/TC-[NNN]-S1-pass.png`
- Fail: `qa/evidence/TC-[NNN]-fail.png`

## Teardown

```bash
osascript -e 'tell application "[AppName]" to quit' 2>/dev/null
# Restore any changed system state
```
```

---

## Key Reminders

- **Accessibility check first** — no automation without it (Step 5.1)
- **Screenshot → Read → Analyze** is the core discovery loop; use it for every new section
- **One flow per user goal**, not per screen
- **Scenarios before test cases** — write `scenarios.md` first, expand each into `TC-NNN-*.md`
- **AppleScript delays are mandatory** — `delay 1` after clicks, `delay 3` after launch/quit
- **Menu bar apps** — if no window appears after launch, check `menu bar 2` (system status bar)
- **Credentials** — `.env.qa` is always gitignored; never write real values to tracked files
- **Context reset** — after every flow traced, write checkpoint to `qa/state-macos.md` and reset context
- **Read `skills/macos/references/macos-automation.md`** for AppleScript patterns not covered here
- **Read `skills/macos/references/test-patterns.md`** for scenario patterns by UI element type
