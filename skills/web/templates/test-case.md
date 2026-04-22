<!--
QUALITY CONTRACT — agent instruction, not rendered in output.
Every generated spec MUST satisfy ALL of the following before W-11 extraction:
1. Syntactically valid TypeScript — no missing `await`, no unresolved imports.
2. Logically complete — every step has a meaningful `expect()`. No `// TODO`, no empty `expect()`.
3. No placeholder values — no `[selector]`, `[route]`, `[label]`, `[value]` in code blocks.
4. No hardcoded credentials — all creds via `process.env.QA_*`.
5. Semantic locators: getByRole > getByLabel > getByTestId > CSS (CSS needs a comment explaining why).
6. No bare `waitForTimeout` — use waitForSelector / waitForResponse / waitForURL / waitForFunction.
7. storageState at test.use() level — never re-login inside a test with a cached session.
Violations must be fixed inline before W-11 runs. The Quality Review Gate (Step W-10.5) enforces this.
-->

# TC-[NNN]: [Feature / Flow Name]

## Metadata

| Field | Value |
|-------|-------|
| **Test Case ID** | TC-[NNN] |
| **Application** | [AppName] |
| **URL / Route** | [`/[route]`](about:blank) |
| **Feature** | [Feature or flow being tested] |
| **Priority** | P1 / P2 / P3 |
| **Type** | Functional / UI / Auth / State / Error / A11y / Visual |
| **Platform** | Web — Chromium / Firefox / WebKit |
| **Viewport** | Desktop (1280×720) / Mobile (375×812) |
| **Auth (role)** | None / `<role>` (storageState: `qa/.auth/<role>.json` — driven by `QA_<ROLE>_STORAGE_STATE` env var) |
| **Automation** | Playwright (TypeScript) |
| **Author** | QA Agent |
| **Created** | [YYYY-MM-DD] |
| **Last Updated** | [YYYY-MM-DD] |
| **Flow Reference** | F-[NNN] — [flow.md](../flow.md) |
| **Scenario Reference** | S-[NNN]-[NN] — [scenarios.md](../scenarios.md) |

---

## Preconditions

> Everything that must be true BEFORE this test runs.

- [ ] `QA_APP_URL` is set in `.env.qa`
- [ ] `QA_TEST_EMAIL` and `QA_TEST_PASSWORD` set in `.env.qa` (if auth required)
- [ ] `npx playwright install chromium` has been run at least once
- [ ] Auth session saved at `qa/.auth/user.json` (if auth required — see setup below)
- [ ] Network: [connected / specific condition]
- [ ] App state: [logged in / logged out / specific route]
- [ ] [Any other preconditions specific to this test]

#### Fallback if test setup fails

If any precondition cannot be met (auth fixture missing, storageState expired, env var absent):
1. **Do not bypass.** Log the failure in `qa/decisions.md` with the TC ID and missing item.
2. **Skip + continue** — mark this TC as `skipped-setup` in the run report and proceed to the next TC.
3. If three consecutive TCs skip for the same reason, stop the run and surface the setup issue to the user.

### Auth Setup (if required)

```bash
# One-time: capture and save authenticated session
npx playwright test --project setup --config qa/playwright.config.ts
# Saves session to qa/.auth/user.json for reuse by all auth-required TCs
```

### Environment Check

```bash
node -e "
require('dotenv').config({ path: '.env.qa' });
['QA_APP_URL', 'QA_TEST_EMAIL', 'QA_TEST_PASSWORD'].forEach(k =>
  console.log(k + ':', process.env[k] ? '✅ set' : '❌ MISSING')
);
"
```

---

## Scenarios

---

### Scenario 1: Happy Path — [Description]

**Priority**: P1
**Type**: Functional

#### Why this scenario (1-2 sentences)

[Ground in fingerprint + flow goal. Repeat this subsection under every `### Scenario N` header in this file.]

#### Preconditions (specific to this scenario)
- [Any state beyond the general preconditions above]

#### Steps

| Step | Action | Playwright Method | Expected Result |
|------|--------|------------------|----------------|
| 1 | Navigate to route | `page.goto('/[route]')` | Page loads, key element visible |
| 2 | [Describe action] | `page.locator('[selector]').click()` | [Expected UI response] |
| 3 | [Fill field] | `page.getByLabel('[label]').fill('[value]')` | [Field populated] |
| N | [Submit / verify] | `page.getByRole('button', { name: '[label]' }).click()` | [Success state] |

#### Playwright Test

