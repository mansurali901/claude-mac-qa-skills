---
name: native-qa-web
description: Autonomous QA skill for web applications using Playwright. Phase 1 explores every reachable page and traces each happy flow step-by-step with screenshots. Phase 2 generates full coverage test cases after credentials are provided.
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

**Goal**: Map every reachable page and trace every happy flow end-to-end with screenshots.
**Output**: `qa/knowledgebase/` full of screenshots + `flow.md` files with evidence tables.
**Stop condition**: All public flows traced. Auth-gated flows documented as needing credentials.
**No TC generation in Phase 1.**

---

### Pre-Step: Load Prior Knowledge

Before doing anything else, check what the root skill extracted from `qa/context/` in Step 3.

```bash
ls qa/knowledgebase/ui-inventory.md 2>/dev/null && echo "EXISTS" || echo "NONE"
ls qa/context/ 2>/dev/null
```

**If `qa/knowledgebase/ui-inventory.md` exists** — read it now. It contains the candidate flow list and known features extracted from any files the user dropped into `qa/context/`. Use this as your starting map:
- Prioritize routes and flows named in the inventory — explore these first
- If Figma screens were provided, you know the screen layouts — confirm visually via Playwright
- If a PRD or spec was provided, you know the features and acceptance criteria — test against them

**If `qa/context/` has unread files** (PNGs, `.md`, `.txt` not yet processed) — read them before opening the browser.

**If nothing exists** — cold start. Discover everything by crawling from the homepage.

---

## STOP / PAUSE / SAVE STATE — Always Active

**This handler is active at every step. Whenever the user says "stop", "pause", "save state", or any equivalent — write the state file immediately. Do not just acknowledge.**

1. **Write `qa/state-web.md` now** — capture everything known at this exact moment:
   - Completed flows (with screenshot counts and key observations)
   - In-progress flow (if mid-trace: note the `flow.md` already exists with observations up to the stopped step — resume will continue appending from here)
   - Pending flows (names, priority, auth requirement)
   - App metadata (name, URL, auth method, plans/tiers)
   - Credentials status
   - Next action (exact resume point — e.g. "Resume F-003 trace from step 5, flow.md has steps 1-4 already written")

2. **Tell the user**:

> "✅ Checkpoint saved to `qa/state-web.md`
>
> | Saved | Value |
> |-------|-------|
> | Flows completed | [N] — [names] |
> | In progress | [flow name, step reached] or None |
> | Flows pending | [N] — [names] |
> | Screenshots taken | [N] |
> | TCs written | [N] |
>
> **To resume**: open a new conversation and say:
> `Read qa/state-web.md and continue QA for [AppName]`"

---

### Step W-1: Workspace Setup

Handled by main SKILL.md Steps 1-2. Confirm:
- `.qa-config.json` has `"platform": "web"`
- `QA_APP_URL` is set in `.env.qa`
- `qa/knowledgebase/screenshots/` directory exists

Then write the Playwright config to `qa/playwright.config.ts` using the Write tool:

```typescript
// qa/playwright.config.ts — written by native-qa at init time. Do not edit manually.
import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const dotenvPath = path.resolve(process.cwd(), '.env.qa');
if (fs.existsSync(dotenvPath)) {
  require('dotenv').config({ path: dotenvPath });
} else {
  throw new Error(
    '.env.qa not found. Copy .env.example to .env.qa and fill in your values.\n' +
    'See qa/credentials/access.md for the required fields.'
  );
}

if (!process.env.QA_APP_URL) {
  throw new Error('QA_APP_URL is not set in .env.qa');
}

const CI       = !!process.env.CI;
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
      name:         'chromium',
      use:          { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
      dependencies: ['setup'],
    },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],

  outputDir:   path.join(REPO_ROOT, 'qa/evidence/playwright/'),
  snapshotDir: path.join(REPO_ROOT, 'qa/knowledgebase/visual-baselines/'),
});
```

