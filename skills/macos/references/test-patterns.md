# Test Patterns Reference — macOS Skill

> Full reference: [`references/test-patterns-native.md`](../../../references/test-patterns-native.md) at project root.
> This file is the skill-local quick-reference index.

---

## Quick Index

| Topic | Location |
|-------|---------|
| App launch & lifecycle scenarios | Root `references/test-patterns-native.md` §1 |
| Authentication flow patterns | Root `references/test-patterns-native.md` §2 |
| Core feature flow patterns | Root `references/test-patterns-native.md` §3 |
| Settings & preferences patterns | Root `references/test-patterns-native.md` §4 |
| Menu bar app patterns | Root `references/test-patterns-native.md` §5 |
| Error & offline state patterns | Root `references/test-patterns-native.md` §6 |
| State persistence patterns | Root `references/test-patterns-native.md` §7 |

---

## Scenario Categories — Minimum Coverage Per Flow

| Category | Min Scenarios | Priority | Notes |
|----------|--------------|----------|-------|
| Happy Path | 1 | P1 | Every flow |
| Alternative Happy Path | 1+ | P1 | Multiple valid paths |
| Negative / Invalid Input | 2+ | P1 | Any flow with user input |
| Empty / Null Input | 1 | P1 | Required fields |
| Boundary Values | 2 | P2 | Fields with length/range |
| State Persistence | 1 | P2 | State-changing flows |
| Interrupted Flow | 1 | P2 | Multi-step flows |
| Error Recovery | 1+ | P2 | Network/IO operations |
| Offline / No Network | 1 | P2 | Connectivity-dependent flows |
| Permission Denied | 1 | P2 | OS permission required |
| Concurrent / Double-tap | 1 | P3 | Action buttons |
| Accessibility | 1 | P3 | All flows |

## Scenario Count Targets Per Flow

| Flow Complexity | Scenario Count |
|----------------|---------------|
| Simple (launch, quit) | 3–5 |
| Medium (settings, navigation) | 6–10 |
| Complex (auth, core feature) | 10–20 |

---

## Universal Flows (Every App Gets These)

```
F-001-app-launch-and-startup
F-002-quit-and-state-persistence
F-003-preferences-settings
F-004-menu-bar-navigation
```

---

> For full scenario patterns by UI element type and app category, see
> [`../../../references/test-patterns-native.md`](../../../references/test-patterns-native.md)
