---
name: native-qa
description: >
  Generic QA skill for Claude Code covering any platform (macOS, iOS, Android, Windows, web). Two-phase workflow: Phase 1 = pure exploration — agent selects platform, initializes workspace, launches the app, traces every happy flow step-by-step with screenshots at every single action, maps flows, saves all knowledge to qa/knowledgebase/. Phase 1 ends with a credentials gate — no test cases are generated yet. Phase 2 = full coverage — after user provides credentials in .env.qa, agent traces auth-gated flows, generates every possible scenario per flow (happy + negative + edge + security + a11y), and writes all TC files. ALWAYS asks platform first. ALWAYS screenshots every step in Phase 1. NEVER generates TCs before credentials are confirmed.
---

# Native App QA Skill

An autonomous QA engineer for **any native or web application**. It asks you to select a platform, initializes a typed workspace, launches your app, takes screenshots for visual analysis, discovers every UI flow, and generates comprehensive test cases — organized by flow, feature, or risk priority.

**Supported platforms**: macOS ✅ | Web (Playwright) ✅ | Windows 🔜 | iOS 🔜 | Android 🔜

---

## DO THIS NOW — Platform Selection

> ⛔ **HARD GATE — Do NOT run any bash commands. Do NOT read any workspace files. Do NOT check `qa/`. Do NOT show a welcome message. Do NOT proceed past this section until the user has answered the platform question below. The only allowed action before this question is answered: read `skills/_registry/registry.json`.**

Read `skills/_registry/registry.json`. Build a numbered menu from all registered skills. Then output exactly this (substituting real status from the registry):

> "Which platform would you like to test on?
>
> 1. macOS — production ✅
> 2. Web (Playwright) — beta ✅
> 3. Windows — stub 🔜
> 4. iOS — stub 🔜
> 5. Android — stub 🔜"

**STOP. Output nothing else. Do not continue to Step 0 until the user replies with their platform choice.**

The selected platform determines: state file name, workspace mode detection, welcome message wording, and which platform SKILL.md to load for Steps 4+. Nothing downstream works correctly without it.

---

## Step 0: Mode Detection and Session Resume

### 0.1b Session Resume Check

Immediately after platform selection, check if a saved session exists for that platform:

```bash
STATE_FILE="qa/state-[selected-platform].md"  # e.g. qa/state-web.md
[ -f "$STATE_FILE" ] && echo "EXISTS" || echo "NONE"
```

#### If state file EXISTS — read it and ask the user

Read `qa/state-[platform].md`. Extract:
- App name (from the App table)
- Phase (e.g. `EXPLORATION_COMPLETE`, `PHASE_2_IN_PROGRESS`)
- Next action (from Resume Instructions → "Next action" line)
- Counts: flows done, TCs written

Present to the user:

> "Found a saved **[platform]** session:
>
> | Field | Value |
> |-------|-------|
> | App | [AppName] |
> | Phase | [phase] |
> | Next action | [next action] |
> | Flows traced | [N done] / [N total] |
> | TCs written | [N] |
>
> **1) Resume** — continue from: *[next action]*
> **2) New session** — start fresh (saved state will be overwritten at next checkpoint)"

Wait for the user's choice:

- **"1"** or **"resume"** → Read the full state file for context. Jump directly to the saved next action. Do NOT re-run workspace init, app selection, or discovery. Announce: *"Resuming [AppName] on [platform] — [next action]"* and continue.
- **"2"** or **"new"** → Proceed to Step 0.2 as normal. The old state file will be overwritten when the new session reaches its first checkpoint.

#### If state file does NOT exist — proceed silently

No prompt. Go directly to Step 0.2.

### 0.2 Workspace Mode