This file lives in `qa/` (gitignored, regenerated each session). All run commands use `--config qa/playwright.config.ts`.

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
  
  await page.goto(process.env.QA_APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.screenshot({
    path: 'qa/knowledgebase/screenshots/homepage-initial.png',
    fullPage: true
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
2. Wait 2-3 seconds
3. Take a full-page screenshot → `qa/knowledgebase/screenshots/page-[slug].png`
4. Read the screenshot — note: page type, key elements, auth state, any redirects

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
| /account | page-account.png | Auth | No (redirects to here) | Sign-up form, Google SSO, X SSO |
| /dashboard | page-dashboard.png | App | Yes (redirects to /account) | — |
```

---

### Step W-4: Happy Flow Tracing — Screenshot at Every Step

**This is the core of Phase 1.** For every identified happy flow, trace it as a real user would — one action at a time, screenshot after every action.

#### Naming convention
```
qa/knowledgebase/screenshots/flow-[F-NNN-slug]-step[NN]-[description].png
```

#### Flows to trace in Phase 1 (public, no login required)

**For each flow — incremental write protocol:**

1. **Create `flow.md` immediately** — before opening the browser, create `qa/flows/F-NNN-[slug]/flow.md` with the header and an empty discovery evidence table:

```markdown
# F-NNN: [Flow Name]
> ⚠️ IN PROGRESS — being traced. Do not use until marked complete.

## Summary
| Field | Value |
|-------|-------|
| **Flow ID** | F-NNN |
| **Application** | [AppName] |
| **URL / Base Route** | [route] |
| **Status** | IN PROGRESS |

## Discovery Evidence

| Step | Action | Screenshot | Observed |
|------|--------|-----------|---------|
```

2. Open a fresh browser context (no cookies)

3. For each step in the happy path — do ALL of the following before moving to the next step:
   - Perform the action
   - `await page.screenshot({ path: '...', fullPage: true })`
   - **Read the screenshot** with the Read tool
   - **Immediately append the observation** to the discovery evidence table in `flow.md`:
   ```markdown
   | 1 | Navigate to homepage | `flow-F001-step01-load.png` | Hero section visible; "Secure OpenClaw in 60 seconds" headline; Sign up + Download CTA buttons; nav: Resources, Log in, Sign up |
   ```
   Write the full observation — every visible element, label, state, layout detail. Do not summarize — capture everything Claude sees in that screenshot.

4. **Finalize `flow.md`** — after all steps are traced, fill in remaining sections (User Journey table, Success Outcome, Playwright skeleton) and remove the `⚠️ IN PROGRESS` warning. Mark status as `COMPLETE`.

---

##### Flow F-001: Homepage & Navigation

Trace: load → scroll sections → click nav links → click CTAs

```javascript
// Step 1: Initial load
await page.goto(process.env.QA_APP_URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await page.screenshot({ path: 'qa/knowledgebase/screenshots/flow-F001-step01-load.png', fullPage: true });

// Step 2: Scroll to mid-page
await page.evaluate(() => window.scrollBy(0, window.innerHeight));
await page.waitForTimeout(1000);
await page.screenshot({ path: 'qa/knowledgebase/screenshots/flow-F001-step02-scroll-mid.png', fullPage: false });

// Step 3: Scroll to bottom
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(1000);
await page.screenshot({ path: 'qa/knowledgebase/screenshots/flow-F001-step03-scroll-bottom.png', fullPage: false });

// Step 4: Click Pricing nav link
await page.evaluate(() => window.scrollTo(0, 0));
const pricingLink = page.locator('nav, header').first().getByRole('link', { name: /pricing/i }).first();
await pricingLink.click();
await page.waitForTimeout(2000);
await page.screenshot({ path: 'qa/knowledgebase/screenshots/flow-F001-step04-pricing-page.png', fullPage: true });

// Step 5: Go back, click Resources (if exists)
await page.goto(process.env.QA_APP_URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
// Try to find Resources dropdown
const resourcesBtn = page.locator('nav, header').first().getByRole('button', { name: /resources/i });
if (await resourcesBtn.isVisible().catch(() => false)) {
  await resourcesBtn.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'qa/knowledgebase/screenshots/flow-F001-step05-resources-dropdown.png', fullPage: false });
}
```

Read each screenshot after capture. Record observations.

---

##### Flow F-002: Authentication (public-facing form only)

Trace: navigate to /account → observe form → fill sign-up form → observe validation states.
**Note**: Do NOT submit with real credentials in Phase 1. Trace up to the form-filled state only.

```javascript
// Step 1: Navigate to /account
await page.goto(process.env.QA_APP_URL + 'account', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await page.screenshot({ path: 'qa/knowledgebase/screenshots/flow-F002-step01-account-page.png', fullPage: true });

// Step 2: Observe sign-up form elements
// Read screenshot — note: fields visible, SSO buttons, toggle to sign-in
await page.screenshot({ path: 'qa/knowledgebase/screenshots/flow-F002-step02-signup-form.png', fullPage: false });

// Step 3: Click "Sign in" toggle (if visible) to see sign-in form
const signinLink = page.getByText(/sign in/i).or(page.getByText(/already have/i)).first();
if (await signinLink.isVisible().catch(() => false)) {
  await signinLink.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'qa/knowledgebase/screenshots/flow-F002-step03-signin-form.png', fullPage: false });
}

// Step 4: Go back to sign-up, fill email (observe email field behavior)
await page.goto(process.env.QA_APP_URL + 'account', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
const emailField = page.getByLabel(/email/i).or(page.getByPlaceholder(/email/i)).first();
if (await emailField.isVisible().catch(() => false)) {
  await emailField.fill('test@example.com');
  await page.screenshot({ path: 'qa/knowledgebase/screenshots/flow-F002-step04-email-filled.png', fullPage: false });
}

// Step 5: Try empty form submit (observe validation)
const submitBtn = page.getByRole('button', { name: /sign up/i }).first();
if (await submitBtn.isVisible().catch(() => false)) {
  await page.goto(process.env.QA_APP_URL + 'account', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await submitBtn.click().catch(() => {});
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'qa/knowledgebase/screenshots/flow-F002-step05-empty-validation.png', fullPage: false });
}
```

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

> "**[Flow Name]** needs access to continue.
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
- Note in `qa/state-web.md` under pending flows: flow name + exact credential type needed
- Continue to the next public flow

---

##### Flow F-003 and beyond: App-specific flows

For each additional flow identified (pricing CTAs, feature sections, etc.), apply the same tracing protocol:
1. Write inline Playwright steps
2. Screenshot after every action
3. Read every screenshot
4. Document in flow.md

---

### Step W-4b: Context Reset After Each Flow

After tracing a flow and reading all its screenshots:

1. Write `qa/flows/F-NNN-[slug]/flow.md` with the discovery evidence table
2. Append to `qa/state-web.md` — mark this flow as done, list the next flow pending
3. Tell the user:
   > "Flow **F-NNN — [name]** traced ✅ ([N] screenshots). Context reset recommended.
   > **Resume**: `Read qa/state-web.md and continue Phase 1. Next flow: F-[NNN+1] — [name].`"

Do NOT continue to the next flow in the same context after reading 3+ flows worth of screenshots.

---

### Step W-5: Document Flows

For each traced flow, create `qa/flows/F-NNN-[slug]/flow.md`. The flow.md for web includes:
- Summary metadata table
- UI Elements table (form fields, buttons, links, sections found)
- User Journey steps table
- **Discovery Evidence table** — every screenshot with observed state
- Note any flows that are auth-gated ("requires credentials — trace in Phase 2")

Include in the flow.md:
```markdown
## Discovery Evidence — Happy Path Screenshots

| Step | Action | Screenshot | Observed |
|------|--------|-----------|---------|
| 1 | Navigate to /account | `flow-F002-step01-account-page.png` | Sign-up form; Google + X SSO; "Already have an account? Sign in" link |
| 2 | Observe sign-up form | `flow-F002-step02-signup-form.png` | Email field, Password field, Confirm Password field, Sign up button |
| 3 | Click Sign in toggle | `flow-F002-step03-signin-form.png` | Email + Password only; no confirm field; "Forgot password?" link |
| 4 | Fill email field | `flow-F002-step04-email-filled.png` | Email value "test@example.com" shown; no immediate validation |
| 5 | Empty submit click | `flow-F002-step05-empty-validation.png` | Validation errors: "Email is required", "Password is required" |
```

---

### Step W-6: Save Exploration Knowledge Base

Write `qa/knowledgebase/ui-inventory.md` with:
- Page inventory table (all crawled URLs)
- Element inventory (buttons, forms, nav items per page)
- Flow inventory (all traced happy flows with screenshot counts)
- Auth-gated flows list (flows to trace in Phase 2)
- App-specific observations (SPA routes, redirect behavior, widget quirks)

---

## Phase 1 → Phase 2 Handoff

After Step W-6, the main SKILL.md **Phase 1 Complete Gate** takes over. It:
1. Writes the checkpoint to `qa/state-web.md`
2. Tells the user which flows need credentials
3. Waits for the user to populate `.env.qa`

---

## Phase 2: Full Coverage Test Generation

**Entry**: User confirms credentials are set in `.env.qa`.

---

### Step W-7: Credential Acquisition — Screenshot-Driven

**Credentials depend entirely on what the app's UI shows. Never assume email + password.**

#### Step W-7a: Read Auth Screenshots First

Before asking the user for anything, read every auth/login/onboarding/settings screenshot captured in Phase 1 using the Read tool:

```
qa/knowledgebase/screenshots/flow-F002-auth-step01-*.png
qa/knowledgebase/screenshots/flow-F003-onboarding-*.png
... (all auth-related screenshots)
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

> "To trace **[F-NNN — Flow Name]**, I can see from the screenshots that the app needs:
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
const ts = Date.now();
const testEmail = `qatest-${ts}@mailinator.com`;
const testPassword = `QAtest${ts}!`;

// Navigate to signup (URL from Phase 1 screenshots)
await page.goto('/account', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
await page.screenshot({ path: 'qa/knowledgebase/screenshots/self-reg-step01.png', fullPage: false });
// READ — confirm what fields are on screen before filling

// Fill exactly the fields visible in the screenshot
// DO NOT fill fields that are not visible
await page.getByLabel(/email/i).or(page.getByPlaceholder(/email/i)).first().fill(testEmail);
// ... fill other fields as seen in screenshot

await page.screenshot({ path: 'qa/knowledgebase/screenshots/self-reg-step02-filled.png' });
// READ — verify before submitting

await page.getByRole('button', { name: /sign up/i }).first().click();
await page.waitForTimeout(4000);
await page.screenshot({ path: 'qa/knowledgebase/screenshots/self-reg-step03-result.png', fullPage: true });
// READ — where did we land? success / email verification / onboarding / error?
// If email verification: check https://www.mailinator.com/v4/public/inboxes.jsp?to=qatest-[ts]
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

**Never block Phase 2** for non-automatable credentials. Write a "Credential Note" in the affected `flow.md`, provide the best alternative, and continue with other flows.

---

### Step W-8: Authenticated Flow Tracing

After credentials are resolved:

```javascript
require('dotenv').config({ path: '.env.qa' });
const { QA_TEST_EMAIL, QA_TEST_PASSWORD, QA_APP_URL } = process.env;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto(QA_APP_URL + 'account', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);

// Switch to sign-in form
const signinLink = page.getByText(/sign in/i).or(page.getByText(/already have/i)).first();
if (await signinLink.isVisible().catch(() => false)) await signinLink.click();
await page.waitForTimeout(1000);

// Fill credentials
await page.getByLabel(/email/i).or(page.getByPlaceholder(/email/i)).first().fill(QA_TEST_EMAIL);
await page.getByLabel(/password/i).or(page.getByPlaceholder(/password/i)).first().fill(QA_TEST_PASSWORD);
await page.screenshot({ path: 'qa/knowledgebase/screenshots/flow-F002-auth-step06-filled.png', fullPage: false });

await page.getByRole('button', { name: /sign in/i }).first().click();
await page.waitForTimeout(3000);
await page.screenshot({ path: 'qa/knowledgebase/screenshots/flow-F002-auth-step07-post-signin.png', fullPage: true });
// Read this screenshot — where did user land? (dashboard / onboarding / error?)
```

Continue tracing each authenticated flow (dashboard, settings, account, skills, etc.) with screenshots at every step.

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
| **Flow** | F-NNN — [Flow Name] |
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
  await page.waitForTimeout(2000);
  
  // assertions
  await expect(page.locator('[selector]')).toBeVisible();
  
  // evidence
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

After all TCs are written:

```bash
# Extract TypeScript code blocks from TC-*.md into runnable .spec.ts files
node qa/extract-specs.js

# Run public tests (no auth)
npx playwright test --project chromium-public --config qa/playwright.config.ts

# Set up auth session (one-time)
npx playwright test --project setup --config qa/playwright.config.ts

# Run all tests
npx playwright test --config qa/playwright.config.ts

# Run specific TC
npx playwright test --grep "TC-001" --config qa/playwright.config.ts
```

---

## Key Rules — Web Skill

1. **Never hardcode URLs** — always `process.env.QA_APP_URL` or `page.goto('/')` (relative)
2. **Never hardcode credentials** — always `process.env.QA_TEST_EMAIL`, `process.env.QA_TEST_PASSWORD`
3. **Never use `networkidle`** — use `domcontentloaded` + `waitForTimeout(2000-3000)` for SPAs
4. **Screenshot at every step in Phase 1** — evidence first, test cases second
5. **Credentials gate** — do not write TCs until user confirms `.env.qa` is populated
6. **Relative URLs only** in test files — `'/'` not `'https://app.example.com/'`
7. **Scope nav selectors** to `page.locator('nav, header').first()` — avoid footer duplicates
