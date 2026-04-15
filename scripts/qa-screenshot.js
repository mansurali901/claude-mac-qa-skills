#!/usr/bin/env node
/**
 * qa-screenshot — Atomic screenshot + flow.md registration.
 *
 * Takes a screenshot AND appends the evidence row to flow.md in one call.
 * Prevents orphaned screenshots by design.
 *
 * Usage as CLI (from Claude Code Bash tool):
 *
 *   node scripts/qa-screenshot.js \
 *     --flow F-003-onboarding-wizard \
 *     --step 5 \
 *     --action "Click Select tasks dropdown" \
 *     --observed "Dropdown opens upward with 9 checkbox options" \
 *     --file flow-F003-step05-dropdown-opened.png
 *
 * Usage as module (from inline Playwright scripts):
 *
 *   const { capture } = require('../scripts/qa-screenshot');
 *   await capture(page, {
 *     flow: 'F-003-onboarding-wizard',
 *     step: 5,
 *     action: 'Click Select tasks dropdown',
 *     observed: 'Dropdown opens upward with 9 checkbox options',
 *     file: 'flow-F003-step05-dropdown-opened.png',
 *     fullPage: true,
 *   });
 *
 * What it does:
 *   1. Captures the screenshot to qa/knowledgebase/screenshots/<file>
 *   2. Appends a row to the Discovery Evidence table in qa/flows/<flow>/flow.md
 *   3. Returns the screenshot path (for the Read tool to open)
 *
 * If flow.md doesn't have a Discovery Evidence table yet, it creates one.
 * If the screenshot filename already exists in flow.md, it skips the append (idempotent).
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = process.cwd();
const QA_DIR = path.join(REPO_ROOT, 'qa');
const SCREENSHOTS_DIR = path.join(QA_DIR, 'knowledgebase', 'screenshots');

// -------------------------------------------------------------------------
// Core: append evidence row to flow.md
// -------------------------------------------------------------------------

function appendEvidence(flowName, step, action, screenshot, observed, page) {
  const flowDir = findFlowDir(flowName);
  if (!flowDir) {
    throw new Error(`Directory not found for "${flowName}". Looked in qa/flows/ and qa/features/.`);
  }

  let flowMdPath = path.join(flowDir, 'flow.md');
  if (!fs.existsSync(flowMdPath)) {
    flowMdPath = path.join(flowDir, 'overview.md');
  }
  if (!fs.existsSync(flowMdPath)) {
    throw new Error(`No flow.md or overview.md found in ${flowDir}`);
  }

  let content = fs.readFileSync(flowMdPath, 'utf8');
  const filename = path.basename(screenshot);

  // Idempotent: skip if this screenshot is already referenced
  if (content.includes(filename)) {
    return { appended: false, reason: 'already referenced' };
  }

  // Detect if existing table is 5-column (E2E journey with Page/Screen) or 4-column (simple flow)
  const is5Col = /\|\s*Page\/Screen\s*\|/i.test(content) ||
                 /\|\s*Page\s*\|/i.test(content);

  // Build the row matching the table's column count
  const row = is5Col
    ? `| ${step} | ${page || ''} | ${action} | \`${filename}\` | ${observed} |`
    : `| ${step} | ${action} | \`${filename}\` | ${observed} |`;

  // Find the Discovery Evidence table and append after the last row
  const evidenceTablePattern = /## Discovery Evidence\b[\s\S]*?\n(\|[^\n]*\|)\n(\n|$)/;
  const match = content.match(evidenceTablePattern);

  if (match) {
    // Find the position of the last table row before the next section/separator
    const evidenceStart = content.indexOf('## Discovery Evidence');
    const afterEvidence = content.substring(evidenceStart);

    // Find all table rows in the evidence section
    const lines = afterEvidence.split('\n');
    let lastRowIndex = -1;
    let inTable = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('|') && !line.match(/^\|[\s:-]+\|$/)) {
        inTable = true;
        lastRowIndex = i;
      } else if (inTable && !line.startsWith('|') && line !== '') {
        break; // End of table
      }
    }

    if (lastRowIndex !== -1) {
      lines.splice(lastRowIndex + 1, 0, row);
      const newEvidenceSection = lines.join('\n');
      content = content.substring(0, evidenceStart) + newEvidenceSection;
    } else {
      // Table header exists but no data rows — append after separator
      content = content.replace(
        /(## Discovery Evidence[\s\S]*?\|[-:\s|]+\|)\n/,
        `$1\n${row}\n`
      );
    }
  } else {
    // No Discovery Evidence section — create one with the right column count
    const header5 = '| Step | Page/Screen | Action | Screenshot | Observed |';
    const sep5    = '|------|------------|--------|-----------|---------|';
    const header4 = '| Step | Action | Screenshot | Observed |';
    const sep4    = '|------|--------|-----------|---------|';

    const evidenceSection = [
      '',
      '## Discovery Evidence',
      '',
      is5Col ? header5 : header4,
      is5Col ? sep5 : sep4,
      row,
      '',
    ].join('\n');

    const firstSeparator = content.indexOf('\n---\n');
    if (firstSeparator !== -1) {
      content = content.substring(0, firstSeparator) + evidenceSection + content.substring(firstSeparator);
    } else {
      content += evidenceSection;
    }
  }

  fs.writeFileSync(flowMdPath, content);
  return { appended: true, flowMd: flowMdPath };
}

function findFlowDir(flowName) {
  // Accept: "F-003-onboarding-wizard" or "F-003" or "003" or "seed-crawl"
  for (const base of ['flows', 'features']) {
    const dir = path.join(QA_DIR, base);
    if (!fs.existsSync(dir)) continue;

    for (const sub of fs.readdirSync(dir)) {
      if (sub === flowName) return path.join(dir, sub);
      if (flowName.match(/^\d+$/) && sub.includes(`F-${flowName.padStart(3, '0')}`)) return path.join(dir, sub);
      if (flowName.match(/^F-\d+$/i) && sub.startsWith(flowName)) return path.join(dir, sub);
    }
  }
  return null;
}

// -------------------------------------------------------------------------
// Module API: capture(page, opts)
// -------------------------------------------------------------------------

async function capture(playwrightPage, opts) {
  const {
    flow,
    step,
    action,
    observed = '',
    file,
    page = '',     // Page/Screen column for 5-col E2E flow tables (e.g. "Homepage `/`")
    fullPage = true,
  } = opts;

  if (!flow || !step || !action || !file) {
    throw new Error('capture() requires: flow, step, action, file');
  }

  const screenshotPath = path.join(SCREENSHOTS_DIR, file);

  // 1. Take the screenshot
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  await playwrightPage.screenshot({ path: screenshotPath, fullPage });

  // 2. Register in flow.md
  const result = appendEvidence(flow, step, action, file, observed || '(pending visual analysis)', page);

  return {
    path: screenshotPath,
    file,
    registered: result.appended,
    flowMd: result.flowMd || null,
  };
}

// -------------------------------------------------------------------------
// CLI mode
// -------------------------------------------------------------------------

function cli() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
  };

  const flow = get('--flow');
  const step = get('--step');
  const action = get('--action');
  const observed = get('--observed') || '(pending visual analysis)';
  const file = get('--file');
  const pageName = get('--page') || ''; // Page/Screen for 5-col E2E flow tables

  if (!flow || !step || !action || !file) {
    console.error('Usage: node scripts/qa-screenshot.js --flow F-NNN-slug --step N --action "..." --observed "..." --file name.png');
    console.error('');
    console.error('  --flow      Flow directory name (e.g. F-003-onboarding-wizard or F-003 or seed-crawl)');
    console.error('  --step      Step number or label (e.g. 5 or D-1)');
    console.error('  --action    What was done (e.g. "Click Submit button")');
    console.error('  --observed  What was seen (e.g. "Form submitted, redirect to dashboard")');
    console.error('  --file      Screenshot filename (must already exist in qa/knowledgebase/screenshots/)');
    console.error('  --page      (Optional) Page/Screen name for 5-col E2E flow tables (e.g. "Homepage `/`")');
    process.exit(1);
  }

  // Verify the screenshot file exists on disk
  const screenshotPath = path.join(SCREENSHOTS_DIR, file);
  if (!fs.existsSync(screenshotPath)) {
    console.error(`Screenshot not found: ${screenshotPath}`);
    console.error('Take the screenshot first, then register it with this tool.');
    process.exit(1);
  }

  try {
    const result = appendEvidence(flow, step, action, file, observed, pageName);
    if (result.appended) {
      console.log(`✅ Registered ${file} in ${result.flowMd}`);
    } else {
      console.log(`⏭ ${file} already referenced (${result.reason})`);
    }
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
}

// -------------------------------------------------------------------------
// Exports + CLI entry
// -------------------------------------------------------------------------

module.exports = { capture, appendEvidence, findFlowDir };

if (require.main === module) {
  cli();
}
