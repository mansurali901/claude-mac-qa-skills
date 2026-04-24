---
name: login-engage
description: Network-first login subroutine with automatic signup fallback. If login fails, attempts signup with the same credentials before asking the user. Runtime scripts copy this to qa/scripts/login-engage.js.
type: helper
---

# Login Engagement Subroutine

> **Purpose** — when the agent identifies a page as an auth gate, run THIS instead of a shallow fill+click+screenshot loop. It captures the network response as ground truth, distinguishes silent form-reset from server rejection, and on any login failure automatically attempts signup with the same credentials before engaging the user.

## When to invoke

Invoke when ANY of:
- URL matches `/login|/signin|/auth`
- A `password` input is visible on the page
- The role-credential gate (web SKILL.md Step W-2.5) marked this role as needing auth

## Fallback chain (built-in)

```
loginEngage()
  └─ auth-success                  → done (storageState cached)
  └─ any login failure*            → signupEngage() with same email + password
       └─ signup-success           → done (storageState cached)
       └─ signup-already-exists    → retry loginEngage() once more (account exists, creds may now match)
       └─ any signup failure       → AskUserQuestion with combined login + signup evidence
  └─ network-timeout               → AskUserQuestion immediately (app unreachable, signup won't help)
  └─ form-validation-blocked       → AskUserQuestion immediately (form has extra requirements)
```

\* login failure labels that trigger signup: `auth-rejected-server`, `form-reset-silent`, `error-surfaced`, `no-change`

## The failure mode (why this exists)

Common pattern across SPAs on any platform: creds filled → submit clicked → URL unchanged, inputs cleared, no visible error. Shallow detectors see no URL change + no visible error and declare "no state change → blocker". The actual failure is server-side rejection the SPA handled by clearing the form without rendering an error. **Ground truth lives in the network response** — this helper captures it instead of re-reading near-identical screenshots.

## Protocol