```bash
if [ ! -d "qa" ] || [ ! -f "qa/.qa-config.json" ]; then
  echo "INIT"
elif [ ! -d "qa/flows" ] && [ ! -d "qa/features" ] && [ ! -d "qa/test-cases/P1-critical" ]; then
  echo "CONFIGURED_NO_FLOWS"
else
  # Count TC files — if zero, exploration is done but Phase 2 hasn't run
  TC_COUNT=$(find qa -name "TC-*.md" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$TC_COUNT" -eq 0 ]; then
    echo "EXPLORATION_COMPLETE"
  else
    echo "HAS_WORKSPACE"
  fi
fi
```

| Result | Action |
|--------|--------|
| `INIT` | → **Step 1: INIT MODE** |
| `CONFIGURED_NO_FLOWS` | → **Step 2: App Selection** (workspace ready, need discovery) |
| `EXPLORATION_COMPLETE` | → **Phase 1 Complete Gate** — flows mapped, awaiting credentials for Phase 2 |
| `HAS_WORKSPACE` | → **Step 10: UPDATE MODE** |

---

## Context Window Management

**After every completed flow, reset the context window. This is not optional.**

Reading screenshots, flow.md files, and accumulated tool output fills the context fast. By flow 3-4 the context is full and the session crashes mid-run. The fix: treat each flow as an isolated unit — complete it, save everything to `qa/state-[platform].md`, start fresh.

### STOP / PAUSE / SAVE STATE — Immediate Handler

**When the user says "stop", "pause", "save state", or any equivalent:**

Do NOT just acknowledge. The FIRST and ONLY action is to write the checkpoint. No other response until the file is written.

1. **Immediately write `qa/state-[platform].md`** using the checkpoint template below — capture everything known at this exact moment: completed flows, pending flows, what was discovered, what was NOT yet written to files (note it as in-progress)
2. **Then tell the user**:

> "✅ Checkpoint saved to `qa/state-[platform].md`
>
> | Saved | Value |
> |-------|-------|
> | Flows completed | [N] — [names] |
> | Flows pending | [N] — [names] |
> | Screenshots taken | [N] |
> | TCs written | [N] |
> | Stopped at | [exact step — e.g. 'Mid F-003 trace, step 4 of 7'] |
>
> **To resume**: open a new conversation and say:
> `Read qa/state-[platform].md and continue QA for [AppName]`"

**If work was in-progress mid-flow** (e.g. stopped while tracing F-003 step 4): note the incomplete flow explicitly in the state file under "In Progress" so the resume picks it up from the right point — not from the beginning of that flow.

---

### Reset Triggers

Reset the context window after:

| Trigger | Action |
|---------|--------|
| User says "stop", "pause", or "save state" | → **STOP handler above — write state file immediately** |
| Each flow fully traced in Phase 1 (flow.md written) | → Write checkpoint, tell user resume command |
| Each flow's TCs fully written in Phase 2 | → Write checkpoint, tell user resume command |
| Conversation exceeds ~15 tool calls | → Write checkpoint proactively before continuing |

### How to Reset After a Flow

After writing `flow.md` and the discovery evidence table for any flow:

1. **Write checkpoint** to `qa/state-[platform].md` — record every flow completed, every flow pending, the exact next step
2. **Tell the user**:

> "Flow **F-NNN — [Name]** complete. Saving context and resetting.
>
> Context used so far: [N] flows traced, [N] screenshots read.
>
> **To continue**: start a new conversation and say:
> `Read qa/state-[platform].md and continue Phase 1. Next flow: F-[NNN+1] — [name].`
>
> Or say **'continue'** here and I'll carry on — but a fresh context is recommended after every 2-3 flows."

3. If the user says **'continue'** — proceed to the next flow but watch for context pressure. Reset at the next flow regardless.

### The State File Is the Memory

Every reset works because `qa/state-[platform].md` contains everything needed to resume:
- Which flows are done (with screenshot paths and key observations)
- Which flows are pending (with names, priority, auth requirement)
- The exact resume command for the next flow
- App quirks discovered so far
- Credentials status

