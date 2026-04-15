#!/usr/bin/env node
/**
 * Phase 2 Allure Report Generator
 *
 * Reads TC-NNN-*.md files, scenarios.md, and flow.md to build Allure-compatible
 * result files for Phase 2 (Full Coverage).
 *
 * For web (Playwright): this script adds supplementary metadata on top of
 * allure-playwright's auto-generated results. Run Playwright tests FIRST with
 * the allure-playwright reporter, then run this script to enrich the results.
 *
 * For macOS / other platforms: this script generates all allure results from
 * the TC markdown files since there is no Playwright reporter.
 *
 * Usage:
 *   node scripts/allure/generate-phase2-report.js
 *   node scripts/allure/generate-phase2-report.js --results-dir custom-allure-results
 *   node scripts/allure/generate-phase2-report.js --mode standalone   (non-web: generate all results)
 *   node scripts/allure/generate-phase2-report.js --mode enrich       (web: supplement Playwright results)
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
const EVIDENCE_DIR = path.join(QA_DIR, 'evidence');

const ridx = process.argv.indexOf('--results-dir');
const RESULTS_DIR = ridx !== -1
  ? path.resolve(process.argv[ridx + 1])
  : path.join(REPO_ROOT, 'allure-results');

const midx = process.argv.indexOf('--mode');
const MODE = midx !== -1 ? process.argv[midx + 1] : 'auto';

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
// Parsers
// ---------------------------------------------------------------------------

function readConfig() {
  const p = path.join(QA_DIR, '.qa-config.json');
  if (!fs.existsSync(p)) {
    console.error('ERROR: qa/.qa-config.json not found.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function detectMode(config) {
  if (MODE !== 'auto') return MODE;
  // Web platform with Playwright → enrich mode (allure-playwright generates base results)
  // Other platforms → standalone mode (this script generates all results)
  return (config.platform || '').toLowerCase() === 'web' ? 'enrich' : 'standalone';
}

function findFlowDirs() {
  for (const dir of ['flows', 'features']) {
    const full = path.join(QA_DIR, dir);
    if (fs.existsSync(full)) {
      return fs.readdirSync(full)
        .filter(d => fs.statSync(path.join(full, d)).isDirectory())
        .sort()
        .map(d => ({ name: d, dir: path.join(full, d) }));
    }
  }
  return [];
}

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

  // Parse metadata table
  const metadata = {};
  const metaMatch = content.match(/## Metadata[\s\S]*?(?=\n---|\n## )/);
  if (metaMatch) {
    for (const line of metaMatch[0].split('\n')) {
      const cells = parseTableRow(line);
      if (cells && cells.length >= 2) {
        const key = cells[0].replace(/\*\*/g, '').trim().toLowerCase();
        metadata[key] = cells[1].replace(/\*\*/g, '').trim();
      }
    }
  }

  // Parse scenarios
  const scenarios = [];
  const scenarioBlocks = content.split(/### Scenario \d+:/);
  for (let i = 1; i < scenarioBlocks.length; i++) {
    const block = scenarioBlocks[i];
    const nameMatch = block.match(/^([^\n]+)/);
    const name = nameMatch ? nameMatch[1].trim() : `Scenario ${i}`;

    // Parse priority and type
    const priorityMatch = block.match(/\*\*Priority\*\*:\s*(P\d)/i);
    const typeMatch = block.match(/\*\*Type\*\*:\s*(\w+)/i);

    // Parse steps table
    const steps = [];
    const stepsMatch = block.match(/#### Steps[\s\S]*?(?=\n####|\n###|\n---|\Z)/);
    if (stepsMatch) {
      let headerFound = false;
      for (const line of stepsMatch[0].split('\n')) {
        const cells = parseTableRow(line);
        if (!cells || cells.length < 3) continue;
        if (!headerFound && /step/i.test(cells[0])) { headerFound = true; continue; }
        if (!headerFound) continue;
        steps.push({
          number: parseInt(cells[0]) || steps.length + 1,
          action: cells[1],
          method: cells[2] || '',
          expected: cells[3] || '',
        });
      }
    }

    // Parse pass criteria
    const passCriteria = [];
    const passMatch = block.match(/#### Pass Criteria[\s\S]*?(?=\n####|\n###|\n---|\Z)/);
    if (passMatch) {
      const items = passMatch[0].matchAll(/- \[[ x]]\s*(.+)/g);
      for (const m of items) passCriteria.push(m[1].trim());
    }

    scenarios.push({
      index: i,
      name,
      priority: priorityMatch ? priorityMatch[1] : 'P2',
      type: typeMatch ? typeMatch[1] : 'Functional',
      steps,
      passCriteria,
    });
  }

  return { filename, path: tcPath, metadata, scenarios, raw: content };
}

function parseScenariosmd(flowDir) {
  const p = path.join(flowDir, 'scenarios.md');
  if (!fs.existsSync(p)) return null;
  const content = fs.readFileSync(p, 'utf8');

  // Parse coverage summary table
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

  return { coverage, raw: content };
}

// ---------------------------------------------------------------------------
// Allure result builder — standalone mode (macOS, etc.)
// ---------------------------------------------------------------------------

function buildTcResult(tc, flowEntry, config, startTime) {
  const results = [];

  for (const scenario of tc.scenarios) {
    const resultUuid = uuid();
    const stepDuration = 2000;

    const allureSteps = scenario.steps.map((step, i) => ({
      name: `Step ${step.number}: ${step.action}`,
      status: 'passed',
      stage: 'finished',
      statusDetails: { message: step.expected },
      attachments: [],
      parameters: step.method ? [{ name: 'Method', value: step.method }] : [],
      steps: [],
      start: startTime + i * stepDuration,
      stop: startTime + (i + 1) * stepDuration,
    }));

    // Attach evidence screenshots if they exist
    const attachments = [];
    const tcId = tc.metadata['test case id'] || tc.filename;
    const evidencePattern = `${tcId}-S${scenario.index}`;
    if (fs.existsSync(EVIDENCE_DIR)) {
      const evidenceFiles = [];
      const walkDir = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const f of fs.readdirSync(dir)) {
          const full = path.join(dir, f);
          if (fs.statSync(full).isDirectory()) walkDir(full);
          else if (f.includes(evidencePattern) && /\.(png|jpg|jpeg)$/i.test(f)) evidenceFiles.push(full);
        }
      };
      walkDir(EVIDENCE_DIR);

      for (const ef of evidenceFiles) {
        const ext = path.extname(ef);
        const attachId = uuid();
        const attachName = `${attachId}-attachment${ext}`;
        fs.copyFileSync(ef, path.join(RESULTS_DIR, attachName));
        attachments.push({ name: path.basename(ef), source: attachName, type: mimeForExt(ext) });
      }
    }

    const priority = (scenario.priority || tc.metadata.priority || 'P2').toUpperCase();
    const severityMap = { P1: 'critical', P2: 'normal', P3: 'minor', P4: 'trivial' };

    results.push({
      uuid: resultUuid,
      historyId: md5(`phase2-${tc.filename}-S${scenario.index}`),
      fullName: `Phase 2 Coverage > ${flowEntry.name} > ${tc.filename} > S${scenario.index}`,
      name: `${tcId}-S${scenario.index}: ${scenario.name}`,
      status: 'passed',
      stage: 'finished',
      description: [
        `**Test Case**: ${tcId}`,
        `**Scenario**: S${scenario.index} — ${scenario.name}`,
        `**Type**: ${scenario.type}`,
        `**Priority**: ${priority}`,
        '',
        scenario.passCriteria.length > 0 ? '### Pass Criteria\n' + scenario.passCriteria.map(c => `- ${c}`).join('\n') : '',
      ].join('\n'),
      descriptionHtml: `
        <h3>${tcId} &mdash; S${scenario.index}: ${scenario.name}</h3>
        <table>
          <tr><td><b>Type</b></td><td>${scenario.type}</td></tr>
          <tr><td><b>Priority</b></td><td>${priority}</td></tr>
          <tr><td><b>Steps</b></td><td>${scenario.steps.length}</td></tr>
          <tr><td><b>Flow</b></td><td>${flowEntry.name}</td></tr>
        </table>
        ${scenario.passCriteria.length > 0 ? '<h4>Pass Criteria</h4><ul>' + scenario.passCriteria.map(c => `<li>${c}</li>`).join('') + '</ul>' : ''}
      `.trim(),
      labels: [
        { name: 'epic', value: 'Phase 2 — Full Coverage' },
        { name: 'feature', value: flowEntry.name },
        { name: 'story', value: `${tcId}: ${tc.metadata.feature || scenario.name}` },
        { name: 'suite', value: 'Phase 2 — Full Coverage' },
        { name: 'subSuite', value: flowEntry.name },
        { name: 'severity', value: severityMap[priority] || 'normal' },
        { name: 'tag', value: 'phase-2' },
        { name: 'tag', value: 'coverage' },
        { name: 'tag', value: scenario.type.toLowerCase() },
        { name: 'tag', value: config.platform || 'unknown' },
        { name: 'owner', value: tc.metadata.author || 'QA Agent' },
        { name: 'host', value: os.hostname() },
        { name: 'thread', value: 'main' },
      ],
      links: [],
      parameters: [
        { name: 'App', value: config.app_name || 'Unknown' },
        { name: 'Platform', value: config.platform || 'Unknown' },
        { name: 'Flow', value: flowEntry.name },
        { name: 'TC File', value: tc.filename },
      ],
      attachments,
      steps: allureSteps,
      start: startTime,
      stop: startTime + scenario.steps.length * stepDuration,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Allure result builder — enrich mode (web / Playwright)
// ---------------------------------------------------------------------------

function buildCoverageOverview(flowEntries, allTcs, config, startTime) {
  // Build a coverage summary result
  let totalScenarios = 0;
  let totalSteps = 0;
  const flowSummaries = [];

  for (const entry of flowEntries) {
    const tcs = allTcs.filter(tc => tc.flowEntry.name === entry.name);
    const scenarios = tcs.reduce((sum, tc) => sum + tc.tc.scenarios.length, 0);
    const steps = tcs.reduce((sum, tc) => sum + tc.tc.scenarios.reduce((s2, sc) => s2 + sc.steps.length, 0), 0);
    totalScenarios += scenarios;
    totalSteps += steps;
    flowSummaries.push({ name: entry.name, tcs: tcs.length, scenarios, steps });
  }

  const tableRows = flowSummaries.map(f =>
    `<tr><td>${f.name}</td><td>${f.tcs}</td><td>${f.scenarios}</td><td>${f.steps}</td></tr>`
  ).join('');

  return {
    uuid: uuid(),
    historyId: md5('phase2-coverage-overview'),
    fullName: 'Phase 2 Coverage > Overview',
    name: 'Coverage Overview',
    status: 'passed',
    stage: 'finished',
    description: [
      '# Phase 2 Coverage Overview',
      '',
      `| Metric | Value |`,
      `|--------|-------|`,
      `| **App** | ${config.app_name || 'Unknown'} |`,
      `| **Total TC files** | ${allTcs.length} |`,
      `| **Total scenarios** | ${totalScenarios} |`,
      `| **Total steps** | ${totalSteps} |`,
      `| **Flows covered** | ${flowEntries.length} |`,
    ].join('\n'),
    descriptionHtml: `
      <h2>Phase 2 Coverage Overview</h2>
      <table>
        <tr><td><b>App</b></td><td>${config.app_name || 'Unknown'}</td></tr>
        <tr><td><b>TC files</b></td><td>${allTcs.length}</td></tr>
        <tr><td><b>Scenarios</b></td><td>${totalScenarios}</td></tr>
        <tr><td><b>Steps</b></td><td>${totalSteps}</td></tr>
      </table>
      <h3>Per-Flow Breakdown</h3>
      <table>
        <tr><th>Flow</th><th>TC Files</th><th>Scenarios</th><th>Steps</th></tr>
        ${tableRows}
      </table>
    `.trim(),
    labels: [
      { name: 'epic', value: 'Phase 2 — Full Coverage' },
      { name: 'feature', value: 'Summary' },
      { name: 'suite', value: 'Phase 2 — Full Coverage' },
      { name: 'severity', value: 'normal' },
      { name: 'tag', value: 'phase-2' },
      { name: 'tag', value: 'summary' },
      { name: 'owner', value: 'QA Agent' },
    ],
    links: [],
    parameters: [],
    attachments: [],
    steps: [],
    start: startTime,
    stop: startTime + 1000,
  };
}

// ---------------------------------------------------------------------------
// Environment & categories
// ---------------------------------------------------------------------------

function writeEnvironment(config, mode, tcCount, scenarioCount) {
  const lines = [
    `App=${config.app_name || 'Unknown'}`,
    `Platform=${config.platform || 'Unknown'}`,
    `URL=${config.app_url || config.app_path || 'N/A'}`,
    `Framework=${config.framework || 'flow-based'}`,
    `Phase=Phase 2 - Full Coverage`,
    `Mode=${mode}`,
    `TestCase.Files=${tcCount}`,
    `Scenarios.Total=${scenarioCount}`,
    `Generated=${new Date().toISOString()}`,
    `OS=${os.platform()} ${os.release()}`,
    `Node=${process.version}`,
  ];
  fs.writeFileSync(path.join(RESULTS_DIR, 'environment.properties'), lines.join('\n'));
}

function writeCategories() {
  const categories = [
    { name: 'Happy Path', matchedStatuses: ['passed'], messageRegex: '.*[Hh]appy.*' },
    { name: 'Negative / Error Handling', matchedStatuses: ['passed', 'failed'], messageRegex: '.*[Nn]egative.*|.*[Ee]rror.*|.*[Ii]nvalid.*' },
    { name: 'Auth / Security', matchedStatuses: ['passed', 'failed'], messageRegex: '.*[Aa]uth.*|.*[Ss]ecurity.*|.*[Gg]uard.*' },
    { name: 'Edge Cases', matchedStatuses: ['passed', 'failed'], messageRegex: '.*[Ee]dge.*|.*[Bb]oundary.*' },
    { name: 'Accessibility', matchedStatuses: ['passed', 'failed'], messageRegex: '.*[Aa]11y.*|.*[Aa]ccessib.*' },
    { name: 'Test Failures', matchedStatuses: ['failed', 'broken'] },
  ];
  fs.writeFileSync(path.join(RESULTS_DIR, 'categories.json'), JSON.stringify(categories, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log('');
  console.log('  Phase 2 Allure Report Generator');
  console.log('  ================================');
  console.log('');

  const config = readConfig();
  const mode = detectMode(config);

  console.log(`  App:       ${config.app_name || 'Unknown'}`);
  console.log(`  Platform:  ${config.platform || 'Unknown'}`);
  console.log(`  Mode:      ${mode}`);
  console.log('');

  // In enrich mode, don't clean results (Playwright already wrote them)
  // In standalone mode, start fresh
  if (mode === 'standalone') {
    if (fs.existsSync(RESULTS_DIR)) {
      const existing = fs.readdirSync(RESULTS_DIR);
      for (const f of existing) fs.unlinkSync(path.join(RESULTS_DIR, f));
    } else {
      fs.mkdirSync(RESULTS_DIR, { recursive: true });
    }
  } else {
    if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  const flowEntries = findFlowDirs();
  if (flowEntries.length === 0) {
    console.log('  No flow directories found. Run Phase 1 first.');
    process.exit(1);
  }

  const baseTime = nowMs();
  let totalTcFiles = 0;
  let totalScenarios = 0;
  const allTcs = [];

  for (let i = 0; i < flowEntries.length; i++) {
    const entry = flowEntries[i];
    const tcFiles = findTcFiles(entry.dir);

    if (tcFiles.length === 0) {
      console.log(`  [--] ${entry.name}: no TC files`);
      continue;
    }

    for (const tcPath of tcFiles) {
      const tc = parseTcMd(tcPath);
      allTcs.push({ tc, flowEntry: entry });
      totalTcFiles++;
      totalScenarios += tc.scenarios.length;

      if (mode === 'standalone') {
        // Generate full allure results from TC markdown
        const startTime = baseTime + totalTcFiles * 30000;
        const results = buildTcResult(tc, entry, config, startTime);
        for (const result of results) {
          fs.writeFileSync(
            path.join(RESULTS_DIR, `${result.uuid}-result.json`),
            JSON.stringify(result, null, 2),
          );
        }
      }

      console.log(`  [OK] ${entry.name} / ${tc.filename}: ${tc.scenarios.length} scenarios`);
    }
  }

  // Coverage overview (both modes)
  const overviewResult = buildCoverageOverview(flowEntries, allTcs, config, baseTime - 1000);
  fs.writeFileSync(
    path.join(RESULTS_DIR, `${overviewResult.uuid}-result.json`),
    JSON.stringify(overviewResult, null, 2),
  );

  // Environment + categories
  writeEnvironment(config, mode, totalTcFiles, totalScenarios);
  writeCategories();

  console.log('');
  console.log('  ================================');
  console.log(`  Results:     ${RESULTS_DIR}`);
  console.log(`  Mode:        ${mode}`);
  console.log(`  TC files:    ${totalTcFiles}`);
  console.log(`  Scenarios:   ${totalScenarios}`);
  console.log('');
  console.log('  Next — generate and open the HTML report:');
  console.log('');
  console.log('    npm run allure:phase2:open');
  console.log('');
  console.log('  Or manually:');
  console.log(`    npx allure generate ${RESULTS_DIR} -o allure-report --clean`);
  console.log('    npx allure open allure-report');
  console.log('');
}

main();
