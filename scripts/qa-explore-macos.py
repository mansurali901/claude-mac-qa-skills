#!/usr/bin/env python3
"""
qa-explore-macos.py
Explores a macOS application's UI using AppleScript via osascript.
Outputs a structured JSON of discovered UI elements, flows, and screenshots.

Usage:
    python3 qa-explore-macos.py --app "AppName" --output qa/knowledgebase/
    python3 qa-explore-macos.py --app "AppName" --output qa/knowledgebase/ --screenshot
    python3 qa-explore-macos.py --app "AppName" --output qa/knowledgebase/ --no-launch
"""

import subprocess
import json
import sys
import os
import time
import argparse
from datetime import datetime
from typing import Optional, Tuple

def capture_screenshot(label: str, output_dir: str) -> Optional[str]:
    """Capture a screenshot of the current screen. Returns the file path or None on failure."""
    screenshots_dir = os.path.join(output_dir, "screenshots")
    os.makedirs(screenshots_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%H%M%S")
    filename = f"{label}-{timestamp}.png"
    path = os.path.join(screenshots_dir, filename)
    result = subprocess.run(
        ["screencapture", "-x", path],
        capture_output=True, text=True
    )
    if result.returncode == 0 and os.path.exists(path):
        print(f"📸 Screenshot: {path}")
        return path
    print(f"⚠️  Screenshot failed: {result.stderr.strip()}")
    return None


def run_applescript(script: str) -> Tuple[str, str, int]:
    """Run an AppleScript and return (stdout, stderr, returncode)."""
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True,
        text=True,
        timeout=30
    )
    return result.stdout.strip(), result.stderr.strip(), result.returncode

def check_accessibility() -> bool:
    """Check if we have accessibility permissions."""
    out, err, code = run_applescript(
        'tell application "System Events" to get name of every process'
    )
    if code != 0:
        print("❌ Accessibility permission not granted.")
        print("   → System Settings → Privacy & Security → Accessibility → Enable Terminal")
        return False
    print("✅ Accessibility permission OK")
    return True

def check_app_running(app_name: str) -> bool:
    """Check if the app is currently running."""
    out, _, code = run_applescript(
        f'tell application "System Events" to (name of every process) contains "{app_name}"'
    )
    return "true" in out.lower()

def launch_app(app_name: str, wait_seconds: int = 4) -> bool:
    """Launch the app and wait for it to be ready."""
    print(f"🚀 Launching {app_name}...")
    _, err, code = run_applescript(f'tell application "{app_name}" to activate')
    if code != 0:
        print(f"❌ Failed to launch: {err}")
        return False
    time.sleep(wait_seconds)
    running = check_app_running(app_name)
    if running:
        print(f"✅ {app_name} is running")
    else:
        print(f"❌ {app_name} did not start")
    return running

def get_windows(app_name: str) -> list:
    """Get list of windows with names and sizes."""
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
end tell
'''
    out, err, code = run_applescript(script)
    if code != 0:
        # App might be menu bar only
        return []
    windows = []
    for line in out.split(","):
        line = line.strip().strip('"').strip("{").strip("}")
        if "|" in line:
            parts = line.split("|")
            windows.append({
                "name": parts[0].strip(),
                "position": parts[1].strip() if len(parts) > 1 else "",
                "size": parts[2].strip() if len(parts) > 2 else ""
            })
    return windows

def get_ui_elements(app_name: str, window_index: int = 1) -> dict:
    """Get all UI elements from a window."""
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
end tell
'''
    out, err, code = run_applescript(script)
    
    elements = {
        "buttons": [],
        "text_fields": [],
        "labels": [],
        "checkboxes": [],
        "popups": [],
        "tabs": [],
        "raw": out
    }
    
    if "ERROR:" in out or code != 0:
        return elements
    
    sections = out.split("||")
    for section in sections:
        if ":" in section:
            key, _, value = section.partition(":")
            items = [v.strip().strip('"').strip("{").strip("}") 
                    for v in value.split(",") 
                    if v.strip() and v.strip() not in ('{}', '""', '')]
            key_map = {
                "BUTTONS": "buttons",
                "FIELDS": "text_fields", 
                "LABELS": "labels",
                "CHECKS": "checkboxes",
                "POPUPS": "popups",
                "TABS": "tabs"
            }
            if key.strip() in key_map:
                elements[key_map[key.strip()]] = items
    
    return elements