```javascript
// Why: network-first login that distinguishes silent reset / server reject / success.
//      On any recoverable login failure, automatically attempts signup with the same
//      credentials before escalating to the user.
// Strategy: helper called by targeted-trace, bfs cred-gate, and W-2.5 role auth.
// Fallback: on any uncaught exception, write evidence-bundle to qa/decisions.md
//           and pose a 4-option AskUserQuestion. Never throw.

const fs = require('fs');
const { attachListeners, snapshot } = require('./outcome-classifier.js');
const { extractDOM } = require('../../scripts/qa-screenshot.js');

// Labels that warrant a signup attempt (account likely doesn't exist yet)
const SIGNUP_FALLBACK_LABELS = new Set([
  'auth-rejected-server', 'form-reset-silent', 'error-surfaced', 'no-change'
]);

// ─────────────────────────────────────────────
// loginEngage — entry point
// ─────────────────────────────────────────────
async function loginEngage(page, context, { email, password, role }) {
  const buf = attachListeners(context);
  const AUTH_WAIT = parseInt(process.env.QA_AUTH_WAIT_MS || '5000', 10);
  const TYPE_DELAY = parseInt(process.env.QA_TYPING_DELAY_MS || '50', 10);

  // 1. Snapshot pre-state
  const before = await snapshot(page);
  const preCookies = await context.cookies();

  // 2. Locate fields with resilient selectors
  const emailField = page.getByLabel(/email|username/i).first()
                  .or(page.locator('input[type=email],input[name*=email i],input[name*=user i]').first());
  const passwordField = page.getByLabel(/password/i).first()
                     .or(page.locator('input[type=password]').first());
  const submit = page.getByRole('button', { name: /sign in|log in|login|submit/i }).first()
              .or(page.locator('button[type=submit]').first());

  // 3. Fill with explicit blur (many SPAs only validate on blur)
  await emailField.fill('');
  await emailField.pressSequentially(email, { delay: TYPE_DELAY });
  await emailField.evaluate(el => el.dispatchEvent(new Event('blur', { bubbles: true })));
  await passwordField.fill('');
  await passwordField.pressSequentially(password, { delay: TYPE_DELAY });
  await passwordField.evaluate(el => el.dispatchEvent(new Event('blur', { bubbles: true })));

  // 4. Wait for submit enabled
  let submitReady = true;
  try { await submit.waitFor({ state: 'visible', timeout: 3000 }); }
  catch { submitReady = false; }
  const enabled = submitReady ? await submit.isEnabled().catch(() => false) : false;
  if (!enabled) {
    // Form has extra requirements (captcha, domain restriction, terms) — signup won't help
    return await pose({
      label: 'form-validation-blocked',
      evidence: { reason: 'submit button not enabled', before }
    });
  }

  // 5. Arm response-waiter BEFORE clicking
  // Exclude known tracking/analytics domains so their 200s don't masquerade as auth success.
  const TRACKING_DOMAINS = /google\.|googleapis\.|doubleclick\.|segment\.|mixpanel\.|amplitude\.|analytics\.|hotjar\.|intercom\.|sentry\.|clarity\./i;
  const sinceTs = Date.now();
  const authRespPromise = page.waitForResponse(
    r => /\/(auth|login|signin|session|token|graphql)/i.test(r.url())
      && r.request().method() === 'POST'
      && !TRACKING_DOMAINS.test(new URL(r.url()).hostname),
    { timeout: AUTH_WAIT }
  ).catch(() => null);
  const navPromise = page.waitForNavigation({ timeout: AUTH_WAIT }).catch(() => null);

  // 6. Click + collect
  await submit.click();
  const [authResp, nav] = await Promise.all([authRespPromise, navPromise]);

  // Settle DOM mutations
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

  // 7. Build evidence bundle
  const after = await snapshot(page);
  const postCookies = await context.cookies();
  const cookieAdded = postCookies.length > preCookies.length;
  const tokenAdded = after.storageKeys > before.storageKeys;
  const inputsEmptyAfter = after.inputs.filter(i => /password|email|user/i.test(i.name || '')).every(i => i.empty);

  let bodyExcerpt = '';
  let status = null;
  if (authResp) {
    status = authResp.status();
    try { bodyExcerpt = (await authResp.text()).slice(0, 1024); } catch {}
  }

  const loginEvidence = {
    role, status, bodyExcerpt,
    urlBefore: before.url, urlAfter: after.url,
    cookieAdded, tokenAdded,
    inputsEmptyAfter, errorVisible: after.errorVisible, errorText: after.errorText,
    requestFailures: buf.requestFailures.filter(f => f.ts >= sinceTs)
  };

  // 8. Classify in order — first match wins
  // A 200 from a tracker can add its own cookie — require nav OR a token-shaped body.
  const AUTH_BODY_RE = /access_token|id_token|refresh_token|"token"|"session"|"user"\s*:/i;
  const bodyLooksLikeAuth = AUTH_BODY_RE.test(bodyExcerpt);
  let label;
  if (status && status >= 200 && status < 300 && (nav || tokenAdded || (cookieAdded && bodyLooksLikeAuth))) {
    label = 'auth-success';
  } else if (status && status >= 400) {
    label = 'auth-rejected-server';
  } else if (!authResp && before.url === after.url && inputsEmptyAfter && !after.errorVisible) {
    label = 'form-reset-silent';
  } else if (after.errorVisible) {
    label = 'error-surfaced';
  } else if (!authResp && !nav) {
    label = 'network-timeout';
  } else if (cookieAdded || tokenAdded) {
    label = 'auth-success';
  } else {
    label = 'no-change';
  }
  
  fs.appendFileSync('qa/decisions.md',
    `\n- ${new Date().toISOString()} | login-engage | ${role} | ${label} | ${JSON.stringify(loginEvidence)}\n`);

  if (label === 'auth-success') {
    await context.storageState({ path: `qa/.auth/${role}.json` });
    return { label, evidence: loginEvidence };
  }

  // App unreachable — signup won't help, ask immediately
  if (label === 'network-timeout') {
    const shotPath = `qa/knowledgebase/screenshots/login-${role}-${label}.png`;
    await page.screenshot({ path: shotPath, fullPage: false });
    return await pose({ label, evidence: loginEvidence, screenshot: shotPath });
  }

  // ── Signup fallback ──────────────────────────────────────────────────────
  if (SIGNUP_FALLBACK_LABELS.has(label)) {
    fs.appendFileSync('qa/decisions.md',
      `\n- ${new Date().toISOString()} | login-engage | ${role} | login-failed→trying-signup | label=${label}\n`);

    const signupResult = await signupEngage(page, context, { email, password, role });

    if (signupResult.label === 'auth-success') {
      return signupResult; // signed up (and auto-logged in or re-logged in)
    }

    // signup-already-exists → account exists but creds differ — ask user
    // any other signup failure → ask user with combined evidence
    const shotPath = `qa/knowledgebase/screenshots/auth-${role}-both-failed.png`;
    await page.screenshot({ path: shotPath, fullPage: false });
    return await pose({
      label: 'auth-and-signup-failed',
      evidence: { loginLabel: label, loginEvidence, signupLabel: signupResult.label, signupEvidence: signupResult.evidence },
      screenshot: shotPath
    });
  }

  // Remaining labels (form-validation-blocked handled above, catchall)
  const shotPath = `qa/knowledgebase/screenshots/login-${role}-${label}.png`;
  await page.screenshot({ path: shotPath, fullPage: false });
  return await pose({ label, evidence: loginEvidence, screenshot: shotPath });
}

// ─────────────────────────────────────────────
// signupEngage — called automatically by loginEngage on failure
// ─────────────────────────────────────────────
async function signupEngage(page, context, { email, password, role }) {
  const AUTH_WAIT = parseInt(process.env.QA_AUTH_WAIT_MS || '5000', 10);
  const TYPE_DELAY = parseInt(process.env.QA_TYPING_DELAY_MS || '50', 10);
  const displayName = process.env[`QA_${role.toUpperCase()}_NAME`] || email.split('@')[0];

  // 1. Navigate to signup page
  const signupUrl = await resolveSignupUrl(page);
  if (!signupUrl) {
    return { label: 'signup-page-not-found', evidence: { currentUrl: page.url() } };
  }
  await page.goto(signupUrl);
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

  // 2. Screenshot the signup page BEFORE touching any field
  const formShotPath = `qa/knowledgebase/screenshots/signup-${role}-form.png`;
  await page.screenshot({ path: formShotPath, fullPage: true });
  // AGENT: Read the screenshot at formShotPath with the Read tool NOW.
  // List every visible form field top→bottom: label text, input type, required marker (* or aria-required).
  // Note any non-standard fields (phone, username, DOB, organization, captcha, custom dropdowns).
  // Build your fill plan from this visual list before calling any Playwright selector.

  const before = await snapshot(page);
  const preCookies = await context.cookies();

  // 3. DOM snapshot — extract all visible fields from the same page state as the screenshot
  const pageDom = await extractDOM(page);
  const allFields = [...pageDom.inputs, ...pageDom.selects, ...pageDom.textareas];

  // 4. Categorize every field and build fill plan in DOM order
  let passwordCount = 0;
  const fillPlan = [];
  const unknownRequired = [];

  for (const f of allFields) {
    if (f.type === 'submit' || f.type === 'button') continue;
    const sig = [f.name, f.id, f.placeholder, f.ariaLabel].join(' ');
    if (f.type === 'checkbox' && /terms|agree|accept/i.test(sig)) {
      fillPlan.push({ ...f, category: 'terms', value: null });
    } else if (f.type === 'email' || /email/i.test(sig)) {
      fillPlan.push({ ...f, category: 'email', value: email });
    } else if (f.type === 'password') {
      passwordCount++;
      fillPlan.push({ ...f, category: 'password', value: password }); // both password + confirm
    } else if (/\bname\b|full.?name|display.?name|username/i.test(sig)) {
      fillPlan.push({ ...f, category: 'name', value: displayName });
    } else if (f.required) {
      unknownRequired.push(f);
    }
    // non-required unknown fields: skip silently
  }

  // 5. Gate: required fields we can't fill — ask before wasting a submit attempt
  if (unknownRequired.length > 0) {
    return await pose({
      label: 'signup-needs-extra-fields',
      evidence: {
        role, signupUrl, formScreenshot: formShotPath,
        unknownRequired,
        message: `Signup form has ${unknownRequired.length} required field(s) that can't be filled from credentials: ${unknownRequired.map(f => f.ariaLabel || f.placeholder || f.name || f.id || '(unknown)').join(', ')}`
      },
      screenshot: formShotPath
    });
  }

  // 6. Gate: minimum expected fields present?
  const hasEmail  = fillPlan.some(f => f.category === 'email');
  const hasPass   = fillPlan.some(f => f.category === 'password');
  const submit    = page.getByRole('button', { name: /sign.?up|register|create.*(account|profile)|get.?started/i })
                        .or(page.locator('button[type=submit]')).first();
  const hasSubmit = await submit.isVisible().catch(() => false);
  const missingFields = [!hasEmail && 'email', !hasPass && 'password', !hasSubmit && 'submit button'].filter(Boolean);

  if (missingFields.length > 0) {
    return await pose({
      label: 'signup-field-not-found',
      evidence: {
        role, signupUrl, formScreenshot: formShotPath,
        missingFields,
        message: `Signup form is missing expected field(s): ${missingFields.join(', ')}. The page may require a different flow, or the selector didn't match.`
      },
      screenshot: formShotPath
    });
  }

  // 7. Execute fill plan in DOM order — every field from scan, no blind guessing
  const typeCounters = {};
  for (const entry of fillPlan) {
    typeCounters[entry.type] = typeCounters[entry.type] ?? 0;
    const loc = entry.id
      ? page.locator(`#${entry.id}`)
      : entry.name
        ? page.locator(`[name="${entry.name}"]`)
        : page.locator(`input[type="${entry.type}"]`).nth(typeCounters[entry.type]);
    typeCounters[entry.type]++;

    if (entry.category === 'terms') {
      await loc.check().catch(() => {});
    } else {
      await loc.fill('');
      await loc.pressSequentially(entry.value, { delay: TYPE_DELAY });
      await loc.evaluate(el => el.dispatchEvent(new Event('blur', { bubbles: true })));
    }
  }

  // 11. Pre-submit verification screenshot
  const preSubmitShot = `qa/knowledgebase/screenshots/signup-${role}-prefill.png`;
  await page.screenshot({ path: preSubmitShot, fullPage: true });
  // AGENT: Read the screenshot at preSubmitShot with the Read tool NOW.
  // Verify every field filled above actually contains a value — no empty required inputs.
  // If any looks empty, re-fill it before continuing.

  // 12. Arm response-waiter BEFORE clicking
  const sinceTs = Date.now();
  const signupRespPromise = page.waitForResponse(
    r => /\/(auth|register|signup|sign.?up|users?|accounts?|graphql)/i.test(r.url()) && r.request().method() === 'POST',
    { timeout: AUTH_WAIT }
  ).catch(() => null);
  const navPromise = page.waitForNavigation({ timeout: AUTH_WAIT }).catch(() => null);

  await submit.click();
  const [signupResp, nav] = await Promise.all([signupRespPromise, navPromise]);
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

  // 13. Build evidence
  const after = await snapshot(page);
  const postCookies = await context.cookies();
  let status = null;
  let bodyExcerpt = '';
  if (signupResp) {
    status = signupResp.status();
    try { bodyExcerpt = (await signupResp.text()).slice(0, 1024); } catch {}
  }

  const signupEvidence = {
    role, signupUrl, status, bodyExcerpt,
    urlBefore: before.url, urlAfter: after.url,
    errorVisible: after.errorVisible, errorText: after.errorText,
    cookieAdded: postCookies.length > preCookies.length
  };

  // 14. Classify signup outcome
  let signupLabel;
  const cookieAdded = postCookies.length > preCookies.length;
  const alreadyExists = /already.*(exist|register|taken)|duplicate|conflict/i.test(bodyExcerpt + (after.errorText || ''));
  if (status && status >= 200 && status < 300 && (nav || cookieAdded)) {
    // Signup succeeded — check if auto-logged in
    if (cookieAdded || after.storageKeys > before.storageKeys) {
      signupLabel = 'auth-success';
    } else {
      // Account created but not auto-logged in — do a fresh login
      signupLabel = 'signup-success-needs-login';
    }
  } else if (alreadyExists) {
    signupLabel = 'signup-already-exists';
  } else if (status && status >= 400) {
    signupLabel = 'signup-server-error';
  } else if (!signupResp && !nav) {
    signupLabel = 'signup-network-timeout';
  } else {
    signupLabel = 'signup-failed';
  }

  fs.appendFileSync('qa/decisions.md',
    `\n- ${new Date().toISOString()} | signup-engage | ${role} | ${signupLabel} | ${JSON.stringify(signupEvidence)}\n`);

  if (signupLabel === 'auth-success') {
    await context.storageState({ path: `qa/.auth/${role}.json` });
    return { label: 'auth-success', evidence: signupEvidence };
  }

  // Signup created account but needs an explicit login round-trip
  if (signupLabel === 'signup-success-needs-login') {
    const loginUrl = await resolveLoginUrl(page);
    if (!loginUrl) {
      return await pose({
        label: 'login-url-not-found',
        evidence: { role, signupUrl, message: 'Account created but no login link found on page. Provide the login URL via QA_LOGIN_URL or navigate manually.' }
      });
    }
    await page.goto(loginUrl);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    return await loginEngage(page, context, { email, password, role });
  }

  return { label: signupLabel, evidence: signupEvidence };
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function resolveSignupUrl(page) {
  if (process.env.QA_SIGNUP_URL) return process.env.QA_SIGNUP_URL;
  // getByRole('link') misses <a> without href (SPA routers give role="generic", not "link")
  const signupEl = page.locator('a, button').filter({ hasText: /sign.?up|register|create.*(account|profile)|get.?started/i }).first();
  const elVisible = await signupEl.isVisible().catch(() => false);
  if (!elVisible) return null;
  const href = await signupEl.getAttribute('href').catch(() => null);
  const resolved = resolveHref(href, page.url());
  if (resolved) return resolved;
  // No navigable href — click and observe (handles all SPA router styles)
  const beforeUrl = page.url();
  await signupEl.click().catch(() => {});
  await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
  const afterUrl = page.url();
  if (afterUrl !== beforeUrl) return afterUrl;
  return null; // caller poses AskUserQuestion
}

