# Application Flows — PureVPN macOS

> Discovered by QA Agent via AppleScript UI exploration on 2025-01-15
> App version: 9.x | macOS: 14.x Sonoma | Architecture: arm64

---

## Flows Index

| ID | Flow Name | Priority | Window/Panel | Test Case |
|----|-----------|----------|-------------|-----------|
| F-001 | App Launch & Initial State | P1 | Main Window | TC-001 |
| F-002 | User Login | P1 | Login Screen | TC-002 |
| F-003 | User Logout | P1 | Account Panel | TC-002 |
| F-004 | Connect to VPN (Quick Connect) | P1 | Main Window | TC-003 |
| F-005 | Connect to Specific Country/Server | P1 | Location List | TC-003 |
| F-006 | Disconnect VPN | P1 | Main Window | TC-003 |
| F-007 | Change VPN Protocol | P2 | Preferences > Protocol | TC-004 |
| F-008 | Enable/Disable Kill Switch | P2 | Preferences > Security | TC-004 |
| F-009 | Enable Auto-connect | P2 | Preferences > General | TC-004 |
| F-010 | View Connection Logs | P3 | Preferences > Logs | TC-005 |
| F-011 | Contact Support | P3 | Help Menu | TC-005 |
| F-012 | Offline / No Internet | P2 | Main Window | TC-006 |

---

## F-001: App Launch & Initial State

**Description**: PureVPN launches and shows connection status  
**App State at Start**: App fully quit  
**Window/Panel**: Main Window + Menu Bar icon  
**Priority**: P1

### UI Elements Involved
| Element Type | Name/Description | Role |
|-------------|-----------------|------|
| Static Text | "Disconnected" / "Connected" | Shows VPN status |
| Button | "Connect" / "Quick Connect" | Initiates connection |
| Pop-up / Dropdown | Server/Country selector | Chooses VPN endpoint |
| Menu Bar Icon | PureVPN icon (changes color) | Status at a glance |

### Steps
1. User opens PureVPN from Applications or Dock
2. App appears in menu bar (status icon)
3. Main window shows (or opens from menu bar)
4. Status shows current VPN state ("Disconnected" or last state)

### Expected Outcome
Main window visible, status clearly shown, Connect button enabled.

### AppleScript Skeleton
```applescript
tell application "PureVPN" to activate
delay 4
tell application "System Events"
    tell process "PureVPN"
        -- Read status text
        set statusTexts to value of static texts of window 1
        log statusTexts
    end tell
end tell
```

---

## F-002: User Login

**Description**: User authenticates with PureVPN account credentials  
**App State at Start**: App running, not logged in (or fresh install)  
**Window/Panel**: Login Screen  
**Priority**: P1

### UI Elements Involved
| Element Type | Name/Description | Role |
|-------------|-----------------|------|
| Text Field | Email/Username field | Input for credentials |
| Text Field | Password field | Password input (masked) |
| Button | "Login" / "Sign In" | Submits credentials |
| Static Text | Error message area | Shows auth errors |
| Button/Link | "Forgot Password?" | Recovery link |

### Steps
1. Launch PureVPN (not logged in)
2. Login screen shown
3. User enters email and password
4. User clicks "Login"
5. System authenticates (network request)
6. On success: main dashboard shown
7. On failure: error message shown, form stays open

### Expected Outcome
User authenticated, dashboard visible, username shown in account area.

### Known Issues / Observations
- Login may trigger system permission dialog (Keychain) on first run
- Network is required — offline shows appropriate error

---

## F-003: Logout

**Description**: User logs out of PureVPN account  
**App State at Start**: Logged in, VPN disconnected  
**Window/Panel**: Account / Settings panel  
**Priority**: P1

### Steps
1. User navigates to Account or Settings
2. User clicks "Sign Out" / "Logout"
3. System may prompt for confirmation
4. Session cleared
5. Login screen shown

### Expected Outcome
User logged out, login screen shown, no credentials cached.

---

## F-004: Connect to VPN (Quick Connect)