def get_menu_bar_items(app_name: str) -> dict:
    """Get app menu bar items and top-level menu names."""
    script = f'''
tell application "System Events"
    tell process "{app_name}"
        try
            set menuNames to name of every menu bar item of menu bar 1
            return menuNames as string
        on error e
            return "ERROR:" & e
        end try
    end tell
end tell
'''
    out, _, code = run_applescript(script)
    menus = [m.strip().strip('"') for m in out.split(",") if m.strip()] if code == 0 else []
    
    # Check for status bar / menu bar extra
    status_script = f'''
tell application "System Events"
    tell process "{app_name}"
        try
            set extras to name of every menu bar item of menu bar 2
            return extras as string
        on error
            return ""
        end try
    end tell
end tell
'''
    status_out, _, _ = run_applescript(status_script)
    has_status_bar = bool(status_out.strip())
    
    return {
        "app_menus": menus,
        "has_menu_bar_extra": has_status_bar
    }

def write_ui_inventory(app_name: str, discovery: dict, output_dir: str):
    """Write the UI inventory markdown file."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    
    lines = [
        f"# UI Inventory — {app_name}",
        f"",
        f"> Discovered by QA Agent on {timestamp}",
        f"> Re-run `qa-explore-macos.py` to refresh this file.",
        f"",
        f"## Windows",
        f""
    ]
    
    for i, w in enumerate(discovery.get("windows", []), 1):
        lines.append(f"### Window {i}: {w.get('name', 'Unnamed')}")
        lines.append(f"- **Size**: {w.get('size', 'unknown')}")
        lines.append(f"- **Position**: {w.get('position', 'unknown')}")
        lines.append("")
        
        els = discovery.get("elements", {}).get(f"window_{i}", {})
        
        if els.get("buttons"):
            lines.append("#### Buttons")
            for b in els["buttons"]:
                if b:
                    lines.append(f"- `{b}`")
            lines.append("")
        
        if els.get("text_fields"):
            lines.append("#### Text Fields")
            for f in els["text_fields"]:
                if f:
                    lines.append(f"- `{f}`")
            lines.append("")
        
        if els.get("checkboxes"):
            lines.append("#### Checkboxes")
            for c in els["checkboxes"]:
                if c:
                    lines.append(f"- `{c}`")
            lines.append("")
        
        if els.get("popups"):
            lines.append("#### Dropdowns / Pop-up Buttons")
            for p in els["popups"]:
                if p:
                    lines.append(f"- `{p}`")
            lines.append("")
        
        if els.get("tabs"):
            lines.append("#### Tabs")
            for t in els["tabs"]:
                if t:
                    lines.append(f"- `{t}`")
            lines.append("")
        
        if els.get("labels"):
            lines.append("#### Visible Labels / Text")
            for l in els["labels"][:20]:  # Cap at 20 labels
                if l and len(l) > 1:
                    lines.append(f"- {l}")
            lines.append("")
    
    menus = discovery.get("menus", {})
    if menus.get("app_menus"):
        lines.extend([
            "## Menu Bar",
            "",
            "### App Menus (top bar when app is focused)"
        ])
        for m in menus["app_menus"]:
            if m:
                lines.append(f"- {m}")
        lines.append("")
    
    if menus.get("has_menu_bar_extra"):
        lines.append("### ✅ App has a Status Bar icon (menu bar extra)")
        lines.append("")
    
    output_path = os.path.join(output_dir, "ui-inventory.md")
    os.makedirs(output_dir, exist_ok=True)
    with open(output_path, "w") as f:
        f.write("\n".join(lines))
    
    print(f"📄 Written: {output_path}")

def explore_app(app_name: str, output_dir: str = "qa/knowledgebase", take_screenshot: bool = False) -> dict:
    """Full exploration pipeline."""
    print(f"\n🔍 Exploring {app_name}...")
    discovery = {
        "app_name": app_name,
        "timestamp": datetime.now().isoformat(),
        "windows": [],
        "elements": {},
        "menus": {}
    }
    
    # Get windows
    windows = get_windows(app_name)
    discovery["windows"] = windows
    print(f"📐 Windows found: {len(windows)}")
    for w in windows:
        print(f"   - {w['name']} ({w['size']})")
    
    # Get UI elements per window
    for i, w in enumerate(windows, 1):
        print(f"🔎 Scanning window {i}: {w['name']}...")
        els = get_ui_elements(app_name, i)
        discovery["elements"][f"window_{i}"] = els
        print(f"   Buttons: {len(els['buttons'])}, Fields: {len(els['text_fields'])}, "
              f"Checkboxes: {len(els['checkboxes'])}, Tabs: {len(els['tabs'])}")
    
    # Get menus
    print("📋 Scanning menus...")
    menus = get_menu_bar_items(app_name)
    discovery["menus"] = menus
    if menus["app_menus"]:
        print(f"   App menus: {', '.join(menus['app_menus'])}")
    if menus["has_menu_bar_extra"]:
        print("   ✅ Has status bar icon")
    
    # Take screenshot after exploration (if requested)
    if take_screenshot:
        print("📸 Capturing post-exploration screenshot...")
        run_applescript(f'tell application "{app_name}" to activate')
        time.sleep(1)
        shot_path = capture_screenshot("applescript-main", output_dir)
        if shot_path:
            discovery["screenshots"] = discovery.get("screenshots", [])
            discovery["screenshots"].append(shot_path)

    # Write UI inventory
    write_ui_inventory(app_name, discovery, output_dir)

    # Save raw JSON
    json_path = os.path.join(output_dir, "ui-inventory.json")
    with open(json_path, "w") as f:
        json.dump(discovery, f, indent=2)
    print(f"📄 Written: {json_path}")

    return discovery

def main():
    parser = argparse.ArgumentParser(description="Explore a macOS app's UI for QA")
    parser.add_argument("--app", required=True, help="Application name (e.g., 'PureVPN')")
    parser.add_argument("--output", default="qa/knowledgebase", help="Output directory")
    parser.add_argument("--no-launch", action="store_true", help="Skip launching the app")
    parser.add_argument("--screenshot", action="store_true", help="Capture screenshot after exploration")
    args = parser.parse_args()
    
    print(f"\n{'='*50}")
    print(f"  QA Explorer — {args.app}")
    print(f"{'='*50}\n")
    
    # Check permissions
    if not check_accessibility():
        sys.exit(1)
    
    # Launch app if needed
    if not args.no_launch:
        if not check_app_running(args.app):
            if not launch_app(args.app):
                sys.exit(1)
        else:
            print(f"✅ {args.app} already running")
    
    # Run exploration
    discovery = explore_app(args.app, args.output, take_screenshot=args.screenshot)
    
    # Summary
    total_buttons = sum(len(v.get("buttons", [])) for v in discovery["elements"].values())
    total_fields = sum(len(v.get("text_fields", [])) for v in discovery["elements"].values())
    total_checks = sum(len(v.get("checkboxes", [])) for v in discovery["elements"].values())
    
    print(f"\n{'='*50}")
    print(f"  Discovery Complete")
    print(f"{'='*50}")
    print(f"  Windows:    {len(discovery['windows'])}")
    print(f"  Buttons:    {total_buttons}")
    print(f"  Fields:     {total_fields}")
    print(f"  Checkboxes: {total_checks}")
    print(f"  Output:     {args.output}/")
    print(f"{'='*50}\n")

if __name__ == "__main__":
    main()
