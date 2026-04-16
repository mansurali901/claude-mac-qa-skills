#!/usr/bin/env node
/**
 * qa-screenshot — Atomic screenshot + flow.md registration + coverage audit.
 *
 * Three modes:
 *
 * 1. CAPTURE (module) — takes screenshot + registers in flow.md atomically
 *    const { capture } = require('../scripts/qa-screenshot');
 *    await capture(page, { flow, step, action, observed, file });
 *
 * 2. REGISTER (CLI) — registers an existing screenshot in flow.md
 *    node scripts/qa-screenshot.js --flow F-003 --step 5 --action "..." --file name.png
 *
 * 3. AUDIT (CLI) — cross-references knowledgebase → flows, reports coverage gaps
 *    node scripts/qa-screenshot.js --audit
 *    node scripts/qa-screenshot.js --audit --json
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(REPO_ROOT, 'qa');
const KB_DIR = path.join(QA_DIR, 'knowledgebase');
const SCREENSHOTS_DIR = path.join(KB_DIR, 'screenshots');

// =========================================================================
// Utilities
// =========================================================================

/** Escape pipe characters so they don't break markdown table cells. */
function escPipe(str) {
  return str ? str.replace(/\|/g, '\\|') : '';
}

/**
 * Parse a markdown table that follows a given heading.
 * Returns array of objects keyed by column header names.
 * If heading is null, parses the first table found.
 */
function parseMarkdownTable(content, heading) {
  let text = content;
  if (heading) {
    const idx = content.indexOf(heading);
    if (idx === -1) return [];
    text = content.substring(idx);
  }

  const lines = text.split('\n');
  let headers = null;
  let pastSeparator = false;
  const rows = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Stop at next heading after we have data
    if (pastSeparator && rows.length > 0 && /^#{1,3}\s/.test(trimmed)) break;

    if (!trimmed.startsWith('|')) {
      if (pastSeparator && rows.length > 0 && trimmed !== '') break;
      continue;
    }

    const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());

    // Separator row: all cells contain only dashes, colons, spaces
    if (cells.length > 0 && cells.every(c => /^[-:\s]+$/.test(c))) {
      pastSeparator = true;
      continue;
    }

    if (!pastSeparator) {
      headers = cells;
    } else if (headers) {
      const row = {};
      cells.forEach((c, i) => { if (headers[i]) row[headers[i]] = c; });
      rows.push(row);
    }
  }

  return rows;
}

// =========================================================================
// Core: append evidence row to flow.md
// =========================================================================

