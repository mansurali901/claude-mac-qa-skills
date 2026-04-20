---
name: engagement-protocol
description: Forbids silent termination. Every blocker becomes a user-facing decision with at least two options.
type: shared
---

# Engagement Protocol — Never Terminate Silently

> **The agent's job is to unblock, not to exit.** When something goes wrong, surface a concrete decision to the user. Exit codes are only acceptable AFTER the user explicitly chooses "halt".

## Rules

1. **No silent `throw`, `exit 1`, or `process.exit()` in any runtime script.** They all become `await askUser({ blocker, evidence, options })`.
2. Every blocker presents **at least two options**: a way to fix-and-retry AND a way to skip-and-continue. Halt is allowed only if the user picks it.
3. **Evidence is mandatory.** Don't say "login failed" — include status code, response body excerpt, screenshot path, the input the user gave, the env var that was missing.
4. **Front-load engagement.** Preflight (Step 3.7), role + flow confirmation (Web Step W-2.5), per-role credential prompts all run BEFORE tracing begins. The agent never burns tokens on work the user hasn't approved.

## The askUser pattern

Runtime scripts (which run outside the agent's tool loop) cannot directly call `AskUserQuestion`. They use a file-based handshake:

```javascript
// In the runtime script:
const fs = require('fs');
function askUser({ blocker, evidence, options }) {
  const q = { blocker, evidence, options, ts: Date.now() };
  fs.writeFileSync('qa/pending-question.md', '```json\n' + JSON.stringify(q, null, 2) + '\n```\n');
  process.exit(0);  // clean exit; agent picks up the question
}
```

The agent, on noticing `qa/pending-question.md`:
1. Reads the file
2. Calls `AskUserQuestion` with the blocker + options
3. Writes the user's choice to `qa/pending-answer.md`
4. Re-launches the script with `--resume-from qa/pending-answer.md`
5. Deletes both pending files on successful resume

**Clean exits are not silent terminations** — the agent guarantees re-engagement.

## Hard-exit sites that MUST be replaced

| Site | Old behavior | New behavior |
|---|---|---|
| Root `SKILL.md` line ~84 (qa/ cleanup fails) | `exit 1` | "qa/ still exists. (a) identify locking process, (b) rename to qa-old and continue, (c) halt." |
| `skills/web/SKILL.md` line ~101 (`.env.qa` missing) | `throw` | Downgrade config-time throw to console warning. Preflight (W-1.5) handles it. |
| `skills/web/SKILL.md` line ~104 (`QA_APP_URL` missing) | `throw` | Downgrade to warning. Preflight prompts. |
| Any runtime script's `throw` on classifier error | crash | Log + return `no-change` label + continue. |
| Any runtime script's `process.exit(1)` | silent death | Replace with `askUser({...})`. |
| Mid-flow idle after user answers an engagement prompt | agent stops, waits for "continue" | Agent re-enters the manifest loop from the first non-`done` line. No re-prompt. |

## End-to-End Completion is Mandatory

Once the agent enters a flow (first line appended to that flow's `qa/flows/F-NNN-*/manifest.jsonl`), it MUST drive every manifest step to a terminal status (`done` / `skipped(reason)` / `blocked(reason)`) before moving on. The manifest — not the user — is the source of truth for "what's left."

- **"Asking the user what's remaining" is not a valid terminal action.** Consult the manifest.
- The ONLY legitimate mid-flow pauses:
  1. Classifier returns `error-surfaced` / `auth-rejected-server` / `form-reset-silent` / `network-timeout` → fire `AskUserQuestion` with evidence, then resume the loop.
  2. `consecutiveStalls >= 3` on `no-change` → surface the stall to the user.
  3. User explicitly types `pause` / `stop`.
- After a flow's manifest is fully terminal, the agent **auto-advances to the next `PENDING` flow** in `qa/knowledgebase/journey-inventory.md` without asking. The answer is always yes until every flow is terminal or the user interrupts.
- Progress is logged to `qa/progress.jsonl` (append-only, ≤150 bytes/line). Resume reads `tail -n 30` — never the whole file.
- Per-flow checkpoints in `qa/state.md` collapse to a 6-line **Active Position** pointer block; the heavy state template is only written at phase boundaries.

### Deterministic resume sequence

1. Read `qa/state.md` → get **Active flow**.
2. `tail -n 30 qa/progress.jsonl` → confirm last concrete action.
3. `grep -v '"status":"done"' qa/flows/<active>/manifest.jsonl` → first line = next step.
4. If active flow is fully done, pick the first `PENDING` flow in `journey-inventory.md`, write its manifest, begin.
5. Stop only when every flow is terminal or the user interrupted.

## Navigation discipline — click, don't goto

Once the seed URL is loaded, **traverse the app by clicking its own nav elements** (links, buttons, menu items) — not by calling `page.goto(arbitrary-url)`. Direct URL insertion bypasses the app's router, skips client-side guards, and produces journeys a real user cannot reproduce. Use `page.locator(...).click()` / `getByRole('link')` and let SPA navigation happen naturally. `page.goto` is reserved for: (a) the initial seed URL, (b) explicit resume-from-route on re-entry, (c) URLs observed in `sitemap.xml` when the sitemap-spot-check strategy is active. Every other hop is a click on a discovered nav element.

## Browser launch shared pattern

All scripts that launch Chromium use the same env-respecting line (so `QA_HEADLESS=false` lets the user watch):

```javascript
const browser = await chromium.launch({
  headless: process.env.QA_HEADLESS !== 'false'
});
```

## Compliance

Strategy files, helper scripts, and platform skills MUST cite this document in their fallback section. PRs that introduce a new `throw`/`exit` without a paired `askUser` must be rejected.