A fresh context reading `qa/state-[platform].md` has full situational awareness. No information is lost.

### Phase 2 Context Resets

Same rule applies during TC generation:
- Write all TCs for one flow → checkpoint → reset
- Resume: `"Read qa/state-[platform].md and write all TCs for F-[NNN] — [name]."`
- Never try to write TCs for multiple flows in one context

---

## Checkpoint Protocol

**Session checkpoints are automatic — each OS gets its own state file, one per platform.**

### One State File Per OS

| OS being tested | State file |
|----------------|-----------|
| Web (any web app) | `qa/state-web.md` |
| macOS (any macOS app) | `qa/state-macos.md` |
| Windows (any Windows app) | `qa/state-windows.md` |
| iOS (any iOS app) | `qa/state-ios.md` |
| Android (any Android app) | `qa/state-android.md` |

**The state file belongs to the OS, not the app.** If you test paio.bot on web, the state goes into `qa/state-web.md`. If you then test Slack on macOS, the state goes into `qa/state-macos.md`. The two files never interfere. If you later test a different web app, `qa/state-web.md` gets overwritten with the new app's context.

Always derive the filename from `.qa-config.json` → `platform` field (lowercase, no spaces).

### When to Write a Checkpoint

| Trigger | What to record |
|---------|---------------|
| After Step 1 (workspace init) | Framework, platform, directories created |
| After Step 2 (app selected) | App name, URL/path, metadata, auth type |
| **After each flow traced in Phase 1** | Flow slug, screenshot count, key observations, next flow pending — then reset context |
| After Phase 1 Complete Gate | All flows list, which need auth, total screenshots |
| **After each flow's TCs written in Phase 2** | TCs written for this flow, remaining flows + TC counts — then reset context |
| After Step 9 (finalize) | Final counts, run commands |
| Whenever the user says "stop", "pause", or "save state" | Full snapshot of current progress |

### How to Write the Checkpoint

Read `platform` from `.qa-config.json`. Write (or overwrite) `qa/state-[platform].md` using this template. Fill every section with real values — no placeholders left blank.

````markdown
# QA Session State — [OS/Platform]

**App under test**: [AppName]

> Resume: open a new conversation in this repo and say:
> **"Read qa/state-[platform].md and continue QA for [AppName]"**

## Snapshot — [YYYY-MM-DD HH:MM]

### App
| Field | Value |
|-------|-------|
| **App** | [name] |
| **Platform** | [macOS / web / windows / ios / android] |
| **URL / Path** | [url or /Applications/App.app] |
| **Auth** | [method — e.g. Email + Google SSO at /account] |
| **Plans / Tiers** | [Free / Pro / etc.] |
| **Core product** | [one sentence what it does] |
| **Key quirks** | [anything surprising discovered — redirects, SPA routes, etc.] |

### Completed
- [x] Workspace initialized (framework: [flow/feature/risk])
- [x] App metadata read
- [x] Discovery complete ([N] pages / sections, [N] screenshots)
- [x] Flows created: [N] — [F-001, F-002, ...]
- [x] Scenarios mapped: [N total]
- [x] Test cases written: [N] — [TC-001, TC-002, ...]

### Flows
| Flow | Dir | Scenarios | TCs Written | Priority |
|------|-----|-----------|-------------|----------|
| F-001 [name] | `qa/flows/F-001-[slug]/` | [N] | [N] | P[1/2/3] |

### Test Cases — Written
| TC | File | Status |
|----|------|--------|
| TC-001 | `F-001/test-cases/TC-001-[slug].md` | Written |

### Test Cases — Pending
#### F-001 ([N] remaining)
- TC-NNN [description]

### Environment
```bash
# Run written tests
npx playwright test [path]          # web
osascript qa/flows/.../TC-NNN.md   # macOS

# Auth setup if needed
npx playwright codegen --save-storage=qa/credentials/.auth/user.json [url]  # web
```

