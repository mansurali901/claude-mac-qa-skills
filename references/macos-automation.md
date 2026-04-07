# macOS Automation Reference

Deep reference for exploring and interacting with native macOS apps using AppleScript, osascript, and the Accessibility API.

## Table of Contents
1. [Permission Setup](#1-permission-setup)
2. [App Discovery](#2-app-discovery)
3. [Launching Apps](#3-launching-apps)
4. [Window & UI Discovery](#4-window--ui-discovery)
5. [Interacting with UI Elements](#5-interacting-with-ui-elements)
6. [Menu Bar Apps](#6-menu-bar-apps)
7. [Screenshots & Evidence](#7-screenshots--evidence)
8. [Reading App State](#8-reading-app-state)
9. [Flow Documentation Format](#9-flow-documentation-format)
10. [Common Patterns by App Type](#10-common-patterns-by-app-type)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Permission Setup

Before any automation, verify and request Accessibility permissions.

```bash
# Check if osascript can see processes (basic accessibility check)
osascript -e 'tell application "System Events" to get name of every process' 2>&1 | head -5

# If permission denied, guide user:
echo "Please grant Accessibility access:"
echo "System Settings → Privacy & Security → Accessibility → Enable Terminal"
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
```

**Important**: Claude Code running in Terminal inherits Terminal's accessibility permissions. If running from an IDE, that IDE needs the permission instead.

---

## 2. App Discovery

### Find Any Installed App

```bash
APP_NAME="PureVPN"  # Change to target app

# Method 1: Direct path check
ls "/Applications/${APP_NAME}.app" 2>/dev/null && echo "Found in /Applications"
ls "$HOME/Applications/${APP_NAME}.app" 2>/dev/null && echo "Found in ~/Applications"

# Method 2: Spotlight search (finds anywhere on system)
mdfind "kMDItemKind == 'Application'" | grep -i "$APP_NAME"

# Method 3: system_profiler (comprehensive)
system_profiler SPApplicationsDataType | grep -A5 -i "$APP_NAME"
```

### Get App Bundle ID and Version

```bash
APP_PATH="/Applications/PureVPN.app"

# Bundle ID (needed for some osascript commands)
/usr/libexec/PlistBuddy -c "Print CFBundleIdentifier" "$APP_PATH/Contents/Info.plist"

# App Version
/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$APP_PATH/Contents/Info.plist"

# Build number
/usr/libexec/PlistBuddy -c "Print CFBundleVersion" "$APP_PATH/Contents/Info.plist"

# All at once
python3 -c "
import plistlib, sys
path = sys.argv[1] + '/Contents/Info.plist'
with open(path, 'rb') as f:
    p = plistlib.load(f)
print('Name:', p.get('CFBundleName', 'N/A'))
print('Bundle ID:', p.get('CFBundleIdentifier', 'N/A'))
print('Version:', p.get('CFBundleShortVersionString', 'N/A'))
print('Build:', p.get('CFBundleVersion', 'N/A'))
print('Min macOS:', p.get('LSMinimumSystemVersion', 'N/A'))
" "$APP_PATH"
```

### Check If App Is Running

```bash
# By process name
pgrep -x "PureVPN" && echo "Running" || echo "Not running"

# Via AppleScript
osascript -e 'tell application "System Events" to (name of every process) contains "PureVPN"'
```

---

## 3. Launching Apps

### Simple Launch

```bash
# Method 1: open command (recommended for most apps)
open -a "PureVPN"
sleep 3  # Give time to start

# Method 2: AppleScript
osascript -e 'tell application "PureVPN" to activate'

# Method 3: by bundle ID (most reliable, avoids name ambiguity)
open -b "com.purevpn.macosvpn"
```

### Launch and Wait for Window

```applescript
-- Launch and wait for main window to appear
tell application "PureVPN"
    activate
end tell

-- Poll until window exists (max 10s)
set maxWait to 10
set waited to 0
repeat
    tell application "System Events"
        tell process "PureVPN"
            if (count of windows) > 0 then
                exit repeat
            end if
        end tell
    end tell
    delay 1
    set waited to waited + 1
    if waited ≥ maxWait then
        error "App window did not appear after " & maxWait & " seconds"
    end if
end repeat

log "✅ App window ready"
```

Run as:
```bash
osascript << 'EOF'
[paste applescript above]
EOF
```

### Quit App Cleanly

```bash
# Graceful quit
osascript -e 'tell application "PureVPN" to quit'
sleep 1

# Force quit if needed
osascript -e 'tell application "System Events" to set quitMessage to ""
tell application "PureVPN" to quit saving no'

# Nuclear option (last resort)
pkill -x "PureVPN"
```

---

## 4. Window & UI Discovery

### List All Windows

```applescript
tell application "System Events"
    tell process "PureVPN"
        set allWindows to {}
        repeat with w in windows
            set end of allWindows to {¬
                name of w, ¬
                position of w, ¬
                size of w, ¬
                (count of UI elements of w) ¬
            }
        end repeat
        return allWindows
    end tell
end tell
```

### Deep UI Element Dump (Full Window)

```applescript
-- Dumps all UI elements with their properties
on dumpElement(el, depth)
    set indent to ""
    repeat depth times
        set indent to indent & "  "
    end repeat
    
    try
        set elClass to class of el as string
        set elDesc to ""
        try
            set elDesc to description of el
        end try
        set elName to ""
        try
            set elName to name of el
        end try
        set elValue to ""
        try
            set elValue to value of el as string
        end try
        
        log indent & "[" & elClass & "] name=" & elName & " desc=" & elDesc & " value=" & elValue
        
        -- Recurse into children
        set children to UI elements of el
        repeat with child in children
            my dumpElement(child, depth + 1)
        end repeat
    end try
end dumpElement

tell application "System Events"
    tell process "PureVPN"
        tell window 1
            my dumpElement(it, 0)
        end tell
    end tell
end tell
```

### Targeted Element Discovery (Faster)

```applescript
tell application "System Events"
    tell process "PureVPN"
        tell window 1
            -- Buttons
            set btnNames to {}
            repeat with b in buttons
                try
                    set end of btnNames to name of b
                end try
            end repeat
            
            -- Text fields
            set fieldDescs to {}
            repeat with f in text fields
                try
                    set end of fieldDescs to description of f
                end try
            end repeat
            
            -- Static text (labels)
            set labels to {}
            repeat with t in static texts
                try
                    if length of (value of t as string) > 0 then
                        set end of labels to value of t as string
                    end if
                end try
            end repeat
            
            -- Tab groups
            set tabNames to {}
            try
                repeat with tg in tab groups
                    repeat with tab in tabs of tg
                        set end of tabNames to name of tab
                    end repeat
                end repeat
            end try
            
            return {buttons:btnNames, textFields:fieldDescs, labels:labels, tabs:tabNames}
        end tell
    end tell
end tell
```

---

## 5. Interacting with UI Elements

### Click a Button by Name

```applescript
tell application "System Events"
    tell process "PureVPN"
        -- Click by name
        click button "Connect" of window 1
        delay 1
        
        -- Click by description (when name is empty)
        click button 1 of window 1 whose description is "Connect button"
    end tell
end tell
```

### Type into a Text Field

```applescript
tell application "System Events"
    tell process "PureVPN"
        -- Click to focus, then type
        set theField to text field 1 of window 1
        click theField
        delay 0.3
        
        -- Clear existing content
        keystroke "a" using command down
        delay 0.1
        key code 51  -- Delete
        
        -- Type new value
        keystroke "test@example.com"
    end tell
end tell
```

### Navigate Tabs

```applescript
tell application "System Events"
    tell process "PureVPN"
        tell window 1
            tell tab group 1
                -- Click a named tab
                click tab "Settings"
                delay 0.5
            end tell
        end tell
    end tell
end tell
```

### Select from Dropdown / Popup Button

```applescript
tell application "System Events"
    tell process "PureVPN"
        tell window 1
            -- Open the popup
            click pop up button 1
            delay 0.3
            -- Select item
            click menu item "United States" of menu 1 of pop up button 1
        end tell
    end tell
end tell
```

### Use Keyboard Shortcuts

```applescript
tell application "System Events"
    -- Cmd+Q: Quit
    keystroke "q" using command down
    
    -- Cmd+,: Open Preferences
    keystroke "," using command down
    
    -- Escape: Dismiss
    key code 53
    
    -- Tab: Navigate fields
    key code 48
    
    -- Enter/Return: Confirm
    key code 36
end tell
```

---

## 6. Menu Bar Apps

Many macOS apps live in the menu bar (top-right) instead of (or in addition to) the Dock.

### Detect Menu Bar App

```applescript
tell application "System Events"
    -- Check if app has menu bar extra (lives in status bar)
    set menuBarExtras to name of every menu bar item of menu bar 2 of process "PureVPN"
    return menuBarExtras
end tell
```

### Click Menu Bar Icon

```applescript
tell application "System Events"
    tell process "PureVPN"
        -- Menu bar 1 = app's own menu bar (when app is frontmost)
        -- Menu bar 2 = system status bar (top right)
        
        -- Click the app's status bar icon
        tell menu bar item 1 of menu bar 2
            click
            delay 0.5
        end tell
    end tell
end tell
```

### Explore Menu Bar Dropdown

```applescript
tell application "System Events"
    tell process "PureVPN"
        -- Click menu bar icon to reveal dropdown
        click menu bar item 1 of menu bar 2
        delay 0.5
        
        -- Get all items in the dropdown
        set dropdownItems to name of every menu item of menu 1 of menu bar item 1 of menu bar 2
        return dropdownItems
    end tell
end tell
```

---

## 7. Screenshots & Evidence

### Capture Full Screen

```bash
# Full screen
screencapture -x /tmp/qa-screenshot-$(date +%Y%m%d-%H%M%S).png

# With a delay (gives time to set up state)
screencapture -T 2 -x /tmp/qa-screenshot.png
```

### Capture Specific Window

```bash
# Capture frontmost window
screencapture -x -l $(osascript -e 'tell app "PureVPN" to id of window 1') /tmp/qa-window.png
```

### Save Evidence to QA Folder

```bash
# Create evidence folder
mkdir -p qa/evidence/$(date +%Y-%m-%d)

# Capture with test case reference
screencapture -x "qa/evidence/$(date +%Y-%m-%d)/TC-001-failure.png"
```

---

## 8. Reading App State

### Check if Connected / Active (for apps with state)

```applescript
-- Read visible text/labels to infer state
tell application "System Events"
    tell process "PureVPN"
        tell window 1
            -- Get all visible text
            set allText to {}
            repeat with t in static texts
                try
                    set end of allText to value of t as string
                end try
            end repeat
            return allText
        end tell
    end tell
end tell
```

### Read Value of a Field

```applescript
tell application "System Events"
    tell process "PureVPN"
        set fieldValue to value of text field 1 of window 1
        return fieldValue
    end tell
end tell
```

### Check Button State (enabled/disabled)

```applescript
tell application "System Events"
    tell process "PureVPN"
        set isEnabled to enabled of button "Connect" of window 1
        return isEnabled  -- true or false
    end tell
end tell
```

### Check Checkbox State

```applescript
tell application "System Events"
    tell process "PureVPN"
        set checkState to value of checkbox "Auto-connect" of window 1
        -- 0 = unchecked, 1 = checked
        return checkState
    end tell
end tell
```

---

## 9. Flow Documentation Format

When writing discovered flows into `qa/knowledgebase/flows.md`, use this format:

```markdown
## F-[NNN]: [Flow Name]

**Description**: [One sentence]
**App State at Start**: [e.g., "App launched, no user logged in"]
**Window/Panel**: [e.g., "Main window", "Preferences > General tab"]
**Priority**: P1 / P2 / P3
**Discovered via**: AppleScript UI exploration / Manual observation

### UI Elements Involved
| Element Type | Name/Description | Role |
|-------------|-----------------|------|
| Button | "Connect" | Initiates VPN connection |
| Static Text | "Status: Disconnected" | Shows current state |
| Pop-up Button | Server location dropdown | Selects VPN server |

### Steps
1. [Observable user action]
2. [System response]
3. [Next user action]
...

### Expected Outcome
[What the UI shows when the flow completes successfully]

### AppleScript Skeleton
```applescript
-- [Brief AppleScript that navigates this flow]
tell application "System Events"
    tell process "[AppName]"
        -- Step 1
        click button "[name]" of window 1
        delay 1
        -- Step 2
        -- ...
    end tell
end tell
```

### Known Issues / Observations
- [Anything unusual noticed during exploration]
```

---

## 10. Common Patterns by App Type

### VPN Apps (e.g., PureVPN, NordVPN, ExpressVPN)

Typical flows to discover:
- Connect / Disconnect toggle
- Server/country selection
- Protocol selection (OpenVPN, WireGuard, etc.)
- Auto-connect on startup setting
- Kill switch setting
- Split tunneling
- Account info / subscription status
- Preferences window tabs

Key UI patterns:
- Usually a menu bar app + main window
- Connection status shown as text label + icon color change
- Connect button state changes (enabled when disconnected, shows "Disconnect" when connected)

```applescript
-- Check connection status for VPN app
tell application "System Events"
    tell process "PureVPN"
        -- Look for status indicator
        set statusLabels to value of static texts of window 1
        -- Usually contains "Connected", "Disconnected", "Connecting..."
        return statusLabels
    end tell
end tell
```

### Settings-Heavy Apps

For apps with a Preferences window:
```applescript
-- Open preferences
tell application "[AppName]"
    activate
end tell
tell application "System Events"
    keystroke "," using command down  -- Cmd+, opens preferences
    delay 1
end tell

-- Then discover all tabs in preferences
tell application "System Events"
    tell process "[AppName]"
        tell window 1  -- or window "Preferences"
            set prefTabs to name of tabs of tab group 1
            return prefTabs
        end tell
    end tell
end tell
```

---

## 11. Troubleshooting

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| `System Events got an error: osascript is not allowed to send keystrokes` | Accessibility not granted | System Settings → Privacy & Security → Accessibility → Enable Terminal |
| `Can't get window 1 of process "X"` | App is a menu bar-only app | Look in `menu bar 2` instead |
| `Button not found` | Name changed, or element is in a sub-view | Use full UI dump to re-discover |
| AppleScript times out | UI is slow to respond | Increase `delay` values |
| App asks for password during test | Keychain access triggered | Pre-grant keychain access or handle dialog in preconditions |
| `Application isn't running` | App name mismatch | Use `osascript -e 'tell application "System Events" to name of every process'` to find exact name |

### Finding the Exact Process Name

```bash
# List all running app processes
osascript -e 'tell application "System Events" to get name of every process whose background only is false'

# Or via ps
ps aux | grep -v grep | grep -i "purevpn"
```

### Debug UI Tree to Console

```bash
# Dump full UI tree (install Accessibility Inspector from Xcode, or use this)
osascript << 'EOF'
tell application "System Events"
    tell process "PureVPN"
        tell window 1
            return entire contents
        end tell
    end tell
end tell
EOF
```
