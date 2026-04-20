---
name: outcome-classifier
description: Replaces shallow "stateChanged" boolean with a labeled outcome. Runtime scripts copy this skeleton to qa/scripts/outcome-classifier.js.
type: helper
---

# Outcome Classifier

> **Purpose** — every runtime script (bfs.js, targeted-trace.js, sitemap-spot-check.js, login-engage.js) calls `classify(page, { before, after })` after each interaction. The classifier returns a **label** plus an evidence bundle. The caller branches on the label instead of treating every non-event as a stall.

## Why this exists

The previous heuristic was:

```javascript
const stateChanged = (beforeUrl !== afterUrl) || Math.abs(afterLen - beforeLen) > 100;
```

It treats wrong-password, server timeout, validation banner, and "nothing happened" as the same outcome. The HomaCare site (see `skills/web/helpers/login-engage.md`) reset the form to empty after a rejected login — same URL, similar DOM length, no visible error → the agent declared a blocker. Real ground truth was in the network response we never inspected.

The classifier fixes this by reading **six cheap signals** in one `page.evaluate()` round-trip plus passively-accumulated network/console/dialog events.

## Labels

| Label | Caller action |
|---|---|
| `navigated` | URL changed → progress; no agent screenshot READ |
| `dom-updated` | Body text Δ > 100 chars + no error signal → progress; no READ |
| `error-surfaced` | Error selector / regex / 4xx / 5xx detected → READ screenshot, surface to user via AskUserQuestion |
| `auth-rejected-server` | Auth POST returned 4xx OR body matched `/error\|invalid\|unauthori[sz]ed/i` → re-engage user with server's exact text |
| `form-reset-silent` | Inputs emptied, URL unchanged, no error visible, no auth cookie/token set → engage user (HomaCare case) |
| `auth-success` | Auth cookie or localStorage token added, OR URL changed off auth path → cache `storageState` |
| `modal-opened` | New `[role="dialog"]` or native `page.on('dialog')` fired → interact, re-classify |
| `network-timeout` | Action/goto timeout → retry once with 2× timeout, then ask user |
| `no-change` | None of the above → only THIS counts toward `consecutiveStalls` |

## Skeleton (copied to qa/scripts/outcome-classifier.js at runtime)

