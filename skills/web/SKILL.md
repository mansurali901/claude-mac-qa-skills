---
name: native-qa-web
description: Autonomous QA skill for web applications using Playwright. Phase 1 discovers E2E user journeys via navigation graph analysis, then traces each journey end-to-end with screenshots. Phase 2 generates full coverage test cases after credentials are provided.
platform: web
status: beta
version: 2.0.0
---

# Web QA Skill — Playwright-Based Workflow

Two phases. Phase 1 = pure exploration (screenshots at every step, no TC generation). Phase 2 = full coverage test generation (triggered after credentials are provided).

---

## Prerequisites

- Node.js 20+ installed
- `npm install` run in project root (installs `@playwright/test`, `dotenv`)
- `npx playwright install chromium` run at least once
- `.env.qa` at repo root — see `.env.example`

---

## Phase 1: Exploratory Discovery

**Goal**: Map every reachable page, discover all E2E user journeys, and trace each journey end-to-end with screenshots.
**Output**: `qa/knowledgebase/` (screenshots, nav graph, personas, journey inventory) + `qa/flows/F-NNN-*/flow.md` files with evidence tables.
**Stop condition**: All discovered journeys traced or explicitly skipped with reason. Auth-gated journeys documented as needing credentials.
**No TC generation in Phase 1.**

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

## STOP / PAUSE / SAVE STATE — Always Active

**This handler is active at every step. Whenever the user says "stop", "pause", "save state", or any equivalent — write the state file immediately. Do not just acknowledge.**

1. **Write `qa/state.md` now** — capture everything known at this exact moment:
   - Completed journeys (with screenshot counts and key observations)
   - In-progress journey (if mid-trace: note the `flow.md` already exists with observations up to the stopped step — resume will continue appending from here)
   - Pending journeys (names, priority, auth requirement)
   - Journey coverage: [N traced] / [N total] ([%])
   - App metadata (name, URL, auth method, plans/tiers)
   - Credentials status
   - Next action (exact resume point — e.g. "Resume F-003 trace from step 5, flow.md has steps 1-4 already written")

2. **Tell the user**:

> "✅ Checkpoint saved to `qa/state.md`
>
> | Saved | Value |
> |-------|-------|
> | Journeys completed | [N] / [Total] — [names] |
> | In progress | [journey name, step reached] or None |
> | Journeys pending | [N] — [names] |
> | Screenshots taken | [N] |
> | TCs written | [N] |
>
> Type `/clear` now to reset context, then paste:
> `Read qa/state.md and continue QA for [AppName]`"

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
  throw new Error('.env.qa not found. Copy .env.example to .env.qa and fill in your values.');
}
if (!process.env.QA_APP_URL) {
  throw new Error('QA_APP_URL is not set in .env.qa');
}

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

### Step W-2: Homepage Discovery

Navigate to the app root and take a full-page screenshot.

```javascript
// Run via: node qa/knowledgebase/discover.js  (or inline Playwright)
const { chromium } = require('@playwright/test');
require('dotenv').config({ path: '.env.qa' });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const { capture } = require('../scripts/qa-screenshot');
  await page.goto(process.env.QA_APP_URL, { waitUntil: 'domcontentloaded' });
  // Adaptive wait — proceed when content renders or after 15s ceiling
  await page.waitForFunction(
    () => document.body.innerText.length > 100 && !document.body.innerText.includes('Loading'),
    { timeout: 15000 }
  ).catch(() => {});
  // Use capture() — registers in seed-crawl flow.md, no orphans
  await capture(page, {
    flow: 'seed-crawl',
    step: 1,
    action: 'Homepage initial load',
    observed: '(fill after Read)',
    file: 'homepage-initial.png',
    fullPage: true,
  });
  
  // Enumerate all links and buttons on the page
  const links = await page.evaluate(() =>
    [...document.querySelectorAll('a[href]')].map(a => ({
      text: a.innerText.trim(),
      href: a.href,
      location: a.closest('nav') ? 'nav' : a.closest('footer') ? 'footer' : 'body'
    })).filter(l => l.text && l.href.startsWith(window.location.origin))
  );
  const buttons = await page.evaluate(() =>
    [...document.querySelectorAll('button, [role=button]')].map(b => b.innerText.trim()).filter(Boolean)
  );
  
  console.log('Links:', JSON.stringify(links, null, 2));
  console.log('Buttons:', buttons);
  
  await browser.close();
})();
```

**Read** `qa/knowledgebase/screenshots/homepage-initial.png` with the Read tool. Identify:
- Top-level navigation items
- Hero CTAs (primary action buttons)
- Footer links
- Authentication entry points (`Log in`, `Sign up`)
- Any tabs / section switchers on the page

Record all discovered entry points in `qa/knowledgebase/ui-inventory.md`.

---

### Step W-3: Seed URL Crawl

