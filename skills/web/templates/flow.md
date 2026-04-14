# F-[NNN]: [Flow Name]

## Summary

| Field | Value |
|-------|-------|
| **Flow ID** | F-[NNN] |
| **Application** | [AppName] |
| **URL / Base Route** | [e.g., `/dashboard`, `/account`, `/settings`] |
| **Description** | [One sentence: what goal does this flow accomplish?] |
| **Start State** | [Browser state before flow begins, e.g., "Unauthenticated, on homepage"] |
| **End State** | [Browser state when flow completes successfully] |
| **Auth Required** | Yes / No |
| **Priority** | P1 / P2 / P3 |
| **Discovered via** | Screenshot analysis + Playwright crawl |
| **Created** | [YYYY-MM-DD] |
| **Last Updated** | [YYYY-MM-DD] |

---

## UI Elements Involved

| Element Type | Selector / Label | Role in This Flow |
|-------------|-----------------|-------------------|
| [Button / Input / Link / Form / Modal / Tab] | `[selector or visible label]` | [what it does in this flow] |

---

## User Journey

### Preconditions
- [ ] [What must be true before this flow starts]
- [ ] [Auth state — logged in / logged out / specific tier]
- [ ] [`.env.qa` values required — e.g., `QA_TEST_EMAIL`, `QA_APP_URL`]
- [ ] [Any cookies, localStorage, or session state required]

### Steps

| Step | User Action | Page / UI Response | URL Change |
|------|------------|-------------------|-----------|
| 1 | [User does this] | [Page responds like this] | [route if changed] |
| 2 | ... | ... | ... |

### Success Outcome
> [What the user sees / what has changed when the flow completes successfully]

### Failure Outcomes

| What Goes Wrong | Expected App Behavior |
|----------------|----------------------|
| [Unauthenticated access] | [Redirect to `/account` or `/login`] |
| [Invalid input submitted] | [Inline validation error, form not submitted] |
| [API / network error] | [Error toast or message shown, no data loss] |

---

## Sub-Flows / Variants

- **[F-NNN-a]**: [Variant name] — [Brief description, e.g., "SSO login instead of email/password"]

---

## Discovery Evidence

### Phase 1 Screenshots

| Step | Action | Screenshot | Observed |
|------|--------|-----------|---------|
| 1 | [Action] | `qa/knowledgebase/screenshots/flow-F[NNN]-step01-[desc].png` | [What was visible] |
| 2 | [Action] | `qa/knowledgebase/screenshots/flow-F[NNN]-step02-[desc].png` | [What was visible] |

---

## Playwright Navigation Skeleton

```typescript
import { chromium } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.qa' });

// Navigate F-[NNN]: [Flow Name]
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Step 1: [description]
  await page.goto(process.env.QA_APP_URL + '[route]', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'qa/knowledgebase/screenshots/flow-F[NNN]-step01-[desc].png', fullPage: true });

  // Step 2: [description]
  await page.locator('[selector]').click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'qa/knowledgebase/screenshots/flow-F[NNN]-step02-[desc].png', fullPage: false });

  // Step N: verify success state
  // await expect(page.locator('[selector]')).toBeVisible();

  await browser.close();
})();
```

---

## Notes / Observations

- [Anything unusual observed during discovery — redirects, SPA route quirks, loading states, auth interceptions, etc.]
