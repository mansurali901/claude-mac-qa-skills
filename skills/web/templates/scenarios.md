# Scenarios — F-[NNN]: [Flow Name]

**Flow**: [F-NNN — flow.md](flow.md)
**Application**: [AppName]
**URL / Route**: [base route for this flow]
**Total scenarios**: [N]
**Generated**: [YYYY-MM-DD]
**Last Updated**: [YYYY-MM-DD]

---

## S-[NNN]-01: Happy Path — [Short Description]

| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Category** | Happy Path |
| **Auth** | None / Required |
| **Preconditions** | [Browser state needed — e.g., "Logged in, on dashboard"] |
| **Steps summary** | [1–2 sentence description of what the user does] |
| **Expected result** | [What success looks like — URL change, element visible, data saved] |
| **Test Case** | [TC-NNN-happy-path.md](test-cases/TC-NNN-happy-path.md) |

---

## S-[NNN]-02: Alternative Path — [Short Description]

| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Category** | Alternative Happy Path |
| **Auth** | None / Required |
| **Preconditions** | [State] |
| **Steps summary** | [1–2 sentences — e.g., "SSO login instead of email/password"] |
| **Expected result** | [Outcome] |
| **Test Case** | [TC-NNN-[slug].md](test-cases/TC-NNN-[slug].md) |

---

## S-[NNN]-03: Negative — [Invalid Input / Wrong State]

| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Category** | Negative / Invalid Input |
| **Auth** | None / Required |
| **Preconditions** | [State] |
| **Steps summary** | [1–2 sentences describing the invalid action] |
| **Expected result** | [Inline validation error shown, form not submitted, page stable] |
| **Test Case** | [TC-NNN-[slug].md](test-cases/TC-NNN-[slug].md) |

---

## S-[NNN]-04: Empty / Null Input — [Required Field Left Blank]

| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Category** | Boundary / Edge Case |
| **Auth** | None / Required |
| **Preconditions** | [Form visible and ready] |
| **Steps summary** | [User submits form with required field empty] |
| **Expected result** | [Validation error: "Field is required", form not submitted] |
| **Test Case** | [TC-NNN-[slug].md](test-cases/TC-NNN-[slug].md) |

---

## S-[NNN]-05: Auth Guard — Unauthenticated Access

| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Category** | Auth Guard |
| **Auth** | None (testing redirect behaviour) |
| **Preconditions** | [User is logged out / no session cookie] |
| **Steps summary** | [Navigate directly to protected route while unauthenticated] |
| **Expected result** | [Redirect to `/account` or `/login`, protected content not shown] |
| **Test Case** | [TC-NNN-[slug].md](test-cases/TC-NNN-[slug].md) |

---

## S-[NNN]-06: SPA Route — Direct URL Entry

| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Category** | SPA Route Access |
| **Auth** | None / Required |
| **Preconditions** | [Fresh browser context — no prior navigation] |
| **Steps summary** | [Enter the route URL directly in address bar, not via in-app navigation] |
| **Expected result** | [Page loads correctly — not a blank page or 404] |
| **Test Case** | [TC-NNN-[slug].md](test-cases/TC-NNN-[slug].md) |

---

## S-[NNN]-07: Session Persistence — Page Reload

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Category** | Session Persistence |
| **Auth** | Required |
| **Preconditions** | [Logged in, specific UI state established] |
| **Steps summary** | [Establish state → reload page → verify state survives] |
| **Expected result** | [Auth session intact, data persists, no redirect to login] |
| **Test Case** | [TC-NNN-[slug].md](test-cases/TC-NNN-[slug].md) |

---

## S-[NNN]-08: Navigation Interruption — Back Button

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Category** | Navigation Interruption |
| **Auth** | None / Required |
| **Preconditions** | [Multi-step flow in progress] |
| **Steps summary** | [Start multi-step flow → press browser Back → return → verify state] |
| **Expected result** | [No data corruption, previous step shown correctly, can continue or restart] |
| **Test Case** | [TC-NNN-[slug].md](test-cases/TC-NNN-[slug].md) |

