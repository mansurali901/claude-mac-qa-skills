---
name: native-qa-web
description: Autonomous QA skill for web applications using Playwright. Four continuous phases — Discovery → Scenario Planning → Test Generation → Test Execution. Stops only for credentials or context limits. QA report generated at phase boundaries only.
platform: web
status: beta
version: 2.0.0
---

# Web QA Skill — Playwright-Based Workflow

Four continuous phases that run end-to-end without stopping for user approval between phases:

```
Phase 1: Discovery         → Seed crawl → nav graph → personas → E2E journeys → flow.md
Phase 2: Scenario Planning → Read flow.md → generate scenarios.md per flow
Phase 3: Test Generation   → Read scenarios.md → write TC-NNN-*.md per scenario
Phase 4: Test Execution    → Extract .spec.ts → run Playwright tests → pass/fail
```

**Continuous execution**: phases flow into each other automatically. The agent only stops for:
- **Credentials required** — must ask user for auth/API keys
- **Context full** — must checkpoint to `qa/state.md` and reset

**Report timing**: `node scripts/allure/generate-report.js --open` generates a self-contained session report at `qa/reports/<app-slug>-<timestamp>.html` with embedded screenshots. No Java or allure-commandline needed — works when opened directly. Each run writes a new timestamped file so prior sessions are preserved. Only run at **phase boundaries** (Phase 1→2, 2→3, 3→4, final) or when user asks — never on per-flow resets.

---

## Prerequisites

- Node.js 20+ installed
- `npm install` run in project root (installs `@playwright/test`, `dotenv`)
- `npx playwright install chromium` run at least once
- `.env.qa` at repo root — see `.env.example`

### BFS Crawl Configuration

These `.env.qa` variables tune the BFS crawler. Defaults work for most apps — only change if needed.

| Variable | Default | Purpose |
|----------|---------|---------|
| `QA_PAGE_WAIT_MS` | `2000` | Minimum wait (ms) after each page loads before screenshotting. Increase for slow SPAs. |
| `QA_MAX_PAGES` | `50` | Maximum pages the BFS visits. Prevents infinite crawl on large apps. |
| `QA_MAX_DEPTH` | `5` | Maximum click-depth from homepage. Pages deeper are queued but skipped. |
| `QA_NAV_TIMEOUT` | `15000` | Timeout (ms) for `page.goto()` calls. |

---

## Phase 1: Discovery

**Goal**: Discover EVERY reachable page in the application via deep BFS crawl, then organize into feature-scoped flows.
**Priority**: Exploration first — maximize pages discovered. Auth is a gate to pass through, not a journey to trace. **NEVER skip any credential gate, setup step, or onboarding step without explicit user permission.** If `.env.qa` has values → use them. If not → ask the user. The agent must never autonomously click "Skip", "Set up later", "Maybe later", or any bypass button.
**Output**: `qa/knowledgebase/` (screenshots, ui-inventory, nav-graph) + `qa/flows/F-NNN-*/flow.md` per feature area.
**Transition to Phase 2**: Automatic — after all pages discovered and flows documented.

---

### Pre-Step: Load Prior Knowledge

Before doing anything else, check what the root skill extracted from `qa/context/` in Step 3.

```bash
ls qa/knowledgebase/ui-inventory.md 2>/dev/null && echo "EXISTS" || echo "NONE"
ls qa/context/ 2>/dev/null
```

**If `qa/knowledgebase/ui-inventory.md` exists** — read it now. It contains the page inventory and known features extracted from any files the user dropped into `qa/context/`. Use this as your starting map:
- Prioritize routes and pages named in the inventory — explore these first
- If Figma screens were provided, you know the screen layouts — confirm visually via Playwright
- If a PRD or spec was provided, you know the features and acceptance criteria — test against them

**If `qa/context/` has unread files** (PNGs, `.md`, `.txt` not yet processed) — read them before opening the browser.

**If nothing exists** — cold start. Discover everything by crawling from the homepage.

---

## STOP / PAUSE / SAVE STATE

Follow the root SKILL.md **"STOP / PAUSE / SAVE STATE — Immediate Handler"** exactly. No web-specific differences — the root handler applies as-is.

---

### Step W-1: Workspace Setup

Handled by main SKILL.md Steps 1-2. Confirm:
- `.qa-config.json` has `"platform": "web"`
- `QA_APP_URL` is set in `.env.qa`
- `qa/knowledgebase/screenshots/` directory exists

Then write the Playwright config to `qa/playwright.config.ts`:

