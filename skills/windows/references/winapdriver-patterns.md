# WinAppDriver Patterns — QA Agent Windows Skill

> **Status**: Placeholder — to be written during Phase 2 implementation (Q3 2026)

## Overview

WinAppDriver uses the WebDriver protocol to automate Windows applications through UIA3 (UI Automation 3).

## Key Concepts

- **WinAppDriver**: Acts as a local HTTP server on port 4723 (same as Appium)
- **UIA3**: Windows Accessibility API — equivalent to macOS Accessibility API
- **Element locators**: AutomationId (preferred), Name, ClassName, XPath

## Planned Patterns

- App launch via `subprocess` + `winreg` for path discovery
- Element enumeration using `uiautomation` Python library
- Click, type, keyboard shortcuts via WinAppDriver WebDriver client
- Screenshot via `pyautogui.screenshot()` or `win32gui.PrintWindow`
- Menu navigation via keyboard (Alt + menu letter)

## References

- WinAppDriver: https://github.com/microsoft/WinAppDriver
- UI Automation: https://docs.microsoft.com/en-us/windows/win32/winauto/entry-uiauto-win32
