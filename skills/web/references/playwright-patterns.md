# Playwright Automation Patterns — QA Agent Web Skill

Reference guide for writing reliable Playwright tests within the QA Agent framework.

---

## Navigation & Page Load

```typescript
// ✅ Use 'domcontentloaded' for SPAs — 'networkidle' times out on sites
// with chat widgets (LiveChat, Intercom), analytics (GTM, Hotjar), etc.
await page.goto('/path', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000); // let SPA render

// ✅ Then wait for a specific element — more reliable than timing
await page.waitForSelector('h1', { state: 'visible' });

// ❌ Avoid — times out on most production SPAs
// await page.goto(url, { waitUntil: 'networkidle' });

// Soft navigation (SPA route change — no full reload)
await page.click('nav a:has-text("Settings")');
await page.waitForURL('**/settings');
```

## Element Selection (Preference Order)

1. `getByRole` — most stable, reflects accessibility tree
2. `getByLabel` — for form fields
3. `getByTestId` — for explicit test hooks
4. `getByText` — for buttons/links by visible text
5. CSS selectors — last resort, brittle

```typescript
// Preferred
await page.getByRole('button', { name: 'Save' }).click();
await page.getByLabel('Email address').fill('test@example.com');
await page.getByTestId('submit-btn').click();
await page.getByText('Sign in').click();

// Avoid
await page.click('.btn.btn-primary.submit');  // brittle
await page.click('#root > div > form > button');  // extremely brittle
```

## Forms & Input

```typescript
// Fill form
await page.getByLabel('Email').fill(process.env.QA_USERNAME!);
await page.getByLabel('Password').fill(process.env.QA_PASSWORD!);
await page.getByRole('button', { name: /sign in/i }).click();

// Select dropdown
await page.getByLabel('Country').selectOption('US');

// File upload
await page.getByLabel('Upload file').setInputFiles('test-data/sample.pdf');

// Clear before typing
await page.getByLabel('Search').clear();
await page.getByLabel('Search').fill('new query');
```

## Assertions

```typescript
// URL and title
await expect(page).toHaveURL('/dashboard');
await expect(page).toHaveTitle(/Dashboard/);

// Visibility
await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
await expect(page.getByTestId('error-message')).toBeHidden();

// Text content
await expect(page.getByTestId('user-name')).toHaveText('John Doe');
await expect(page.getByTestId('count')).toContainText('5');

// Form state
await expect(page.getByLabel('Email')).toHaveValue('user@example.com');
await expect(page.getByRole('checkbox')).toBeChecked();
await expect(page.getByRole('button', { name: 'Submit' })).toBeDisabled();

// Soft assertions (collect all failures)
await expect.soft(page.getByTestId('logo')).toBeVisible();
await expect.soft(page.getByRole('navigation')).toBeVisible();
```

## Screenshots & Visual Validation

```typescript
// Full-page screenshot
await page.screenshot({ path: 'qa/evidence/TC-001-S1-pass.png', fullPage: true });

// Element screenshot
await page.locator('.chart-container').screenshot({ path: 'qa/evidence/TC-001-chart.png' });

// Visual regression (snapshot comparison)
await expect(page).toHaveScreenshot('dashboard-baseline.png', {
  maxDiffPixels: 100,
  threshold: 0.2,
});
```

## Network Mocking

```typescript
// Mock API response
await page.route('**/api/users', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{ id: 1, name: 'Test User' }]),
  });
});

// Simulate network error
await page.route('**/api/data', (route) => route.abort('failed'));

// Simulate slow network
await page.route('**/*', async (route) => {
  await new Promise((r) => setTimeout(r, 3000));
  await route.continue();
});

// Block images (speed up tests)
await page.route('**/*.{png,jpg,jpeg,gif,svg}', (route) => route.abort());
```

## Authentication & Session Persistence

```typescript
// Save auth state (run once in setup)
await page.goto('/login');
await page.getByLabel('Email').fill(process.env.QA_USERNAME!);
await page.getByLabel('Password').fill(process.env.QA_PASSWORD!);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL('/dashboard');
await page.context().storageState({ path: 'qa/.auth/user.json' });

// Reuse auth state in tests (configured in playwright.config.ts)
// storageState: 'qa/.auth/user.json'
```

## Accessibility (axe-core)

```typescript
import { injectAxe, checkA11y } from 'axe-playwright';

test('Page meets WCAG 2.1 AA', async ({ page }) => {
  await page.goto('/');
  await injectAxe(page);
  await checkA11y(page, null, {
    axeOptions: {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    },
  });
});
```

## Performance Metrics (CDP)

```typescript
// Capture Core Web Vitals
const client = await page.context().newCDPSession(page);
await client.send('Performance.enable');
await page.goto('/');
const metrics = await client.send('Performance.getMetrics');
const lcp = metrics.metrics.find((m) => m.name === 'LargestContentfulPaint');
console.log('LCP:', lcp?.value);
```
