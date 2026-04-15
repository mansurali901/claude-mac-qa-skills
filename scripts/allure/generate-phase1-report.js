#!/usr/bin/env node
/**
 * Phase 1 Allure Report Generator
 *
 * Reads QA workspace discovery data (flow.md files, screenshots, .qa-config.json)
 * and generates Allure-compatible result files so `allure generate` can produce
 * an HTML report for Phase 1 (Discovery).
 *
 * Usage:
 *   node scripts/allure/generate-phase1-report.js
 *   node scripts/allure/generate-phase1-report.js --results-dir custom-allure-results
 *
 * No external dependencies — Node.js stdlib only.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();
const QA_DIR = path.join(REPO_ROOT, 'qa');
const SCREENSHOTS_DIR = path.join(QA_DIR, 'knowledgebase', 'screenshots');

const ridx = process.argv.indexOf('--results-dir');
const RESULTS_DIR = ridx !== -1
  ? path.resolve(process.argv[ridx + 1])
  : path.join(REPO_ROOT, 'allure-results');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uuid() {
  return crypto.randomUUID();
}

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function mimeForExt(ext) {
  const map = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

function nowMs() {
  return Date.now();
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function readConfig() {
  const p = path.join(QA_DIR, '.qa-config.json');
  if (!fs.existsSync(p)) {
    console.error('ERROR: qa/.qa-config.json not found. Run the QA skill first.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readStateFile(platform) {
  const p = path.join(QA_DIR, `state-${platform}.md`);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

function findFlowDirs() {
  // Support flow-based (qa/flows/) and feature-based (qa/features/)
  const results = [];
  for (const dir of ['flows', 'features']) {
    const full = path.join(QA_DIR, dir);
    if (!fs.existsSync(full)) continue;
    const entries = fs.readdirSync(full)
      .filter(d => fs.statSync(path.join(full, d)).isDirectory())
      .sort()
      .map(d => ({ name: d, dir: path.join(full, d) }));
    results.push(...entries);
  }
  return results;
}

/** Parse a markdown table row: | col1 | col2 | ... | → [col1, col2, ...] */
function parseTableRow(line) {
  if (!line.trim().startsWith('|')) return null;
  const cells = line.split('|').slice(1, -1).map(c => c.trim());
  // Skip separator rows (---|---)
  if (cells.every(c => /^[-:]+$/.test(c))) return null;
  return cells;
}

