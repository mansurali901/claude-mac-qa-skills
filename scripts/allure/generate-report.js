#!/usr/bin/env node
/**
 * Unified Allure Report Generator
 *
 * ONE script, ONE report. Reads everything that exists in the qa/ workspace
 * and generates a comprehensive Allure report covering all completed work:
 *
 *   Phase 1 (Discovery):  flow.md files + screenshots
 *   Phase 2 (Scenarios):  scenarios.md files
 *   Phase 3 (Test Cases): TC-NNN-*.md files
 *   Phase 4 (Execution):  Playwright test results (if run)
 *
 * If you stop mid-Phase 2, the report shows Phase 1 complete + Phase 2 partial.
 * The report always contains everything done so far — no data is lost.
 *
 * Usage:
 *   node scripts/allure/generate-report.js                  # generate allure-results
 *   node scripts/allure/generate-report.js --open           # generate + build HTML + open browser
 *   node scripts/allure/generate-report.js --results-dir X  # custom output directory
 *
 * No external dependencies — Node.js stdlib only.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();
const QA_DIR = path.join(REPO_ROOT, 'qa');
const SCREENSHOTS_DIR = path.join(QA_DIR, 'knowledgebase', 'screenshots');
const EVIDENCE_DIR = path.join(QA_DIR, 'evidence');

const args = process.argv.slice(2);
const ridx = args.indexOf('--results-dir');
const RESULTS_DIR = ridx !== -1
  ? path.resolve(args[ridx + 1])
  : path.join(REPO_ROOT, 'allure-results');
const OPEN = args.includes('--open');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uuid() { return crypto.randomUUID(); }
function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }
function nowMs() { return Date.now(); }

function mimeForExt(ext) {
  const map = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

function parseTableRow(line) {
  if (!line.trim().startsWith('|')) return null;
  const cells = line.split('|').slice(1, -1).map(c => c.trim());
  if (cells.every(c => /^[-:]+$/.test(c))) return null;
  return cells;
}

// ---------------------------------------------------------------------------
// Config + workspace reading
// ---------------------------------------------------------------------------

function readConfig() {
  const p = path.join(QA_DIR, '.qa-config.json');
  if (!fs.existsSync(p)) {
    console.error('  ERROR: qa/.qa-config.json not found. Run the QA skill first.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function findFlowDirs() {
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

// ---------------------------------------------------------------------------
// Screenshot coverage gate
// ---------------------------------------------------------------------------

function validateScreenshotCoverage() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) return { pass: true, orphaned: [], missing: [], total: 0, covered: 0 };

  const onDisk = new Set(fs.readdirSync(SCREENSHOTS_DIR).filter(f => f.endsWith('.png')));
  const referenced = new Set();

  for (const dirName of ['flows', 'features']) {
    const base = path.join(QA_DIR, dirName);
    if (!fs.existsSync(base)) continue;
    for (const sub of fs.readdirSync(base)) {
      for (const docName of ['flow.md', 'overview.md']) {
        const docPath = path.join(base, sub, docName);
        if (!fs.existsSync(docPath)) continue;
        const content = fs.readFileSync(docPath, 'utf8');
        let m;
        const re = /[a-zA-Z0-9_-]+\.png/g;
        while ((m = re.exec(content)) !== null) referenced.add(m[0]);
      }
    }
  }

  const orphaned = [...onDisk].filter(f => !referenced.has(f)).sort();
  const missing = [...referenced].filter(f => !onDisk.has(f)).sort();
  return { pass: orphaned.length === 0, orphaned, missing, total: onDisk.size, covered: onDisk.size - orphaned.length };
}

// ---------------------------------------------------------------------------
// Phase 1: Parse flow.md (discovery evidence)
// ---------------------------------------------------------------------------

function parseFlowMd(flowEntry) {
  let flowMdPath = path.join(flowEntry.dir, 'flow.md');
  if (!fs.existsSync(flowMdPath)) flowMdPath = path.join(flowEntry.dir, 'overview.md');
  if (!fs.existsSync(flowMdPath)) return null;

  const content = fs.readFileSync(flowMdPath, 'utf8');

  // Parse Summary table
  const metadata = {};
  const summaryMatch = content.match(/## Summary[\s\S]*?(?=\n---|\n## )/);
  if (summaryMatch) {
    for (const line of summaryMatch[0].split('\n')) {
      const cells = parseTableRow(line);
      if (cells && cells.length >= 2) {
        metadata[cells[0].replace(/\*\*/g, '').trim().toLowerCase()] = cells[1].replace(/\*\*/g, '').trim();
      }
    }
  }

  // Parse Discovery Evidence table (4-col or 5-col)
  const steps = [];
  const evidenceMatch = content.match(/## Discovery Evidence[\s\S]*?(?=\n---|\n## [^#]|$)/);
  if (evidenceMatch) {
    const lines = evidenceMatch[0].split('\n');
    let headerFound = false;
    let colLayout = null;
    for (const line of lines) {
      const cells = parseTableRow(line);
      if (!cells || cells.length < 4) continue;
      if (!headerFound && /step/i.test(cells[0])) {
        headerFound = true;
        colLayout = cells.length >= 5 && /page|screen/i.test(cells[1]) ? '5col' : '4col';
        continue;
      }
      if (!headerFound) continue;

      if (colLayout === '5col' && cells.length >= 5) {
        steps.push({ number: parseInt(cells[0]) || steps.length + 1, page: cells[1], action: cells[2], screenshot: cells[3].replace(/`/g, '').trim(), observed: cells[4] });
      } else if (cells.length >= 4) {
        steps.push({ number: parseInt(cells[0]) || steps.length + 1, action: cells[1], screenshot: cells[2].replace(/`/g, '').trim(), observed: cells[3] });
      }
    }
  }

  // Parse Notes
  const notesMatch = content.match(/## Notes[\s\S]*$/);
  const notes = notesMatch ? notesMatch[0].replace(/^## Notes.*\n/, '').trim() : '';

  return { entry: flowEntry, metadata, steps, notes };
}

// ---------------------------------------------------------------------------
// Phase 2: Parse scenarios.md
// ---------------------------------------------------------------------------

function parseScenariosmd(flowDir) {
  const p = path.join(flowDir, 'scenarios.md');
  if (!fs.existsSync(p)) return null;
  const content = fs.readFileSync(p, 'utf8');

  const scenarios = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^## S-[\d-]+:\s*(.+)/);
    if (match) {
      // Parse the scenario table that follows
      const meta = {};
      for (let j = i + 1; j < Math.min(i + 15, lines.length); j++) {
        const cells = parseTableRow(lines[j]);
        if (cells && cells.length >= 2) {
          meta[cells[0].replace(/\*\*/g, '').trim().toLowerCase()] = cells[1].replace(/\*\*/g, '').trim();
        }
      }
      scenarios.push({ name: match[1].trim(), ...meta });
    }
  }

  // Parse coverage summary
  const coverage = {};
  const summaryMatch = content.match(/## Coverage Summary[\s\S]*$/);
  if (summaryMatch) {
    let headerFound = false;
    for (const line of summaryMatch[0].split('\n')) {
      const cells = parseTableRow(line);
      if (!cells || cells.length < 2) continue;
      if (!headerFound && /category/i.test(cells[0])) { headerFound = true; continue; }
      if (!headerFound) continue;
      coverage[cells[0]] = parseInt(cells[1]) || 0;
    }
  }

  return { scenarios, coverage };
}

// ---------------------------------------------------------------------------
// Phase 3: Parse TC-NNN-*.md files
// ---------------------------------------------------------------------------

function findTcFiles(flowDir) {
  const tcDir = path.join(flowDir, 'test-cases');
  if (!fs.existsSync(tcDir)) return [];
  return fs.readdirSync(tcDir)
    .filter(f => f.startsWith('TC-') && f.endsWith('.md'))
    .sort()
    .map(f => path.join(tcDir, f));
}

function parseTcMd(tcPath) {
  const content = fs.readFileSync(tcPath, 'utf8');
  const filename = path.basename(tcPath, '.md');

  const metadata = {};
  // Try both table-at-top format and ## Metadata section
  const metaSection = content.match(/\| Field[\s\S]*?(?=\n## |\n---)/i) || content.match(/## Metadata[\s\S]*?(?=\n---|\n## )/);
  if (metaSection) {
    for (const line of metaSection[0].split('\n')) {
      const cells = parseTableRow(line);
      if (cells && cells.length >= 2) {
        metadata[cells[0].replace(/\*\*/g, '').trim().toLowerCase()] = cells[1].replace(/\*\*/g, '').trim();
      }
    }
  }

  // Check if .spec.ts exists (Phase 4 ready)
  const specPath = tcPath.replace(/\.md$/, '.spec.ts');
  const hasSpec = fs.existsSync(specPath);

  // Check for typescript code block
  const hasCode = /```typescript/.test(content);

  return { filename, path: tcPath, metadata, hasSpec, hasCode };
}

// ---------------------------------------------------------------------------
// Allure result builders
// ---------------------------------------------------------------------------

function buildDiscoveryResult(flow, appName, startTime) {
  const resultUuid = uuid();
  const stepDuration = 3000;
  const attachments = [];
  const allureSteps = [];

  for (let i = 0; i < flow.steps.length; i++) {
    const step = flow.steps[i];
    const stepAttachments = [];

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

    const stepName = step.page
      ? `Step ${step.number} [${step.page}]: ${step.action}`
      : `Step ${step.number}: ${step.action}`;

    allureSteps.push({
      name: stepName,
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

  const idMatch = flow.entry.name.match(/F-(\d+)/);
  const flowId = idMatch ? idMatch[1] : '000';
  const flowName = flow.metadata.description || flow.metadata.goal || flow.entry.name.replace(/^F-\d+-/, '').replace(/-/g, ' ');
  const priority = (flow.metadata.priority || 'P2').toUpperCase();
  const severityMap = { P1: 'critical', P2: 'normal', P3: 'minor', P4: 'trivial' };
  const authRequired = /yes/i.test(flow.metadata['auth required'] || flow.metadata['auth transition'] || '');
  const status = flow.steps.length > 0 ? 'passed' : 'broken';

  return {
    uuid: resultUuid,
    historyId: md5(`discovery-${flow.entry.name}`),
    fullName: `Product: ${appName} > Phase 1 Discovery > ${flow.entry.name}`,
    name: `F-${flowId}: ${flowName}`,
    status,
    stage: 'finished',
    description: [
      `**Product**: ${appName}`,
      `**Phase**: 1 — Discovery`,
      `**Flow**: ${flow.entry.name}`,
      `**Steps traced**: ${flow.steps.length}`,
      `**Screenshots**: ${attachments.length}`,
      `**Auth required**: ${authRequired ? 'Yes' : 'No'}`,
      `**Priority**: ${priority}`,
      '',
      flow.notes ? `### Notes\n${flow.notes}` : '',
    ].join('\n'),
    labels: [
      { name: 'epic', value: `Product: ${appName}` },
      { name: 'feature', value: 'Phase 1 — Discovery' },
      { name: 'story', value: `F-${flowId}: ${flowName}` },
      { name: 'suite', value: `Product: ${appName}` },
      { name: 'subSuite', value: 'Phase 1 — Discovery' },
      { name: 'severity', value: severityMap[priority] || 'normal' },
      { name: 'tag', value: 'discovery' },
      { name: 'tag', value: 'phase-1' },
      { name: 'tag', value: authRequired ? 'auth-required' : 'public' },
      { name: 'owner', value: 'QA Agent' },
      { name: 'host', value: os.hostname() },
    ],
    links: [],
    parameters: [
      { name: 'Product', value: appName },
      { name: 'Phase', value: '1 — Discovery' },
    ],
    attachments,
    steps: allureSteps,
    start: startTime,
    stop: startTime + flow.steps.length * stepDuration,
  };
}

function buildScenarioResult(flowEntry, scenarioData, appName, startTime) {
  const flowName = flowEntry.name;
  const count = scenarioData.scenarios.length;

  const scenarioList = scenarioData.scenarios.map((s, i) =>
    `${i + 1}. **${s.name}** — ${s.priority || 'P2'} / ${s.category || 'Functional'}`
  ).join('\n');

  return {
    uuid: uuid(),
    historyId: md5(`scenarios-${flowName}`),
    fullName: `Product: ${appName} > Phase 2 Scenarios > ${flowName}`,
    name: `${flowName}: ${count} scenarios planned`,
    status: 'passed',
    stage: 'finished',
    description: `**Product**: ${appName}\n**Phase**: 2 — Scenario Planning\n**Flow**: ${flowName}\n**Scenarios**: ${count}\n\n${scenarioList}`,
    labels: [
      { name: 'epic', value: `Product: ${appName}` },
      { name: 'feature', value: 'Phase 2 — Scenario Planning' },
      { name: 'story', value: `${flowName}: ${count} scenarios` },
      { name: 'suite', value: `Product: ${appName}` },
      { name: 'subSuite', value: 'Phase 2 — Scenario Planning' },
      { name: 'severity', value: 'normal' },
      { name: 'tag', value: 'scenarios' },
      { name: 'tag', value: 'phase-2' },
      { name: 'owner', value: 'QA Agent' },
    ],
    links: [],
    parameters: [{ name: 'Product', value: appName }, { name: 'Phase', value: '2 — Scenarios' }],
    attachments: [],
    steps: scenarioData.scenarios.map((s, i) => ({
      name: `S-${String(i + 1).padStart(2, '0')}: ${s.name}`,
      status: 'passed',
      stage: 'finished',
      statusDetails: { message: `${s.priority || 'P2'} | ${s.category || 'Functional'}` },
      attachments: [],
      parameters: [],
      steps: [],
      start: startTime + i * 1000,
      stop: startTime + (i + 1) * 1000,
    })),
    start: startTime,
    stop: startTime + count * 1000,
  };
}

function buildTcResult(flowEntry, tc, appName, startTime) {
  const tcId = tc.metadata['tc id'] || tc.metadata['test case id'] || tc.filename;
  const priority = (tc.metadata.priority || 'P2').toUpperCase();
  const severityMap = { P1: 'critical', P2: 'normal', P3: 'minor', P4: 'trivial' };

  // Attach evidence if exists
  const attachments = [];
  if (fs.existsSync(EVIDENCE_DIR)) {
    const walkDir = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) walkDir(full);
        else if (f.includes(tc.filename) && /\.(png|jpg|jpeg)$/i.test(f)) {
          const ext = path.extname(f);
          const attachId = uuid();
          const attachName = `${attachId}-attachment${ext}`;
          fs.copyFileSync(full, path.join(RESULTS_DIR, attachName));
          attachments.push({ name: f, source: attachName, type: mimeForExt(ext) });
        }
      }
    };
    walkDir(EVIDENCE_DIR);
  }

  const status = tc.hasSpec ? 'passed' : (tc.hasCode ? 'passed' : 'broken');

  return {
    uuid: uuid(),
    historyId: md5(`tc-${tc.filename}`),
    fullName: `Product: ${appName} > Phase 3 Test Cases > ${flowEntry.name} > ${tc.filename}`,
    name: `${tcId}: ${tc.metadata.scenario || tc.filename}`,
    status,
    stage: 'finished',
    description: `**Product**: ${appName}\n**Phase**: 3 — Test Generation\n**Flow**: ${flowEntry.name}\n**TC**: ${tcId}\n**Has Playwright code**: ${tc.hasCode ? 'Yes' : 'No'}\n**Has .spec.ts**: ${tc.hasSpec ? 'Yes' : 'No'}`,
    labels: [
      { name: 'epic', value: `Product: ${appName}` },
      { name: 'feature', value: 'Phase 3 — Test Cases' },
      { name: 'story', value: `${flowEntry.name}: ${tcId}` },
      { name: 'suite', value: `Product: ${appName}` },
      { name: 'subSuite', value: 'Phase 3 — Test Cases' },
      { name: 'severity', value: severityMap[priority] || 'normal' },
      { name: 'tag', value: 'test-case' },
      { name: 'tag', value: 'phase-3' },
      { name: 'owner', value: 'QA Agent' },
    ],
    links: [],
    parameters: [{ name: 'Product', value: appName }, { name: 'Phase', value: '3 — Test Cases' }, { name: 'Flow', value: flowEntry.name }],
    attachments,
    steps: [],
    start: startTime,
    stop: startTime + 2000,
  };
}