Visit every reachable page with a headless Playwright crawl. For each page:
1. Navigate to the URL
2. Wait for content to render (use adaptive wait — see Performance section)
3. Take a screenshot using `capture()` — this registers it in the seed crawl evidence:
   ```javascript
   await capture(page, {
     flow: 'seed-crawl',  // special ID — creates qa/flows/seed-crawl/flow.md
     step: N,
     action: 'Crawl [page-name]',
     observed: '(fill after Read)',
     file: 'page-[slug].png',
   });
   ```
4. Read the screenshot — note: page type, key elements, auth state, any redirects
5. Update the observed column with findings

**Important**: Use `capture()` for seed crawl screenshots too — this prevents orphans from the start. Create `qa/flows/seed-crawl/flow.md` before the crawl begins.

**Seed URLs to visit** (adapt to the specific app):
- `/` — homepage
- `/pricing` — pricing/plans
- `/account` or `/login` or `/signup` — auth entry
- `/dashboard` — will redirect if not authed
- `/settings` — will redirect if not authed
- Any nav links discovered in Step W-2
- Any footer links

For each URL, record in `qa/knowledgebase/ui-inventory.md`:

```markdown
| URL | Screenshot | Page Type | Auth Required | Key Elements |
|-----|-----------|----------|---------------|-------------|
| / | homepage-initial.png | Marketing/Landing | No | H1, hero CTA, nav, FAQ |
| /pricing | page-pricing.png | Pricing | No | Free/Pro cards, toggle, FAQ |
| /account | page-account.png | Auth | No (redirects to here) | Sign-up form, SSO buttons, email/password fields |
| /dashboard | page-dashboard.png | App | Yes (redirects to /account) | — |
```

---

### Step W-3b: Journey Discovery — Derive E2E User Journeys

**This is the critical planning step.** Before tracing anything, analyze the seed crawl data from W-2 and W-3 to discover every possible end-to-end user journey in the application. This must be dynamic — derived from observations, not hardcoded.

#### W-3b.1: Build the Navigation Graph

From the seed crawl page inventory (`qa/knowledgebase/ui-inventory.md`), construct a directed graph:

```
For each page:
  - List every outbound link/CTA and where it leads
  - Mark auth requirement (public / auth-gated / plan-gated)
  - Mark page type (marketing / auth / app / content / legal / pricing)
```

Write this to `qa/knowledgebase/nav-graph.md`:

```markdown
## Navigation Graph

| From | Action/CTA | To | Auth Gate |
|------|-----------|-----|-----------|
| [homepage URL] | [primary CTA text] | [target URL] | none |
| [homepage URL] | [login link text] | [login URL] | none |
| [homepage URL] | [nav link text] | [target URL] | none |
| [auth page URL] | Submit sign-up form | [post-auth URL] | creates auth |
| [auth page URL] | Submit sign-in form | [post-auth URL] | requires auth |
| [app page URL] | [sidebar/nav link] | [target section] | requires auth |
| [pricing URL] | [upgrade CTA text] | [payment flow] | requires auth + payment |
```

Populate with the actual URLs, CTA labels, and auth gates observed during the seed crawl. Every outbound link/CTA on every page becomes a row.

#### W-3b.2: Identify User Personas

From the navigation graph, derive personas by looking at:
- **Auth boundaries** → at minimum 2 personas: unauthenticated visitor, authenticated user
- **Plan/tier indicators** → Free vs Pro badges, upgrade CTAs, plan-gated features → split auth users by tier
- **Onboarding presence** → wizard, setup steps → "new user" persona distinct from "returning user"
- **Admin/power features** → config panels, debug tools, API management → "admin" persona
- **Content sections** → blog, tutorial, community → "evaluator" persona

Write to `qa/knowledgebase/personas.md`:

```markdown
## Discovered Personas

| # | Persona | How Identified | Auth State | Entry Point |
|---|---------|---------------|------------|-------------|
| P1 | [name] | [what in the UI revealed this persona] | [None/Auth/Auth+Plan] | [entry URL] |
| P2 | [name] | [evidence] | [auth state] | [entry URL] |
```

**Common persona patterns** (adapt based on what the seed crawl actually reveals):
- Public visitor → identified by: public pages exist with sign-up CTAs
- Evaluator → identified by: pricing/comparison/testimonial pages exist
- New user → identified by: onboarding wizard or setup flow detected after auth
- Returning user → identified by: sign-in form separate from sign-up, dashboard with existing data
- Tiered users (Free/Pro/Enterprise) → identified by: plan badges, upgrade CTAs, gated features
- Admin/Power user → identified by: settings panels, config pages, debug/log sections
- Content consumer → identified by: blog, docs, tutorial, help center pages exist

Only include personas that have **evidence in the seed crawl**. Do not invent personas the app doesn't support.

#### W-3b.3: Map Goals per Persona

For each persona, ask: **what does this person come to the app to accomplish?**

