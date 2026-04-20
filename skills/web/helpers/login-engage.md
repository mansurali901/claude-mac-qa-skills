---
name: login-engage
description: Network-first login subroutine. Fixes the HomaCare silent form-reset failure mode. Runtime scripts copy this to qa/scripts/login-engage.js.
type: helper
---

# Login Engagement Subroutine

> **Purpose** — when the agent identifies a page as an auth gate, run THIS instead of a shallow fill+click+screenshot loop. It captures the network response as ground truth, distinguishes silent form-reset from server rejection, and engages the user with concrete evidence rather than reporting "blocker".

## When to invoke

Invoke when ANY of:
- URL matches `/login|/signin|/auth`
- A `password` input is visible on the page
- The role-credential gate (web SKILL.md Step W-2.5) marked this role as needing auth

## The HomaCare failure (why this exists)

Evidence in `qa/knowledgebase/screenshots/page-13-login-filled.png` and `page-14-post-login.png`:
- page-13: email + password filled, Sign In button enabled
- page-14: SAME URL, SAME login layout, BUT BOTH FIELDS BLANK and NO error message rendered

The previous flow read both ~8 KB screenshots, saw no URL change, no visible error, declared "no state change → blocker" — and stopped. The actual failure was a server-side rejection that the SPA handled by clearing the form without rendering an error. **Ground truth was in the network response we never captured.**

## Protocol — 8 steps, one browser round-trip cluster

```javascript
// Why: network-first login that distinguishes silent reset / server reject / success.
// Strategy: helper called by targeted-trace, bfs cred-gate, and W-2.5 role auth.
// Fallback: on any uncaught exception, write evidence-bundle to qa/decisions.md
//           and pose a 4-option AskUserQuestion. Never throw.

const fs = require('fs');
const { attachListeners, snapshot, classify } = require('./outcome-classifier.js');

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
  await emailField.pressSequentially(email, { delay: TYPE_DELAY });
  await emailField.evaluate(el => el.dispatchEvent(new Event('blur', { bubbles: true })));
  await passwordField.pressSequentially(password, { delay: TYPE_DELAY });
  await passwordField.evaluate(el => el.dispatchEvent(new Event('blur', { bubbles: true })));

  // 4. Wait for submit enabled
  let submitReady = true;
  try { await submit.waitFor({ state: 'visible', timeout: 3000 }); }
  catch { submitReady = false; }
  const enabled = submitReady ? await submit.isEnabled().catch(() => false) : false;
  if (!enabled) {
    return await pose({
      label: 'form-validation-blocked',
      evidence: { reason: 'submit button not enabled', before }
    });
  }

  // 5. Arm response-waiter BEFORE clicking
  const sinceTs = Date.now();
  const authRespPromise = page.waitForResponse(
    r => /\/(auth|login|signin|session|token|graphql)/i.test(r.url()) && r.request().method() === 'POST',
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

  const evidence = {
    role, status, bodyExcerpt,
    urlBefore: before.url, urlAfter: after.url,
    cookieAdded, tokenAdded,
    inputsEmptyAfter, errorVisible: after.errorVisible, errorText: after.errorText,
    requestFailures: buf.requestFailures.filter(f => f.ts >= sinceTs)
  };

  // 8. Classify in order — first match wins
  let label;
  if (status && status >= 200 && status < 300 && (cookieAdded || tokenAdded || nav)) {
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

  // Emit one JSON line + one screenshot only on non-success
  fs.appendFileSync('qa/decisions.md',
    `\n- ${new Date().toISOString()} | login-engage | ${role} | ${label} | ${JSON.stringify(evidence)}\n`);

  if (label === 'auth-success') {
    await context.storageState({ path: `qa/.auth/${role}.json` });
    return { label, evidence };
  }

  // Non-success → one diagnostic screenshot
  const shotPath = `qa/knowledgebase/screenshots/login-${role}-${label}.png`;
  await page.screenshot({ path: shotPath, fullPage: false });
  return await pose({ label, evidence, screenshot: shotPath });
}

// pose() writes a question file the agent picks up via AskUserQuestion
async function pose({ label, evidence, screenshot }) {
  const q = { label, evidence, screenshot, ts: Date.now() };
  fs.writeFileSync('qa/pending-question.md', '```json\n' + JSON.stringify(q, null, 2) + '\n```\n');
  return q;
}

module.exports = { loginEngage };
```

## Agent-side handling per label

After running login-engage, the agent reads the returned label and routes:

| Label | AskUserQuestion message |
|---|---|
| `auth-success` | (silent — proceed; storageState cached) |
| `auth-rejected-server` | "Server rejected login with status `<status>`: '<bodyExcerpt>'. (a) provide different creds, (b) self-register via UI, (c) skip this role." |
| `form-reset-silent` | "App cleared the form without an error message — likely silent server-side rejection (expired CSRF, backend session mismatch, account not provisioned). (a) retry, (b) open DevTools Network tab and share failing request, (c) provide different creds, (d) skip this role." |
| `form-validation-blocked` | "Submit never became enabled — app needs something extra (captcha? specific email domain? terms checkbox?). What's missing?" |
| `error-surfaced` | "App rendered: '<errorText>'. (a) provide different creds, (b) skip role, (c) tell me what to do." |
| `network-timeout` | "No auth response within `QA_AUTH_WAIT_MS`ms. (a) retry with longer timeout, (b) check app reachability, (c) skip." |

## Deep-engagement notes

- **OAuth/SSO popups**: detect `page.on('popup')` BEFORE clicking submit. If a popup opens to a 3rd-party domain, defer to the user — never auto-click consent.
- **MFA/OTP**: when post-submit page contains an OTP input, ask the user for the 6-digit code via AskUserQuestion. Cache nothing.
- **Rate-limited / paste-blocked fields**: `pressSequentially` with `QA_TYPING_DELAY_MS` already handles this.
- **HAR capture**: opt-in via `QA_AUTH_HAR=1` — write only the auth step to `qa/har/auth-<role>.har`.

## Fallback

If `loginEngage` throws, the catching script must:
1. Append the exception + last evidence-bundle to `qa/decisions.md`.
2. Take ONE diagnostic screenshot.
3. Pose a 4-option AskUserQuestion (retry / different creds / inspect manually / skip role).

Never `throw`, never `process.exit`.
