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

### Step W-2: BFS Deep Crawl — Discover Every Page

**This is the most important step.** Use Breadth-First Search to discover every reachable page in the application. Do NOT stop at 1-hop from the homepage.

**Key fixes applied in this section:**
- Every navigation is **verified** — screenshot is named by the ACTUAL page, not the intended URL
- A **configurable minimum wait** runs before every screenshot (`QA_PAGE_WAIT_MS`)
- BFS stops at **`QA_MAX_PAGES`** and **`QA_MAX_DEPTH`** to prevent context exhaustion
- BFS state is **saved to disk** (`qa/crawl-state.json`) after every page — survives context resets
- Screenshots are taken **AFTER** hidden content is revealed, not before
- Buttons are clicked through a **safe whitelist** — dangerous actions are never triggered
- **Content fingerprinting** flags duplicate pages that have different URLs but identical content

#### W-2.1: Launch Browser, Read Config, Initialize State

```javascript
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');
require('dotenv').config({ path: '.env.qa' });
const { capture } = require('../scripts/qa-screenshot');

// ═══ CONFIG — from .env.qa with safe defaults ═══
const CONFIG = {
  pageWaitMs:  parseInt(process.env.QA_PAGE_WAIT_MS || '2000'),
  maxPages:    parseInt(process.env.QA_MAX_PAGES || '50'),
  maxDepth:    parseInt(process.env.QA_MAX_DEPTH || '5'),
  navTimeout:  parseInt(process.env.QA_NAV_TIMEOUT || '15000'),
};

const CRAWL_STATE_FILE = 'qa/crawl-state.json';

// Pre-crawl: load ALL credentials from .env.qa into a map
const credentials = {
  email:    process.env.QA_TEST_EMAIL || '',
  password: process.env.QA_TEST_PASSWORD || '',
  apiKey:   process.env.QA_LLM_API_KEY || '',
  provider: process.env.QA_LLM_PROVIDER || '',
  secondaryEmail:    process.env.QA_SECONDARY_EMAIL || '',
  secondaryPassword: process.env.QA_SECONDARY_PASSWORD || '',
};
const hasCredentials = !!(credentials.email || credentials.apiKey);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

// ═══ BFS STATE — persisted to disk after every page ═══
// If crawl-state.json exists from a previous run, resume from it.
let state;
if (fs.existsSync(CRAWL_STATE_FILE)) {
  const saved = JSON.parse(fs.readFileSync(CRAWL_STATE_FILE, 'utf8'));
  state = {
    visited: new Set(saved.visited),
    queue: saved.queue,               // Array of { url, depth }
    pages: saved.pages,               // Discovered page manifest
    fingerprints: new Map(Object.entries(saved.fingerprints || {})),
    duplicates: saved.duplicates || [],
    pageCount: saved.pageCount || 0,
    isAuthenticated: saved.isAuthenticated || false,
  };
  console.log(`Resuming BFS: ${state.visited.size} visited, ${state.queue.length} queued`);
} else {
  state = {
    visited: new Set(),
    queue: [{ url: process.env.QA_APP_URL, depth: 0 }],
    pages: [],
    fingerprints: new Map(),
    duplicates: [],
    pageCount: 0,
    isAuthenticated: false,
  };
}

function saveCrawlState() {
  fs.writeFileSync(CRAWL_STATE_FILE, JSON.stringify({
    visited: [...state.visited],
    queue: state.queue,
    pages: state.pages,
    fingerprints: Object.fromEntries(state.fingerprints),
    duplicates: state.duplicates,
    pageCount: state.pageCount,
    isAuthenticated: state.isAuthenticated,
    savedAt: new Date().toISOString(),
  }, null, 2));
}
```

#### W-2.2: Utility Functions — Wait, Verify, Normalize

These functions are used throughout the BFS loop. Define them before the loop starts.

**URL Normalization** — prevents visiting the same page under different URL forms:

```javascript
function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    // Strip: trailing slash, hash, tracking params
    let normalized = `${u.protocol}//${u.hostname}${u.pathname}`
      .replace(/\/+$/, '');
    // Keep meaningful query params, strip tracking
    const tracking = new Set([
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
      'ref', 'fbclid', 'gclid', '_ga',
    ]);
    const params = new URLSearchParams(u.search);
    const kept = [];
    for (const [k, v] of params) {
      if (!tracking.has(k)) kept.push(`${k}=${v}`);
    }
    if (kept.length) normalized += `?${kept.sort().join('&')}`;
    return normalized.toLowerCase();
  } catch {
    return raw;
  }
}
```

**Page Wait** — configurable minimum + load state. Simple and reliable:

```javascript
async function waitForPageReady(page) {
  // 1. Wait for DOM to be ready — non-negotiable baseline
  await page.waitForLoadState('domcontentloaded');

  // 2. Configurable minimum wait — gives JS frameworks time to hydrate.
  //    User tunes this via QA_PAGE_WAIT_MS in .env.qa.
  //    Default 2000ms works for most apps. Slow apps: set 3000-4000.
  await page.waitForTimeout(CONFIG.pageWaitMs);
}
```

> **Why a simple minimum wait instead of DOM mutation observers or spinner detection?**
> MutationObservers never settle on apps with animations or live data. Spinner detection by class name is fragile. A configurable minimum wait is predictable, works on every app, and the user can tune it. If 2000ms isn't enough, set `QA_PAGE_WAIT_MS=3000` in `.env.qa`.

**Page Verification** — confirms the agent arrived at the intended page:

```javascript
async function verifyNavigation(page, intendedUrl) {
  const actualUrl = page.url();
  const intendedPath = new URL(intendedUrl).pathname.replace(/\/+$/, '');
  const actualPath = new URL(actualUrl).pathname.replace(/\/+$/, '');
  const redirected = intendedPath !== actualPath;

  // Content fingerprint — detects same page at different URLs
  const fingerprint = await page.evaluate(() => {
    const h1 = (document.querySelector('h1') || {}).textContent || '';
    const title = document.title || '';
    return `${title.trim()}|||${h1.trim()}`.toLowerCase();
  });

  // Use ACTUAL path for the screenshot slug — not the intended one
  const slug = actualPath.split('/').filter(Boolean).pop() || 'homepage';

  return { intendedUrl, actualUrl, redirected, fingerprint, slug };
}
```

**Error Page Detection** — broader than just "404 + not found":

```javascript
async function isErrorPage(page) {
  return page.evaluate(() => {
    const text = document.body.innerText.toLowerCase();
    const h1 = (document.querySelector('h1') || {}).textContent || '';
    const h1Lower = h1.toLowerCase();

    // Explicit 404
    if (/\b404\b/.test(text) && /not found|doesn.t exist/i.test(text))
      return '404';
    // "Page not found" without the number
    if (/page not found|this page doesn.t exist|nothing here/i.test(h1Lower))
      return 'not-found';
    // Generic error with short content (not a feature page)
    if (/something went wrong|unexpected error|oops/i.test(h1Lower) && text.length < 500)
      return 'error';
    // Empty SPA route — shell loaded but no meaningful content
    const main = document.querySelector('main, [role="main"], #app, #root');
    if (main && main.innerText.trim().length < 20
        && !main.querySelector('input, button, form'))
      return 'empty-route';

    return null;
  });
}
```

---

#### W-2.3: BFS Main Loop — Navigate, Verify, Interact, Screenshot

**Loop order is critical.** Each step depends on the previous one completing correctly:

```
For each URL in the queue:
  1. LIMIT CHECK — skip if max pages or max depth exceeded
  2. NAVIGATE — click-based (SPA-safe), with fallbacks
  3. WAIT — configurable minimum wait (QA_PAGE_WAIT_MS)
  4. VERIFY — compare actual URL to intended URL
  5. DEDUP — content fingerprint check (same page, different URL?)
  6. ERROR CHECK — 404, empty route, generic error page
  7. CREDENTIAL CHECK — detect input fields, auto-fill from .env.qa
  8. REVEAL HIDDEN CONTENT — tabs, dropdowns, scroll (W-2.4)
  9. SCREENSHOT — after everything is visible and settled
  10. READ — visual analysis via Read tool
  11. COLLECT LINKS — href scan + safe button discovery (W-2.5)
  12. SAVE STATE — write crawl-state.json to disk
