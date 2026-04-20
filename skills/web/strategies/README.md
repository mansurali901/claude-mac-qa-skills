---
name: web-strategies-index
description: Index + selection rubric for web exploration strategies. Read fingerprint, pick a strategy, declare its fallback before executing.
type: reference
platform: web
---

# Web Exploration Strategies — Index & Selection Rubric

> ⚠️ **THESE ARE EXAMPLES AND PREFERRED SUGGESTIONS — NOT MANDATES.**
> You may deviate based on the observed app character, but you MUST:
> 1. Log the deviation in `qa/decisions.md` with rationale.
> 2. Declare a fallback. If your chosen approach stalls, fall back and continue — never break the flow.

---

## Available Strategies

| File | Strategy | Best for | Default fallback |
|---|---|---|---|
| [bfs.md](bfs.md) | Breadth-First Crawl | Dashboard / multi-page apps with rich nav | Direct-URL probing → sitemap-spot-check |
| [targeted-trace.md](targeted-trace.md) | Linear persona path | Onboarding / wizard / transactional flows | Skip step + continue → BFS after 3 stalls |
| [sitemap-spot-check.md](sitemap-spot-check.md) | Sample N URLs per template group | Content / CMS / marketing / docs | BFS with `QA_MAX_DEPTH=2` |

You may also write a **custom** strategy if none fit. Document it in `qa/decisions.md` with rationale and fallback.

---

## Selection Rubric (read fingerprint Q1–Q4)

```
Q3 = Onboarding-heavy or Transactional?
  → start with TARGETED-TRACE
  → fallback: skip+continue → BFS after 3 stalls

Q3 = Content?
  → start with SITEMAP-SPOT-CHECK
  → fallback: BFS with QA_MAX_DEPTH=2

Q3 = Dashboard?  (or Mixed with dashboard dominant)
  → start with BFS
  → fallback: direct-URL probing → sitemap-spot-check

Q1 = pure native (CLI, native shell)?
  → none of these apply — see your platform's strategies dir
```

---

## Required Outputs Before Executing

Before running ANY strategy, the platform skill must:

1. **Confirm fingerprint exists** (`qa/platform-fingerprint.md`) — created in root SKILL.md Step 3.5.
2. **Log the choice** in `qa/decisions.md` using this format:

```markdown
## YYYY-MM-DD HH:MM — Strategy chosen
**Strategy**: <bfs | targeted-trace | sitemap-spot-check | custom>
**Why**: <2-3 sentences citing fingerprint Q1-Q4 answers>
**Fallback**: <named alternative + when to switch>
**Runtime helper**: qa/scripts/<strategy>.js
```

3. **Write the runtime helper** to `qa/scripts/<strategy>.js` — copy the code skeleton from the chosen strategy file, adapt selectors/heuristics to what observed in the fingerprint probe screenshot.

4. **Add the helper's header comment**:

```javascript
// Why: <reason this script exists>
// Strategy: <name from this file>
// Fallback: <what to do if this script stalls — different code path, not retry>
```

---

## When to Switch Strategies Mid-Run

Watch for the stall signals listed in each strategy file. When you see one:

1. Stop the current strategy cleanly (do NOT crash — finish current iteration).
2. Append a `qa/decisions.md` entry: `"Switching from <X> to <Y> because <stall signal>."`
3. Update or replace `qa/scripts/explore.js` with the new strategy's helper.
4. Resume from where you left off — the new strategy uses the same `qa/state.md` + `qa/crawl-state.json` (if compatible) so progress isn't lost.

**The flow never breaks.** A stall means switch, not stop.
