# macOS Automation Reference — macOS Skill

> Full reference: [`references/macos-automation.md`](../../../references/macos-automation.md) at project root.
> This file is the skill-local index. The complete AppleScript recipe library is in the root references directory.

---

## Quick Index

| Topic | Location |
|-------|---------|
| Permission setup | Root `references/macos-automation.md` §1 |
| App discovery (`mdfind`, plist) | Root `references/macos-automation.md` §2 |
| Launching and quitting apps | Root `references/macos-automation.md` §3 |
| Window & UI element enumeration | Root `references/macos-automation.md` §4 |
| Clicking, typing, keyboard shortcuts | Root `references/macos-automation.md` §5 |
| Menu bar apps | Root `references/macos-automation.md` §6 |
| Screenshots & evidence | Root `references/macos-automation.md` §7 |
| Reading app state | Root `references/macos-automation.md` §8 |
| Flow documentation format | Root `references/macos-automation.md` §9 |
| Common patterns by app type | Root `references/macos-automation.md` §10 |
| Troubleshooting | Root `references/macos-automation.md` §11 |

---

## Essential Snippets (Most-Used)

### Check Accessibility Permission
```bash
osascript -e 'tell application "System Events" to get name of every process' > /dev/null 2>&1 \
  && echo "✅ Accessibility OK" \
  || echo "❌ BLOCKED — System Settings → Privacy & Security → Accessibility → Terminal"
```

### Launch App + Wait
```bash
osascript -e 'tell application "[AppName]" to quit' 2>/dev/null; sleep 2
open -a "[AppName]"; sleep 4
osascript -e 'tell application "[AppName]" to activate'; sleep 1
```

### Take Evidence Screenshot
```bash
screencapture -x qa/evidence/TC-NNN-S1-pass.png
```

### Click a Button
```applescript
tell application "System Events"
    tell process "[AppName]"
        click button "[ButtonName]" of window 1
        delay 1
    end tell
end tell
```

### Navigate Menu
```applescript
tell application "System Events"
    tell process "[AppName]"
        click menu bar item "File" of menu bar 1
        delay 0.5
        click menu item "Save" of menu "File" of menu bar item "File" of menu bar 1
        delay 1
    end tell
end tell
```

### Assert Element Exists
```applescript
tell application "System Events"
    tell process "[AppName]"
        if exists button "Save" of window 1 then
            log "✅ PASS: Save button found"
        else
            error "❌ FAIL: Save button not found"
        end if
    end tell
end tell
```

### Capture on Failure
```applescript
-- Always capture evidence on failure
on error errMsg
    do shell script "screencapture -x qa/evidence/TC-NNN-fail.png"
    error errMsg
end try
```

---

> For the complete reference with all patterns, see [`../../../references/macos-automation.md`](../../../references/macos-automation.md)