```javascript
// Why: replaces shallow stateChanged boolean with labeled outcome.
// Strategy: shared helper — used by bfs / targeted-trace / sitemap-spot-check / login-engage.
// Fallback: on classifier exception, return { label: 'no-change', error: e.message } — caller treats as stall but logs.

const ERROR_SELECTORS = '[role="alert"], .error, .invalid-feedback, [aria-invalid="true"], .toast, [data-testid*="error"], .alert-danger';
const ERROR_REGEX = /invalid|incorrect|failed|wrong|denied|rejected|unauthori[sz]ed|forbidden/i;
const AUTH_URL_REGEX = /\/(login|signin|auth|session|token)/i;

// Attach ONCE per BrowserContext:
function attachListeners(context) {
  const buf = { responses: [], dialogs: [], consoleErrors: [], requestFailures: [] };
  context.on('response', async (resp) => {
    if (resp.status() >= 400) {
      let body = '';
      try { body = (await resp.text()).slice(0, 1024); } catch {}
      buf.responses.push({ url: resp.url(), status: resp.status(), body, ts: Date.now() });
    }
  });
  context.on('console', (msg) => {
    if (msg.type() === 'error') buf.consoleErrors.push({ text: msg.text().slice(0, 512), ts: Date.now() });
  });
  context.on('requestfailed', (req) => {
    buf.requestFailures.push({ url: req.url(), failure: req.failure()?.errorText, ts: Date.now() });
  });
  return buf;
}

async function snapshot(page) {
  return page.evaluate(({ errSel, errRe }) => ({
    url: location.href,
    bodyLen: document.body.innerText.length,
    errorVisible: !!document.querySelector(errSel) ||
                  new RegExp(errRe, 'i').test(document.body.innerText.slice(0, 4000)),
    errorText: (document.querySelector(errSel)?.innerText || '').slice(0, 200),
    cookieCount: document.cookie.split(';').filter(Boolean).length,
    storageKeys: Object.keys(localStorage).length,
    inputs: Array.from(document.querySelectorAll('input,textarea')).map(i => ({
      name: i.name || i.id, type: i.type, empty: !i.value
    }))
  }), { errSel: ERROR_SELECTORS, errRe: ERROR_REGEX.source });
}

async function classify(page, before, buf, opts = {}) {
  const after = await snapshot(page);
  const sinceTs = opts.sinceTs || 0;
  const recentResp = buf.responses.filter(r => r.ts >= sinceTs);
  const recentDialog = buf.dialogs.filter(d => d.ts >= sinceTs);

  // Auth-aware checks first (when caller marks this as an auth step)
  if (opts.isAuth) {
    const authResp = recentResp.find(r => AUTH_URL_REGEX.test(r.url));
    if (authResp) {
      return { label: 'auth-rejected-server', evidence: { ...authResp, after } };
    }
    const cookieAdded = after.cookieCount > before.cookieCount;
    const tokenAdded = after.storageKeys > before.storageKeys;
    const offAuth = !AUTH_URL_REGEX.test(after.url);
    if (cookieAdded || tokenAdded || (after.url !== before.url && offAuth)) {
      return { label: 'auth-success', evidence: { cookieAdded, tokenAdded, url: after.url } };
    }
    const inputsEmptiedNow = after.inputs.some((i, idx) =>
      before.inputs[idx] && !before.inputs[idx].empty && i.empty
    );
    if (inputsEmptiedNow && after.url === before.url && !after.errorVisible) {
      return { label: 'form-reset-silent', evidence: { after } };
    }
  }

  if (recentDialog.length) return { label: 'modal-opened', evidence: recentDialog[0] };
  if (after.errorVisible) {
    return { label: 'error-surfaced', evidence: { errorText: after.errorText, recentResp } };
  }
  if (after.url !== before.url) return { label: 'navigated', evidence: { from: before.url, to: after.url } };
  if (Math.abs(after.bodyLen - before.bodyLen) > 100) return { label: 'dom-updated', evidence: { delta: after.bodyLen - before.bodyLen } };
  return { label: 'no-change', evidence: {} };
}

module.exports = { attachListeners, snapshot, classify };
```

## Logging contract

Each classify call appends ONE JSON line (≤ 120 bytes typical) to `qa/classifier-log.jsonl`:

```json
{"ts":1729872000,"step":"login-submit","label":"form-reset-silent","url":"https://app/login"}
```

On resume, the agent tails this file (last ~50 lines) instead of re-parsing flow.md tables.

## Caller pattern

```javascript
const { attachListeners, snapshot, classify } = require('./outcome-classifier.js');
const buf = attachListeners(context);

const before = await snapshot(page);
const sinceTs = Date.now();
await page.click('button[type=submit]');
await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
const outcome = await classify(page, before, buf, { isAuth: true, sinceTs });

switch (outcome.label) {
  case 'auth-success': /* save storageState */ break;
  case 'auth-rejected-server':
  case 'form-reset-silent':
  case 'error-surfaced':
    await askUser({ blocker: outcome.label, evidence: outcome.evidence });
    break;
  case 'no-change': consecutiveStalls++; break;
  default: consecutiveStalls = 0;
}
```

## Token discipline

- The classifier itself emits ≤ 120 bytes per call.
- The agent **does not** Read the screenshot for `navigated` / `dom-updated` / `no-change` outcomes mid-flow. Those rows in flow.md are tagged `(batch-read pending)` and at most 3 representative shots are read at flow boundary.
- Screenshots ARE read immediately for: `error-surfaced`, `auth-rejected-server`, `form-reset-silent`, `modal-opened`, `network-timeout`, terminal states.
- Listeners attach **once per context**; never per-action.

## Fallback

If the classifier helper fails to load or throws, runtime scripts fall back to the legacy `stateChanged` boolean and log the degradation in `qa/decisions.md`. Flow never breaks.