```typescript
import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const dotenvPath = path.resolve(process.cwd(), '.env.qa');
if (fs.existsSync(dotenvPath)) {
  require('dotenv').config({ path: dotenvPath });
} else {
  console.warn('[qa] .env.qa not found. Preflight (Step W-1.5) will engage the user to create it.');
}
if (!process.env.QA_APP_URL) {
  console.warn('[qa] QA_APP_URL is not set. Preflight (Step W-1.5) will prompt for it.');
}
const HEADLESS = process.env.QA_HEADLESS !== 'false';

const CI = !!process.env.CI;
const REPO_ROOT = process.cwd();
const AUTH_FILE = path.join(REPO_ROOT, 'qa/.auth/user.json');

export default defineConfig({
  testDir:       path.join(REPO_ROOT, 'qa/flows'),
  testMatch:     '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly:    CI,
  retries:       CI ? 2 : 0,
  workers:       CI ? 4 : 2,
  timeout:       30_000,
  expect:        { timeout: 5_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(REPO_ROOT, 'playwright-report'), open: 'never' }],
    ['json', { outputFile: path.join(REPO_ROOT, 'qa/runs/playwright-results.json') }],
  ],
  use: {
    baseURL:           process.env.QA_APP_URL,
    headless:          HEADLESS,
    trace:             'on-first-retry',
    screenshot:        'only-on-failure',
    video:             'on-first-retry',
    actionTimeout:     10_000,
    navigationTimeout: 15_000,
    locale:            'en-US',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'chromium-public', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
      dependencies: ['setup'],
    },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
  outputDir:   path.join(REPO_ROOT, 'qa/evidence/playwright/'),
  snapshotDir: path.join(REPO_ROOT, 'qa/knowledgebase/visual-baselines/'),
});
```

This reads all config from `.env.qa` dynamically — no hardcoded URLs or credentials. Write it fresh each session to `qa/` (gitignored). All run commands use `--config qa/playwright.config.ts`.

---

### Step W-1.5: Preflight — Verify & Auto-Install with User Consent

> **Engagement protocol** (`skills/_shared/engagement-protocol.md`): preflight MUST NOT throw or `exit 1`. For each missing item, surface a four-option `AskUserQuestion`: (a) auto-install / auto-create, (b) provide value now, (c) fix manually then say "continue", (d) skip the affected feature.

Run these checks IN ORDER, branch on failure:

```bash
# 1. node_modules with @playwright/test
[ -d node_modules/@playwright/test ] && echo "ok: playwright installed" \
  || echo "MISSING: @playwright/test — offer 'npm install'"

# 2. Chromium browser binary
npx --yes playwright install --dry-run chromium 2>&1 | grep -q "is already installed" \
  && echo "ok: chromium installed" \
  || echo "MISSING: chromium — offer 'npx playwright install chromium'"

# 3. .env.qa exists
[ -f .env.qa ] && echo "ok: .env.qa present" \
  || echo "MISSING: .env.qa — offer to copy .env.example and prompt for values"

# 4. QA_APP_URL set
( set -a; [ -f .env.qa ] && . ./.env.qa; set +a; [ -n "$QA_APP_URL" ] ) \
  && echo "ok: QA_APP_URL set" \
  || echo "MISSING: QA_APP_URL — prompt user for the URL to test"

# 5. Default-role creds (member)
( set -a; [ -f .env.qa ] && . ./.env.qa; set +a; [ -n "$QA_TEST_EMAIL" ] && [ -n "$QA_TEST_PASSWORD" ] ) \
  && echo "ok: default creds present" \
  || echo "WARN: no QA_TEST_EMAIL/PASSWORD — non-blocking; W-2.9 role gate will reconcile"
```

For each MISSING line, call `AskUserQuestion` once with the four options. Auto-install only on explicit consent. Append every preflight outcome to `qa/decisions.md` as a single dated entry. **Per-role credentials are deferred to Step W-2.9.**

---

### Step W-2: Exploration Strategy Selection — Pick, Log, Execute, Fallback

> ⚠️ **Strategies under `skills/web/strategies/` are EXAMPLES AND PREFERRED SUGGESTIONS — NOT MANDATES.**
> You may deviate based on the observed app character, but you MUST:
> 1. Log the deviation in `qa/decisions.md` with rationale.
> 2. Declare a fallback. If the chosen approach stalls, fall back and continue — never break the flow.

Playwright remains the web tool. Autonomy is about **which exploration strategy** to apply, not which tool.

#### W-2.1 — Read the fingerprint

Read `qa/platform-fingerprint.md` (written in root SKILL.md Step 3.5). The Q3 answer (app category) and Q4 answer (audience) drive strategy selection.

#### W-2.2 — Consult the selection rubric

Open [skills/web/strategies/README.md](strategies/README.md) and map Q3 → starting strategy:

| Fingerprint Q3 | Starting strategy | Declared fallback |
|---|---|---|
| Dashboard / multi-page / mixed | [bfs.md](strategies/bfs.md) (default) | Direct-URL probing → sitemap-spot-check |
| Onboarding-heavy / Transactional / Wizard | [targeted-trace.md](strategies/targeted-trace.md) | Skip + continue → BFS after 3 consecutive stalls |
| Content / CMS / Marketing / Docs | [sitemap-spot-check.md](strategies/sitemap-spot-check.md) | BFS with `QA_MAX_DEPTH=2` |
| Something else | Custom strategy — document rationale + fallback in `qa/decisions.md` |  |

#### W-2.3 — Log the choice

Append to `qa/decisions.md`:

```markdown
## YYYY-MM-DD HH:MM — Strategy chosen
**Strategy**: <bfs | targeted-trace | sitemap-spot-check | custom>
**Why**: <2-3 sentences citing fingerprint Q1-Q4 answers>
**Fallback**: <named alternative + when to switch>
**Runtime helper**: qa/scripts/<strategy>.js
```

#### W-2.4 — Write the runtime helper

Copy the code skeleton from the chosen strategy file into `qa/scripts/<strategy>.js` (e.g. `qa/scripts/bfs.js`). Adapt selectors, wait heuristics, and actionable-element rules to what the fingerprint probe screenshot actually showed. The helper header comment MUST contain:

```javascript
// Why: <reason this script exists>
// Strategy: <strategy name — see skills/web/strategies/<name>.md>
// Fallback: <what to do if this script stalls — different code path, not retry>
```

Also write a dispatcher stub at `qa/scripts/explore.js` that `require()`s the chosen helper. Subsequent phases and resumes load `explore.js` — swapping strategies means replacing what it dispatches to.

#### W-2.5 — Execute + screenshot + READ

Run the helper. For every page/step:
1. Navigate / interact via Playwright
2. Wait `QA_PAGE_WAIT_MS`
3. Verify state change (URL / DOM fingerprint)
4. Capture via `scripts/qa-screenshot.js` `capture()` — atomic registration into `flow.md`
5. **Read** the screenshot with the Read tool before deciding the next action. Never act on assumption alone.

All strategies share the same session artefacts:
- `qa/knowledgebase/screenshots/` — PNGs from every verified state
- `qa/knowledgebase/ui-inventory.md` — page inventory (strategy-agnostic schema: url, title, fingerprint, screenshot, auth-gated?)
- `qa/knowledgebase/nav-graph.md` — every outbound link on every visited page
- `qa/crawl-state.json` (BFS only) — queue + visited set for mid-crawl resume. If using targeted-trace, write `qa/trace-state.json` instead; if sitemap-spot-check, write `qa/sitemap-groups.json`. The shape is strategy-owned; the principle is identical: **auto-saved after every page so resume is free**.

#### W-2.6 — Credential gate protocol (all strategies)

Any strategy may hit a credential gate (login, SSO, API key). NEVER bypass.

1. Check `.env.qa` for applicable credentials (`QA_TEST_EMAIL`, `QA_TEST_PASSWORD`, `QA_API_KEY`, etc.).
2. If present — use them. If the gate succeeds, save session state to `qa/.auth/user.json` via Playwright `storageState`.
3. If absent — **stop, ask the user**, do not click "Skip", "Maybe later", or any bypass button.
4. Log the gate encounter + outcome in `qa/decisions.md`.

For self-registration (account not pre-provisioned), only proceed if the user explicitly authorizes. Generated credentials get appended to `.env.qa` (gitignored) and logged in `qa/decisions.md` as `"Self-registered test account <email> at YYYY-MM-DD"`.

#### W-2.7 — Watch for stall signals, fall back

Each strategy file names its own stall signals. When one triggers:
1. Stop the current strategy cleanly (finish the current iteration — do not crash).
2. Append to `qa/decisions.md`: `"Switching from <X> to <Y> because <signal>."`
3. Replace or update `qa/scripts/explore.js` to dispatch to the fallback strategy's helper.
4. Resume — session artefacts (`qa/state.md`, screenshots, nav-graph) carry over. Progress is not lost.

**The flow never breaks.** A stall means switch, not stop.

#### W-2.8 — Record results

At end of strategy execution:
- `qa/knowledgebase/ui-inventory.md` + `qa/knowledgebase/nav-graph.md` must be current
- `qa/state.md` gets a checkpoint: strategy used, pages visited, fallback triggered?, next action
- `qa/decisions.md` closes with a terminal entry: `"<Strategy> complete: N pages, M stalls, fallback-triggered=<yes|no>."`

---

### Runtime Script Evolution

`qa/scripts/` is **Claude-owned**. Every script there traces back to a strategy file under `skills/web/strategies/`. Rules:

- Every script starts with the three-line header (Why / Strategy / Fallback) shown in W-2.4.
- Updating a script mid-session requires a matching `qa/decisions.md` entry: `"Updated qa/scripts/<name>.js: <what changed> — because <observation from screenshot N>."`
- Deleting a script requires a matching entry: `"Removed qa/scripts/<name>.js — strategy switched from <X> to <Y>."`
- Scripts that accumulate without entries are stale. Audit at phase boundaries and prune.
- **Every generated script reads `QA_HEADLESS` from env**: `chromium.launch({ headless: process.env.QA_HEADLESS !== 'false' })`. Default headless; set `QA_HEADLESS=false` in `.env.qa` to watch the browser.
- **Every script that interacts with a login form uses `qa/scripts/login-engage.js`** (skeleton in `skills/web/helpers/login-engage.md`). Direct fill+click on a password field is a bug — it cannot detect form-reset-silent failures.
- **Every interaction calls `qa/scripts/outcome-classifier.js`** (skeleton in `skills/web/helpers/outcome-classifier.md`) and branches on the returned label — never on the legacy `stateChanged` boolean.