function appendEvidence(flowName, step, action, screenshot, observed, page) {
  const flowDir = findFlowDir(flowName);
  if (!flowDir) {
    throw new Error(`Directory not found for "${flowName}". Looked in qa/flows/, qa/features/, and qa/test-cases/.`);
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

  // Build the row matching the table's column count — escape pipes in user text
  const safeAction = escPipe(action);
  const safeObserved = escPipe(observed);
  const safePage = escPipe(page || '');

  const row = is5Col
    ? `| ${step} | ${safePage} | ${safeAction} | \`${filename}\` | ${safeObserved} |`
    : `| ${step} | ${safeAction} | \`${filename}\` | ${safeObserved} |`;

  // Find the Discovery Evidence table and append after the last row
  const evidenceTablePattern = /## Discovery Evidence\b[\s\S]*?\n(\|[^\n]*\|)(\n(\n|$)|$)/;
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
  for (const base of ['flows', 'features', 'test-cases']) {
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

// =========================================================================
// Module API: capture(page, opts)
// =========================================================================

async function capture(playwrightPage, opts) {
  const {
    flow,
    step,
    action,
    observed = '',
    file,
    page = '',     // Page/Screen column for 5-col E2E flow tables
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

// =========================================================================
// Audit: knowledgebase → flows coverage
// =========================================================================

// --- Knowledgebase parsers ---

function parseKBPages() {
  const file = path.join(KB_DIR, 'ui-inventory.md');
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8');
  const rows = parseMarkdownTable(content, '## Page Inventory');
  const tableRows = rows.length > 0 ? rows : parseMarkdownTable(content, null);
  return tableRows
    .map(r => ({
      url: (r['URL'] || r['url'] || '').replace(/`/g, ''),
      pageType: r['Page Type'] || '',
      auth: r['Auth Required'] || r['Auth'] || '',
    }))
    .filter(p => p.url);
}

function parseKBRoutes() {
  const file = path.join(KB_DIR, 'nav-graph.md');
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8');
  const rows = parseMarkdownTable(content, '## Navigation Graph');
  return rows
    .map(r => ({
      from: (r['From'] || '').replace(/`/g, ''),
      cta: r['Action/CTA'] || r['Action'] || '',
      to: (r['To'] || '').replace(/`/g, ''),
      authGate: r['Auth Gate'] || r['Auth'] || 'none',
    }))
    .filter(r => r.from || r.cta);
}

function parseKBPersonas() {
  const file = path.join(KB_DIR, 'personas.md');
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8');
  const rows = parseMarkdownTable(content, '## Discovered Personas');
  return rows
    .map(r => {
      const raw = r['#'] || '';
      const idMatch = raw.match(/P(\d+)/);
      return {
        id: idMatch ? `P${idMatch[1]}` : raw,
        name: r['Persona'] || '',
        authState: r['Auth State'] || '',
      };
    })
    .filter(p => p.id);
}

function parseKBElements() {
  const file = path.join(KB_DIR, 'ui-inventory.md');
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8');

  const elements = [];
  const lines = content.split('\n');
  let currentPage = '';

  for (const line of lines) {
    // Match ### headings like: ### Homepage `/`  or  ### Navigation (all pages)
    const headingMatch = line.match(/^###\s+(.+?)(?:\s+`([^`]+)`)?\s*$/);
    if (headingMatch) {
      currentPage = headingMatch[2] || headingMatch[1].trim();
      continue;
    }

    if (!currentPage) continue;

    const bulletMatch = line.match(/^-\s+(.+)$/);
    if (!bulletMatch) continue;

    const text = bulletMatch[1].trim();
    // Extract quoted CTA/button label, or fall back to text before arrow/paren
    const quotedMatch = text.match(/"([^"]+)"/);
    const label = quotedMatch
      ? quotedMatch[1]
      : text.split(/[→(]/)[0].trim();

    elements.push({ page: currentPage, text, label });
  }

  return elements;
}

function parseKBJourneys() {
  const file = path.join(KB_DIR, 'journey-inventory.md');
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8');
  return parseMarkdownTable(content, null).map(r => ({
    flowId: r['Flow ID'] || '',
    name: r['Journey Name'] || '',
    persona: r['Persona'] || '',
    status: r['Status'] || '',
    steps: parseInt(r['Steps'] || '0', 10),
    screenshots: parseInt(r['Screenshots'] || '0', 10),
  }));
}

// --- Flow evidence parser ---

function gatherFlowData() {
  const flows = [];
  for (const base of ['flows', 'features', 'test-cases']) {
    const dir = path.join(QA_DIR, base);
    if (!fs.existsSync(dir)) continue;
    for (const sub of fs.readdirSync(dir)) {
      const subPath = path.join(dir, sub);
      if (!fs.statSync(subPath).isDirectory()) continue;
      const flowMd = path.join(subPath, 'flow.md');
      if (!fs.existsSync(flowMd)) continue;
      const content = fs.readFileSync(flowMd, 'utf8');

      // Parse Summary table for persona/status
      const summaryRows = parseMarkdownTable(content, '## Summary');
      const summary = {};
      summaryRows.forEach(r => {
        const key = (r['Field'] || '').replace(/\*+/g, '').trim();
        const val = (r['Value'] || '').replace(/\*+/g, '').trim();
        if (key) summary[key] = val;
      });

      // Parse Discovery Evidence table
      const evidence = parseMarkdownTable(content, '## Discovery Evidence');

      const allActions = evidence.map(e => (e['Action'] || '').toLowerCase()).join(' ');
      const allObserved = evidence.map(e => (e['Observed'] || '').toLowerCase()).join(' ');
      const allPages = evidence.map(e => (e['Page/Screen'] || '').toLowerCase()).join(' ');
      const allScreenshots = evidence.map(e => (e['Screenshot'] || '').replace(/`/g, '')).filter(Boolean);

      flows.push({
        id: sub,
        flowId: sub.match(/^F-\d+/) ? sub.match(/^F-\d+/)[0] : sub,
        contentLower: content.toLowerCase(),
        persona: summary['Persona'] || '',
        status: summary['Status'] || '',
        allActions,
        allObserved,
        allPages,
        allScreenshots,
        stepCount: evidence.length,
      });
    }
  }
  return flows;
}

// --- Coverage checks ---

function auditPages(pages, flows) {
  return pages.map(p => {
    const url = p.url.toLowerCase();
    const coveredBy = flows.filter(f => {
      return f.allPages.includes(url) ||
             f.allActions.includes(url) ||
             f.contentLower.includes(url);
    }).map(f => f.flowId);

    return {
      item: p.url,
      detail: `${p.pageType}${p.auth.toLowerCase() === 'yes' ? ' [AUTH]' : ''}`,
      status: coveredBy.length > 0 ? 'PASS' : 'MISS',
      coveredBy,
    };
  });
}

function auditRoutes(routes, flows) {
  return routes.map(r => {
    // Extract the quoted CTA label for matching
    const quotedMatch = r.cta.match(/"([^"]+)"/);
    const ctaLabel = (quotedMatch ? quotedMatch[1] : r.cta).toLowerCase();

    const toLower = r.to.toLowerCase();
    const isExternal = toLower.includes('external') ||
                       toLower.includes('chrome web store') ||
                       toLower.includes('discord') ||
                       /\bx\b/.test(toLower) && toLower.includes('twitter');
    const isAuthGated = r.authGate.toLowerCase().includes('requires');

    // Check actions (clicked) vs observed (seen only)
    const clickedIn = flows.filter(f => f.allActions.includes(ctaLabel)).map(f => f.flowId);
    const seenIn = clickedIn.length === 0
      ? flows.filter(f => f.allObserved.includes(ctaLabel)).map(f => f.flowId)
      : [];

    let status;
    if (clickedIn.length > 0) status = 'PASS';
    else if (seenIn.length > 0) status = 'SEEN';
    else if (isExternal) status = 'EXTERNAL';
    else if (isAuthGated) status = 'AUTH_GATED';
    else status = 'MISS';

    return {
      item: `${r.from} -> ${r.cta} -> ${r.to}`,
      status,
      coveredBy: clickedIn.length > 0 ? clickedIn : seenIn,
      tag: isExternal ? 'external' : isAuthGated ? 'auth-gated' : '',
    };
  });
}

function auditPersonas(personas, flows) {
  return personas.map(p => {
    const coveredBy = flows.filter(f => {
      return f.persona.includes(p.id) ||
             f.persona.toLowerCase().includes(p.name.toLowerCase());
    }).map(f => f.flowId);

    let status;
    if (coveredBy.length > 0) status = 'PASS';
    else if (p.authState.toLowerCase().includes('auth')) status = 'AUTH_GATED';
    else status = 'MISS';

    return {
      item: `${p.id}: ${p.name}`,
      detail: p.authState,
      status,
      coveredBy,
    };
  });
}

function auditElements(elements, flows) {
  return elements.map(el => {
    const label = el.label.toLowerCase();
    if (!label || label.length < 2) return null;

    // Check actions (clicked) vs observed (seen only)
    const clickedIn = flows.filter(f => f.allActions.includes(label)).map(f => f.flowId);
    const seenIn = clickedIn.length === 0
      ? flows.filter(f => f.allObserved.includes(label)).map(f => f.flowId)
      : [];

    let status;
    if (clickedIn.length > 0) status = 'PASS';
    else if (seenIn.length > 0) status = 'SEEN';
    else status = 'MISS';

    return {
      item: `${el.page}: ${el.label}`,
      detail: el.text,
      status,
      coveredBy: clickedIn.length > 0 ? clickedIn : seenIn,
    };
  }).filter(Boolean);
}

function auditScreenshots(onDisk, flows) {
  // All screenshots referenced in flow.md files
  const flowRefs = new Set();
  flows.forEach(f => f.allScreenshots.forEach(s => flowRefs.add(s)));

  // Also check ui-inventory.md for seed-crawl screenshot references
  const uiInvPath = path.join(KB_DIR, 'ui-inventory.md');
  const kbRefs = new Set();
  if (fs.existsSync(uiInvPath)) {
    const uiContent = fs.readFileSync(uiInvPath, 'utf8');
    onDisk.forEach(s => { if (uiContent.includes(s)) kbRefs.add(s); });
  }

  return onDisk.map(s => {
    const inFlow = flowRefs.has(s);
    const inKB = kbRefs.has(s);
    return {
      item: s,
      status: (inFlow || inKB) ? 'PASS' : 'MISS',
      coveredBy: inFlow ? ['flow.md'] : inKB ? ['ui-inventory.md'] : [],
    };
  });
}

// --- Main audit entry ---

function audit() {
  if (!fs.existsSync(KB_DIR)) {
    return { error: 'No knowledgebase directory found at ' + KB_DIR };
  }

  const pages = parseKBPages();
  const routes = parseKBRoutes();
  const personas = parseKBPersonas();
  const elements = parseKBElements();
  const flows = gatherFlowData();

  const screenshotsOnDisk = fs.existsSync(SCREENSHOTS_DIR)
    ? fs.readdirSync(SCREENSHOTS_DIR).filter(f => /\.(png|jpg|jpeg|gif)$/i.test(f))
    : [];

  const pageCov = auditPages(pages, flows);
  const routeCov = auditRoutes(routes, flows);
  const personaCov = auditPersonas(personas, flows);
  const elemCov = auditElements(elements, flows);
  const screenshotCov = auditScreenshots(screenshotsOnDisk, flows);

  const pct = (items) => {
    const pass = items.filter(i => i.status === 'PASS').length;
    const total = items.length;
    return { covered: pass, total, pct: total > 0 ? Math.round(pass / total * 100) : 0 };
  };

  const summary = {
    pages: pct(pageCov),
    routes: pct(routeCov),
    personas: pct(personaCov),
    elements: pct(elemCov),
    screenshots: pct(screenshotCov),
  };
  summary.overall = Math.round(
    (summary.pages.pct + summary.routes.pct + summary.personas.pct +
     summary.elements.pct + summary.screenshots.pct) / 5
  );

  return { pages: pageCov, routes: routeCov, personas: personaCov, elements: elemCov, screenshots: screenshotCov, summary };
}

// =========================================================================
// Audit: console report
// =========================================================================

function printAuditReport(report) {
  if (report.error) {
    console.error('ERROR:', report.error);
    process.exit(1);
  }

  const line = '='.repeat(64);
  const thin = '-'.repeat(64);

  console.log('');
  console.log(line);
  console.log('  QA COVERAGE AUDIT — knowledgebase -> flows');
  console.log(line);

  printSection('PAGES  (ui-inventory -> flows)', report.pages);
  printSection('ROUTES (nav-graph -> flows)', report.routes);
  printSection('PERSONAS (personas -> flows)', report.personas);
  printSection('ELEMENTS (ui-inventory -> flows)', report.elements);
  printSection('SCREENSHOTS (disk -> flow.md)', report.screenshots);

  const s = report.summary;
  console.log('');
  console.log(line);
  console.log('  SUMMARY');
  console.log(thin);
  console.log(`  Pages:        ${pad(s.pages.pct)}%  (${s.pages.covered}/${s.pages.total})`);
  console.log(`  Routes:       ${pad(s.routes.pct)}%  (${s.routes.covered}/${s.routes.total})`);
  console.log(`  Personas:     ${pad(s.personas.pct)}%  (${s.personas.covered}/${s.personas.total})`);
  console.log(`  Elements:     ${pad(s.elements.pct)}%  (${s.elements.covered}/${s.elements.total})`);
  console.log(`  Screenshots:  ${pad(s.screenshots.pct)}%  (${s.screenshots.covered}/${s.screenshots.total})`);
  console.log(thin);
  console.log(`  OVERALL:      ${pad(s.overall)}%`);
  console.log(line);
  console.log('');
}

function printSection(title, items) {
  const pass = items.filter(i => i.status === 'PASS').length;
  const total = items.length;
  const pctVal = total > 0 ? Math.round(pass / total * 100) : 0;

  console.log('');
  console.log(`-- ${title}  ${pass}/${total} (${pctVal}%) --`);

  for (const item of items) {
    const tag = item.status === 'PASS'       ? '[PASS]' :
                item.status === 'SEEN'       ? '[SEEN]' :
                item.status === 'EXTERNAL'   ? '[SKIP]' :
                item.status === 'AUTH_GATED' ? '[AUTH]' : '[MISS]';
    const by = item.coveredBy && item.coveredBy.length > 0
      ? ` -> ${item.coveredBy.join(', ')}`
      : '';
    const note = item.status === 'EXTERNAL'   ? '  (external link)' :
                 item.status === 'AUTH_GATED' ? '  (needs auth - Phase 2)' :
                 item.status === 'SEEN'       ? '  (observed but not clicked)' : '';
    console.log(`  ${tag} ${item.item}${by}${note}`);
  }
}

function pad(n) {
  return String(n).padStart(3, ' ');
}

// =========================================================================
// CLI
// =========================================================================

function cli() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
  };
  const has = (flag) => args.includes(flag);

  // --- Audit mode ---
  if (has('--audit')) {
    const report = audit();
    if (has('--json')) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printAuditReport(report);
    }
    // Exit with non-zero if overall < 80%
    if (report.summary && report.summary.overall < 80) {
      process.exit(1);
    }
    return;
  }

  // --- Register mode ---
  const flow = get('--flow');
  const step = get('--step');
  const action = get('--action');
  const observed = get('--observed') || '(pending visual analysis)';
  const file = get('--file');
  const pageName = get('--page') || '';

  if (!flow || !step || !action || !file) {
    console.error('Usage:');
    console.error('  node scripts/qa-screenshot.js --flow F-NNN-slug --step N --action "..." --observed "..." --file name.png');
    console.error('  node scripts/qa-screenshot.js --audit [--json]');
    console.error('');
    console.error('Register flags:');
    console.error('  --flow      Flow directory name (e.g. F-003-onboarding-wizard or F-003 or seed-crawl)');
    console.error('  --step      Step number or label (e.g. 5 or D-1)');
    console.error('  --action    What was done (e.g. "Click Submit button")');
    console.error('  --observed  What was seen (e.g. "Form submitted, redirect to dashboard")');
    console.error('  --file      Screenshot filename (must already exist in qa/knowledgebase/screenshots/)');
    console.error('  --page      (Optional) Page/Screen name for 5-col E2E flow tables');
    console.error('');
    console.error('Audit flags:');
    console.error('  --audit     Cross-reference knowledgebase against flows, report coverage gaps');
    console.error('  --json      Output audit as JSON instead of formatted text');
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
      console.log(`Registered ${file} in ${result.flowMd}`);
    } else {
      console.log(`Skipped ${file} — already referenced (${result.reason})`);
    }
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

// =========================================================================
// Exports + CLI entry
// =========================================================================

module.exports = { capture, appendEvidence, findFlowDir, audit, parseMarkdownTable };

if (require.main === module) {
  cli();
}