### .env.qa values needed
```env
QA_APP_URL=
QA_TEST_EMAIL=
QA_TEST_PASSWORD=
```

### Resume Instructions

**Next action**: [exact one-line description — e.g. "Trace F-003 — OpenClaw Onboarding" or "Write TCs for F-002 — Authentication"]

**Copy-paste resume command**:
```
Read qa/state-[platform].md and continue QA for [AppName]. Next: [exact next action].
```

> This command gives a fresh context full situational awareness. The state file is the memory.
````

### After Writing the Checkpoint

Tell the user:
> "✅ Checkpoint saved to `qa/state-[platform].md` — [N] flows, [N] scenarios, [N] TCs written, [N] pending.
> To resume: start a new conversation and say **'Read qa/state-[platform].md and continue QA for [AppName]'**"

---

## Step 1: INIT MODE — Initialize QA Workspace

### 1.1 Framework Selection

Tell the user:
> "Welcome to native-qa! Let me set up a QA workspace for your **[selected platform]** app.
>
> First — how would you like your test cases organized?
>
> **1. Flow-based** *(recommended)*
>    One directory per user journey: `qa/flows/F-001-login/`, `qa/flows/F-002-settings/`, etc.
>    Best for apps with distinct end-to-end user flows.
>
> **2. Feature-based**
>    One directory per feature module: `qa/features/authentication/`, `qa/features/dashboard/`, etc.
>    Best for apps with many independent feature areas.
>
> **3. Risk-based**
>    Organized by severity: `qa/test-cases/P1-critical/`, `qa/test-cases/P2-high/`, etc.
>    Best for regression suites or deadline-driven QA cycles."

**STOP. Output nothing else. Do not continue to Step 1.2 until the user replies.** Accept: 1/2/3, "flow", "feature", "risk", or their description. Default to **flow-based** if unclear.

### 1.2 Create Directory Structure and READMEs

Create all directories and write a README in each one explaining its purpose.
Every directory gets a README so anyone opening the workspace understands what it is and why it exists.

#### Common directories (all frameworks)

```bash
mkdir -p qa/planning qa/guardrails qa/credentials qa/scope
mkdir -p qa/knowledgebase/screenshots
mkdir -p qa/context/feature-specs qa/context/figma-screens
mkdir -p qa/evidence qa/runs
```

#### Flow-based

```bash
mkdir -p qa/flows
```

#### Feature-based

```bash
mkdir -p qa/features
```

#### Risk-based

```bash
mkdir -p qa/test-cases/P1-critical
mkdir -p qa/test-cases/P2-high
mkdir -p qa/test-cases/P3-medium
mkdir -p qa/test-cases/P4-low
```

#### Write README in every directory

Write the following README files immediately after creating the directories. Use the actual app name and platform from earlier steps where shown as `[AppName]` / `[platform]`.

**`qa/README.md`**
```markdown
# QA Workspace

Auto-generated by `/native-qa init` — do not manually edit the structure.
This entire directory is gitignored and recreated fresh each session.

## App under test
- **App**: [AppName]
- **Platform**: [platform]
- **Framework**: [flow-based / feature-based / risk-based]

## Directory map
| Directory | Purpose |
|-----------|---------|
| `context/` | Prior knowledge inputs — the only things you place here manually |
| `planning/` | Platform info and test environment setup |
| `guardrails/` | What to do and not do during testing |
| `credentials/` | Credential structure (no real values — use `.env.qa`) |
| `scope/` | What is and isn't in scope for this QA cycle |
| `knowledgebase/` | Discovery output — screenshots, UI inventory, flow maps |
| `flows/` | One directory per user flow: flow.md + scenarios.md + test cases |
| `evidence/` | Screenshots and artifacts captured during test runs |
| `runs/` | Test run summaries and Playwright JSON results |
| `state-[platform].md` | Session checkpoint — resume from here in a new conversation |

## Resume a session
Open a new conversation in this repo and say:
**"Read qa/state-[platform].md and continue QA for [AppName]"**
```