```

> **Why this order matters**: The old loop took screenshots at step 5 (before revealing hidden content) and named them by intended URL (before verification). This caused the hallucination bug — same screen, different filenames. The new order screenshots AFTER verification, AFTER interaction, using the ACTUAL URL for naming.

```javascript
// ═══ BEFORE THE LOOP — create seed-crawl flow directory ═══
// capture() needs a flow directory to register screenshots.
// Create it before the loop starts so capture() doesn't throw.
const seedFlowDir = 'qa/flows/seed-crawl';
fs.mkdirSync(path.join(seedFlowDir, 'test-cases'), { recursive: true });
if (!fs.existsSync(path.join(seedFlowDir, 'flow.md'))) {
  fs.writeFileSync(path.join(seedFlowDir, 'flow.md'),
    '# Seed Crawl — BFS Discovery\n\n' +
    '## Discovery Evidence\n\n' +
    '| Step | Page/Screen | Action | Screenshot | Observed |\n' +
    '|------|------------|--------|-----------|---------|');
}

while (state.queue.length > 0) {
  const { url, depth } = state.queue.shift();
  const normalized = normalizeUrl(url);

  // ── 1. LIMIT CHECKS ──
  if (state.visited.has(normalized)) continue;

  if (state.pageCount >= CONFIG.maxPages) {
    console.log(`⚠ MAX PAGES (${CONFIG.maxPages}) reached. Stopping BFS.`);
    console.log(`  ${state.queue.length} URLs remain in queue — increase QA_MAX_PAGES to crawl more.`);
    break;
  }
  if (depth > CONFIG.maxDepth) {
    console.log(`⚠ Skipping ${url} — depth ${depth} exceeds QA_MAX_DEPTH (${CONFIG.maxDepth})`);
    continue;
  }

  state.visited.add(normalized);

  // ── 2. NAVIGATE — click-based, SPA-safe ──
  const intendedPath = new URL(url).pathname;

  if (state.pageCount === 0) {
    // First page: load SPA shell via direct navigation
    await page.goto(process.env.QA_APP_URL, {
      waitUntil: 'domcontentloaded',
      timeout: CONFIG.navTimeout,
    });
  } else {
    let navigated = false;

    // Try 1: Click <a> or [data-href] matching this path
    for (const sel of [
      `a[href="${intendedPath}"], a[href="${url}"], a[href$="${intendedPath}"]`,
      `[data-href="${intendedPath}"], [data-to="${intendedPath}"]`,
    ]) {
      const lnk = page.locator(sel).first();
      if (await lnk.count() > 0 && await lnk.isVisible().catch(() => false)) {
        await lnk.click();
        navigated = true;
        break;
      }
    }

    // Try 2: Text match — scoped to nav/header only (avoids footer duplicates)
    if (!navigated) {
      const slug = intendedPath.split('/').filter(Boolean).pop() || '';
      if (slug) {
        const navLink = page.locator('nav, header').first()
          .locator('a, button, [role="link"], [role="menuitem"]')
          .filter({ hasText: new RegExp(slug.replace(/-/g, '.'), 'i') }).first();
        if (await navLink.count() > 0) {
          await navLink.click();
          navigated = true;
        }
      }
    }

    // Try 3: Reveal dropdown menus, then click
    if (!navigated) {
      for (const trigger of await page.locator(
        'nav button[aria-haspopup], nav [aria-expanded], header button[aria-haspopup], details > summary'
      ).all()) {
        await trigger.click().catch(() => {});
        await page.waitForTimeout(500);
        const menuLink = page.locator(`a[href="${intendedPath}"], a[href$="${intendedPath}"]`).first();
        if (await menuLink.count() > 0) {
          await menuLink.click();
          navigated = true;
          break;
        }
        await page.keyboard.press('Escape');
      }
    }

    // Last resort: direct navigation (may soft-404 on SPAs — caught by error check)
    if (!navigated) {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: CONFIG.navTimeout,
      }).catch(() => {
        console.log(`⚠ Navigation timeout for ${url}`);
      });
    }
  }

  // ── 3. WAIT — configurable minimum + DOM ready ──
  await waitForPageReady(page);

  // ── 4. VERIFY — did we actually arrive at the intended page? ──
  const nav = await verifyNavigation(page, url);

  if (nav.redirected) {
    console.log(`↪ Redirect: ${url} → ${nav.actualUrl}`);
    // Mark the actual URL as visited too — prevents re-visiting the redirect target
    state.visited.add(normalizeUrl(nav.actualUrl));
  }

  // ── 5. DEDUP — content fingerprint check ──
  if (state.fingerprints.has(nav.fingerprint)) {
    const original = state.fingerprints.get(nav.fingerprint);
    console.log(`⚠ DUPLICATE: ${nav.actualUrl} has same content as ${original} — skipping`);
    state.duplicates.push({ url: nav.actualUrl, duplicateOf: original });
    saveCrawlState();
    continue;
  }
  state.fingerprints.set(nav.fingerprint, nav.actualUrl);

  // ── 6. ERROR CHECK — broader than just "404 + not found" ──
  const errorType = await isErrorPage(page);
  if (errorType) {
    console.log(`⚠ ${errorType} detected at ${nav.actualUrl} — skipping screenshot`);
    saveCrawlState();
    continue;
  }

  // ── 7. CREDENTIAL CHECK — detect fields, auto-fill from .env.qa ──
  const credFields = await page.evaluate(() => {
    const fields = [];
    document.querySelectorAll('input[type="password"]').forEach(el =>
      fields.push({ type: 'password', label: (el.labels?.[0]?.textContent || el.placeholder || 'password').trim() })
    );
    document.querySelectorAll('input[type="email"], input[name*="email" i], input[placeholder*="email" i]').forEach(el =>
      fields.push({ type: 'email', label: (el.placeholder || el.name || 'email').trim() })
    );
    document.querySelectorAll(
      'input[placeholder*="key" i], input[placeholder*="token" i], input[placeholder*="api" i], ' +
      'input[name*="key" i], input[name*="api" i], input[placeholder*="secret" i]'
    ).forEach(el =>
      fields.push({ type: 'api_key', label: (el.placeholder || el.name || 'api_key').trim() })
    );
    document.querySelectorAll('label').forEach(lbl => {
      if (/key|token|secret|api/i.test(lbl.textContent)) {
        const input = lbl.querySelector('input') || document.getElementById(lbl.htmlFor);
        if (input) fields.push({ type: 'api_key', label: lbl.textContent.trim() });
      }
    });
    document.querySelectorAll('input[name*="card" i], input[placeholder*="card" i], input[autocomplete*="cc-"]').forEach(el =>
      fields.push({ type: 'payment', label: (el.placeholder || el.name || 'card').trim() })
    );
    return fields;
  });

  if (credFields.length > 0) {
    // → Handle via Credential Gate Protocol (W-2.6)
    // Auto-fill from .env.qa if available. Ask user if not.
    // After successful auth, re-add gated URLs to queue.
  }

  // ── 8. REVEAL HIDDEN CONTENT — tabs, dropdowns, scroll (W-2.4) ──
  // This runs BEFORE the screenshot so the capture shows the full page state.
  // See W-2.4 section below for the full interaction code.

  // ── 9. SCREENSHOT — AFTER verification, interaction, and reveal ──
  state.pageCount++;
  // Prefix with zero-padded counter to guarantee unique filenames.
  // Without this, /user/settings and /admin/settings both produce page-settings.png.
  const screenshotFile = `page-${String(state.pageCount).padStart(2, '0')}-${nav.slug}.png`;

  await capture(page, {
    flow: 'seed-crawl',
    step: state.pageCount,
    action: `Visit ${nav.actualUrl}`,
    observed: '(pending visual analysis)',
    page: nav.slug,
    file: screenshotFile,
  });

  // ── 10. READ — visual analysis via Read tool ──
  // READ the screenshot with the Read tool now.
  // Write the actual observation back to the discovery evidence table.

  // ── 11. COLLECT LINKS — href scan + safe button discovery (W-2.5) ──
  const hrefLinks = await page.evaluate(() =>
    [...document.querySelectorAll('a[href], [data-href], [data-to]')]
      .map(el => el.href || el.dataset?.href || el.dataset?.to || '')
      .filter(href => href && href.startsWith(window.location.origin))
      .map(href => href.split('#')[0].split('?')[0])
      .filter((v, i, a) => a.indexOf(v) === i)
  );
  for (const link of hrefLinks) {
    if (!state.visited.has(normalizeUrl(link))) {
      state.queue.push({ url: link, depth: depth + 1 });
    }
  }

  // Safe button discovery — see W-2.5 for the whitelist logic
  // Runs AFTER screenshot so button clicks don't corrupt the captured state.

  // ── 12. RECORD — update page manifest and save to disk ──
  state.pages.push({
    url: nav.actualUrl,
    intendedUrl: url,
    redirected: nav.redirected,
    screenshot: screenshotFile,
    depth,
    credFields: credFields.length > 0 ? credFields : undefined,
    timestamp: new Date().toISOString(),
  });

  saveCrawlState();
}