async function resolveLoginUrl(page) {
  if (process.env.QA_LOGIN_URL) return process.env.QA_LOGIN_URL;
  const loginEl = page.locator('a, button').filter({ hasText: /log.?in|sign.?in/i }).first();
  const elVisible = await loginEl.isVisible().catch(() => false);
  if (!elVisible) return null;
  const href = await loginEl.getAttribute('href').catch(() => null);
  const resolved = resolveHref(href, page.url());
  if (resolved) return resolved;
  const beforeUrl = page.url();
  await loginEl.click().catch(() => {});
  await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
  const afterUrl = page.url();
  if (afterUrl !== beforeUrl) return afterUrl;
  return null; // caller poses AskUserQuestion
}

function resolveHref(href, base) {
  if (!href) return null;
  try {
    const resolved = new URL(href, base).href;
    if (resolved === base || resolved === base + '#') return null;
    return resolved;
  } catch { return null; }
}

// pose() writes a question file the agent picks up via AskUserQuestion
async function pose({ label, evidence, screenshot }) {
  const q = { label, evidence, screenshot, ts: Date.now() };
  fs.writeFileSync('qa/pending-question.md', '```json\n' + JSON.stringify(q, null, 2) + '\n```\n');
  return q;
}

module.exports = { loginEngage, signupEngage };
```

## Agent-side handling per label

`loginEngage` now runs the signup fallback internally. The agent only sees the final returned label:

| Label | Meaning | AskUserQuestion message |
|---|---|---|
| `auth-success` | Login OR signup succeeded | (silent — proceed; storageState cached) |
| `auth-and-signup-failed` | Both login AND signup failed | "Login failed (`<loginLabel>`) and signup also failed (`<signupLabel>`). Evidence: `<loginEvidence>`, `<signupEvidence>`. (a) provide different creds, (b) fix account in the app then retry, (c) skip this role." |
| `login-url-not-found` | Account created but no login link visible on page | "Signup succeeded but no login link is visible on the page. Navigate to the login page and retry." |
| `signup-page-not-found` | No signup link visible on page | "No signup link found on the current page. Navigate to the signup page and retry." |
| `form-validation-blocked` | Login form has extra requirements; signup not attempted | "Submit never became enabled — app needs something extra (captcha? specific email domain? terms checkbox?). What's missing?" |
| `network-timeout` | App unreachable; signup not attempted | "No auth response within `QA_AUTH_WAIT_MS`ms. (a) retry with longer timeout, (b) check app reachability, (c) skip." |
| `signup-already-exists` | Signup says account exists but login failed | "Account exists (`<email>`) but login was rejected. (a) provide correct password, (b) reset password via UI, (c) skip this role." |
| `signup-needs-extra-fields` | Signup form has required fields that can't be filled from credentials (phone, DOB, org, etc.) | "Signup form at `<signupUrl>` requires fields I can't fill automatically: `<fieldList>`. Provide a value for each field, or skip this role." |
| `signup-field-not-found` | A required field (email, password, or submit button) was not found on the signup page | "Signup form is missing: `<missingFields>`. The page may use a different layout or multi-step flow. Tell me what to do, or skip this role." |

## Deep-engagement notes

- **OAuth/SSO popups**: detect `page.on('popup')` BEFORE clicking submit. If a popup opens to a 3rd-party domain, defer to the user — never auto-click consent.
- **MFA/OTP**: when post-submit page contains an OTP input, ask the user for the 6-digit code via AskUserQuestion. Cache nothing.
- **Rate-limited / paste-blocked fields**: `pressSequentially` with `QA_TYPING_DELAY_MS` already handles this.
- **HAR capture**: opt-in via `QA_AUTH_HAR=1` — write only the auth step to `qa/har/auth-<role>.har`.

## Deep-engagement notes — signup-specific

- **Name field**: uses `QA_<ROLE>_NAME` env var; falls back to the local-part of the email.
- **Confirm-password**: filled automatically with the same password.
- **Terms checkbox**: auto-checked if visible. If the form has a captcha, `signupEngage` cannot proceed — it returns `signup-failed` and the agent asks the user.
- **Signup URL resolution**: visible signup link on the current page only. No env vars, no path guessing — if no link is found, agent poses `AskUserQuestion`.
- **Login URL resolution**: visible login link on the current page only. No env vars, no path guessing — if no link is found, agent poses `AskUserQuestion`.
- **Auto-login after signup**: if the app issues cookies/tokens immediately on signup, `signupEngage` caches `storageState` and returns `auth-success` without a second login round-trip.
- **signup-success-needs-login**: if account is created but no session is issued, `signupEngage` follows the visible login link on the page and calls `loginEngage` once more with the same creds.

## Fallback

If `loginEngage` or `signupEngage` throws, the catching script must:
1. Append the exception + last evidence-bundle to `qa/decisions.md`.
2. Take ONE diagnostic screenshot.
3. Pose a 4-option AskUserQuestion (retry / different creds / inspect manually / skip role).

Never `throw`, never `process.exit`.