```typescript
import { test, expect } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.qa' });

// Auth: load cached session — never re-login inside the test body
// test.use({ storageState: process.env.QA_<ROLE>_STORAGE_STATE ?? 'qa/.auth/member.json' });

test('TC-[NNN]-S1: [Happy path description]', async ({ page }) => {
  // Step 1: Navigate to seed URL only — all further nav is via clicks
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[visible-landmark-selector]', { timeout: 10000 });
  await page.screenshot({ path: 'qa/knowledgebase/screenshots/TC-[NNN]-S1-step01.png', fullPage: true });

  // Step 2: Click nav element (prefer semantic locators)
  await page.getByRole('link', { name: '[nav label]' }).click();
  await page.waitForURL(/[expected-route-pattern]/, { timeout: 10000 });
  await page.screenshot({ path: 'qa/knowledgebase/screenshots/TC-[NNN]-S1-step02.png', fullPage: false });

  // Step 3: Fill field
  await page.getByLabel('[field label]').fill(process.env.QA_TEST_EMAIL ?? '');

  // Step N: Submit and wait for response
  const responsePromise = page.waitForResponse(r => r.url().includes('/api/') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '[Submit label]' }).click();
  await responsePromise;
  await page.screenshot({ path: 'qa/knowledgebase/screenshots/TC-[NNN]-S1-result.png', fullPage: true });

  // Assertions — must be concrete, never empty
  await expect(page.getByRole('[role]', { name: '[success text]' })).toBeVisible();
  await expect(page).toHaveURL(/[expected-route]/);
});
```

#### Pass Criteria
- [ ] [Specific observable outcome 1 — e.g., redirect to `/dashboard`]
- [ ] [Specific observable outcome 2 — e.g., success toast visible]
- [ ] No `console.error` calls
- [ ] No unhandled network errors

#### Evidence
- Screenshot: `qa/evidence/TC-[NNN]-S1-pass.png`

---

### Scenario 2: [Edge Case / Variant]

**Priority**: P2
**Type**: Functional

#### Steps

| Step | Action | Playwright Method | Expected Result |
|------|--------|------------------|----------------|
| 1 | [Setup] | [method] | [result] |
| 2 | [Edge case trigger] | [method] | [graceful handling] |

#### Playwright Test

```typescript
test('TC-[NNN]-S2: [Edge case description]', async ({ page }) => {
  await page.goto('/[route]', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Trigger edge case
  // ...

  // Assert graceful handling
  await expect(page.locator('[selector]')).toBeVisible();
  await page.screenshot({ path: 'qa/knowledgebase/screenshots/TC-[NNN]-S2-result.png' });
});
```

#### Pass Criteria
- [ ] App handles edge case without crash
- [ ] [Expected UI state]
- [ ] No unhandled JS errors in console

---

### Scenario 3: Negative — [Invalid Input / Error Condition]

**Priority**: P1
**Type**: Functional (Negative)

#### Steps

| Step | Action | Playwright Method | Expected Result |
|------|--------|------------------|----------------|
| 1 | Navigate | `page.goto('/[route]')` | Form visible |
| 2 | Enter invalid input | `page.getByLabel('[field]').fill('[bad value]')` | — |
| 3 | Submit | `page.getByRole('button', { name: '[Submit]' }).click()` | Validation error shown |

#### Playwright Test

```typescript
test('TC-[NNN]-S3: Negative — [description]', async ({ page }) => {
  await page.goto('/[route]', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Enter invalid input
  await page.getByLabel('[field label]').fill('[invalid value]');
  await page.getByRole('button', { name: '[Submit label]' }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'qa/knowledgebase/screenshots/TC-[NNN]-S3-validation.png' });

  // Assert error is shown
  await expect(page.getByText('[expected error message]')).toBeVisible();

  // Assert form was NOT submitted (still on same route)
  await expect(page).toHaveURL(/[current-route]/);
});
```

#### Pass Criteria
- [ ] Validation error displayed: `"[expected error text]"`
- [ ] Form is NOT submitted (no route change)
- [ ] User can correct input and resubmit

---

### Scenario 4: Auth Guard — Unauthenticated Access

**Priority**: P1
**Type**: Auth

#### Playwright Test

```typescript
test('TC-[NNN]-S4: Auth guard — unauthenticated redirect', async ({ browser }) => {
  // Fresh context with no session
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('/[protected-route]', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'qa/knowledgebase/screenshots/TC-[NNN]-S4-redirect.png', fullPage: true });

  // Assert redirect to login/account page
  await expect(page).toHaveURL(/account|login/);

  // Assert protected content is not shown
  await expect(page.locator('[protected content selector]')).not.toBeVisible();

  await context.close();
});
```

