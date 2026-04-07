# TC-001: App Launch & Initial State — PureVPN

## Metadata

| Field | Value |
|-------|-------|
| **Test Case ID** | TC-001 |
| **Application** | PureVPN |
| **Feature** | App Launch & Initial State |
| **Priority** | P1 |
| **Type** | Functional, State |
| **Platform** | macOS 14.x (Sonoma) |
| **Architecture** | arm64 (Apple Silicon) + x86_64 (Intel) |
| **Automation Method** | AppleScript + osascript |
| **Author** | QA Agent |
| **Created** | 2025-01-15 |
| **Flow Reference** | F-001 in `qa/knowledgebase/flows.md` |

---

## Preconditions

- [ ] PureVPN installed at `/Applications/PureVPN.app`
- [ ] macOS Accessibility permission granted for Terminal
- [ ] PureVPN is fully quit (not just hidden) before each scenario
- [ ] Internet connection active
- [ ] Test account credentials in `.env.qa`

### Setup Script

```bash
# Ensure app is quit
osascript -e 'tell application "PureVPN" to quit' 2>/dev/null || true
sleep 2
pgrep -x "PureVPN" > /dev/null && echo "⚠️  Still running, force quitting..." && pkill -x "PureVPN"
sleep 1
echo "✅ App is quit, ready for test"
```

---

## Scenarios

---

### Scenario 1: Happy Path — Cold Launch

**Priority**: P1
**Type**: Functional

#### Steps

| Step | Action | Command | Expected Result |
|------|--------|---------|----------------|
| 1 | Launch PureVPN | `open -a "PureVPN"` | App icon appears in Dock |
| 2 | Wait for window | `sleep 4` | Main window appears |
| 3 | Check window visible | AppleScript check | Window with PureVPN branding visible |
| 4 | Check menu bar icon | AppleScript check | PureVPN icon in status bar |

#### AppleScript

```applescript
-- Launch
tell application "PureVPN" to activate
delay 4

-- Verify main window
tell application "System Events"
    tell process "PureVPN"
        if (count of windows) > 0 then
            log "✅ PASS: Main window visible — " & name of window 1
        else
            -- Check if it's a menu bar-only app
            try
                tell menu bar item 1 of menu bar 2
                    log "✅ Menu bar icon present (menu bar app)"
                end tell
            on error
                error "❌ FAIL: No window and no menu bar icon after launch"
            end try
        end if
    end tell
end tell
```

#### Pass Criteria
- [ ] App launches within 5 seconds
- [ ] Main window OR menu bar icon is visible
- [ ] No crash dialog appears
- [ ] No unexpected permission dialogs block the UI
- [ ] App does not immediately show an error

---

### Scenario 2: Happy Path — Launch When Already Running (Reactivate)

**Priority**: P1
**Type**: Functional

#### Steps

| Step | Action | Command | Expected Result |
|------|--------|---------|----------------|
| 1 | Launch PureVPN | `open -a "PureVPN"` | App running |
| 2 | Hide PureVPN | `Cmd+H` | App hidden, Dock shows it running |
| 3 | Click Dock icon | AppleScript click | Window comes to front |
| 4 | Check window state | Visual check | Window restored, same state as before hiding |

#### AppleScript

```applescript
-- Launch and hide
tell application "PureVPN" to activate
delay 3
tell application "System Events"
    keystroke "h" using command down  -- Hide
    delay 1
end tell

-- Reactivate via Dock
tell application "PureVPN" to activate
delay 1

-- Verify frontmost
tell application "System Events"
    if frontmost of process "PureVPN" then
        log "✅ PASS: PureVPN is frontmost after reactivation"
    else
        error "❌ FAIL: PureVPN not frontmost after reactivation"
    end if
end tell
```

#### Pass Criteria
- [ ] App comes to front without restarting
- [ ] UI state preserved (same screen as before hiding)
- [ ] No duplicate windows

---

### Scenario 3: Happy Path — Launch at Login (Login Item)

**Priority**: P2
**Type**: Functional, State

#### Steps

| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Open PureVPN Preferences | Preferences window opens |
| 2 | Enable "Launch at Login" | Checkbox checked, setting saved |
| 3 | Quit PureVPN | App quits cleanly |
| 4 | Log out and back in to macOS | — |
| 5 | Check if PureVPN launched | PureVPN icon in menu bar or window visible |

#### Pass Criteria
- [ ] "Launch at Login" setting persists after quit
- [ ] App appears in Login Items (System Settings → General → Login Items)
- [ ] App launches automatically on next login

#### Note
> Step 4 requires a manual macOS logout — cannot be automated with AppleScript alone. Mark as **Manual Test**.

---

### Scenario 4: Negative — Launch When Installation is Corrupt

**Priority**: P3
**Type**: Error Handling

> ⚠️ **Do not actually corrupt the installation.** This scenario tests the installer's recovery path.

#### Steps

| Step | Action | Expected |
|------|--------|---------|
| 1 | Attempt to open a missing binary | Descriptive error from macOS | 
| 2 | Re-install from DMG | Clean installation succeeds |
| 3 | Launch after reinstall | App launches cleanly |

---

### Scenario 5: Edge Case — Rapid Relaunch

**Priority**: P3
**Type**: Edge Case

#### Steps

| Step | Action | Command | Expected |
|------|--------|---------|---------|
| 1 | Launch PureVPN | `open -a "PureVPN"` | Launching |
| 2 | Immediately quit | AppleScript quit | Quit during startup |
| 3 | Immediately relaunch | `open -a "PureVPN"` | Clean launch |

#### AppleScript

```applescript
-- Launch
tell application "PureVPN" to activate
delay 1  -- Short delay (not full load)

-- Quit mid-load
tell application "PureVPN" to quit
delay 2

-- Relaunch
tell application "PureVPN" to activate
delay 4

-- Verify clean state
tell application "System Events"
    tell process "PureVPN"
        if (count of windows) > 0 then
            log "✅ PASS: Clean relaunch after mid-load quit"
        end if
    end tell
end tell
```

#### Pass Criteria
- [ ] App doesn't get stuck in a bad state
- [ ] Second launch succeeds normally
- [ ] No data corruption from interrupted first launch

---

## Automation Notes

- **Process name**: Verify with `ps aux | grep -i purevpn` — may differ from app name
- **Menu bar**: PureVPN is likely a menu bar app; if no `window 1` found, check `menu bar 2`
- **Delay tuning**: Increase `delay` if tests are flaky on slower machines
- **Accessibility**: Required — check with `osascript -e 'tell app "System Events" to name of every process'`

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2025-01-15 | QA Agent | Initial generation from UI exploration |
