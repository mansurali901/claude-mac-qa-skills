---
name: native-qa-android
description: Autonomous QA skill for Android applications using UIAutomator2 and ADB.
platform: android
status: stub
version: 0.1.0
---

# Android QA Skill — UIAutomator2 + ADB

> **Status**: Stub — Phase 4 implementation (Q4 2026)

## Prerequisites

- Android SDK installed with ADB in PATH
- Android Emulator or physical device connected (`adb devices` shows device)
- Appium + UIAutomator2 driver installed

## Shared Principles & Fallback Discipline (applies when implemented)

Before any platform work, read:
- [skills/_shared/principles.md](../_shared/principles.md)
- [skills/_shared/fingerprint-questions.md](../_shared/fingerprint-questions.md) — drives `qa/platform-fingerprint.md` in Step 3.5
- [skills/_shared/fallback-discipline.md](../_shared/fallback-discipline.md) — every strategy, runtime script, and test step must declare a fallback; never break the flow.

## Pre-Step: Load Prior Knowledge (required when implemented)

All platform skills must begin by reading `qa/knowledgebase/ui-inventory.md` (built from `qa/context/` in Step 3) before starting any device interaction. See macOS skill for the reference implementation.

## Planned Workflow

- **Discovery**: `skills/android/explore.py` using ADB + UIAutomator2 accessibility dump
- **Interaction**: `skills/android/interact.py` using Appium WebDriver
- **Screenshots**: `adb exec-out screencap -p > screenshot.png`
- **Lifecycle**: `adb shell am start`, `adb install`, `adb shell pm clear`