Derive goals from:
- **CTAs** → every CTA is a goal invitation (e.g. a "Get Started" button = goal: create account)
- **Navigation sections** → every nav item is a feature area the user wants to reach
- **Forms** → every form is a task the user wants to complete
- **Auth gates** → crossing an auth gate is a sub-goal (sign up / sign in)
- **State changes** → any action that changes visible state (timer starts, assistant created, device approved)

#### W-3b.4: Derive Journeys — Path from Entry to Goal

A **journey** = one persona + one goal + the complete path through the app to achieve it.

**Algorithm:**
```
For each persona:
  For each goal that persona has:
    1. Start at the persona's entry point
    2. Follow the navigation graph to reach the goal
    3. Record every page/screen/state transition on the path
    4. The path from entry to goal completion = one journey
    5. If the path hits an auth gate → the sign-in/sign-up is part of the journey, not a separate flow
    6. If the path hits a plan gate → the upgrade flow is part of the journey
```

**Deduplication rules:**
- If two personas share the exact same path → merge into one journey, note both personas
- If two goals share a common prefix (same first 5 steps, different endings) → keep as separate journeys
- A sub-path that appears in 3+ journeys → still trace it each time (journeys are independent E2E runs)

#### W-3b.5: Write Journey Inventory

Write `qa/knowledgebase/journey-inventory.md`:

```markdown
## Journey Inventory

**Total journeys discovered: [N]**
**Coverage: 0/[N] traced (0%)**

| # | Flow ID | Journey Name | Persona | Goal | Path Summary | Pages | Auth | Priority |
|---|---------|-------------|---------|------|-------------|-------|------|----------|
| 1 | F-001 | [Name] | P1: [persona] | [goal] | [entry] → [page] → ... → [end state] | [N] | [Yes/No] | P1 |
| 2 | F-002 | [Name] | P2: [persona] | [goal] | [entry] → [page] → ... → [end state] | [N] | [Yes/No] | P1 |
```

**Priority rules:**
- P1: Journeys that cross an auth boundary (sign-up, sign-in, onboarding) or involve the core product action
- P2: Journeys within a single auth state (all-public or all-authenticated)
- P3: Content/informational journeys (blog, tutorial, legal)

#### W-3b.6: Present to User for Confirmation

Tell the user:

> "I've analyzed [AppName] and discovered **[N] end-to-end user journeys** across **[M] personas**:
>
> | # | Journey | Persona | Path | Priority |
> |---|---------|---------|------|----------|
> | F-001 | [Name] | [Persona] | [Entry] → ... → [End] | P1 |
> | ... | | | | |
>
> This covers:
> - **[N1]** public journeys (no auth)
> - **[N2]** authenticated journeys (requires sign-in)
> - **[N3]** plan-gated journeys (requires upgrade)
>
> Should I trace all [N], or would you like to adjust the list?"

Wait for confirmation before proceeding to Step W-4.

---

### Step W-4: Journey Tracing — Screenshot at Every Step

**This is the core of Phase 1.** For every discovered journey, trace it end-to-end as a real user would — one continuous browser session per journey, screenshot after every action.

Each journey crosses multiple pages/features. The journey is the container; the features are steps within it.

#### Naming convention
```
qa/knowledgebase/screenshots/flow-[F-NNN-slug]-step[NN]-[description].png
```

#### Directory structure
```
qa/flows/F-NNN-[slug]/
├── flow.md             ← Full E2E journey trace with all evidence
└── test-cases/         ← Phase 2: test cases for this journey
```

#### For each journey — incremental write protocol:

1. **Create `flow.md` immediately** — before opening the browser:

```markdown
# F-NNN: [Journey Name]
> ⚠️ IN PROGRESS — being traced. Do not use until marked complete.

## Summary
| Field | Value |
|-------|-------|
| **Flow ID** | F-NNN |
| **Application** | [AppName] |
| **Persona** | [Persona name and description] |
| **Goal** | [What the user is trying to accomplish] |
| **Entry Point** | [Starting URL/state] |
| **End State** | [Success condition] |
| **Pages Crossed** | [N] |
| **Auth Transition** | [None / Sign-up / Sign-in / Upgrade] |
| **Priority** | P1 / P2 / P3 |
| **Status** | IN PROGRESS |

## Discovery Evidence

| Step | Page/Screen | Action | Screenshot | Observed |
|------|------------|--------|-----------|---------|
```

