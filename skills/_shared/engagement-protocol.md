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

## Browser launch shared pattern

All scripts that launch Chromium use the same env-respecting line (so `QA_HEADLESS=false` lets the user watch):

```javascript
const browser = await chromium.launch({
  headless: process.env.QA_HEADLESS !== 'false'
});
```

## Compliance

Strategy files, helper scripts, and platform skills MUST cite this document in their fallback section. PRs that introduce a new `throw`/`exit` without a paired `askUser` must be rejected.