#### Pass Criteria
- [ ] Unauthenticated user is redirected to login/account page
- [ ] Protected content is not exposed
- [ ] After login, user lands on the originally requested route (if app supports deep-link return)

---

### Scenario 5: Session Persistence — Page Reload

**Priority**: P2
**Type**: State

#### Playwright Test

```typescript
test('TC-[NNN]-S5: Session persists after reload', async ({ page }) => {
  // Establish state
  await page.goto('/[route]', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Record state before reload
  const stateBefore = await page.locator('[state element]').textContent();

  // Reload
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'qa/knowledgebase/screenshots/TC-[NNN]-S5-after-reload.png', fullPage: true });

  // Assert state survived
  const stateAfter = await page.locator('[state element]').textContent();
  expect(stateAfter).toBe(stateBefore);

  // Assert still authenticated (no redirect to login)
  await expect(page).not.toHaveURL(/account|login/);
});
```

#### Pass Criteria
- [ ] Auth session intact after reload
- [ ] UI state matches pre-reload state
- [ ] No redirect to login page

---

### Scenario 6: Console Error Monitoring

**Priority**: P2
**Type**: Functional

#### Playwright Test

```typescript
test('TC-[NNN]-S6: No console errors during happy path', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  await page.goto('/[route]', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Run through happy path steps
  // [repeat core happy path steps here]

  await page.screenshot({ path: 'qa/knowledgebase/screenshots/TC-[NNN]-S6-console.png', fullPage: true });

  expect(consoleErrors, `Console errors found:\n${consoleErrors.join('\n')}`).toHaveLength(0);
});
```

#### Pass Criteria
- [ ] Zero `console.error` calls during happy path
- [ ] Zero unhandled page errors

---

### Scenario 7: Mobile Viewport — 375px

**Priority**: P2
**Type**: UI

#### Playwright Test

```typescript
import { test, expect, devices } from '@playwright/test';

test('TC-[NNN]-S7: Mobile viewport — layout correct at 375px', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 14'] });
  const page = await context.newPage();

  await page.goto('/[route]', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'qa/knowledgebase/screenshots/TC-[NNN]-S7-mobile.png', fullPage: true });

  // Assert no horizontal overflow
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(overflow).toBe(false);

  // Assert primary CTA is visible and tappable
  await expect(page.getByRole('button', { name: '[primary action]' })).toBeVisible();

  await context.close();
});
```

#### Pass Criteria
- [ ] No horizontal scrollbar at 375px
- [ ] Primary CTA visible and not clipped
- [ ] Navigation collapses to mobile menu (hamburger or equivalent)
- [ ] All text readable (no overflow)

---

### Scenario 8: Accessibility — axe-core Audit

**Priority**: P3
**Type**: Accessibility

#### Playwright Test

```typescript
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('TC-[NNN]-S8: Accessibility — zero critical violations', async ({ page }) => {
  await page.goto('/[route]', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  const critical = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');

  if (critical.length > 0) {
    console.log('Violations:\n', critical.map(v =>
      `[${v.impact}] ${v.id}: ${v.description}\n  nodes: ${v.nodes.map(n => n.target).join(', ')}`
    ).join('\n'));
  }

  expect(critical).toHaveLength(0);
});
```

#### Pass Criteria
- [ ] Zero critical axe violations
- [ ] Zero serious axe violations
- [ ] All images have alt text
- [ ] All form fields have labels

---

## Automation Notes

- **Config**: `qa/playwright.config.ts` — `baseURL` from `QA_APP_URL` in `.env.qa`
- **URLs**: always relative — `page.goto('/path')` not `page.goto('https://...')`
- **Credentials**: always from `process.env.QA_TEST_EMAIL` — never hardcoded
- **SPA timing**: use `waitUntil: 'domcontentloaded'` + `waitForTimeout(2000)`, never `networkidle`
- **Selectors**: prefer `getByRole`, `getByLabel`, `getByText` over CSS selectors
- **Nav scope**: scope to `page.locator('nav, header').first()` to avoid footer duplicates
- **Auth**: tests needing auth use `storageState: 'qa/.auth/user.json'` via Playwright project config
- **Evidence**: `page.screenshot({ path: 'qa/evidence/TC-[NNN]-...' })` on failure
- **Run single TC**: `npx playwright test --grep "TC-[NNN]" --config qa/playwright.config.ts`

---

## Known Issues & Bugs

| Bug ID | Description | Status | Workaround |
|--------|-------------|--------|-----------|
| — | — | — | — |

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| [YYYY-MM-DD] | QA Agent | Initial generation from Phase 1 exploration |
