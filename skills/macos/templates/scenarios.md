# Scenarios — F-[NNN]: [Flow Name]

**Flow**: [F-NNN — flow.md](flow.md)
**Application**: [AppName]
**Total scenarios**: [N]
**Generated**: [YYYY-MM-DD]
**Last Updated**: [YYYY-MM-DD]

---

## S-[NNN]-01: Happy Path — [Short Description]

| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Category** | Happy Path |
| **Preconditions** | [Specific app state needed before this scenario] |
| **Steps summary** | [1–2 sentence description of what the user does] |
| **Expected result** | [What success looks like — observable UI change or outcome] |
| **Test Case** | [TC-NNN-happy-path.md](test-cases/TC-NNN-happy-path.md) |

---

## S-[NNN]-02: Alternative Path — [Short Description]

| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Category** | Alternative Happy Path |
| **Preconditions** | [State] |
| **Steps summary** | [1–2 sentences] |
| **Expected result** | [Outcome] |
| **Test Case** | [TC-NNN-[slug].md](test-cases/TC-NNN-[slug].md) |

---

## S-[NNN]-03: Negative — [Invalid Input / Wrong State]

| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Category** | Negative / Invalid Input |
| **Preconditions** | [State] |
| **Steps summary** | [1–2 sentences describing the invalid action] |
| **Expected result** | [Error shown, action blocked, app remains stable] |
| **Test Case** | [TC-NNN-[slug].md](test-cases/TC-NNN-[slug].md) |

---

## S-[NNN]-04: Empty / Null Input — [Short Description]

| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Category** | Boundary / Edge Case |
| **Preconditions** | [State] |
| **Steps summary** | [User leaves required field empty and triggers action] |
| **Expected result** | [Validation error shown, action blocked] |
| **Test Case** | [TC-NNN-[slug].md](test-cases/TC-NNN-[slug].md) |

---

## S-[NNN]-05: State Persistence — [After Relaunch]

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Category** | State Persistence |
| **Preconditions** | [Completed happy path, specific state established] |
| **Steps summary** | [Quit app → relaunch → verify state] |
| **Expected result** | [State survives relaunch] |
| **Test Case** | [TC-NNN-[slug].md](test-cases/TC-NNN-[slug].md) |

---

## S-[NNN]-06: Interrupted Flow — [Mid-Action Interruption]

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Category** | Interrupted Flow |
| **Preconditions** | [Flow in progress] |
| **Steps summary** | [Start flow → switch to another app → return → complete or cancel] |
| **Expected result** | [App handles interruption gracefully — no data loss, no crash] |
| **Test Case** | [TC-NNN-[slug].md](test-cases/TC-NNN-[slug].md) |

---

## S-[NNN]-07: Error Recovery — [Specific Error Condition]

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Category** | Error Recovery |
| **Preconditions** | [Error condition set up] |
| **Steps summary** | [Trigger error → observe handling → recover] |
| **Expected result** | [User-friendly error shown, recovery path available] |
| **Test Case** | [TC-NNN-[slug].md](test-cases/TC-NNN-[slug].md) |

---

## S-[NNN]-08: Offline / No Network

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Category** | Offline / Network |
| **Preconditions** | [App running, Wi-Fi disabled] |
| **Steps summary** | [Attempt network-dependent action while offline] |
| **Expected result** | [Clear offline error, no crash, recovers when network restored] |
| **Test Case** | [TC-NNN-[slug].md](test-cases/TC-NNN-[slug].md) |

---

## S-[NNN]-09: Boundary Values — [Min/Max Input]

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Category** | Boundary / Edge Case |
| **Preconditions** | [State] |
| **Steps summary** | [Enter minimum / maximum / boundary values in fields] |
| **Expected result** | [Accepted at valid boundary, rejected just outside] |
| **Test Case** | [TC-NNN-[slug].md](test-cases/TC-NNN-[slug].md) |

---

## S-[NNN]-10: Concurrent Action — [Double-tap / Rapid Trigger]

| Field | Value |
|-------|-------|
| **Priority** | P3 |
| **Category** | Concurrent / Race Condition |
| **Preconditions** | [State ready for action] |
| **Steps summary** | [Trigger the same action twice in rapid succession] |
| **Expected result** | [No duplicate operation, no crash, graceful handling] |
| **Test Case** | [TC-NNN-[slug].md](test-cases/TC-NNN-[slug].md) |

---

## [Add more scenarios following the same table format]

---

## Coverage Summary

| Category | Count | TC References |
|----------|-------|--------------|
| Happy Path | [N] | TC-NNN, ... |
| Alternative Happy Path | [N] | TC-NNN, ... |
| Negative / Invalid Input | [N] | TC-NNN, ... |
| Boundary / Edge Cases | [N] | TC-NNN, ... |
| State Persistence | [N] | TC-NNN, ... |
| Interrupted Flow | [N] | TC-NNN, ... |
| Error Recovery | [N] | TC-NNN, ... |
| Offline / Network | [N] | TC-NNN, ... |
| Permission Denied | [N] | TC-NNN, ... |
| Concurrent Actions | [N] | TC-NNN, ... |
| **Total** | **[N]** | |