**`qa/context/README.md`**
```markdown
# qa/context — Prior Knowledge Inputs

The only directory under `qa/` that you populate manually.
Everything else in `qa/` is auto-generated by the skill.

## How to use

During Step 3 the skill asks how you want to provide background on the app.
If you choose **"Drop files"**, place your context here and say "ready".

## What to drop here

You can mix and match — drop whatever you have:

| What you have | What to drop |
|---------------|-------------|
| Figma designs | Export screens as PNG or JPG into `figma-screens/` |
| Product spec / PRD | Drop as `.md` or `.txt` (any filename) |
| GitHub README or notes | Copy in as a `.md` file |
| Feature specs | Drop `.md` files into `feature-specs/` |
| App screenshots | Drop as `.png` into root or `figma-screens/` |
| Known bugs / edge cases | Any `.md` or `.txt` file |

## What the agent does with it

The agent reads every file here — markdown as text, images visually via AI vision.
It extracts: flows, features, navigation structure, edge cases, auth type, priority areas.
Then it launches the app to validate what it found.

No fixed filenames required. Drop anything — the agent reads it all.
```

**`qa/context/feature-specs/README.md`**
```markdown
# qa/context/feature-specs — Feature Specification Files

Drop feature spec and acceptance criteria files here.
Accepted formats: Markdown (.md), plain text (.txt).

Examples:
- `auth-spec.md` — authentication requirements
- `onboarding-spec.md` — onboarding flow acceptance criteria
- `dashboard-spec.md` — dashboard feature details

The agent reads every file here during Step 3 and maps them to test flows.
```

**`qa/context/figma-screens/README.md`**
```markdown
# qa/context/figma-screens — Figma Screen Exports

Drop exported Figma screens or app screenshots here (PNG or JPG).
The agent reads each image visually to identify screens, navigation patterns,
form states, and UI elements — then maps them to test flows.

Tip: descriptive filenames help, but any name works.
Examples: `01-homepage.png`, `02-login-form.png`, `03-dashboard-empty.png`
```

**`qa/planning/README.md`**
```markdown
# qa/planning — Test Planning

Contains environment and platform documentation generated during init.

| File | Contents |
|------|----------|
| `platforms.md` | App metadata, OS version, architecture, test environments |
```

**`qa/guardrails/README.md`**
```markdown
# qa/guardrails — QA Rules

What to do and not do when running tests for [AppName].
Generated during init based on the platform and app type.

| File | Contents |
|------|----------|
| `do-and-dont.md` | Specific dos/don'ts: delays, test accounts, state cleanup, system dialogs |
```

**`qa/credentials/README.md`**
```markdown
# qa/credentials — Credential Structure

Defines what credentials are needed and how to supply them.
NEVER store real values here — this directory is gitignored but treat it as if it isn't.

Real credentials go in `.env.qa` at the repo root (also gitignored).
Copy `.env.example` to `.env.qa` and fill in your values.

| File | Contents |
|------|----------|
| `access.md` | What accounts/tokens are needed and how to obtain them |
```

**`qa/scope/README.md`**
```markdown
# qa/scope — QA Scope Contract

Defines what is and isn't being tested in this QA cycle.

| File | Contents |
|------|----------|
| `contract.md` | In-scope flows, out-of-scope areas, definition of done |
```

**`qa/knowledgebase/README.md`**
```markdown
# qa/knowledgebase — Discovery Knowledge Base

Auto-generated during Phase 1 exploration. Do not edit manually.
Regenerated every time the skill runs a fresh discovery.

| Path | Contents |
|------|----------|
| `screenshots/` | Screenshots taken during discovery — one per page/step |
| `ui-inventory.md` | Human-readable list of all discovered UI elements and pages |
| `ui-inventory.json` | Machine-readable version of the UI inventory |
| `discover.js` | Playwright script used for web app crawling (web platform only) |
| `visual-baselines/` | Playwright snapshot baselines for visual regression tests |
```