---

## S-[NNN]-09: Network Error — API Failure

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Category** | Error Recovery |
| **Auth** | None / Required |
| **Preconditions** | [App loaded; network request intercepted via `page.route()`] |
| **Steps summary** | [Trigger action that calls API → intercept and fail the request → observe handling] |
| **Expected result** | [User-friendly error message shown, no crash, retry or recovery path available] |
| **Test Case** | [TC-NNN-[slug].md](test-cases/TC-NNN-[slug].md) |

---

## S-[NNN]-10: Mobile Viewport — [375px]

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Category** | Mobile Viewport |
| **Auth** | None / Required |
| **Preconditions** | [Viewport set to 375×812 (iPhone 14)] |
| **Steps summary** | [Complete the happy path at mobile viewport width] |
| **Expected result** | [Layout adapts correctly — no overflow, nav collapses, CTAs remain tappable] |
| **Test Case** | [TC-NNN-[slug].md](test-cases/TC-NNN-[slug].md) |

---

## S-[NNN]-11: Console Error Monitoring

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Category** | Console Error |
| **Auth** | None / Required |
| **Preconditions** | [Console listener attached before navigation] |
| **Steps summary** | [Complete the happy path with console monitoring active] |
| **Expected result** | [Zero `console.error` calls during normal flow] |
| **Test Case** | [TC-NNN-[slug].md](test-cases/TC-NNN-[slug].md) |

---

## S-[NNN]-12: Boundary Values — [Min/Max Field Length]

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Category** | Boundary / Edge Case |
| **Auth** | None / Required |
| **Preconditions** | [Form visible and ready] |
| **Steps summary** | [Enter value at min length, max length, and one character beyond max] |
| **Expected result** | [Min and max accepted; beyond-max rejected with clear message] |
| **Test Case** | [TC-NNN-[slug].md](test-cases/TC-NNN-[slug].md) |

---

## S-[NNN]-13: Accessibility — axe-core Audit

| Field | Value |
|-------|-------|
| **Priority** | P3 |
| **Category** | Accessibility |
| **Auth** | None / Required |
| **Preconditions** | [Page fully loaded with all primary content visible] |
| **Steps summary** | [Run axe-core audit on the page in its default state] |
| **Expected result** | [Zero critical or serious axe violations] |
| **Test Case** | [TC-NNN-[slug].md](test-cases/TC-NNN-[slug].md) |

---

## S-[NNN]-14: Visual Regression — Baseline Comparison

| Field | Value |
|-------|-------|
| **Priority** | P3 |
| **Category** | Visual Regression |
| **Auth** | None / Required |
| **Preconditions** | [Visual baseline exists in `qa/knowledgebase/visual-baselines/`] |
| **Steps summary** | [Navigate to page → capture screenshot → compare against baseline] |
| **Expected result** | [Pixel diff below threshold (default 0.1%)] |
| **Test Case** | [TC-NNN-[slug].md](test-cases/TC-NNN-[slug].md) |

---

## [Add more scenarios following the same table format]

---

## Coverage Summary

| Category | Count | TC References |
|----------|-------|--------------|
| Happy Path | [N] | TC-NNN, ... |
| Alternative Happy Path | [N] | TC-NNN, ... |
| Negative / Invalid Input | [N] | TC-NNN, ... |
| Boundary / Edge Cases | [N] | TC-NNN, ... |
| Auth Guard | [N] | TC-NNN, ... |
| SPA Route Access | [N] | TC-NNN, ... |
| Session Persistence | [N] | TC-NNN, ... |
| Navigation Interruption | [N] | TC-NNN, ... |
| Error Recovery | [N] | TC-NNN, ... |
| Mobile Viewport | [N] | TC-NNN, ... |
| Console Error | [N] | TC-NNN, ... |
| Accessibility | [N] | TC-NNN, ... |
| Visual Regression | [N] | TC-NNN, ... |
| **Total** | **[N]** | |