This is how Claude "writes its own tools" without losing audit trail. The strategy file is the contract; the script is the implementation; `decisions.md` is the commit log.

---

### Step W-2.9: Role & Flow Inventory Confirmation Gate

> **No tracing begins until the user confirms roles and flow categories.** This step front-loads engagement so the agent never burns tokens on flows the user didn't approve, and so multi-role apps are not wedged on a single global credential pair.

#### 1. Synthesize roles from the inventory

Read `qa/knowledgebase/ui-inventory.md` + `nav-graph.md` and infer roles from:
- distinct post-auth route prefixes (`/admin/*`, `/member/*`)
- visible role labels in nav (e.g. "Admin", "Owner", "Viewer")
- plan-tier badges in the header
- pages that 403/redirect for the default role

Write `qa/knowledgebase/roles.md`:

```markdown
| Role ID | Observed signal | Evidence screenshot | Credential slot |
|---|---|---|---|
| admin   | `/admin/*` + "Admin" badge | shot-03.png | QA_ADMIN_EMAIL / QA_ADMIN_PASSWORD |
| member  | default post-login         | shot-01.png | QA_TEST_EMAIL  / QA_TEST_PASSWORD  |
```

#### 2. Synthesize broad flow categories

Group nav clusters into 5–8 flow categories. Write `qa/knowledgebase/flow-categories.md`:

```markdown
| Category    | Pages | Roles needed |
|-------------|-------|--------------|
| Auth        | /login, /signup, /reset | anonymous → member/admin |
| Dashboard   | /, /home              | member, admin |
| Admin Panel | /admin/*              | admin |
```

#### 3. ONE batched AskUserQuestion

Present roles + categories together. Use a structured `AskUserQuestion` so the user can confirm, edit, or add. Do not ask sequentially — one prompt, multiple answers.

#### 4. Per confirmed role, request credentials

For each confirmed role, in order:

1. Look up `QA_<ROLE>_EMAIL` / `QA_<ROLE>_PASSWORD` in `.env.qa` (e.g. `QA_ADMIN_EMAIL`).
2. If present → confirm: *"Use the existing admin creds for the Admin role?"*
3. If absent → `AskUserQuestion` with options: (a) provide creds now, append to `.env.qa`; (b) self-register via UI if app supports it; (c) skip this role's flows for this run.
4. After successful login (via `qa/scripts/login-engage.js` — see `skills/web/helpers/login-engage.md`), save `storageState` to `qa/.auth/<role>.json`. Add `QA_<ROLE>_STORAGE_STATE=qa/.auth/<role>.json` to `.env.qa`.

#### 5. Only then proceed to W-3

Each W-3 flow declares its `Role` in the Summary table. Traced flows pick the right `storageState` file via `browser.newContext({ storageState: process.env[\`QA_${role.toUpperCase()}_STORAGE_STATE\`] })` — never re-login per flow.

**Login engagement** is delegated to `skills/web/helpers/login-engage.md`. It is the ONLY way to attempt a login from any runtime script — the shallow "fill + click + screenshot" loop is forbidden because it silently mis-classifies HomaCare-style form-reset rejections (see helper doc for evidence).

---

### Step W-3: Feature-Scoped Flow Creation

After BFS crawl, organize discovered pages into **feature-scoped flows** — one flow per distinct feature area (3-7 steps each).

**Manifest-first tracing.** Before executing any step in a flow, write its plan to `qa/flows/F-NNN-<slug>/manifest.jsonl` — one line per step `{step, action, target, url, status:"pending"}`. Then run the **Tracing Loop Contract** (see strategy files; governed by `skills/_shared/engagement-protocol.md` → *End-to-End Completion is Mandatory*): drive every manifest line to terminal status, append one line to `qa/progress.jsonl` per step, and auto-advance to the next PENDING flow in `journey-inventory.md` when the manifest is fully terminal. Do not stop mid-flow to ask the user what's left — the manifest is the answer.

**Resume**: `grep -v '"status":"done"' qa/flows/<active>/manifest.jsonl` → continue at the first non-done line. `tail -n 30 qa/progress.jsonl` confirms the last concrete action.

#### How to identify flows from the page inventory:

Group pages into flows based on **what the crawl actually found** — not assumed categories. Use these signals:
- **Pages that share a URL prefix** → likely one feature area (e.g., `/docs/*` = docs section)
- **Pages reachable from the same nav item** → one flow
- **Pages behind the same auth gate** → group together
- **Pages with related functionality** (seen in screenshots) → one flow
- **Standalone pages** (legal, about, contact) → can be grouped into one "static pages" flow

Do NOT assume every app has pricing, dashboard, blog, etc. Derive flow boundaries from the actual nav-graph and page inventory.

#### Create flow directories and flow.md:

```
qa/flows/F-001-[slug]/flow.md     ← 3-7 steps, one feature area
qa/flows/F-002-[slug]/flow.md
qa/flows/F-003-[slug]/flow.md
```

**flow.md template** — feature-scoped (NOT journey-scoped):
```markdown
# F-NNN: [Feature/Section Name]

## Summary
| Field | Value |
|-------|-------|
| **Flow ID** | F-NNN |
| **Application** | [AppName] |
| **Section** | [Feature area — derived from nav-graph grouping] |
| **Pages** | [URLs covered — list all pages in this flow] |
| **Auth Required** | Yes / No |
| **Priority** | P1 / P2 / P3 |
| **Status** | COMPLETE |

## Discovery Evidence

| Step | Page/Screen | Action | Screenshot | Observed |
|------|------------|--------|-----------|---------|
```

Screenshots taken during BFS crawl are **already captured** in `qa/flows/seed-crawl/flow.md`. Redistribute them into the correct F-NNN flows:

#### Bridge seed-crawl evidence into F-NNN flows

1. Read `qa/flows/seed-crawl/flow.md` — parse the Discovery Evidence table
2. Read `qa/crawl-state.json` — get the page manifest (URL → screenshot mapping)
3. For each F-NNN flow, find which BFS screenshots belong to it:
   - Match by URL prefix (e.g., pages at `/settings/*` → F-002-settings)
   - Match by nav-graph grouping (pages reachable from the same nav item)
4. Copy the matching evidence rows into each F-NNN's `flow.md` Discovery Evidence table
5. After all rows are distributed, delete the seed-crawl directory:
   ```bash
   rm -rf qa/flows/seed-crawl
   ```

> Every screenshot must end up in exactly one F-NNN flow. If a screenshot doesn't fit any flow, create a catch-all flow (e.g., `F-NNN-misc-pages`). The screenshot coverage gate will fail on any `.png` not referenced in a `flow.md`.

#### Present to user:

> "Discovered **[N] pages** across **[M] feature areas**:
>
> | Flow | Section | Pages | Auth |
> |------|---------|-------|------|
> | F-001 | [section name from nav-graph] | [N] | [Yes/No] |
> | F-002 | [section name] | [N] | [Yes/No] |
> | ... | | | |
>
> Any sections I should explore deeper?"

---

### Step W-3b: Context Reset After Each Flow

Follow root SKILL.md **"How to Reset After a Flow"** (lightweight reset — finalize flow.md, append to state.md, tell user).

**Web-specific addition**: close the browser context after each flow to free memory:
```javascript
await context.close(); // clean state for next flow
```

Screenshot coverage check and QA report are **deferred to Phase 1 → Phase 2 transition** — not run here.

---

### Step W-6: Save Exploration Knowledge Base

Write/update `qa/knowledgebase/` with:
- `ui-inventory.md` — Page inventory table (all crawled URLs), element inventory per page. Written in W-2.8 during BFS, enriched here with visual observations from screenshot analysis.
- `nav-graph.md` — Navigation graph built from BFS link collection (W-2.3 step 11). Every outbound link on every page = one row.
- `personas.md` — Discovered personas derived from auth boundaries, plan tiers, and feature sections visible in screenshots.
- `journey-inventory.md` — All flows with coverage status, updated as flows are traced.
- App-specific observations (SPA routes, redirect behavior, widget quirks)

---

## Phase 1 → Phase 2 Transition (automatic)

After all flows are traced (Step W-6 complete), do the **deferred housekeeping** that was skipped during per-flow resets:

1. **Update `qa/knowledgebase/journey-inventory.md`** — batch-update all flows as TRACED or SKIPPED based on what exists in `qa/flows/`

2. **Run screenshot coverage check** (lightweight inline — see Key Rules > Performance #17):
   ```bash
   node -e "
   const fs=require('fs'),p=require('path'),QA='qa';
   const disk=new Set(fs.readdirSync(p.join(QA,'knowledgebase','screenshots')).filter(f=>f.endsWith('.png')));
   const refs=new Set();
   for(const d of['flows','features']){const b=p.join(QA,d);if(!fs.existsSync(b))continue;
   for(const s of fs.readdirSync(b)){for(const f of['flow.md','overview.md']){
   const fp=p.join(b,s,f);if(!fs.existsSync(fp))continue;
   const c=fs.readFileSync(fp,'utf8');let m;const r=/[a-zA-Z0-9_-]+\\.png/g;
   while(m=r.exec(c))refs.add(m[0]);}}}
   const orphaned=[...disk].filter(f=>!refs.has(f));
   if(orphaned.length){console.warn('⚠',orphaned.length,'orphaned screenshots — registering...');orphaned.forEach(f=>console.warn(' ',f));}
   else console.log('✅',disk.size+'/'+disk.size,'screenshots covered');
   "
   ```
   If orphans found → register them with `node scripts/qa-screenshot.js` before continuing.

3. **Generate the QA report** — this is the correct time for report generation:
   ```bash
   node scripts/allure/generate-report.js --open
   ```

4. **Checkpoint** — write `qa/state.md`, log: `"Phase 1 complete — [N] flows traced. Continuing to Phase 2..."`

5. **Continue immediately to Phase 2** — do NOT wait for user approval.
   If auth-gated flows need credentials → ask user for credentials → once provided, continue.

---

## Phase 2: Scenario Planning

**Goal**: Generate test scenarios for every traced flow.
**Input**: `qa/flows/F-NNN-*/flow.md` files from Phase 1.
**Output**: `qa/flows/F-NNN-*/scenarios.md` per flow.
**Transition to Phase 3**: Automatic — after all scenarios written, immediately begin TC generation.

---

### Step W-7: Resolve Remaining Auth Gates

If Phase 1 BFS crawl skipped any auth gates (pages marked `⛔ AUTH REQUIRED` in ui-inventory.md), resolve them now before generating scenarios.

**Credential handling follows the same Auth-as-Gate protocol from Step W-2.6.** No duplication — same rules apply:
1. Check `.env.qa` → use if available
2. Ask user → provide in chat or tell agent to self-generate
3. Self-generate → disposable email + email verification flow (see below)
4. Use ONLY the auth method user chose — note others as "available but not tested"

After credentials resolved → **create `qa/auth.setup.ts`** so Playwright's `setup` project can save auth state:

```typescript
import { test as setup, expect } from '@playwright/test';
import path from 'path';

