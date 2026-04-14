---
name: native-qa-windows
description: Autonomous QA skill for Windows native applications using WinAppDriver and UIA3.
platform: windows
status: stub
version: 0.1.0
---

# Windows QA Skill — WinAppDriver + UIA3

> **Status**: Stub — Phase 2 implementation (Q3 2026)
> See `references/winapdriver-patterns.md` for automation reference.

## Prerequisites

- Windows 10/11
- WinAppDriver installed: https://github.com/microsoft/WinAppDriver
- Accessibility permission equivalent enabled
- Python 3.9+ or Node.js 20+

## Pre-Step: Load Prior Knowledge (required when implemented)

All platform skills must begin by reading `qa/knowledgebase/ui-inventory.md` (built from `qa/context/` in Step 3) before starting any app interaction. See macOS skill for the reference implementation.

## Workflow

Follows the same 9-step workflow as the macOS skill (`SKILL.md`), adapted for Windows:

- **Discovery**: `skills/windows/explore.py` using UIA3 via `uiautomation` or WinAppDriver
- **Interaction**: `skills/windows/interact.py` using WinAppDriver WebDriver protocol
- **Screenshots**: `skills/windows/screenshot.py` using `pyautogui.screenshot()` or Win32 PrintWindow
- **Automation**: PowerShell for app lifecycle, WinAppDriver for UI interaction

## Implementation Status

- [ ] `explore.py` — UIA3 element enumeration
- [ ] `interact.py` — WinAppDriver interaction driver
- [ ] `screenshot.py` — Windows screenshot capture
- [ ] `references/winapdriver-patterns.md` — Automation reference
- [ ] CI template for Windows Server runners
