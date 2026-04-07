# F-[NNN]: [Flow Name]

## Summary

| Field | Value |
|-------|-------|
| **Flow ID** | F-[NNN] |
| **Application** | [AppName] |
| **Description** | [One sentence: what goal does this flow accomplish?] |
| **Start State** | [App state before flow begins, e.g., "App launched, user logged out"] |
| **End State** | [App state when flow completes successfully] |
| **Window / Panel** | [e.g., Main window / Preferences > General / Menu bar dropdown] |
| **Priority** | P1 / P2 / P3 |
| **Discovered via** | Screenshot analysis + AppleScript enumeration |
| **Created** | [YYYY-MM-DD] |
| **Last Updated** | [YYYY-MM-DD] |

---

## UI Elements Involved

| Element Type | Name / Description | Role in This Flow |
|-------------|-------------------|--------------------|
| [Button / Field / Tab / Checkbox / Dropdown] | "[name]" | [what it does in this flow] |

---

## User Journey

### Preconditions
- [ ] [What must be true before this flow starts]
- [ ] [Required account state, permissions, network, etc.]

### Steps

| Step | User Action | System / UI Response | Element Involved |
|------|------------|---------------------|-----------------|
| 1 | [User does this] | [App responds like this] | [Element name] |
| 2 | ... | ... | ... |

### Success Outcome
> [What the user sees / what has changed when the flow completes successfully]

### Failure Outcomes

| What Goes Wrong | Expected App Behavior |
|----------------|----------------------|
| [Failure condition] | [How app should handle it — error message, disabled state, etc.] |

---

## Sub-Flows / Variants

- **[F-NNN-a]**: [Variant name] — [Brief description of how this differs from the main flow]

---

## Discovery Evidence

- Screenshot: `qa/knowledgebase/screenshots/0N-[section-slug].png`

---

## AppleScript Navigation Skeleton

```applescript
-- Navigate F-[NNN]: [Flow Name]
tell application "[AppName]"
    activate
end tell
delay 2

tell application "System Events"
    tell process "[AppName]"
        -- Step 1: [description]
        click [element] of window 1
        delay 1

        -- Step 2: [description]
        -- ...
    end tell
end tell
```

---

## Notes / Observations

- [Anything unusual observed during discovery — timing issues, inconsistencies, hidden states, etc.]