// BFS complete
console.log(`BFS done: ${state.pageCount} pages visited, ${state.duplicates.length} duplicates skipped`);
saveCrawlState();
```

---

#### W-2.4: Reveal Hidden Content — Runs BEFORE Screenshot

On each page, AFTER wait + verification but BEFORE screenshot, reveal interactive content so the screenshot captures the full page state.

```javascript
// 1. Tabs — click each to reveal content
const tabs = await page.locator('[role=tab], [data-tab], button[aria-selected]').all();
for (const tab of tabs) {
  await tab.click().catch(() => {});
  await page.waitForTimeout(500);
}

// 2. Dropdowns/menus — open to discover links, then close
const toggles = await page.locator(
  '[aria-haspopup], details:not([open]) > summary'
).all();
for (const t of toggles) {
  await t.click().catch(() => {});
  await page.waitForTimeout(500);
  // Collect links from the revealed content here
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

// 3. Scroll — trigger lazy-loaded content
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(CONFIG.pageWaitMs);  // Wait again after scroll
await page.evaluate(() => window.scrollTo(0, 0));  // Scroll back to top for screenshot
```

> **Adapt to what you SEE.** After each screenshot READ, if you notice interactive elements not covered above (accordions, carousels, slide-out panels, mega-menus), write a custom click sequence for them.

---

#### W-2.5: Safe Button Discovery — Whitelist, Not Blacklist

After the screenshot is taken, discover routes behind non-anchor buttons. **Only click buttons that look like navigation.** Never click destructive actions.

```javascript
// Labels that are NEVER safe to click during discovery
const DANGEROUS = /delete|remove|cancel|log\s?out|sign\s?out|reset|clear|
  unsubscribe|deactivate|close.account|revoke|disconnect|destroy|
  disable|block|report|archive/i;

// Labels that are likely navigation (safe to click)
const SAFE_NAV = /view|open|go.to|see.all|see.more|more|details|explore|
  learn|visit|show|browse|discover|manage|dashboard|settings|profile|
  upgrade|pricing|docs|help|support|about/i;

// Only scan nav and header — never click random buttons in main content
const navButtons = await page.locator('nav, header').first()
  .locator('button, [role="link"]:not(a), [role="menuitem"]:not(a)').all();

const urlBeforeDiscovery = page.url();

for (const el of navButtons) {
  const text = (await el.textContent().catch(() => '')).trim();
  if (!text || text.length > 50) continue;

  // Skip dangerous labels
  if (DANGEROUS.test(text)) {
    console.log(`SKIP dangerous: "${text}"`);
    continue;
  }

  // Only click if it looks like navigation
  if (!SAFE_NAV.test(text)) {
    console.log(`SKIP non-nav: "${text}"`);
    continue;
  }

  await el.click().catch(() => {});
  await page.waitForTimeout(CONFIG.pageWaitMs);

  const urlAfterClick = page.url();
  if (urlAfterClick !== urlBeforeDiscovery
      && !state.visited.has(normalizeUrl(urlAfterClick))) {
    state.queue.push({ url: urlAfterClick, depth: depth + 1 });
    // Navigate back to continue discovery
    await page.goBack().catch(() => {});
    await page.waitForTimeout(CONFIG.pageWaitMs);
  } else {
    // No navigation — dismiss any popup
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
}
```

---

#### W-2.6: Credential Gate Protocol — Proactive Detection

**Triggered by**: The credential detection in W-2.3 step 7 finding ANY sensitive input field on a page — not just login/signup. This includes API key entry, payment forms, onboarding flows, token inputs, admin gates, SSO screens, etc.

**When credential fields are detected on a page, do NOT stop crawling.** Handle inline.

> ⛔ **HARD RULE**: If `.env.qa` has a value for a detected field, **you MUST auto-fill it**. You must NEVER click "Skip", "Set up later", "Maybe later", "Not now", or any bypass/dismiss button when the matching credential exists in `.env.qa`. The user provided those values specifically so you would use them. Skipping when values are available is a bug.

1. **Identify what's needed** from the `credFields` detected in the loop:

| Detected field type | `.env.qa` variable | Auto-fill? |
|--------------------|--------------------|-----------|
| `email` | `QA_TEST_EMAIL` | **MANDATORY** if set |
| `password` | `QA_TEST_PASSWORD` | **MANDATORY** if set |
| `api_key` | `QA_LLM_API_KEY` | **MANDATORY** if set |
| Provider dropdown | `QA_LLM_PROVIDER` | **MANDATORY** if set — select matching option |
| Model dropdown | Derive from provider or use default | Select if available |
| `payment` (card) | Test card `4242 4242 4242 4242` | **MANDATORY** if Stripe detected |
| Unknown / custom | — | Ask user |

2. **If matching `.env.qa` values exist** → auto-fill is **MANDATORY**, not optional:

```javascript
// ═══ MANDATORY AUTO-FILL — never skip when values exist ═══

// Provider dropdown (if present) — MUST be filled BEFORE API key
if (credFields.some(f => f.type === 'api_key') && credentials.provider) {
  const providerDropdown = page.locator('select, [role="listbox"], [role="combobox"]')
    .filter({ hasText: /provider|model|select/i }).first();
  if (await providerDropdown.count() > 0) {
    await providerDropdown.click();
    await page.waitForTimeout(500);
    await page.getByRole('option', { name: new RegExp(credentials.provider, 'i') }).click()
      .catch(() => page.locator(`[data-value*="${credentials.provider}" i]`).first().click())
      .catch(() => {});
    await page.waitForTimeout(1000);
  }
}

// Email
if (credFields.some(f => f.type === 'email') && credentials.email) {
  await page.getByLabel(/email/i).fill(credentials.email);
}

// Password
if (credFields.some(f => f.type === 'password') && credentials.password) {
  await page.getByLabel(/password/i).fill(credentials.password);
}

// API key — fill AFTER provider dropdown is set
if (credFields.some(f => f.type === 'api_key') && credentials.apiKey) {
  await page.locator(
    'input[placeholder*="key" i], input[name*="key" i], input[placeholder*="api" i], ' +
    'input[placeholder*="token" i], input[name*="api" i]'
  ).first().fill(credentials.apiKey);
}

// Submit — find the most likely submit button (NOT skip/later/dismiss)
await page.getByRole('button', { name: /sign in|log in|submit|continue|sign up|save|connect|add|confirm/i }).click();
await waitForPageReady(page);

// Screenshot result → verify success (no error message visible)
state.isAuthenticated = true;
```

> **Common trap — onboarding "Set up later" buttons**: Many apps show both a submit button AND a skip/later link on credential forms. When `.env.qa` has the value, ALWAYS click the submit/save/connect button — NEVER the skip/later/dismiss link. Read the screenshot after submission to verify it worked.

3. **If NO matching values exist in `.env.qa`** → ask the user. **Never skip on your own.**

```
"Credential fields detected at [URL]:
  - [list each field type + label found]
  - .env.qa status: [which keys are set vs missing]

How would you like to proceed?
  1. Provide values now (I'll fill them)
  2. Add to .env.qa and say 'ready' (I'll re-read it)
  3. Generate account myself (disposable email — see W-2.7)
  4. Skip this credential gate (only if you say so)"
```

> ⛔ **The agent NEVER chooses option 4 on its own.** Only the user can decide to skip. The agent must never autonomously click "Skip", "Set up later", "Maybe later", "Not now", or any bypass/dismiss button in the app UI.

4. **After successful credential entry**:
   - Screenshot the result page → verify success (no error message)
   - Note the credential type and method in ui-inventory.md
   - **Re-add the current URL and previously gated URLs back to the BFS queue** — pages behind this gate are now reachable
   - Continue BFS from the new page
   - Note other available methods as: `"Available but not tested: [list]"`

5. **If credential entry fails** (wrong password, rejected key, error shown):
   - Screenshot the error
   - Tell user what happened and what the error says
   - Ask for corrected credentials or skip
   - **Do NOT stop crawling** — continue with other pages

#### W-2.7: Self-Registration with Email Verification

When user says **"generate yourself"** or **"create account yourself"**:

1. **Generate disposable email** — use an accessible domain:
```javascript
const ACCESSIBLE_DOMAINS = ['yopmail.com', 'mailinator.com', 'guerrillamail.com'];
const email = `qatest-${Date.now()}@yopmail.com`;
const password = `QAtest${Date.now()}!`;
```

2. **Fill signup form** → screenshot → submit → screenshot result → READ

3. **Check what happened after submit:**

| Screenshot shows | Action |
|-----------------|--------|
| Dashboard / welcome page | Done — save credentials to `.env.qa` |
| "Check your email" / "Enter verification code" | → **Email verification flow below** |
| CAPTCHA / reCAPTCHA | Cannot automate — tell user, fall back |
| "Invite only" / error | Cannot self-register — tell user, fall back |

4. **Email verification flow** — if app requires email verification:

```javascript
const domain = email.split('@')[1];
const ACCESSIBLE = ['yopmail.com', 'mailinator.com', 'guerrillamail.com', 'tempmail.plus'];

if (ACCESSIBLE.includes(domain)) {
  await page.goto('https://yopmail.com');
  await page.locator('#login').fill(email.split('@')[0]);
  await page.getByRole('button', { name: /check/i }).click();
  await page.waitForTimeout(3000);

  const inbox = page.frameLocator('#ifmail');
  const emailBody = await inbox.locator('body').innerText();
  const otp = emailBody.match(/\b\d{4,6}\b/)?.[0];
  const verifyLink = emailBody.match(/https?:\/\/[^\s"<>]+verify[^\s"<>]*/i)?.[0];

  if (verifyLink) {
    await page.goto(verifyLink);
  } else if (otp) {
    await page.goto(process.env.QA_APP_URL);
    await page.getByPlaceholder(/code|otp|verify/i).fill(otp);
    await page.getByRole('button', { name: /verify|confirm|submit/i }).click();
  }
} else {
  // Domain not accessible — ask user for OTP
}
```

5. **After verification** → save credentials to `.env.qa` → save auth session → continue BFS

**Domain accessibility rules:**
| Domain | How to access | Notes |
|--------|--------------|-------|
| yopmail.com | `https://yopmail.com` → enter username → read iframe | Most reliable |
| mailinator.com | `https://www.mailinator.com/v4/public/inboxes.jsp?to=[user]` | Some apps block it |
| guerrillamail.com | `https://grr.la/mail/[user]` | Alternative if others blocked |
| gmail.com, outlook.com, corporate | **NOT accessible** — ask user for OTP | Cannot automate |

**If one domain is blocked by the app** (signup rejected), try the next accessible domain before falling back to asking the user.

#### W-2.8: Record Results

After BFS completes (queue empty or limit reached), write:

**`qa/knowledgebase/ui-inventory.md`**:
```markdown
## Page Inventory — [AppName]

**Total pages discovered: [N]** | **Public: [N]** | **Auth-gated: [N]** | **Duplicates skipped: [N]**

| # | URL | Screenshot | Page Type | Auth | Key Elements |
|---|-----|-----------|----------|------|-------------|
| 1 | [actual URL] | page-[slug].png | [type from screenshot] | [Yes/No] | [elements seen] |
```

Page types are **derived from what you see in each screenshot** — not assumed. Common types: landing, auth, app/dashboard, content, settings, pricing, legal — but use whatever fits.

**`qa/knowledgebase/nav-graph.md`** — built incrementally during crawl:
```markdown
| From | Link/CTA | To | Auth Gate |
|------|---------|-----|-----------|
| [source URL] | [link text or CTA label] | [target URL] | [none / requires auth / requires plan] |
```

Every outbound link on every visited page becomes a row. This is the data that powers flow creation.

**`qa/crawl-state.json`** — already saved incrementally during the loop. Contains the full BFS state for resume.

---

### Step W-3: Feature-Scoped Flow Creation

After BFS crawl, organize discovered pages into **feature-scoped flows** — one flow per distinct feature area (3-7 steps each).

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