**Description**: User connects to VPN using the fastest available server  
**App State at Start**: Logged in, VPN disconnected  
**Window/Panel**: Main Window  
**Priority**: P1

### UI Elements Involved
| Element Type | Name/Description | Role |
|-------------|-----------------|------|
| Button | "Connect" or "Quick Connect" | Initiates connection |
| Static Text | Status label | Changes: "Disconnected" → "Connecting..." → "Connected" |
| Static Text | Server/IP info | Shows connected server and assigned IP |
| Menu Bar Icon | PureVPN icon | Changes color/state on connection |

### Steps
1. User is on main dashboard (disconnected state)
2. User clicks "Connect" / "Quick Connect"
3. Status label changes to "Connecting..."
4. System establishes VPN tunnel (network activity)
5. Status label changes to "Connected"
6. Server info and new IP shown
7. Menu bar icon changes to indicate connected state

### Expected Outcome
VPN tunnel established, status shows "Connected", IP has changed.

### AppleScript Skeleton
```applescript
tell application "System Events"
    tell process "PureVPN"
        click button "Connect" of window 1
        delay 2
        -- Poll for Connected status
        set waited to 0
        repeat while waited < 30
            set texts to value of static texts of window 1
            repeat with t in texts
                if t contains "Connected" then
                    log "✅ Connected after " & waited & "s"
                    return
                end if
            end repeat
            delay 1
            set waited to waited + 1
        end repeat
        error "Timeout: VPN did not connect"
    end tell
end tell
```

### IP Verification
```bash
# Record IP before connecting
BEFORE_IP=$(curl -s https://api.ipify.org)
echo "Before: $BEFORE_IP"

# [Connect via AppleScript here]

# Verify IP changed
sleep 5
AFTER_IP=$(curl -s https://api.ipify.org)
echo "After: $AFTER_IP"

if [ "$BEFORE_IP" != "$AFTER_IP" ]; then
    echo "✅ IP changed — VPN tunnel confirmed"
else
    echo "❌ IP unchanged — VPN may not be routing traffic"
fi
```

---

## F-005: Connect to Specific Country/Server

**Description**: User selects a specific country or server before connecting  
**App State at Start**: Logged in, disconnected  
**Window/Panel**: Location list / server picker  
**Priority**: P1

### Steps
1. User opens server/location list
2. User searches for or scrolls to target country
3. User selects country or specific server
4. User clicks "Connect"
5. VPN connects to selected server

### Expected Outcome
Connected to user-selected country, server location confirmed.

---

## F-006: Disconnect VPN

**Description**: User disconnects the active VPN tunnel  
**App State at Start**: VPN connected  
**Window/Panel**: Main Window  
**Priority**: P1

### Steps
1. VPN is connected
2. User clicks "Disconnect"
3. Status changes to "Disconnecting..."
4. Status changes to "Disconnected"
5. Original IP restored

---

## F-007: Change VPN Protocol

**Description**: User changes the tunneling protocol  
**App State at Start**: Logged in, disconnected  
**Window/Panel**: Preferences → Protocol  
**Priority**: P2

### Protocols typically available
- WireGuard
- OpenVPN (UDP / TCP)
- IKEv2
- IPSec

### Steps
1. Open Preferences (Cmd+,)
2. Navigate to Protocol tab
3. Select different protocol
4. Close preferences
5. Connect VPN
6. Verify connection uses selected protocol (may check logs)

---

## F-008: Kill Switch

**Description**: Kill switch blocks internet if VPN drops  
**App State at Start**: Logged in, disconnected  
**Window/Panel**: Preferences → Security  
**Priority**: P2

### Steps (Enable)
1. Open Preferences → Security
2. Enable "Kill Switch"
3. Connect VPN
4. Simulate VPN drop (or manually disconnect)
5. Verify internet is blocked while VPN reconnects

### Steps (Disable)
1. Disable Kill Switch in Preferences
2. Connect VPN
3. Disconnect VPN
4. Verify internet remains accessible

---

*Last updated: 2025-01-15 by QA Agent via AppleScript exploration*