const AUTH_FILE = path.join(process.cwd(), 'qa/.auth/user.json');

setup('authenticate', async ({ page }) => {
  await page.goto(process.env.QA_APP_URL || '/');

  // Navigate to login — adapt selectors to what discovery screenshots showed
  await page.getByRole('link', { name: /sign in|log in|login/i }).click();
  await page.waitForURL(/login|signin|auth/, { timeout: 10000 }).catch(() => {});

  // Fill credentials from .env.qa
  await page.getByLabel(/email/i).fill(process.env.QA_TEST_EMAIL || '');
  await page.getByLabel(/password/i).fill(process.env.QA_TEST_PASSWORD || '');
  await page.getByRole('button', { name: /sign in|log in|submit/i }).click();

  // Wait for auth to complete — adapt to app's post-login state
  await page.waitForURL(/dashboard|home|app/, { timeout: 15000 }).catch(() => {});

  // Save auth state for reuse by other test projects
  await page.context().storageState({ path: AUTH_FILE });
});
```

**IMPORTANT**: This is a **starter template**. After writing it, read the Phase 1 auth-gate screenshots to adapt the selectors (login URL, field labels, button text, post-login URL) to match the actual app. The template above uses generic selectors that may not work for every app.

Then **re-run BFS crawl** from the auth-gated URLs to discover pages behind the gate. Add new pages to ui-inventory.md, create new flows for newly discovered feature areas.

#### Non-automatable Credentials

| Type | Action |
|------|--------|
| Google/X/Apple/GitHub SSO | `playwright codegen --save-storage=qa/.auth/sso.json [URL]` — mark as "requires manual session" |
| LLM API keys | User provides via .env.qa or chat |
| Stripe / payment | Use test card `4242 4242 4242 4242` if Stripe detected |
| TOTP / 2FA | User provides TOTP seed |
| Enterprise SSO / SAML | Out of scope — note in flow.md |

**Never block Phase 2** for non-automatable credentials. Continue with flows that have full access.

---

### Step W-9: Scenario Generation — Full Coverage

For each flow in `qa/flows/`, read `flow.md` and generate ALL scenarios using these rules:

#### Scenario Generation Rules

1. **Read the flow.md first** — every scenario MUST trace back to something observed in the Discovery Evidence table (a screenshot, a UI element, a page state). No invented scenarios.
2. **One scenario = one user intent + one expected outcome**. If a scenario has two assertions, split it.
3. **Naming**: `S-NNN-NN` — first NNN is the flow number, NN is sequence within flow. E.g., `S-001-01`, `S-001-02`.
4. **Cover all categories below** — for each flow, generate at minimum one scenario per applicable category. Skip categories that don't apply to that flow.
5. **Priority assignment**: P1 = user cannot complete their goal. P2 = degraded experience. P3 = cosmetic or edge case.

#### Universal scenario categories (apply to every flow):

| Category | Min per flow | Priority | Description |
|----------|-------------|----------|-------------|
| Happy path (end-to-end) | 1 | P1 | Complete the flow successfully with valid inputs |
| Required field validation | 1 per form | P1 | Submit with empty required fields |
| Invalid input | 1 per input | P1 | Wrong format, too long, special chars, SQL/XSS payloads |
| Boundary values | 1 per numeric/text input | P2 | Min, max, min-1, max+1, empty string |
| Error state recovery | 1 | P2 | After an error, can user retry and succeed? |
| Empty state | 1 | P2 | Page with no data (new user, empty list, no results) |
| Loading / slow network | 1 | P3 | Behavior during API calls, spinners, skeleton screens |
| Unauthorized access | 1 per auth-gated page | P1 | Direct URL access without login |

#### Web-specific scenario categories (apply in addition to the universal categories):

| Category | Min | Priority | When |
|----------|-----|----------|------|
| SPA route access (direct URL entry) | 1 | P1 | Every route |
| Auth guard (unauthenticated → protected route) | 1 | P1 | Auth-gated routes |
| Form validation (inline + on submit) | 2+ | P1 | Any form |
| Mobile viewport (375px, 390px) | 1 | P2 | Every page |
| Network error / API failure | 1 | P2 | Forms with API calls |
| Console error monitoring | 1 | P2 | Every page |
| WCAG accessibility (axe-core) | 1 | P3 | Every page |
| Visual regression baseline | 1 | P3 | Key pages |

**Target**: Use the discovery screenshots from Phase 1 to inform EVERY scenario. If a screenshot showed a specific UI element, write a test for it. Full coverage means every visible interactive element has at least one TC.

**Phase boundary checkpoint** — write full `qa/state.md` (heavy checkpoint per root SKILL.md). Generate QA report. Log: `"Phase 2 complete — [N] scenarios across [N] flows."`

---

## Phase 3: Test Case Generation

**Goal**: Write runnable Playwright test cases for every scenario.
**Input**: `qa/flows/F-NNN-*/scenarios.md` files from Phase 2.
**Output**: `qa/flows/F-NNN-*/test-cases/TC-NNN-*.md` files with embedded TypeScript.
**Transition to Phase 4**: Automatic — after all TCs written, immediately extract and run.

### Step W-10: Test Case Generation

For each scenario, write `TC-NNN-[slug].md` with embedded Playwright TypeScript.

**Standards for web TCs:**
- Use `waitUntil: 'domcontentloaded'` (never `networkidle` on SPAs)
- All URLs are relative — `page.goto('/')` not `page.goto('https://...')`
- `baseURL` comes from `QA_APP_URL` via `qa/playwright.config.ts`
- Screenshot evidence saved to `qa/knowledgebase/screenshots/TC-NNN-[slug].png`
- Credentials always from `process.env.QA_TEST_EMAIL` — never hardcoded
- Every TC that needs auth must use `storageState` (from `qa/.auth/user.json`) or explicit login steps

**TC structure for web:**
```markdown
# TC-NNN: [Scenario Name]

