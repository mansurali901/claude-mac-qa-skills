# Native App Test Patterns

Scenario patterns for native macOS app testing, organized by flow type.

## Table of Contents
1. [App Launch & Lifecycle](#1-app-launch--lifecycle)
2. [Authentication Flows](#2-authentication-flows)
3. [Core Feature Flows](#3-core-feature-flows)
4. [Settings & Preferences](#4-settings--preferences)
5. [Menu Bar App Patterns](#5-menu-bar-app-patterns)
6. [Error & Offline States](#6-error--offline-states)
7. [State Persistence](#7-state-persistence)
8. [VPN-Specific Patterns](#8-vpn-specific-patterns)

---

## 1. App Launch & Lifecycle

### Always include these scenarios:

| Scenario | Steps | Pass Criteria |
|----------|-------|--------------|
| Cold launch | Quit app fully → relaunch | Main window appears within 5s, no crash |
| Warm launch (reactivate) | Hide app → click Dock icon | Window comes to front, state preserved |
| Launch after system restart | Restart mac → open app | App launches cleanly, no data loss |
| Launch with login item | Enable "Launch at login" → restart | App in menu bar / dock on startup |
| Launch when already running | Double-click .app while running | Focus existing window, no duplicate |

### AppleScript for cold launch test:
```applescript
-- Quit
tell application "PureVPN" to quit
delay 2

-- Verify quit
tell application "System Events"
    if exists process "PureVPN" then
        error "App did not quit cleanly"
    end if
end tell

-- Relaunch
tell application "PureVPN" to activate
delay 3

-- Verify window
tell application "System Events"
    tell process "PureVPN"
        if (count of windows) = 0 then
            error "No window after relaunch"
        end if
        log "✅ Window appeared: " & name of window 1
    end tell
end tell
```

---

## 2. Authentication Flows

### Login

| Scenario | Input | Expected |
|----------|-------|---------|
| Valid credentials | Correct email + password | Logged in, home screen shown |
| Wrong password | Correct email + wrong password | Error message, NOT logged in |
| Non-existent account | Unknown email | Generic error (no user enumeration) |
| Empty email | `""` + any password | "Email required" validation |
| Empty password | Email + `""` | "Password required" validation |
| Very long input | 500-char email | Field truncates or rejects |
| Special characters | `test+qa@example.com` | Accepted and works |
| Remember me | Toggle "Remember me" + login → relaunch | Session persists after relaunch |

### Logout

| Scenario | Steps | Expected |
|----------|-------|---------|
| Standard logout | Menu → Sign Out | Logged out, login screen shown |
| Logout and relaunch | Logout → quit → relaunch | Shows login screen (not auto-logged in) |
| Logout mid-connection (VPN) | Connect VPN → logout | VPN disconnected, then logged out |

---

## 3. Core Feature Flows

For each primary feature, generate these scenario categories:

### Happy Path
- User has all prerequisites met
- Performs main action
- Expected outcome is reached
- UI reflects the new state

### Negative Path
- User is missing prerequisites (not connected, not logged in)
- UI shows appropriate disabled state or error
- Error message is clear and actionable

### Interrupted Action
- Start an action → interrupt it (switch windows, receive system alert)
- Return to app → action is either completed or safely cancelled
- No data corruption

### Rapid Actions
- Trigger the same action twice quickly (double-click)
- UI handles gracefully (no duplicate operations, no crash)

---

## 4. Settings & Preferences

### For every settings/preferences panel:

| Scenario | Steps | Expected |
|----------|-------|---------|
| Open preferences | Cmd+, | Preferences window opens |
| Navigate all tabs | Click each tab | Tab content loads, no crash |
| Change a setting | Toggle/change any option | Setting visually reflects new state |
| Setting persists | Change → quit → relaunch | Setting value preserved |
| Reset to default | Use "Reset" if available | All settings back to default |
| Cancel changes | Change setting → close without saving | Original value restored |

### AppleScript for settings persistence test:
```applescript
-- Open preferences
tell application "System Events"
    keystroke "," using command down
    delay 1
end tell

-- Read current value of a checkbox
tell application "System Events"
    tell process "PureVPN"
        set originalValue to value of checkbox 1 of window "Preferences"
        -- Toggle it
        click checkbox 1 of window "Preferences"
        delay 0.5
        set newValue to value of checkbox 1 of window "Preferences"
        log "Changed from " & originalValue & " to " & newValue
    end tell
end tell

-- Quit and relaunch
tell application "PureVPN" to quit
delay 2
tell application "PureVPN" to activate
delay 3

-- Open preferences again and verify value persisted
tell application "System Events"
    keystroke "," using command down
    delay 1
    tell process "PureVPN"
        set persistedValue to value of checkbox 1 of window "Preferences"
        if persistedValue = newValue then
            log "✅ Setting persisted correctly"
        else
            error "❌ Setting reverted — persistence failed"
        end if
    end tell
end tell
```

---

## 5. Menu Bar App Patterns

For apps that live in the macOS menu bar (status bar, top right):

| Scenario | Steps | Expected |
|----------|-------|---------|
| Menu bar icon visible | Launch app | Icon appears in status bar |
| Click to open | Click menu bar icon | Dropdown / popover appears |
| Status reflected in icon | Connect VPN → check icon | Icon color/image changes to reflect state |
| Right-click | Right-click menu bar icon | Context menu with options appears |
| Open main window from menu | Click menu bar → "Open [App]" | Full app window opens |
| Quit from menu | Click menu bar → Quit | App fully quits, icon disappears |

### AppleScript for menu bar interaction:
```applescript
tell application "System Events"
    tell process "PureVPN"
        -- Click menu bar icon
        tell menu bar item 1 of menu bar 2
            click
            delay 0.5
            
            -- Get all visible menu items
            set items to name of every menu item of menu 1
            log "Menu items: " & items
            
            -- Dismiss
            key code 53  -- Escape
        end tell
    end tell
end tell
```

---

## 6. Error & Offline States

### Network Offline

| Scenario | How to Simulate | Expected |
|----------|----------------|---------|
| No internet during action | Turn off Wi-Fi → perform action | Clear offline error message |
| Connection dropped mid-action | Disconnect Wi-Fi during operation | Graceful failure, not crash |
| Reconnect after offline | Re-enable Wi-Fi | App recovers automatically or prompts retry |

```bash
# Disable Wi-Fi (use with care — re-enable after test!)
networksetup -setairportpower en0 off
sleep 2
# ... perform test ...
networksetup -setairportpower en0 on
```

### Server Errors

| Scenario | Expected |
|----------|---------|
| API returns 500 | User-friendly error, not raw error code |
| API timeout | Timeout message, retry option |
| Invalid session | Prompt to log in again, graceful session expiry |

### App-Level Errors

| Scenario | Expected |
|----------|---------|
| Feature not available in account tier | Upgrade prompt, not crash |
| Missing required permission | Clear permission request, not silent failure |
| Corrupted local data | Recovery flow or clean reset, not crash |

---

## 7. State Persistence

### What Should Persist Across Relaunches

| State | Should Persist? | How to Test |
|-------|---------------|-------------|
| Login session | Yes | Login → quit → relaunch → still logged in |
| Last selected server (VPN) | Yes | Select server → quit → relaunch → same server selected |
| User preferences | Yes | Change setting → quit → relaunch → setting preserved |
| Window position/size | Yes | Resize window → quit → relaunch → same size |
| Pending/in-progress actions | App-dependent | Start action → force quit → relaunch → handled gracefully |

### AppleScript state check template:
```applescript
-- Record state before quit
tell application "System Events"
    tell process "[AppName]"
        set stateBefore to [read relevant value]
    end tell
end tell

-- Quit and relaunch
tell application "[AppName]" to quit
delay 2
tell application "[AppName]" to activate
delay 3

-- Check state after relaunch
tell application "System Events"
    tell process "[AppName]"
        set stateAfter to [read same value]
        if stateAfter = stateBefore then
            log "✅ State persisted"
        else
            error "❌ State lost on relaunch"
        end if
    end tell
end tell
```

---

## 8. App-Category-Specific Patterns

### VPN Apps (e.g., PureVPN, NordVPN, ExpressVPN)

For VPN applications:

### Connection Flows

| Scenario | Steps | Expected |
|----------|-------|---------|
| Connect to default server | Click "Connect" | Status changes to "Connecting..." then "Connected" |
| Connect to specific country | Select country → Connect | Connected to selected country |
| Disconnect | Click "Disconnect" | Status back to "Disconnected" within 5s |
| Reconnect after disconnect | Connect → Disconnect → Connect | Second connection succeeds |
| Auto-reconnect on drop | Simulate network drop | App reconnects automatically (if enabled) |
| Connect while already connected | (Edge case) | Graceful: already connected message or re-routes |

### Protocol Selection

| Scenario | Expected |
|----------|---------|
| Change protocol while disconnected | Setting saved, connects with new protocol |
| Change protocol while connected | May reconnect automatically or prompt |
| Each protocol option connects | Test each protocol individually |

### Kill Switch

| Scenario | Steps | Expected |
|----------|-------|---------|
| Kill switch enabled | Enable kill switch → disconnect VPN | Internet blocked until VPN reconnects |
| Kill switch disabled | Disable kill switch → disconnect | Internet remains available |
| Kill switch setting persists | Enable → quit → relaunch | Still enabled |

### IP / DNS Verification

```bash
# Before connecting — record original IP
curl -s https://api.ipify.org

# After connecting — verify IP changed
curl -s https://api.ipify.org

# Verify DNS isn't leaking
curl -s https://dns.google/resolve?name=example.com&type=A
```

### AppleScript Connect/Status Check:
```applescript
-- Click Connect button
tell application "System Events"
    tell process "PureVPN"
        click button "Connect" of window 1
        delay 2
        
        -- Poll for connected status (max 30s)
        set maxWait to 30
        set waited to 0
        repeat
            set statusTexts to value of static texts of window 1
            repeat with t in statusTexts
                if t contains "Connected" then
                    log "✅ VPN Connected after " & waited & "s"
                    return
                end if
            end repeat
            delay 1
            set waited to waited + 1
            if waited ≥ maxWait then
                error "❌ VPN did not connect within " & maxWait & "s"
            end if
        end repeat
    end tell
end tell
```

---

### Productivity / Document Apps (e.g., text editors, note apps)

Typical flows:
- Create / open / save / close document
- Undo / redo chain
- Export to different formats
- Find and replace
- Print / share

Key scenarios:
| Scenario | Expected |
|----------|---------|
| Unsaved changes on quit | "Save changes?" dialog — not silently discarded |
| Auto-save recovery | After force-quit → reopen → document recovered |
| Large document performance | No freeze or crash with large content |
| Concurrent edits (if sync) | No data loss on conflict |

---

### Communication Apps (e.g., Slack, Messages, email clients)

Typical flows:
- Send / receive message
- Notifications (permission grant, badge count)
- Search messages
- Attachments

Key scenarios:
| Scenario | Expected |
|----------|---------|
| Send with no network | Queued or clear error — not silently dropped |
| Notification permission denied | App handles gracefully without crash |
| Very long message | Accepted and displayed or truncated with indication |

---

### Media / Player Apps

Typical flows:
- Open / play / pause / stop
- Volume and playback controls
- Playback position persistence

Key scenarios:
| Scenario | Expected |
|----------|---------|
| Unsupported file format | Clear error, not crash |
| Playback position on relaunch | Resumes from last position (if applicable) |
| System audio change mid-play | Handles output device switch gracefully |