2. Open a fresh browser context (clean state matching the persona's starting condition)

3. For each step in the journey — do ALL of the following before moving to the next step:
   - Perform the action
   - **Use the `capture()` utility** to screenshot AND register in flow.md atomically:
   ```javascript
   const { capture } = require('../scripts/qa-screenshot');
   const result = await capture(page, {
     flow: 'F-001-new-user-onboarding',
     step: 1,
     action: 'Land on homepage',
     observed: '(filled after Read)',
     file: 'flow-F001-step01-homepage.png',
     fullPage: true,
   });
   ```
   - **Read the screenshot** with the Read tool
   - **Update the observed column** with full observations
   - **Note the page/feature** being crossed in the `Page/Screen` column — this captures feature-level detail within the journey

   The utility is **idempotent** — if the screenshot is already referenced, it skips.
   This prevents orphaned screenshots: every capture is registered at the moment it's taken.

   **Fallback (manual)**: If not using the utility, you MUST append the row to flow.md immediately after screenshot. Do not defer.

4. **At auth boundaries** — when the journey crosses a sign-up/sign-in gate:
   - Screenshot the auth form
   - Fill credentials (from `.env.qa` or ask user)
   - Screenshot each auth step
   - Continue the journey on the other side of the gate
   - Do NOT stop and create a separate "auth flow" — auth is part of this journey

5. **Finalize `flow.md`** — after all steps are traced, fill in remaining sections and mark as `COMPLETE`.

6. **Update `qa/knowledgebase/journey-inventory.md`** — mark this journey as traced, record step count and screenshot count.

---

##### Example: Tracing a Journey

The agent writes Playwright steps dynamically based on what the journey requires. No hardcoded URLs or selectors — discover elements from screenshots at each step.

```javascript
const { capture } = require('../scripts/qa-screenshot');

// Step 1: Start at the journey's entry point
await page.goto(process.env.QA_APP_URL, { waitUntil: 'domcontentloaded' });
// Adaptive wait — proceed when content renders
await page.waitForFunction(
  () => document.body.innerText.length > 100 && !document.body.innerText.includes('Loading'),
  { timeout: 15000 }
).catch(() => {});
await capture(page, {
  flow: 'F-001-[flow-slug]',
  step: 1,
  action: 'Land on entry page',
  page: 'Homepage `/`',
  observed: '(fill after Read)',
  file: 'flow-F001-step01-entry.png',
});
// READ screenshot → describe what's visible → update observed column

// Step 2: Follow the primary CTA toward the goal
// (discover the CTA text/selector from the screenshot, don't hardcode)
const primaryCTA = page.getByRole('link', { name: /[CTA text from screenshot]/i }).first();
await primaryCTA.click();
await page.waitForTimeout(500); // brief UI settle after click
await capture(page, {
  flow: 'F-001-[flow-slug]',
  step: 2,
  action: 'Click primary CTA',
  page: '[target page] `[URL]`',
  observed: '(fill after Read)',
  file: 'flow-F001-step02-after-cta.png',
});
// READ → describe → continue

// Step 3+: Continue until the journey's goal state is reached
// If an auth gate appears → handle it inline (fill credentials, submit)
// If a form appears → fill it, screenshot before and after submit
// If a new page loads → screenshot and document it in the Page/Screen column
```

**Key principle**: each journey is a continuous browser session. Do NOT close the browser between pages. Auth transitions, form submissions, redirects — they all happen within the same session, just like a real user.

---

#### Mid-Exploration Auth Gate — Credential Prompt

When navigating to a route that redirects or shows any access restriction:

1. **Screenshot the gate** — capture exactly what the UI shows
2. **Read the screenshot** — identify the exact credential type required. Do not assume email + password. Read what the UI actually shows:

| What the UI shows | Credential type |
|-------------------|----------------|
| Email + Password fields | Login credentials |
| API key input field | API key (OpenAI, Anthropic, custom, etc.) |
| License key field | License / activation key |
| "Connect your account" OAuth button | OAuth token |
| TOTP / 2FA code input | Time-based one-time password |
| Multiple plan options visible | Plan selection required |
| Account tier / plan gate ("Pro only") | Plan upgrade required |
| Invite code field | Invite / beta access code |
| Webhook URL / secret | Webhook credentials |
| Any other field | Read its label exactly |

3. **Check for plan selection** — if the screenshot shows multiple plans or tiers, ask before anything else:

> "I can see multiple plans available: [list plan names exactly as shown in the UI]
> Which plan should I test with?"

Store the selected plan in `.qa-config.json` as `QA_ACCOUNT_TIER`. Use it throughout to decide which flows to trace and which to mark as plan-gated.

4. **Then ask for credentials** — using the exact field names from the screenshot:

> "**[Journey Name]** needs access to continue.
>
> The app is asking for: **[exact credential type — e.g. "an OpenAI API key", "email + password", "a Pro plan", "an invite code"]**
>
> How would you like to provide it?
>
> **1. Check `.env.qa`** — I'll look for the relevant key right now
> **2. Tell me in the chat** — paste the value here (used this session only, never written to tracked files)
> **3. Self-register** — only available for email + password signup flows
> **4. Skip for now** — document this gate and come back in Phase 2"

#### Route Based on Answer

**Option 1 — Check `.env.qa`:**

Read `.env.qa` and match what the UI needs — not just `QA_TEST_EMAIL`:

```bash
cat .env.qa 2>/dev/null || echo "File not found"
```

| UI needs | Look for in .env.qa |
|----------|-------------------|
| Email + password | `QA_TEST_EMAIL`, `QA_TEST_PASSWORD` |
| OpenAI API key | `QA_LLM_API_KEY` or `OPENAI_API_KEY` |
| Anthropic API key | `QA_LLM_API_KEY` or `ANTHROPIC_API_KEY` |
| License key | `QA_LICENSE_KEY` |
| Account tier | `QA_ACCOUNT_TIER` |
| Any other | Read label from screenshot, search `.env.qa` for a matching key name |

If found → log in / inject the value via Playwright → save session to `qa/.auth/user.json` if applicable → proceed to trace the flow immediately.
If missing → tell the user exactly which key is missing, offer Options 2 or 4.

**Option 2 — Value in chat:**
User pastes the credential value. Use it in this session via Playwright only.
Do NOT write to any tracked file. If it should persist → write to `.env.qa` only (gitignored).

**Option 3 — Self-register:**
Only when the UI shows an email + password signup form. Generate:
```javascript
const email    = `qa-test-${Date.now()}@mailinator.com`;
const password = `QaTest@${Math.random().toString(36).slice(2, 10)}`;
```
Attempt signup via Playwright. If successful → write to `.env.qa` → save session → proceed.
If gated (invite only, CAPTCHA, paid plan, no signup form visible) → tell user and fall back to Option 4.

**Option 4 — Skip:**
- Append to `flow.md` discovery evidence table: `⛔ Access required — [exact credential type] — deferred to Phase 2`
- Note in `qa/state.md` under pending journeys: journey name + exact credential type needed
- Continue to the next journey

---

##### Subsequent journeys

For each remaining journey in the inventory, apply the same tracing protocol:
1. Open a fresh browser context matching the persona's starting state
2. Write inline Playwright steps following the journey's path
3. Use `capture()` for every screenshot — atomic registration
4. Read every screenshot, document in flow.md
5. Update journey-inventory.md coverage count after each journey

---

### Step W-4b: Context Reset After Each Journey

After tracing a journey and reading all its screenshots:

1. Finalize `qa/flows/F-NNN-[slug]/flow.md` with the discovery evidence table
2. **Run lightweight screenshot coverage check** (see Key Rules > Performance #12 for the inline script). If orphans found, register them with `node scripts/qa-screenshot.js` before moving on.
3. Update `qa/knowledgebase/journey-inventory.md` — mark this journey as traced, update coverage count
4. Append to `qa/state.md` — mark this journey as done, list the next journey pending
5. Tell the user:
   > "Journey **F-NNN — [name]** traced ✅ ([N] steps, [M] screenshots, [P] pages crossed).
   > Coverage: [X]/[Total] journeys ([%]).
   >
   > Type `/clear` now to reset context, then paste:
   > `Read qa/state.md and continue Phase 1. Next: F-[NNN+1] — [name].`"

Do NOT continue to the next journey in the same context after reading 3+ journeys worth of screenshots.

---

### Step W-5: Document Journeys

Each journey is documented in `qa/flows/F-NNN-[slug]/flow.md`. The flow.md includes:
- Summary metadata table (persona, goal, entry point, end state, pages crossed, auth transitions)
- **Discovery Evidence table** — every step with page/screen, action, screenshot, and observation
- UI Elements table — all interactive elements encountered across the journey
- Feature checkpoints — which features/pages were crossed and what was observed at each
- Auth boundary notes — how sign-up/sign-in/upgrade was handled within the journey

The evidence table has an extra `Page/Screen` column compared to feature-level flows:
```markdown
## Discovery Evidence

| Step | Page/Screen | Action | Screenshot | Observed |
|------|------------|--------|-----------|---------|
| 1 | [page name] `[URL]` | [what user did] | `flow-F001-step01-[slug].png` | [what was visible on screen] |
| 2 | [page name] `[URL]` | [next action] | `flow-F001-step02-[slug].png` | [observations] |
| 3 | [auth page] `[URL]` | [fill form / submit] | `flow-F001-step03-[slug].png` | [auth form elements, validation] |
| 4 | [post-auth page] `[URL]` | [observe new state] | `flow-F001-step04-[slug].png` | [what changed after auth] |
```

Each row captures the **page the user is on** + **what they did** + **what they saw**. The `Page/Screen` column is what gives feature-level visibility within the journey.

This captures **which page the user is on at each step** — giving both journey-level and feature-level visibility in one document.

---

### Step W-6: Save Exploration Knowledge Base

Write/update `qa/knowledgebase/` with:
- `ui-inventory.md` — Page inventory table (all crawled URLs), element inventory per page
- `nav-graph.md` — Navigation graph (from W-3b.1)
- `personas.md` — Discovered personas (from W-3b.2)
- `journey-inventory.md` — All journeys with coverage status (from W-3b.5, updated after each trace)
- App-specific observations (SPA routes, redirect behavior, widget quirks)

---

## Phase 1 → Phase 2 Handoff

After Step W-6, the main SKILL.md **Phase 1 Complete Gate** takes over. It:

1. **Hard gate — verify journey coverage**:
   ```bash
   node -e "
   const fs = require('fs');
   const inv = fs.readFileSync('qa/knowledgebase/journey-inventory.md', 'utf8');
   const total = (inv.match(/\| J-\d+/g) || []).length;
   const traced = (inv.match(/TRACED|COMPLETE/gi) || []).length;
   const skipped = (inv.match(/SKIPPED/gi) || []).length;
   const pending = total - traced - skipped;
   console.log('Total:', total, '| Traced:', traced, '| Skipped:', skipped, '| Pending:', pending);
   if (pending > 0) { console.error('❌ BLOCKED —', pending, 'journeys not traced or skipped'); process.exit(1); }
   console.log('✅ All journeys accounted for');
   "
   ```
   If any journey is neither traced nor explicitly skipped with a reason → **stop and trace it** before proceeding.

2. **Screenshot coverage gate** — run Allure generator (blocks if orphaned screenshots exist)
3. Writes the checkpoint to `qa/state.md`
4. Tells the user which journeys need credentials for deeper tracing
5. **Generates the Phase 1 Allure report** (discovery summary with screenshots)
6. Waits for the user to populate `.env.qa`

### Phase 1 Allure Report

After the checkpoint is written, generate the Allure discovery report:

```bash
# Generate allure-results from discovery data (flow.md + screenshots)
node scripts/allure/generate-phase1-report.js

# Build the HTML report
npx allure generate allure-results -o allure-report --clean

# Open in browser
npx allure open allure-report
```

Or use the npm script shortcut:

```bash
npm run allure:phase1:open
```

Tell the user:

> "**Phase 1 Allure Report** generated at `allure-report/index.html`
>
> The report includes:
> - **Product: [AppName]** — all results labeled with the product/system name
> - Discovery summary (app metadata, platform, journey count, coverage %)
> - One entry per traced journey with step-by-step discovery evidence
> - Screenshots attached to each discovery step
> - Journey priority and auth-requirement labels
> - Persona and goal metadata per journey
> - Environment info (app, platform, OS)
>
> Run `npm run allure:open` to view it again."

---

## Phase 2: Full Coverage Test Generation

**Entry**: User confirms credentials are set in `.env.qa`.

---

### Step W-7: Credential Acquisition — Screenshot-Driven

**Credentials depend entirely on what the app's UI shows. Never assume email + password.**

#### Step W-7a: Read Auth Screenshots First

Before asking the user for anything, read every auth/login/onboarding/settings screenshot captured in Phase 1 using the Read tool:

```
qa/knowledgebase/screenshots/journey-*-signin-*.png
qa/knowledgebase/screenshots/journey-*-auth-*.png
qa/knowledgebase/screenshots/journey-*-onboarding-*.png
... (all auth-related screenshots from Phase 1 journeys)
```

From the screenshots, identify **every credential field actually visible in the UI**. Common possibilities (not an exhaustive list):

| UI shows | Credential needed |
|----------|------------------|
| Email + Password fields | `QA_TEST_EMAIL`, `QA_TEST_PASSWORD` |
| "Paste your API key" input + model dropdown | `QA_LLM_API_KEY`, `QA_LLM_PROVIDER` |
| Username (not email) | `QA_USERNAME` |
| API key only | `QA_API_KEY` |
| Bearer token / access token | `QA_BEARER_TOKEN` |
| Workspace slug + credentials | `QA_WORKSPACE`, `QA_PASSWORD` |
| Sign in with Google / X / Apple button | SSO — cannot automate, requires manual session |
| Payment / billing fields | Use Stripe test card if Stripe detected |
| Two-factor / TOTP code | `QA_TOTP_SECRET` |

**If a screenshot is unclear**, take a fresh one now before proceeding.

#### Step W-7b: Present Options Based on What Screenshots Show

After identifying the actual fields, tell the user exactly what is needed and offer the three options:

> "To trace **[F-NNN — Journey Name]**, I can see from the screenshots that the app needs:
>
> | Field seen in UI | Env key I'll use |
> |-----------------|-----------------|
> | [exact field label, e.g. "Claude API Key"] | `QA_LLM_API_KEY` |
> | [e.g. "Email"] | `QA_TEST_EMAIL` |
>
> How would you like to provide these?
>
> **Option 1 — Check `.env.qa`**
> I'll read `.env.qa` now and tell you if those exact fields are already set.
>
> **Option 2 — Provide here in chat**
> Paste values in any format: `field: value | field2: value2`
> I'll save them to `.env.qa`. Use test/dedicated values — not personal or production.
>
> **Option 3 — I'll obtain them myself**
> Only available if the UI showed an email + password signup form and nothing else.
> I'll create a throwaway account using Mailinator and save the credentials.
> Not available for: API keys, LLM keys, OAuth/SSO buttons, payment fields, tokens — those require a real account."

#### Handling Each Option

**Option 1 — Read `.env.qa`**

```bash
node -e "
require('dotenv').config({ path: '.env.qa' });
// Check only the fields identified from screenshots
const needed = ['QA_[FIELD_1]', 'QA_[FIELD_2]']; // ← replace with actual fields
needed.forEach(k => console.log(k + ':', process.env[k] ? '✅ set' : '❌ MISSING'));
"
```

All set → proceed. Any missing → report exact field name and wait.

**Option 2 — Provided in chat**

Parse whatever format the user sends and append to `.env.qa`:
```bash
# Append only provided fields — do not touch other fields
echo "QA_[FIELD_NAME]=provided-value" >> .env.qa
```

**Option 3 — Self-registration** *(email/password signup only)*

Only run this if Phase 1 screenshots confirmed an email + password signup form exists. Read each screenshot as you go:

```javascript
const { capture } = require('../scripts/qa-screenshot');
const ts = Date.now();
const testEmail = `qatest-${ts}@mailinator.com`;
const testPassword = `QAtest${ts}!`;

// Navigate to signup (URL from Phase 1 nav-graph.md — not hardcoded)
const signupURL = '...'; // ← read from qa/knowledgebase/nav-graph.md
await page.goto(signupURL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => document.body.innerText.length > 50, { timeout: 15000 }
).catch(() => {});
await capture(page, {
  flow: 'F-NNN-[flow-slug]', step: N,
  action: 'Navigate to signup page',
  observed: '(fill after Read)',
  file: 'flow-FNNN-stepNN-self-reg-form.png',
});
// READ — confirm what fields are on screen before filling

// Fill exactly the fields visible in the screenshot — DO NOT fill fields that are not visible
await page.getByLabel(/email/i).or(page.getByPlaceholder(/email/i)).first().fill(testEmail);
// ... fill other fields as seen in screenshot

await capture(page, {
  flow: 'F-NNN-[flow-slug]', step: N + 1,
  action: 'Fill self-registration form',
  observed: '(fill after Read)',
  file: 'flow-FNNN-stepNN-self-reg-filled.png',
});
// READ — verify before submitting

await page.getByRole('button', { name: /sign up/i }).first().click();
await page.waitForFunction(
  () => !document.body.innerText.includes('Loading'), { timeout: 15000 }
).catch(() => {});
await capture(page, {
  flow: 'F-NNN-[flow-slug]', step: N + 2,
  action: 'Submit self-registration',
  observed: '(fill after Read)',
  file: 'flow-FNNN-stepNN-self-reg-result.png',
  fullPage: true,
});
// READ — where did we land? success / email verification / onboarding / error?
// If onboarding needs MORE credentials (e.g., API key) → loop back to Step W-7b for those fields
```

#### Non-automatable Credentials

| Credential type | Why it can't be automated | What to do |
|----------------|--------------------------|-----------|
| Google/X/Apple/GitHub SSO | OAuth redirects to third-party | Provide `playwright codegen --save-storage=qa/.auth/sso.json [URL]` command; mark TC "requires manual session" |
| LLM API keys (OpenAI/Anthropic/Gemini) | Require paid API account | User must provide via Option 1 or 2 |
| Stripe / payment | Real billing | Use Stripe test card `4242 4242 4242 4242` if Stripe detected; otherwise user provides |
| TOTP / 2FA | Requires seed enrollment | User provides TOTP seed via Option 2 |
| Enterprise SSO / SAML | Requires IDP | Mark as out-of-scope in flow.md |

**Never block Phase 2** for non-automatable credentials. Write a "Credential Note" in the affected `flow.md`, provide the best alternative, and continue with other journeys.

---

### Step W-8: Authenticated Journey Tracing

After credentials are resolved, continue tracing auth-gated journeys. Auth is part of the journey — not a separate step.

```javascript
require('dotenv').config({ path: '.env.qa' });
const { capture } = require('../scripts/qa-screenshot');
const { QA_TEST_EMAIL, QA_TEST_PASSWORD, QA_APP_URL } = process.env;

// Reuse browser from session, fresh context for clean auth state
const context = await browser.newContext();
const page = await context.newPage();

// Navigate to the auth page discovered in Phase 1 (use URL from nav-graph.md, not hardcoded)
const authURL = '...'; // ← read from qa/knowledgebase/nav-graph.md
await page.goto(QA_APP_URL + authURL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => document.body.innerText.length > 50,
  { timeout: 15000 }
).catch(() => {});

// Discover the sign-in form elements from the screenshot — don't assume field names
await capture(page, {
  flow: 'F-NNN-[flow-slug]',
  step: N,
  action: 'Navigate to auth page',
  observed: '(fill after Read)',
  file: 'flow-FNNN-stepNN-auth-page.png',
});
// READ screenshot → identify exact field selectors → fill credentials

await page.getByLabel(/email/i).or(page.getByPlaceholder(/email/i)).first().fill(QA_TEST_EMAIL);
await page.getByLabel(/password/i).or(page.getByPlaceholder(/password/i)).first().fill(QA_TEST_PASSWORD);
await capture(page, {
  flow: 'F-NNN-[flow-slug]',
  step: N + 1,
  action: 'Fill credentials',
  observed: '(fill after Read)',
  file: 'flow-FNNN-stepNN-creds-filled.png',
});

await page.getByRole('button', { name: /sign in/i }).first().click();
await page.waitForFunction(
  () => !document.body.innerText.includes('Loading') && document.body.innerText.length > 100,
  { timeout: 15000 }
).catch(() => {});
await capture(page, {
  flow: 'F-NNN-[flow-slug]',
  step: N + 2,
  action: 'Submit sign-in',
  observed: '(fill after Read)',
  file: 'flow-FNNN-stepNN-post-signin.png',
});
// READ screenshot → continue the journey from the post-auth page
```

Continue tracing the journey through authenticated sections (dashboard, settings, etc.) with `capture()` at every step.

---

### Step W-9: Scenario Generation — Full Coverage

For each flow in `qa/flows/`, generate ALL scenarios using the main SKILL.md Step 7 rules.

**Web-specific scenario categories** (apply in addition to the universal categories):

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

---

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

---

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

### Step W-12: Phase 2 Allure Report

After test execution completes, generate the Phase 2 Allure report:

```bash
# Enrich allure-results with coverage metadata from TC files
node scripts/allure/generate-phase2-report.js

# Build the HTML report
npx allure generate allure-results -o allure-report --clean

# Open in browser
npx allure open allure-report
```

Or use the npm script shortcut:

```bash
npm run allure:phase2:open
```

> **Note**: The `allure-playwright` reporter in `qa/playwright.config.ts` automatically writes
> test execution results (pass/fail, duration, screenshots, traces) to `allure-results/` during
> the Playwright test run. The `generate-phase2-report.js` script adds coverage metadata
> (scenario categories, flow mappings, TC metadata) on top of those results.

Tell the user:

> "**Phase 2 Allure Report** generated at `allure-report/index.html`
>
> The report includes:
> - Full test execution results (pass/fail/broken with error details)
> - Screenshots and traces on failure
> - Coverage overview (scenarios per journey, category breakdown)
> - Test timeline and duration analysis
> - Environment info and test history
>
> Run `npm run allure:open` to view it again."

---

## Key Rules — Web Skill

### Correctness

1. **Never hardcode URLs** — always `process.env.QA_APP_URL` or `page.goto('/')` (relative)
2. **Never hardcode credentials** — always `process.env.QA_TEST_EMAIL`, `process.env.QA_TEST_PASSWORD`
3. **Never use `networkidle`** — use `domcontentloaded` + adaptive wait (see Performance below)
4. **Always use `capture()`** for screenshots — never raw `page.screenshot()` — prevents orphans
5. **Screenshot at every step in Phase 1** — evidence first, test cases second
6. **Credentials gate** — do not write TCs until user confirms `.env.qa` is populated
7. **Relative URLs only** in test files — `'/'` not `'https://app.example.com/'`
8. **Scope nav selectors** to `page.locator('nav, header').first()` — avoid footer duplicates

### Performance

9. **Adaptive waits instead of fixed timeouts** — never `waitForTimeout(3000)` blindly:
   ```javascript
   // ❌ Bad — wastes 3s on fast apps, too short on slow SPAs
   await page.waitForTimeout(3000);

   // ✅ Good — wait for actual content, with a ceiling
   await page.waitForFunction(
     () => document.body.innerText.length > 100 && !document.body.innerText.includes('Loading'),
     { timeout: 15000 }
   ).catch(() => {}); // fallback: proceed after 15s even if still loading
   ```
   Use `waitForFunction()` to detect when content has rendered. Only use `waitForTimeout()` for brief UI settle time (500-1000ms after clicks).

10. **Viewport screenshots by default** — only use `fullPage: true` when you need the below-fold content:
    ```javascript
    // Default: viewport only (fast, small file)
    await capture(page, { ..., fullPage: false });

    // Full page: only for landing pages, long forms, full inventories
    await capture(page, { ..., fullPage: true });
    ```

11. **Reuse browser, fresh context** — launch browser once per session, create new context per journey:
    ```javascript
    // ❌ Bad — cold browser launch per journey (2-3s each)
    const browser = await chromium.launch();

    // ✅ Good — launch once, new context per journey (200ms each)
    // Browser launched at session start
    const context = await browser.newContext();
    const page = await context.newPage();
    // ... trace journey ...
    await context.close(); // clean state for next journey
    ```

12. **Lightweight coverage check** — don't run the full Allure generator just to verify coverage:
    ```bash
    # ❌ Bad — generates all Allure results just to check coverage
    node scripts/allure/generate-phase1-report.js 2>&1 | head -5

    # ✅ Good — check screenshot coverage directly (instant)
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
    if(orphaned.length){console.error('❌',orphaned.length,'orphaned');orphaned.forEach(f=>console.error(' ',f));process.exit(1)}
    console.log('✅',disk.size+'/'+disk.size,'covered');
    "
    ```