| Field | Value |
|-------|-------|
| **TC ID** | TC-NNN |
| **Flow** | F-NNN — [Journey Name] |
| **Scenario** | S-NNN-NN — [Scenario] |
| **Priority** | P1/P2/P3 |
| **Platform** | Web — Chromium |
| **Auth** | None / Required |
| **Automation** | Playwright (TypeScript) |
| **Created** | YYYY-MM-DD |

## Preconditions
- [ ] [state before test]

## Steps

| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | [action] | [expected] |

## Playwright Test

\`\`\`typescript
import { test, expect } from '@playwright/test';

test('TC-NNN: [description]', async ({ page }) => {
  // relative URL — baseURL from .env.qa → qa/playwright.config.ts
  await page.goto('/path', { waitUntil: 'domcontentloaded' });
  // Wait for content to render (adaptive)
  await page.waitForFunction(
    () => document.body.innerText.length > 50,
    { timeout: 15000 }
  ).catch(() => {});
  
  // assertions
  await expect(page.locator('[selector]')).toBeVisible();
  
  // evidence — TCs use raw Playwright screenshots (they run independently via test runner,
  // not the QA skill session — capture() is for Phase 1 discovery only)
  await page.screenshot({ path: 'qa/knowledgebase/screenshots/TC-NNN-pass.png', fullPage: true });
});
\`\`\`

## Pass Criteria
- [ ] [binary observable outcome]

## Evidence
\`qa/evidence/TC-NNN-pass.png\`

## Teardown
[None / cleanup steps]
```

