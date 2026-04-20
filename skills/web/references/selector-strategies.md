# Selector Strategies — QA Agent Web Skill

> ⚠️ **These strategies are EXAMPLES AND PREFERRED SUGGESTIONS — adapt as needed.**
> Document deviations in `qa/decisions.md`. If your preferred selector doesn't exist in the target app (e.g. no `data-testid`), fall back to the next best tier and log the substitution.

Guide for choosing the right selectors to write maintainable, non-brittle Playwright tests.

---

## Selector Priority (Best → Worst)

| Priority | Strategy | Example | Why |
|----------|----------|---------|-----|
| 1 | `getByRole` | `getByRole('button', {name:'Save'})` | Reflects accessibility tree; survives CSS changes |
| 2 | `getByLabel` | `getByLabel('Email address')` | Tied to the visible label; intent-based |
| 3 | `getByTestId` | `getByTestId('submit-btn')` | Explicit test contract; never ambiguous |
| 4 | `getByText` | `getByText('Sign in')` | Works for unique text; breaks if text changes |
| 5 | `getByPlaceholder` | `getByPlaceholder('Search...')` | Good for unlabelled inputs |
| 6 | CSS selectors | `locator('.submit-button')` | Only when no semantic option exists |
| 7 | XPath | `locator('//button[@type="submit"]')` | Last resort; very brittle |

---

## Adding Test IDs (`data-testid`)

When no semantic selector works, ask the development team to add test IDs:

```html
<!-- React -->
<button data-testid="save-document-btn" onClick={handleSave}>Save</button>

<!-- Vue -->
<input v-bind:data-testid="'search-input'" ... />

<!-- Angular -->
<nav data-testid="main-navigation">...</nav>
```

Playwright reads them as:
```typescript
await page.getByTestId('save-document-btn').click();
```

---

## Dynamic Elements

```typescript
// Wait for dynamic content before asserting
await page.waitForSelector('[data-testid="results"]', { state: 'visible' });

// Retry-able assertions (auto-wait built into Playwright)
await expect(page.getByTestId('toast')).toBeVisible();           // waits up to expect.timeout
await expect(page.getByTestId('spinner')).toBeHidden();          // waits for spinner to disappear

// Explicit wait for network (for slow APIs)
await Promise.all([
  page.waitForResponse('**/api/data'),
  page.getByRole('button', { name: 'Load' }).click(),
]);
```

---

## Handling Modals and Dialogs

```typescript
// Browser dialog (alert/confirm)
page.on('dialog', async (dialog) => {
  await dialog.accept();  // or dialog.dismiss()
});

// Modal within the page
const modal = page.getByRole('dialog');
await expect(modal).toBeVisible();
await modal.getByRole('button', { name: 'Confirm' }).click();
await expect(modal).toBeHidden();
```

---

## iframes

```typescript
// Access content inside an iframe
const iframe = page.frameLocator('#embedded-content');
await iframe.getByRole('button', { name: 'Submit' }).click();
```
