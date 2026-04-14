# XCUITest Patterns — QA Agent iOS Skill

> **Status**: Placeholder — to be written during Phase 4 implementation (Q3 2026)

## Key Concepts

- **XCUITest**: Apple's native UI testing framework, runs as an Xcode test target
- **xcrun simctl**: CLI tool to manage iOS Simulators
- **Appium XCUITest driver**: Wraps XCUITest in a WebDriver server for Python/Node clients

## Planned Patterns

- Simulator lifecycle: `xcrun simctl boot`, `xcrun simctl install`, `xcrun simctl launch`
- Screenshot: `xcrun simctl io booted screenshot output.png`
- Element discovery via Xcode Accessibility Inspector dump
- Tap, swipe, type via Appium WebDriver protocol