**Phase boundary checkpoint** — write full `qa/state.md` (heavy checkpoint per root SKILL.md). Generate QA report. Log: `"Phase 3 complete — [N] TC files written."`

---

## Phase 4: Test Execution

**Goal**: Extract Playwright code from TC files, run tests, capture results.
**Input**: `qa/flows/F-NNN-*/test-cases/TC-NNN-*.md` files from Phase 3.
**Output**: `.spec.ts` files + Playwright execution results (pass/fail, screenshots on failure).
**End**: Generate unified report and open in browser.

### Step W-11: Extract Specs and Run

After all TCs are written, extract the Playwright TypeScript from each TC-*.md into runnable .spec.ts files:

```javascript
// Extract specs inline — find all TC-*.md, pull out ```typescript blocks, write .spec.ts
const fs = require('fs');
const path = require('path');

function findTCs(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) results.push(...findTCs(p));
    else if (e.name.startsWith('TC-') && e.name.endsWith('.md')) results.push(p);
  }
  return results;
}

for (const tc of findTCs('qa')) {
  const content = fs.readFileSync(tc, 'utf8');
  const match = content.match(/```typescript\s*\n([\s\S]*?)```/);
  if (!match) { console.log('⚠ No TS block:', tc); continue; }
  const specPath = tc.replace(/\.md$/, '.spec.ts');
  fs.writeFileSync(specPath, match[1].trim() + '\n');
  console.log('✅', path.relative('.', specPath));
}
```

Then run the tests:

```bash
# Run public tests (no auth)
npx playwright test --project chromium-public --config qa/playwright.config.ts

