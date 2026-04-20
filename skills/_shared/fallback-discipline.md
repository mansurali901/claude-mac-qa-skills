---
name: fallback-discipline
description: Non-negotiable rule for autonomous QA. Every strategy, runtime script, and TC declares a fallback. If primary stalls, fall back and continue — never break the flow.
type: reference
---

# Fallback Discipline — Never Break the Flow

> ⚠️ **NON-NEGOTIABLE RULE** — this is not a suggestion. Every strategy, runtime script, and TC must declare a fallback. If primary stalls, fall back and continue. Stopping the run because one approach failed is a bug.

---

## The Rule

Every action that could fail or stall must answer **two questions** before it runs:

1. **What does success look like?** (concrete observable outcome)
2. **What do I do if this stalls?** (the fallback action — must continue progress, not stop)

Stalls include: timeouts, empty results, ambiguous UI, repeated nav failures, missing selectors, unexpected redirects, rate limits, external service down.

## What "Falling Back" Means

| ❌ Wrong | ✅ Right |
|---|---|
| Stop the run, ask user for guidance | Switch to declared fallback strategy, log the switch in `qa/decisions.md`, continue |
| Retry the same action 5x | Try once, on failure execute fallback (different approach, not same approach) |
| Throw an error and crash | Catch, record skip with reason, advance to next step |
| Skip silently and pretend it worked | Record the skip with explicit reason in `qa/decisions.md` AND in the relevant `flow.md` evidence row |

## Fallback Patterns by Layer

### Strategy-level (exploration)

Each file in `skills/<platform>/strategies/` declares a primary technique AND a named fallback strategy. Example: BFS's fallback is "direct-URL probing of links collected so far"; targeted-trace's fallback is "skip the failing step, record skip, continue with next".

### Runtime script-level (`qa/scripts/*.js`)

Every helper script's header comment must include:
```javascript
// Why: <reason this script exists>
// Strategy: <which strategy spawned it>
// Fallback: <what to do if this script stalls — different code path, not retry>
```

### Test case-level (`TC-NNN-*.md`)

Add a `#### Fallback if test setup fails` row in the Preconditions section. If `auth.setup.ts` fails, the TC degrades to public-route assertions instead of skipping the run.

### Step-level (inside a strategy or TC)

For any step that interacts with the UI:

```javascript
// Primary
const ok = await tryPrimary().catch(() => false);
if (!ok) {
  // Fallback — different approach, log it
  await logDecision('Step X primary failed, using fallback Y');
  await tryFallback();
}
```

## What Counts as a Valid Fallback

A fallback is valid only if **all** are true:

- It is a **different approach**, not a retry of the same one.
- It **continues progress** — moves forward in the flow, doesn't stop.
- It is **declared in advance**, not invented at failure time.
- It is **logged** to `qa/decisions.md` when executed.

## When You May Stop

You may stop ONLY when:

1. **Credentials are required and `.env.qa` lacks them** — ask the user (per principle #9).
2. **Context limit approached** — checkpoint to `qa/state.md`, tell user resume command.
3. **System-level permission denied** (e.g. macOS Accessibility) — stop is the system's choice, not yours; tell user how to fix.

For any other stall, the answer is: execute the declared fallback and continue.

## Audit Trail

Every fallback execution appends one entry to `qa/decisions.md`:

```markdown
## YYYY-MM-DD HH:MM — Fallback executed: <step/strategy/script>
**Primary**: <what was tried>
**Stall signal**: <what indicated failure>
**Fallback**: <what was executed instead>
**Outcome**: <continued / partial success / skip recorded>
```

The audit trail is the proof that autonomy is disciplined, not chaotic.
