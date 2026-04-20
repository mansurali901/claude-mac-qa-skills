---
name: native-qa-ios
description: Autonomous QA skill for iOS applications using XCUITest and xcrun simctl.
platform: ios
status: stub
version: 0.1.0
---

# iOS QA Skill — XCUITest + xcrun simctl

> **Status**: Stub — Phase 4 implementation (Q3 2026)

## Prerequisites

- macOS with Xcode 15+ installed
- iOS Simulator or physical device connected
- `xcrun simctl` available in PATH

## Shared Principles & Fallback Discipline (applies when implemented)

Before any platform work, read:
- [skills/_shared/principles.md](../_shared/principles.md)
- [skills/_shared/fingerprint-questions.md](../_shared/fingerprint-questions.md) — drives `qa/platform-fingerprint.md` in Step 3.5
- [skills/_shared/fallback-discipline.md](../_shared/fallback-discipline.md) — every strategy, runtime script, and test step must declare a fallback; never break the flow.

## Pre-Step: Load Prior Knowledge (required when implemented)

All platform skills must begin by reading `qa/knowledgebase/ui-inventory.md` (built from `qa/context/` in Step 3) before starting any device interaction. See macOS skill for the reference implementation.

## Planned Workflow

- **Discovery**: `skills/ios/explore.py` using xcrun simctl + Xcode Accessibility Inspector
- **Interaction**: `skills/ios/interact.py` using XCUITest commands via Appium or direct xcrun
- **Screenshots**: `xcrun simctl io <device> screenshot`
- **Lifecycle**: `xcrun simctl boot/shutdown/install/launch`