**`qa/evidence/README.md`**
```markdown
# qa/evidence — Test Run Evidence

Screenshots and artifacts captured when test cases execute.
One subdirectory per test run, named by date/run ID.
Gitignored — regenerated on each test run.

Never reference files in this directory in test case source — use paths relative to the run.
```

**`qa/runs/README.md`**
```markdown
# qa/runs — Test Run Summaries

Contains run summary reports and Playwright JSON results.
Gitignored — regenerated on each test run.

| File pattern | Contents |
|-------------|----------|
| `RUN-YYYYMMDD-HHMMSS.md` | Human-readable run summary with pass/fail counts |
| `playwright-results.json` | Raw Playwright JSON output (used for reporting) |
```

For the **flow/feature/test-cases directories**, write a README when each one is created during flow generation (Step 6), not here.

### 1.3 Write `.qa-config.json`

Write `qa/.qa-config.json` with the actual chosen framework value:

```json
{
  "version": "2.0",
  "framework": "flow-based",
  "app_name": null,
  "app_path": null,
  "app_identifier": null,
  "app_version": null,
  "platform": "[selected platform — macOS | web | windows | ios | android]",
  "os_version": null,
  "architecture": null,
  "created": "YYYY-MM-DD",
  "last_discovery": null,
  "flows_count": 0,
  "test_cases_count": 0
}
```

- `platform`: use the exact platform chosen in Step 0.1 (e.g., `"macOS"`, `"web"`, `"windows"`, `"iOS"`, `"android"`).
- `app_identifier`: bundle ID for macOS/iOS, package name for Android, URL/base URL for web, exe path for Windows.
- `os_version`: populate during app metadata discovery in Step 2.

Tell the user:
> "✅ QA workspace initialized with **[chosen framework]** organization on **[selected platform]**.
> Next — which application do you want to test?"

→ **Write checkpoint** to `qa/state-[platform].md` (see Checkpoint Protocol). Record: platform, framework, directories created.

Proceed to **Step 2**.

---

## Step 2: App Selection

Ask, tailoring to the selected platform:
> **macOS**: "What application would you like to test? (e.g., 'Slack', 'Figma', 'MyApp')"
> **Web**: "What URL or web app would you like to test? (e.g., 'https://app.example.com')"
> **Windows**: "What application would you like to test? (e.g., 'Notepad', 'MyApp')"
> **iOS / Android**: "What app would you like to test? (bundle ID or app name — e.g., 'com.example.myapp')"

Wait for the answer. Store the app name / URL.

→ **Write checkpoint** to `qa/state-[platform].md`. Record: platform, framework, app name provided.

Proceed to **Step 3**.

---

## Step 3: Prior Domain Knowledge

### 3.1 Check `qa/context/` for Pre-Placed Files

`qa/context/` was created during Step 1. Before asking anything, silently check if the user has already placed files there:

```bash
find qa/context -type f ! -name "README.md" 2>/dev/null
```

**If files exist** — read all of them now. Accept any format found:
- `.md` / `.txt` — PRDs, specs, GitHub notes, feature docs
- `.png` / `.jpg` — Figma exports, app screenshots, design mocks (use the Read tool for visual analysis)

Extract: named flows, features, user journeys, navigation paths, edge cases, auth type, known bugs, priority areas. Announce what you found, then proceed directly to **Step 4** — skip the question below.

> "Found prior knowledge in `qa/context/` — read [N] files: [list]. I'll use this to guide flow discovery."

---

### 3.2 Ask How to Provide Context (only if `qa/context/` is empty)

**DO NOT paraphrase. DO NOT rewrite. Output EXACTLY the following text, replacing only [AppName] with the actual app name:**

---

