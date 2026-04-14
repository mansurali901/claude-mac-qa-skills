# UIAutomator2 Patterns — QA Agent Android Skill

> **Status**: Placeholder — to be written during Phase 4 implementation (Q4 2026)

## Key Concepts

- **UIAutomator2**: Android's UI testing framework, uses Accessibility Service
- **ADB**: Android Debug Bridge — CLI for device/emulator management
- **Appium UIAutomator2 driver**: Wraps UIAutomator2 in WebDriver protocol

## Planned Patterns

- Device lifecycle: `adb shell am start`, `adb shell pm clear`, `adb install`
- Screenshot: `adb exec-out screencap -p > evidence.png`
- Element discovery via `uiautomator dump`
- Tap, swipe, type via Appium WebDriver
- Permission grant: `adb shell pm grant <package> <permission>`