# Set up auth session (one-time)
npx playwright test --project setup --config qa/playwright.config.ts

# Run all tests (allure-playwright reporter auto-generates allure-results)
npx playwright test --config qa/playwright.config.ts

# Run specific TC
npx playwright test --grep "TC-001" --config qa/playwright.config.ts
```

### Step W-12: Generate Final Report

```bash
node scripts/allure/generate-report.js --open
```

Tell the user: `"✅ All 4 phases complete. [N] flows, [N] scenarios, [N] TCs, [N] passed / [N] failed. Report opened."`

---

### Step W-13: Update Mode

Triggered when `HAS_WORKSPACE` is detected (TC files already exist). The workspace has completed at least one full run. The goal is to **incrementally update** — not redo everything from scratch.

#### W-13.1: Read Current State

```bash
cat qa/state.md
cat qa/.qa-config.json
ls qa/flows/*/flow.md 2>/dev/null | wc -l
find qa -name "TC-*.md" 2>/dev/null | wc -l
```

Present to user:
> "Existing workspace for **[AppName]**:
>
> | Field | Value |
> |-------|-------|
> | Flows | [N] |
> | Scenarios | [N] |
> | TCs | [N] |
> | Last run | [date from state.md] |
>
> What would you like to do?
>
> **1) Re-discover** — re-crawl the app, find new pages/flows, keep existing TCs
> **2) Add flows** — add specific new flows without re-crawling
> **3) Re-run tests** — re-execute existing TCs and generate fresh report
> **4) Full refresh** — delete all flows and TCs, start Phase 1 from scratch"

Wait for user's choice.

#### W-13.2: Route Based on Choice

- **"1" / "re-discover"** → Delete `qa/crawl-state.json` (force fresh crawl), then run Step W-2 (BFS crawl) again. Compare new page inventory with existing `ui-inventory.md`. For new pages not in any existing flow → create new flow directories. For existing flows → keep as-is unless pages are gone (mark as stale). Then run Phase 2–4 for new flows only.

- **"2" / "add flows"** → Ask user which flows to add. Create new `F-NNN-*` directories. Run Phase 1 trace for those flows only → Phase 2 scenarios → Phase 3 TCs → Phase 4 execution. Existing flows untouched.

- **"3" / "re-run"** → Jump directly to Step W-11 (extract specs and run). Skip all discovery and generation.

- **"4" / "full refresh"** → Delete `qa/flows/`, `qa/knowledgebase/`, `qa/state.md`, `qa/crawl-state.json`. Keep `qa/.qa-config.json` and `qa/context/`. Then jump to Step W-2 (BFS crawl) — full Phase 1 restart with existing config.

---

## Key Rules — Web Skill

### Correctness

1. **Never hardcode URLs** — always `process.env.QA_APP_URL` or `page.goto('/')` (relative)
2. **Never hardcode credentials** — always `process.env.QA_TEST_EMAIL`, `process.env.QA_TEST_PASSWORD`
3. **Never use `networkidle`** — use `domcontentloaded` + `QA_PAGE_WAIT_MS` (configurable minimum wait)
4. **Always use `capture()`** for screenshots — never raw `page.screenshot()` — prevents orphans
5. **Screenshot AFTER interaction** — wait, verify, reveal hidden content, THEN screenshot (W-2.3 loop order)
6. **Verify every navigation** — compare `page.url()` to intended URL; name screenshots by ACTUAL URL, not intended
7. **Credentials gate** — do not write TCs until user confirms `.env.qa` is populated
8. **Relative URLs only** in test files — `'/'` not `'https://app.example.com/'`
9. **Scope nav selectors** to `page.locator('nav, header').first()` — avoid footer duplicates
10. **Never click destructive buttons** during BFS discovery — use the safe whitelist (W-2.5)

### Performance

11. **Configurable page wait** — `QA_PAGE_WAIT_MS` (default 2000ms) runs after every navigation. Tune per-app in `.env.qa`. Simple, predictable, works on every app.
12. **BFS limits** — `QA_MAX_PAGES` (default 50) and `QA_MAX_DEPTH` (default 5) prevent infinite crawl and context exhaustion. Increase for large apps.
13. **Disk state persistence** — `qa/crawl-state.json` written after every page. BFS survives context resets.
14. **Content fingerprinting** — detects duplicate pages at different URLs. Prevents wasted screenshots and context.
15. **Viewport screenshots by default** — only use `fullPage: true` for landing pages, long forms, or full inventories.
16. **Reuse browser, fresh context** — launch browser once per session, `browser.newContext()` per flow, `context.close()` after each flow.
17. **Lightweight coverage check** — use the inline script in "Phase 1 → Phase 2 Transition" (not the full Allure generator). Only run at phase boundaries.
