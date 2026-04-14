# TC-[NNN]: [Feature / Flow Name]

## Metadata

| Field | Value |
|-------|-------|
| **Test Case ID** | TC-[NNN] |
| **Application** | [App Name] |
| **Feature** | [Feature or flow being tested] |
| **Priority** | P1 / P2 / P3 |
| **Type** | Functional / UI / State / Error / Performance |
| **Platform** | macOS [version] |
| **Architecture** | arm64 (Apple Silicon) / x86_64 (Intel) / Both |
| **Automation Method** | AppleScript / Manual / Hybrid |
| **Author** | QA Agent |
| **Created** | [YYYY-MM-DD] |
| **Last Updated** | [YYYY-MM-DD] |
| **Flow Reference** | F-[NNN] — [flow.md](../flow.md) |
| **Scenario Reference** | S-[NNN]-[NN] — [scenarios.md](../scenarios.md) |

---

## Preconditions

> Everything that must be true BEFORE any scenario in this file runs.

- [ ] App is installed at `/Applications/[AppName].app`
- [ ] macOS Accessibility permission granted for Terminal (System Settings → Privacy & Security → Accessibility)
- [ ] Test account credentials loaded from `.env.qa` (never hardcoded)
- [ ] App is **fully quit** before starting (not just hidden)
- [ ] Network: [connected / offline / specific condition]
- [ ] App state: [logged in / logged out / fresh install]
- [ ] [Any other preconditions specific to this feature]

### Setup Script

```bash
# Quit app before each test
osascript -e 'tell application "[AppName]" to quit' 2>/dev/null || true
sleep 2

# Launch fresh
open -a "[AppName]"
sleep 3

# Verify running
pgrep -x "[ProcessName]" > /dev/null && echo "✅ App running" || echo "❌ App not running"
```

---

## Scenarios

---

### Scenario 1: Happy Path — [Description]

**Priority**: P1
**Type**: Functional

#### Preconditions (specific to this scenario)
- [Any state beyond the general preconditions above]

#### Steps

| Step | Action | AppleScript / Command | Expected Result |
|------|--------|----------------------|----------------|
| 1 | Launch app | `open -a "[AppName]"` | App window appears within 5s |
| 2 | [Describe action] | `click button "[name]" of window 1` | [Expected UI response] |
| 3 | [Describe action] | `[AppleScript or manual]` | [Expected result] |
| N | [Final action] | `[command]` | [Success state] |

#### AppleScript

```applescript
tell application "System Events"
    tell process "[AppName]"
        -- Step 2
        click button "[ButtonName]" of window 1
        delay 1

        -- Step 3
        -- ...

        -- Verify outcome
        set statusText to value of static text 1 of window 1
        if statusText contains "[expected text]" then
            log "✅ PASS: Scenario 1"
        else
            error "❌ FAIL: Expected '[expected text]', got '" & statusText & "'"
        end if
    end tell
end tell
```

#### Pass Criteria
- [ ] [Specific observable outcome 1]
- [ ] [Specific observable outcome 2]
- [ ] App does not crash
- [ ] No unexpected system dialogs

#### Evidence
- Screenshot: `qa/evidence/TC-[NNN]-S1-pass.png`

---

### Scenario 2: [Edge Case / Variant]

**Priority**: P2
**Type**: Functional

#### Steps

| Step | Action | AppleScript / Command | Expected Result |
|------|--------|----------------------|----------------|
| 1 | [Setup] | [command] | [result] |
| 2 | [Edge case trigger] | [command] | [graceful handling] |

#### Pass Criteria
- [ ] App handles edge case without crash
- [ ] [Expected UI state]
- [ ] [Data integrity maintained]

---

### Scenario 3: Negative — [Invalid Input / Error Condition]

**Priority**: P2
**Type**: Functional (Negative)

#### Steps

| Step | Action | AppleScript / Command | Expected Result |
|------|--------|----------------------|----------------|
| 1 | [Setup] | [command] | [ready state] |
| 2 | [Enter invalid input] | `keystroke "[invalid value]"` | — |
| 3 | [Trigger action] | `click button "Submit"` | Error shown |

#### Pass Criteria
- [ ] Error message displayed: `"[expected error text]"`
- [ ] Action is NOT completed
- [ ] App remains usable (can recover)
- [ ] No crash

---

### Scenario 4: State Persistence — [After Relaunch]

**Priority**: P2
**Type**: State

#### AppleScript

```applescript
-- Record state
tell application "System Events"
    tell process "[AppName]"
        set stateBefore to [value to check]
    end tell
end tell

-- Quit
tell application "[AppName]" to quit
delay 2

-- Relaunch
tell application "[AppName]" to activate
delay 3

-- Verify state persisted
tell application "System Events"
    tell process "[AppName]"
        set stateAfter to [same value]
        if stateAfter = stateBefore then
            log "✅ PASS: State persisted"
        else
            error "❌ FAIL: State lost — before=" & stateBefore & " after=" & stateAfter
        end if
    end tell
end tell
```

#### Pass Criteria
- [ ] [Specific state value] matches before and after relaunch
- [ ] No data loss

---

## Automation Notes

- **Method**: AppleScript via `osascript`
- **Delays**: `delay 1` after each click, `delay 3` after launch/quit
- **Process name**: Verify with `ps aux | grep -i [appname]`
- **Element selectors**: Always name-based (`button "Save"`) not index-based (`button 1`)
- **Test isolation**: Quit and relaunch app between scenarios for clean state

---

## Known Issues & Bugs

| Bug ID | Description | Status | Workaround |
|--------|-------------|--------|-----------|
| — | — | — | — |

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| [YYYY-MM-DD] | QA Agent | Initial generation from UI exploration |