Step 3 — Prior Knowledge

`qa/context/` is ready. Before I start exploring **[AppName]**, do you have any background I should read first?

**Option 1 — Drop files into `qa/context/`**
Place any of the following there, then say "ready":
- Figma screen exports (PNG or JPG)
- PRD / product spec (.md or .txt)
- GitHub README, issue list, or notes
- Any markdown describing flows, features, or edge cases
- Screenshots of the installed app

**Option 2 — Tell me in the chat**
Describe what you know — what the app does, key flows, things to test or skip, known edge cases.

**Option 3 — Discover it yourself**
I'll explore **[AppName]** visually from scratch — screenshot every screen and map every flow.

Which would you like? (1 / 2 / 3)

---

**Wait for the user's answer. Do not proceed until they reply.**

---

### 3.3 Route Based on Answer

#### Option 1 — Files in `qa/context/`
Wait for the user to say "ready" (or any confirmation). Then scan:

```bash
find qa/context -type f ! -name "README.md" 2>/dev/null
```

Read every file found. For images, use the Read tool (visual analysis). For text/markdown, read as-is. Extract:
- Named flows and user journeys
- Features to prioritize and features to skip
- Known edge cases, bugs, or tricky states
- Auth type and credential fields
- Navigation structure and key routes

Write a candidate flow list as a starting skeleton in `qa/knowledgebase/ui-inventory.md`. Proceed to **Step 4** to launch the app and validate extracted knowledge visually.

#### Option 2 — Written in chat
Parse the user's message. Extract the same fields as Option 1. Ask one follow-up only if the auth situation is unclear:

> "Got it — one thing I need before launching: does **[AppName]** require login? If yes, what does it look like — email/password, SSO, API key, or something else?"

Write what was extracted to `qa/knowledgebase/ui-inventory.md`. Proceed to **Step 4**.

#### Option 3 — Discover yourself
Acknowledge and proceed immediately to **Step 4**:

> "Got it — I'll explore **[AppName]** visually and map every flow from scratch."

---

### 3.4 Incomplete Picture — Always Supplement with Visual Discovery

After processing any provided context, evaluate completeness:
- Are there named flows covering all major user goals?
- Are screen states (empty, error, success, loading) identified?
- Are navigation paths between sections clear?

**If incomplete** — regardless of how much context was provided — supplement with visual exploration in Step 4:

> "The provided context gives me a partial picture — I can see [what was found] but [what's missing] isn't covered. I'll launch the app and screenshot every section to fill in the gaps."

---

## → Delegate to Platform Skill

Steps 4 onward are **platform-specific**. After completing Step 3, load the selected platform's skill file and follow it from its Step 4:

```
skills/macos/SKILL.md    → macOS native apps (AppleScript + screencapture)
skills/web/SKILL.md      → Web apps (Playwright + Chromium)
skills/windows/SKILL.md  → Windows native apps (WinAppDriver + UIA3)
skills/ios/SKILL.md      → iOS apps (XCUITest + xcrun)
skills/android/SKILL.md  → Android apps (UIAutomator2 + ADB)
```

The platform skill is **fully self-contained** — it carries everything needed from Step 4 onward:

| Step | What happens |
|------|-------------|
| **Step 4** | App metadata: locate app, read version / bundle ID, detect OS version |
| **Step 5** | Launch app + first screenshot |
| **Step 6** | Deep exploration + UI enumeration (inline automation script) |
| **Step 6.5** | Happy flow tracing — screenshot at every step (Phase 1) |
| **Step 7** | Flow creation + Phase 1 complete gate |
| **Step 8** | Credential acquisition + scenario generation (Phase 2) |
| **Step 9** | Test case generation (inline interaction driver) |
| **Step 10** | Finalize + HTML report generation |
| **Step 11** | Update mode (re-discover, add flows, full refresh) |

No other files are required. All automation scripts, templates, and references are inlined in the platform skill.