function parseFlowMd(flowEntry) {
  let flowMdPath = path.join(flowEntry.dir, 'flow.md');
  if (!fs.existsSync(flowMdPath)) flowMdPath = path.join(flowEntry.dir, 'overview.md');
  if (!fs.existsSync(flowMdPath)) return null;

  const content = fs.readFileSync(flowMdPath, 'utf8');

  // --- Parse Summary table ---
  const metadata = {};
  const summaryMatch = content.match(/## Summary[\s\S]*?(?=\n---|\n## )/);
  if (summaryMatch) {
    const rows = summaryMatch[0].split('\n').map(parseTableRow).filter(Boolean);
    for (const cells of rows) {
      if (cells.length >= 2) {
        const key = cells[0].replace(/\*\*/g, '').trim().toLowerCase();
        const val = cells[1].replace(/\*\*/g, '').trim();
        metadata[key] = val;
      }
    }
  }

  // --- Parse Discovery Evidence table ---
  // Supports both 4-column and 5-column evidence table formats:
  //   4-col: Step | Action | Screenshot | Observed
  //   5-col: Step | Page/Screen | Action | Screenshot | Observed  (E2E flows with page tracking)
  const steps = [];
  const evidenceMatch = content.match(/## Discovery Evidence[\s\S]*?(?=\n---|\n## [^#]|$)/);
  if (evidenceMatch) {
    const lines = evidenceMatch[0].split('\n');
    let headerFound = false;
    let colLayout = null; // '4col' or '5col'
    for (const line of lines) {
      const cells = parseTableRow(line);
      if (!cells || cells.length < 4) continue;
      // Detect header row and column layout
      if (!headerFound && /step/i.test(cells[0])) {
        headerFound = true;
        colLayout = cells.length >= 5 && /page|screen/i.test(cells[1]) ? '5col' : '4col';
        continue;
      }
      if (!headerFound) continue;

      if (colLayout === '5col' && cells.length >= 5) {
        steps.push({
          number: parseInt(cells[0]) || steps.length + 1,
          page: cells[1],
          action: cells[2],
          screenshot: cells[3].replace(/`/g, '').trim(),
          observed: cells[4],
        });
      } else if (cells.length >= 4) {
        steps.push({
          number: parseInt(cells[0]) || steps.length + 1,
          action: cells[1],
          screenshot: cells[2].replace(/`/g, '').trim(),
          observed: cells[3],
        });
      }
    }
  }

  // --- Parse User Journey steps table (the ### Steps section in flow.md) ---
  const userSteps = [];
  const stepsMatch = content.match(/### Steps[\s\S]*?(?=\n###|\n---|\n## )/);
  if (stepsMatch) {
    const lines = stepsMatch[0].split('\n');
    let headerFound = false;
    for (const line of lines) {
      const cells = parseTableRow(line);
      if (!cells || cells.length < 3) continue;
      if (!headerFound && /step/i.test(cells[0])) { headerFound = true; continue; }
      if (!headerFound) continue;

      userSteps.push({
        number: parseInt(cells[0]) || userSteps.length + 1,
        action: cells[1],
        response: cells[2],
        urlChange: cells[3] || '',
      });
    }
  }

  // --- Parse Notes ---
  const notesMatch = content.match(/## Notes[\s\S]*$/);
  const notes = notesMatch ? notesMatch[0].replace(/^## Notes.*\n/, '').trim() : '';

  return { entry: flowEntry, metadata, steps, userSteps, notes, raw: content };
}

// ---------------------------------------------------------------------------
// Allure result builders
// ---------------------------------------------------------------------------

function buildFlowResult(flow, config, startTime) {
  const resultUuid = uuid();
  const stepDuration = 3000; // 3 s per step for visual spacing in timeline

  const attachments = [];
  const allureSteps = [];

  for (let i = 0; i < flow.steps.length; i++) {
    const step = flow.steps[i];
    const stepAttachments = [];

    // Resolve screenshot — could be a bare filename or a path like qa/knowledgebase/screenshots/...
    const screenshotFile = path.basename(step.screenshot);
    const screenshotSrc = path.join(SCREENSHOTS_DIR, screenshotFile);

    if (fs.existsSync(screenshotSrc)) {
      const ext = path.extname(screenshotFile);
      const attachId = uuid();
      const attachName = `${attachId}-attachment${ext}`;
      fs.copyFileSync(screenshotSrc, path.join(RESULTS_DIR, attachName));

      const att = { name: `Step ${step.number}: ${screenshotFile}`, source: attachName, type: mimeForExt(ext) };
      stepAttachments.push(att);
      attachments.push(att);
    }

    allureSteps.push({
      name: `Step ${step.number}: ${step.action}`,
      status: 'passed',
      stage: 'finished',
      statusDetails: { message: step.observed },
      attachments: stepAttachments,
      parameters: [],
      steps: [],
      start: startTime + i * stepDuration,
      stop: startTime + (i + 1) * stepDuration,
    });
  }

  // Severity from priority
  const priority = (flow.metadata.priority || 'P2').toUpperCase();
  const severityMap = { P1: 'critical', P2: 'normal', P3: 'minor', P4: 'trivial' };
  const severity = severityMap[priority] || 'normal';

  const idMatch = flow.entry.name.match(/F-(\d+)/);
  const idPrefix = 'F';
  const flowId = idMatch ? idMatch[1] : '000';
  const flowName = flow.metadata.description || flow.metadata.goal || flow.entry.name.replace(/^F-\d+-/, '').replace(/-/g, ' ');
  const authRequired = /yes/i.test(flow.metadata['auth required'] || flow.metadata['auth transition'] || '');
  const appName = config.app_name || 'Unknown Product';

  const status = flow.steps.length > 0 ? 'passed' : 'broken';

  const result = {
    uuid: resultUuid,
    historyId: md5(`phase1-discovery-${flow.entry.name}`),
    fullName: `Product: ${appName} > Phase 1 Discovery > ${flow.entry.name}`,
    name: `${idPrefix}-${flowId}: ${flowName}`,
    status,
    stage: 'finished',
    description: [
      `**Product**: ${appName}`,
      `**Journey**: ${flow.entry.name}`,
      `**Steps traced**: ${flow.steps.length}`,
      `**Screenshots**: ${attachments.length}`,
      `**Auth required**: ${authRequired ? 'Yes' : 'No'}`,
      `**Priority**: ${priority}`,
      '',
      flow.notes ? `### Notes\n${flow.notes}` : '',
    ].join('\n'),
    descriptionHtml: `
      <h3>Product: ${appName} &mdash; ${flow.entry.name}</h3>
      <table>
        <tr><td><b>Product</b></td><td>${appName}</td></tr>
        <tr><td><b>Steps traced</b></td><td>${flow.steps.length}</td></tr>
        <tr><td><b>Screenshots</b></td><td>${attachments.length}</td></tr>
        <tr><td><b>Auth required</b></td><td>${authRequired ? 'Yes' : 'No'}</td></tr>
        <tr><td><b>Priority</b></td><td>${priority}</td></tr>
        <tr><td><b>Start state</b></td><td>${flow.metadata['start state'] || flow.metadata['entry point'] || 'N/A'}</td></tr>
        <tr><td><b>End state</b></td><td>${flow.metadata['end state'] || 'N/A'}</td></tr>
      </table>
      ${flow.notes ? `<h4>Notes</h4><p>${flow.notes.replace(/\n/g, '<br>')}</p>` : ''}
    `.trim(),
    labels: [
      { name: 'epic', value: `Product: ${appName}` },
      { name: 'feature', value: 'Phase 1 — Discovery' },
      { name: 'story', value: `${idPrefix}-${flowId}: ${flowName}` },
      { name: 'suite', value: 'Phase 1 — Discovery' },
      { name: 'subSuite', value: flow.entry.name },
      { name: 'severity', value: severity },
      { name: 'tag', value: 'discovery' },
      { name: 'tag', value: 'phase-1' },
      { name: 'tag', value: config.platform || 'unknown' },
      { name: 'tag', value: authRequired ? 'auth-required' : 'public' },
      { name: 'owner', value: 'QA Agent' },
      { name: 'host', value: os.hostname() },
      { name: 'thread', value: 'main' },
    ],
    links: [],
    parameters: [
      { name: 'App', value: config.app_name || 'Unknown' },
      { name: 'Platform', value: config.platform || 'Unknown' },
      { name: 'URL', value: config.app_url || config.app_path || 'N/A' },
      { name: 'Framework', value: config.framework || 'flow-based' },
    ],
    attachments,
    steps: allureSteps,
    start: startTime,
    stop: startTime + flow.steps.length * stepDuration,
  };

  return result;
}

function buildSummaryResult(config, flowCount, totalSteps, totalScreenshots, startTime) {
  const resultUuid = uuid();
  const appName = config.app_name || 'Unknown Product';

  return {
    uuid: resultUuid,
    historyId: md5('phase1-summary'),
    fullName: `Product: ${appName} > Phase 1 Discovery > Summary`,
    name: `Product: ${appName} — Discovery Summary`,
    status: 'passed',
    stage: 'finished',
    description: [
      `# Product: ${appName} — Phase 1 Discovery Summary`,
      '',
      `| Metric | Value |`,
      `|--------|-------|`,
      `| **Product** | ${appName} |`,
      `| **Platform** | ${config.platform || 'Unknown'} |`,
      `| **Journeys discovered** | ${flowCount} |`,
      `| **Total steps traced** | ${totalSteps} |`,
      `| **Screenshots captured** | ${totalScreenshots} |`,
      `| **Framework** | ${config.framework || 'flow-based'} |`,
      `| **Generated** | ${new Date().toISOString()} |`,
    ].join('\n'),
    descriptionHtml: `
      <h2>Product: ${appName} — Phase 1 Discovery Summary</h2>
      <table>
        <tr><td><b>Product</b></td><td>${appName}</td></tr>
        <tr><td><b>Platform</b></td><td>${config.platform || 'Unknown'}</td></tr>
        <tr><td><b>Journeys discovered</b></td><td>${flowCount}</td></tr>
        <tr><td><b>Total steps traced</b></td><td>${totalSteps}</td></tr>
        <tr><td><b>Screenshots captured</b></td><td>${totalScreenshots}</td></tr>
        <tr><td><b>Framework</b></td><td>${config.framework || 'flow-based'}</td></tr>
      </table>
    `.trim(),
    labels: [
      { name: 'epic', value: `Product: ${appName}` },
      { name: 'feature', value: 'Phase 1 — Discovery' },
      { name: 'story', value: 'Summary' },
      { name: 'suite', value: `Product: ${appName}` },
      { name: 'severity', value: 'normal' },
      { name: 'tag', value: 'discovery' },
      { name: 'tag', value: 'phase-1' },
      { name: 'tag', value: 'summary' },
      { name: 'owner', value: 'QA Agent' },
    ],
    links: [],
    parameters: [
      { name: 'Product', value: appName },
      { name: 'Platform', value: config.platform || 'Unknown' },
    ],
    attachments: [],
    steps: [],
    start: startTime,
    stop: startTime + 1000,
  };
}

// ---------------------------------------------------------------------------
// Environment & categories
// ---------------------------------------------------------------------------

function writeEnvironment(config) {
  const stateContent = readStateFile(config.platform);
  const flowCount = config.flows_count || 0;
  const tcCount = config.test_cases_count || 0;

  const lines = [
    `Product=${config.app_name || 'Unknown Product'}`,
    `Platform=${config.platform || 'Unknown'}`,
    `URL=${config.app_url || config.app_path || 'N/A'}`,
    `Framework=${config.framework || 'flow-based'}`,
    `Phase=Phase 1 - Discovery`,
    `Journeys.Discovered=${flowCount}`,
    `TestCases.Written=${tcCount}`,
    `Generated=${new Date().toISOString()}`,
    `OS=${os.platform()} ${os.release()}`,
    `Node=${process.version}`,
  ];
  fs.writeFileSync(path.join(RESULTS_DIR, 'environment.properties'), lines.join('\n'));
}

function writeCategories() {
  const categories = [
    {
      name: 'Flows Fully Traced',
      description: 'Flows with complete discovery evidence and screenshots',
      matchedStatuses: ['passed'],
    },
    {
      name: 'Flows Incomplete',
      description: 'Flows missing discovery evidence or screenshots',
      matchedStatuses: ['broken'],
    },
    {
      name: 'Auth-Gated (Deferred to Phase 2)',
      description: 'Flows that require credentials — traced partially, full coverage in Phase 2',
      matchedStatuses: ['skipped'],
    },
  ];
  fs.writeFileSync(path.join(RESULTS_DIR, 'categories.json'), JSON.stringify(categories, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Screenshot coverage gate
// ---------------------------------------------------------------------------

function validateScreenshotCoverage() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) return { pass: true, orphaned: [], missing: [], total: 0, covered: 0 };

  const onDisk = new Set(
    fs.readdirSync(SCREENSHOTS_DIR).filter(f => f.endsWith('.png'))
  );

  const referenced = new Set();

  // Scan all doc directories: flows, features
  for (const dirName of ['flows', 'features']) {
    const base = path.join(QA_DIR, dirName);
    if (!fs.existsSync(base)) continue;
    for (const sub of fs.readdirSync(base)) {
      for (const docName of ['flow.md', 'overview.md']) {
        const docPath = path.join(base, sub, docName);
        if (!fs.existsSync(docPath)) continue;
        const content = fs.readFileSync(docPath, 'utf8');
        const re = /[a-zA-Z0-9_-]+\.png/g;
        let m;
        while ((m = re.exec(content)) !== null) referenced.add(m[0]);
      }
    }
  }

  const orphaned = [...onDisk].filter(f => !referenced.has(f)).sort();
  const missing = [...referenced].filter(f => !onDisk.has(f)).sort();

  return { pass: orphaned.length === 0, orphaned, missing, total: onDisk.size, covered: onDisk.size - orphaned.length };
}

function main() {
  console.log('');
  console.log('  Phase 1 Allure Report Generator');
  console.log('  ================================');
  console.log('');

  // --- Screenshot coverage gate (hard fail) ---
  const coverage = validateScreenshotCoverage();
  if (!coverage.pass) {
    console.log('  ❌ SCREENSHOT COVERAGE GATE FAILED');
    console.log('');
    console.log(`  On disk: ${coverage.total} | Referenced: ${coverage.covered} | Orphaned: ${coverage.orphaned.length}`);
    console.log('');
    console.log('  Orphaned screenshots (on disk but not in any flow.md):');
    for (const f of coverage.orphaned) {
      console.log(`    - ${f}`);
    }
    console.log('');
    console.log('  Every screenshot in qa/knowledgebase/screenshots/ must be referenced');
    console.log('  in a Discovery Evidence table in the corresponding flow.md file.');
    console.log('');
    console.log('  Fix with: node scripts/qa-screenshot.js --flow F-NNN --step N --action "..." --observed "..." --file <name>.png');
    console.log('  for each orphaned screenshot listed above.');
    console.log('');
    process.exit(1);
  }
  console.log(`  ✅ Screenshot coverage: ${coverage.covered}/${coverage.total} referenced`);
  if (coverage.missing.length > 0) {
    console.log(`  ⚠ ${coverage.missing.length} referenced but missing from disk: ${coverage.missing.slice(0, 3).join(', ')}${coverage.missing.length > 3 ? '...' : ''}`);
  }
  console.log('');

  // Clean and create results directory
  if (fs.existsSync(RESULTS_DIR)) {
    const existing = fs.readdirSync(RESULTS_DIR);
    for (const f of existing) fs.unlinkSync(path.join(RESULTS_DIR, f));
  } else {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  const config = readConfig();
  console.log(`  App:       ${config.app_name || 'Unknown'}`);
  console.log(`  Platform:  ${config.platform || 'Unknown'}`);
  console.log(`  Framework: ${config.framework || 'flow-based'}`);
  console.log('');

  const flowEntries = findFlowDirs();
  if (flowEntries.length === 0) {
    console.log('  No flow directories found in qa/flows/ or qa/features/.');
    console.log('  Run Phase 1 discovery first.');
    process.exit(1);
  }
  console.log(`  Found ${flowEntries.length} flow directories`);
  console.log('');

  const baseTime = nowMs();
  let totalSteps = 0;
  let totalScreenshots = 0;
  let processedFlows = 0;

  for (let i = 0; i < flowEntries.length; i++) {
    const entry = flowEntries[i];
    const flow = parseFlowMd(entry);

    if (!flow) {
      console.log(`  [!] ${entry.name}: no flow.md — skipped`);
      continue;
    }

    const startTime = baseTime + i * 60000; // space flows 1 min apart in timeline
    const result = buildFlowResult(flow, config, startTime);
    fs.writeFileSync(
      path.join(RESULTS_DIR, `${result.uuid}-result.json`),
      JSON.stringify(result, null, 2),
    );

    totalSteps += flow.steps.length;
    totalScreenshots += result.attachments.length;
    processedFlows++;

    const icon = result.status === 'passed' ? '[OK]' : '[!!]';
    console.log(`  ${icon} ${entry.name}: ${flow.steps.length} steps, ${result.attachments.length} screenshots`);
  }

  // Summary result
  const summaryResult = buildSummaryResult(config, processedFlows, totalSteps, totalScreenshots, baseTime - 1000);
  fs.writeFileSync(
    path.join(RESULTS_DIR, `${summaryResult.uuid}-result.json`),
    JSON.stringify(summaryResult, null, 2),
  );

  // Environment + categories
  writeEnvironment(config);
  writeCategories();

  console.log('');
  console.log('  ================================');
  console.log(`  Results:      ${RESULTS_DIR}`);
  console.log(`  Flows:        ${processedFlows}`);
  console.log(`  Steps:        ${totalSteps}`);
  console.log(`  Screenshots:  ${totalScreenshots}`);
  console.log('');
  console.log('  Next — generate and open the HTML report:');
  console.log('');
  console.log('    npm run allure:phase1:open');
  console.log('');
  console.log('  Or manually:');
  console.log(`    npx allure generate ${RESULTS_DIR} -o allure-report --clean`);
  console.log('    npx allure open allure-report');
  console.log('');
}

main();