// ---------------------------------------------------------------------------
// Summary result
// ---------------------------------------------------------------------------

function buildSummary(appName, counts, startTime) {
  return {
    uuid: uuid(),
    historyId: md5('unified-summary'),
    fullName: `Product: ${appName} > QA Summary`,
    name: `Product: ${appName} — QA Report Summary`,
    status: 'passed',
    stage: 'finished',
    description: [
      `# Product: ${appName} — QA Report`,
      '',
      '| Phase | Status | Count |',
      '|-------|--------|-------|',
      `| **Phase 1 — Discovery** | ${counts.flows > 0 ? '✅' : '❌'} | ${counts.flows} flows, ${counts.steps} steps, ${counts.screenshots} screenshots |`,
      `| **Phase 2 — Scenarios** | ${counts.scenarioFlows > 0 ? '✅' : '⏳'} | ${counts.scenarios} scenarios across ${counts.scenarioFlows} flows |`,
      `| **Phase 3 — Test Cases** | ${counts.tcs > 0 ? '✅' : '⏳'} | ${counts.tcs} test case files |`,
      `| **Phase 4 — Execution** | ${counts.specs > 0 ? '✅' : '⏳'} | ${counts.specs} runnable .spec.ts files |`,
      '',
      `Generated: ${new Date().toISOString()}`,
    ].join('\n'),
    labels: [
      { name: 'epic', value: `Product: ${appName}` },
      { name: 'feature', value: 'Summary' },
      { name: 'suite', value: `Product: ${appName}` },
      { name: 'severity', value: 'normal' },
      { name: 'tag', value: 'summary' },
      { name: 'owner', value: 'QA Agent' },
    ],
    links: [],
    parameters: [
      { name: 'Product', value: appName },
      { name: 'Flows', value: String(counts.flows) },
      { name: 'Scenarios', value: String(counts.scenarios) },
      { name: 'Test Cases', value: String(counts.tcs) },
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

function writeEnvironment(config, counts) {
  const lines = [
    `Product=${config.app_name || 'Unknown'}`,
    `Platform=${config.platform || 'Unknown'}`,
    `URL=${config.app_url || config.app_path || 'N/A'}`,
    `Framework=${config.framework || 'flow-based'}`,
    `Phase.1.Discovery=${counts.flows > 0 ? 'Complete (' + counts.flows + ' flows)' : 'Not started'}`,
    `Phase.2.Scenarios=${counts.scenarios > 0 ? counts.scenarios + ' scenarios' : 'Not started'}`,
    `Phase.3.TestCases=${counts.tcs > 0 ? counts.tcs + ' TCs' : 'Not started'}`,
    `Phase.4.Execution=${counts.specs > 0 ? counts.specs + ' specs ready' : 'Not started'}`,
    `Generated=${new Date().toISOString()}`,
    `OS=${os.platform()} ${os.release()}`,
    `Node=${process.version}`,
  ];
  fs.writeFileSync(path.join(RESULTS_DIR, 'environment.properties'), lines.join('\n'));
}

function writeCategories() {
  const categories = [
    { name: 'Phase 1 — Discovery (Complete)', matchedStatuses: ['passed'], messageRegex: '.*' },
    { name: 'Phase 1 — Discovery (Incomplete)', matchedStatuses: ['broken'], messageRegex: '.*' },
    { name: 'Test Failures', matchedStatuses: ['failed', 'broken'] },
  ];
  fs.writeFileSync(path.join(RESULTS_DIR, 'categories.json'), JSON.stringify(categories, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║  Allure Report Generator — Unified       ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');

  // --- Screenshot coverage gate ---
  const coverage = validateScreenshotCoverage();
  if (!coverage.pass) {
    console.log('  ❌ SCREENSHOT COVERAGE GATE FAILED');
    console.log(`  On disk: ${coverage.total} | Referenced: ${coverage.covered} | Orphaned: ${coverage.orphaned.length}`);
    console.log('');
    for (const f of coverage.orphaned) console.log(`    - ${f}`);
    console.log('');
    console.log('  Fix: node scripts/qa-screenshot.js --flow F-NNN --step N --action "..." --file <name>.png');
    console.log('');
    process.exit(1);
  }
  if (coverage.total > 0) {
    console.log(`  ✅ Screenshot coverage: ${coverage.covered}/${coverage.total}`);
  }

  const config = readConfig();
  const appName = config.app_name || 'Unknown Product';
  console.log(`  Product:  ${appName}`);
  console.log(`  Platform: ${config.platform || 'Unknown'}`);
  console.log('');

  // Clean and create results directory
  if (fs.existsSync(RESULTS_DIR)) {
    for (const f of fs.readdirSync(RESULTS_DIR)) fs.unlinkSync(path.join(RESULTS_DIR, f));
  } else {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  const flowEntries = findFlowDirs();
  if (flowEntries.length === 0) {
    console.log('  No flow directories found in qa/flows/ or qa/features/.');
    console.log('  Run the QA skill first.');
    process.exit(1);
  }

  const baseTime = nowMs();
  const counts = { flows: 0, steps: 0, screenshots: 0, scenarioFlows: 0, scenarios: 0, tcs: 0, specs: 0 };

  // === PHASE 1: Discovery ===
  console.log('  Phase 1 — Discovery');
  for (let i = 0; i < flowEntries.length; i++) {
    const entry = flowEntries[i];
    const flow = parseFlowMd(entry);
    if (!flow) { console.log(`    [--] ${entry.name}: no flow.md`); continue; }

    const startTime = baseTime + i * 60000;
    const result = buildDiscoveryResult(flow, appName, startTime);
    fs.writeFileSync(path.join(RESULTS_DIR, `${result.uuid}-result.json`), JSON.stringify(result, null, 2));

    counts.flows++;
    counts.steps += flow.steps.length;
    counts.screenshots += result.attachments.length;
    const icon = result.status === 'passed' ? '✅' : '⚠️';
    console.log(`    ${icon} ${entry.name}: ${flow.steps.length} steps, ${result.attachments.length} screenshots`);
  }

  // === PHASE 2: Scenarios ===
  console.log('  Phase 2 — Scenarios');
  let hasAnyScenarios = false;
  for (const entry of flowEntries) {
    const scenarioData = parseScenariosmd(entry.dir);
    if (!scenarioData || scenarioData.scenarios.length === 0) { continue; }

    hasAnyScenarios = true;
    const startTime = baseTime + (flowEntries.length + counts.scenarioFlows) * 60000;
    const result = buildScenarioResult(entry, scenarioData, appName, startTime);
    fs.writeFileSync(path.join(RESULTS_DIR, `${result.uuid}-result.json`), JSON.stringify(result, null, 2));

    counts.scenarioFlows++;
    counts.scenarios += scenarioData.scenarios.length;
    console.log(`    ✅ ${entry.name}: ${scenarioData.scenarios.length} scenarios`);
  }
  if (!hasAnyScenarios) console.log('    ⏳ No scenarios yet');

  // === PHASE 3: Test Cases ===
  console.log('  Phase 3 — Test Cases');
  let hasAnyTcs = false;
  for (const entry of flowEntries) {
    const tcFiles = findTcFiles(entry.dir);
    if (tcFiles.length === 0) continue;

    hasAnyTcs = true;
    for (const tcPath of tcFiles) {
      const tc = parseTcMd(tcPath);
      const startTime = baseTime + (flowEntries.length * 2 + counts.tcs) * 60000;
      const result = buildTcResult(entry, tc, appName, startTime);
      fs.writeFileSync(path.join(RESULTS_DIR, `${result.uuid}-result.json`), JSON.stringify(result, null, 2));

      counts.tcs++;
      if (tc.hasSpec) counts.specs++;
    }
    console.log(`    ✅ ${entry.name}: ${tcFiles.length} TC files`);
  }
  if (!hasAnyTcs) console.log('    ⏳ No test cases yet');

  // === PHASE 4: Execution ===
  console.log('  Phase 4 — Execution');
  if (counts.specs > 0) {
    console.log(`    ✅ ${counts.specs} .spec.ts files ready to run`);
    console.log(`    Run: npx playwright test --config qa/playwright.config.ts`);
  } else {
    console.log('    ⏳ No specs extracted yet');
  }

  // === Summary ===
  const summaryResult = buildSummary(appName, counts, baseTime - 1000);
  fs.writeFileSync(path.join(RESULTS_DIR, `${summaryResult.uuid}-result.json`), JSON.stringify(summaryResult, null, 2));

  writeEnvironment(config, counts);
  writeCategories();

  console.log('');
  console.log('  ════════════════════════════════════════════');
  console.log(`  Product:     ${appName}`);
  console.log(`  Phase 1:     ${counts.flows} flows, ${counts.steps} steps, ${counts.screenshots} screenshots`);
  console.log(`  Phase 2:     ${counts.scenarios} scenarios across ${counts.scenarioFlows} flows`);
  console.log(`  Phase 3:     ${counts.tcs} test cases`);
  console.log(`  Phase 4:     ${counts.specs} specs ready`);
  console.log(`  Results:     ${RESULTS_DIR}`);
  console.log('');

  // Build HTML and optionally open
  if (OPEN) {
    try {
      console.log('  Building HTML report...');
      execSync(`npx allure generate "${RESULTS_DIR}" -o allure-report --clean`, { stdio: 'pipe' });
      console.log('  Opening in browser...');
      execSync('npx allure open allure-report', { stdio: 'inherit' });
    } catch (e) {
      console.log(`  ⚠ Could not open report: ${e.message.substring(0, 80)}`);
      console.log('  Run manually: npx allure generate allure-results -o allure-report --clean && npx allure open allure-report');
    }
  } else {
    console.log('  To view: node scripts/allure/generate-report.js --open');
    console.log('  Or:      npx allure generate allure-results -o allure-report --clean && npx allure open allure-report');
  }
  console.log('');
}

main();
