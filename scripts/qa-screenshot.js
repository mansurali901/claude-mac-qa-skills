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
// DOM extraction
// =========================================================================

/**
 * Extract all visible interactive elements from the current page state.
 * Saved as a .dom.json sidecar alongside every screenshot.
 * Callers (login-engage, signup-engage, BFS) can read this instead of
 * running their own page.evaluate() — one less round-trip, consistent schema.
 */
/**
 * extractDOM - Agent-Optimized Tiered DOM Extraction
 *
 * Philosophy:
 *   Screenshot -> what does the page look like
 *   DOM        -> how do I interact with it (selectors + state only, no visual info)
 *
 * Tiers:
 *   'minimal'  ~80-150 tokens   - after each step, page state check
 *   'action'   ~300-600 tokens  - before click/type/select; includes inputs, buttons, links
 *   'full'     ~2000-4000 tokens - debug or complex multi-form pages
 *
 * Usage:
 *   const dom = await extractDOM(page)              // default: 'action'
 *   const dom = await extractDOM(page, 'minimal')
 *   const dom = await extractDOM(page, 'full')
 */
async function extractDOM(playwrightPage, tier = 'action') {
  try {
    return await playwrightPage.evaluate((tier) => {

      // -----------------------------------------------------------
      // HELPERS
      // -----------------------------------------------------------

      const getCssPath = el => {
        if (!el) return '';
        if (el.id) return `#${el.id}`;
        const parts = [];
        let node = el;
        while (node.nodeType === Node.ELEMENT_NODE && node.tagName.toLowerCase() !== 'html') {
          if (node.id) { parts.unshift(`#${node.id}`); break; }
          let seg = node.tagName.toLowerCase();
          if (node.className && typeof node.className === 'string' && node.className.trim()) {
            seg += '.' + node.className.trim().split(/\s+/).slice(0, 2).join('.');
          } else {
            let sib = node, nth = 1;
            while ((sib = sib.previousElementSibling)) nth++;
            seg += `:nth-child(${nth})`;
          }
          parts.unshift(seg);
          node = node.parentNode;
        }
        const path = parts.join(' > ');
        if (path.length <= 120) return path;
        const cut = path.lastIndexOf(' > ', 120);
        return cut > 0 ? path.slice(0, cut) : path.slice(0, 120);
      };

      const getSel = el =>
        el.getAttribute('data-testid') ||
        el.getAttribute('data-test')   ||
        el.getAttribute('data-cy')     ||
        (el.id ? `#${el.id}` : getCssPath(el));

      const isVisible = el => {
        if (el.getAttribute('aria-hidden') === 'true') return false;
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        return (
          r.width > 0 && r.height > 0 &&
          s.visibility !== 'hidden' &&
          s.display     !== 'none'   &&
          s.opacity     !== '0'      &&
          el.offsetParent !== null
        );
      };

      const inViewport = el => {
        const r = el.getBoundingClientRect();
        return (
          r.top  < window.innerHeight && r.bottom > 0 &&
          r.left < window.innerWidth  && r.right  > 0
        );
      };

      const isInView = el => isVisible(el) && inViewport(el);

      const resolveLabel = el => {
        const al = el.getAttribute('aria-label');
        if (al) return al.trim().slice(0, 60);

        const alby = el.getAttribute('aria-labelledby');
        if (alby) {
          const ref = document.getElementById(alby);
          if (ref) return ref.textContent.trim().slice(0, 60);
        }

        if (el.id) {
          const lbl = document.querySelector(`label[for="${el.id}"]`);
          if (lbl) return lbl.textContent.trim().slice(0, 60);
        }
        return '';
      };

      const getPageState = () => {
        if (document.querySelector(
          '[aria-busy="true"], .spinner, [class*="skeleton"], [class*="shimmer"], [class*="loading"]'
        )) return 'loading';
        if (document.querySelector('.error-page, [class*="error-boundary"]'))
          return 'error';
        return 'ready';
      };

      const getErrors = (filterFn = isVisible) =>
        Array.from(document.querySelectorAll(
          '[aria-invalid="true"], [role="alert"], .alert-danger, [class*="error-message"], [class*="field-error"]'
        ))
        .filter(filterFn)
        .map(el => ({ text: el.textContent.trim().slice(0, 100), sel: getSel(el) }))
        .filter(e => e.text);

      // -----------------------------------------------------------
      // TIER 1 - MINIMAL
      // -----------------------------------------------------------

      const buildMinimal = () => ({
        tier:  'minimal',
        url:   location.href,
        title: document.title,
        ts:    Date.now(),
        state: getPageState(),

        viewport: {
          w:          window.innerWidth,
          h:          window.innerHeight,
          scrollY:    window.scrollY,
          pageH:      document.body.scrollHeight,
          scrollable: document.body.scrollHeight > window.innerHeight
        },

        modal:   !!document.querySelector('[role="dialog"]:not([hidden])'),
        focused: document.activeElement ? getSel(document.activeElement) : null,

        alerts: Array.from(document.querySelectorAll('[role="alert"],[role="status"]'))
          .filter(isVisible)
          .map(el => el.textContent.trim().slice(0, 100))
          .filter(Boolean),

        errors: getErrors()
      });

      // -----------------------------------------------------------
      // TIER 2 - ACTION
      // -----------------------------------------------------------

      const buildAction = () => {
        const base = buildMinimal();

        const inputs = Array.from(document.querySelectorAll('input:not([type=hidden])'))
          .filter(isInView)
          .map(el => {
            const o = { sel: getSel(el), type: el.type || 'text' };
            const label = resolveLabel(el);
            if (label)    o.label    = label;
            if (el.required || el.getAttribute('aria-required') === 'true') o.required = true;
            if (el.disabled) o.disabled = true;
            if (el.getAttribute('aria-invalid') === 'true') o.invalid = true;
            if (el.type !== 'password' && el.value) o.value = el.value;
            if (el.type === 'checkbox' || el.type === 'radio') o.checked = el.checked;
            if (el.placeholder) o.placeholder = el.placeholder.slice(0, 50);
            if (el.pattern)     o.pattern = el.pattern;
            if (el.min)         o.min = el.min;
            if (el.max)         o.max = el.max;
            if (el.name)        o.name = el.name;
            return o;
          });

        const selects = Array.from(document.querySelectorAll('select'))
          .filter(isInView)
          .map(el => {
            const o = { sel: getSel(el) };
            const label = resolveLabel(el);
            if (label) o.label = label;
            if (el.required || el.getAttribute('aria-required') === 'true') o.required = true;
            if (el.disabled) o.disabled = true;
            const cur = el.options[el.selectedIndex]?.text || '';
            if (cur) o.current = cur;
            o.options = el.options.length <= 15
              ? Array.from(el.options).map(opt => ({ v: opt.value, t: opt.text, on: opt.selected || undefined }))
              : `${el.options.length} options - use tier:full`;
            return o;
          });

        const textareas = Array.from(document.querySelectorAll('textarea'))
          .filter(isInView)
          .map(el => {
            const o = { sel: getSel(el) };
            const label = resolveLabel(el);
            if (label) o.label = label;
            if (el.required || el.getAttribute('aria-required') === 'true') o.required = true;
            if (el.disabled) o.disabled = true;
            if (el.value) o.value = el.value.slice(0, 200);
            if (el.placeholder) o.placeholder = el.placeholder.slice(0, 50);
            return o;
          });

        const buttons = Array.from(document.querySelectorAll(
          'button, input[type=submit], input[type=button], input[type=reset], [role="button"]'
        ))
          .filter(isInView)
          .map(el => {
            const text = (el.textContent || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 80);
            if (!text) return null;
            const o = { sel: getSel(el), text };
            const type = el.type || el.getAttribute('role') || 'button';
            if (type !== 'button') o.type = type;
            if (el.disabled || el.getAttribute('aria-disabled') === 'true') o.disabled = true;
            return o;
          })
          .filter(Boolean);

        const ariaWidgets = Array.from(document.querySelectorAll(
          '[role="listbox"],[role="combobox"],[role="tablist"],[role="menu"],[role="tree"],[role="grid"]'
        ))
          .filter(isInView)
          .map(el => ({
            sel:      getSel(el),
            role:     el.getAttribute('role'),
            label:    resolveLabel(el),
            expanded: el.getAttribute('aria-expanded') || null,
            disabled: el.getAttribute('aria-disabled') === 'true' || null
          }))
          .map(w => Object.fromEntries(Object.entries(w).filter(([, v]) => v !== null)));

        const images = Array.from(document.querySelectorAll('img, svg'))
          .filter(el => {
            if (!isInView(el)) return false;
            const r = el.getBoundingClientRect();
            if (el.tagName === 'svg' && r.width < 40 && !el.getAttribute('aria-label')) return false;
            return !!(
              el.onclick ||
              el.closest('a, button, [role="button"]') ||
              el.getAttribute('alt') ||
              el.getAttribute('aria-label')
            );
          })
          .map(el => ({
            sel:      getSel(el),
            alt:      el.getAttribute('alt') || el.getAttribute('aria-label') || '',
            clickable: !!(el.onclick || el.closest('a, button, [role="button"]'))
          }));

        const seenHrefs = new Set();
        const links = Array.from(document.querySelectorAll('a, [role="link"]'))
          .filter(isInView)
          .map(el => ({
            text: (el.textContent || '').trim().slice(0, 80),
            href: el.getAttribute('href') || '',
            label: el.getAttribute('aria-label') || ''
          }))
          .filter(l => {
            if (!l.href || l.href.startsWith('#')) return false;
            if (!l.text && !l.label) return false;
            if (seenHrefs.has(l.href)) return false;
            seenHrefs.add(l.href);
            return true;
          })
          .slice(0, 20);

        return {
          ...base,
          tier: 'action',
          inputs,
          selects,
          textareas,
          buttons,
          ...(links.length       && { links }),
          ...(ariaWidgets.length && { ariaWidgets }),
          ...(images.length      && { images })
        };
      };

      // -----------------------------------------------------------
      // TIER 3 - FULL
      // -----------------------------------------------------------

      const buildFull = () => {
        const base = buildAction();

        const allInputs = Array.from(document.querySelectorAll('input:not([type=hidden])'))
          .filter(isVisible)
          .map(el => ({
            sel:      getSel(el),
            type:     el.type || 'text',
            label:    resolveLabel(el),
            required: el.required || el.getAttribute('aria-required') === 'true',
            disabled: el.disabled,
            invalid:  el.getAttribute('aria-invalid') === 'true',
            value:    el.type === 'password' ? '' : (el.value || ''),
            ...(( el.type === 'checkbox' || el.type === 'radio') && { checked: el.checked })
          }));

        const seenHrefs = new Set();
        const links = Array.from(document.querySelectorAll('a, [role="link"]'))
          .filter(isVisible)
          .map(el => ({
            text:  (el.textContent || '').trim().slice(0, 80),
            href:  el.getAttribute('href') || '',
            label: el.getAttribute('aria-label') || ''
          }))
          .filter(l => {
            if (!l.href || l.href.startsWith('#')) return false;
            if (!l.text && !l.label) return false;
            if (seenHrefs.has(l.href)) return false;
            seenHrefs.add(l.href);
            return true;
          });

        const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
          .filter(isVisible)
          .map(el => ({ lvl: el.tagName, text: el.textContent.trim().slice(0, 80) }));

        const forms = Array.from(document.querySelectorAll('form'))
          .filter(isVisible)
          .map(f => ({
            sel:    getSel(f),
            id:     f.id || '',
            inputs: f.querySelectorAll('input:not([type=hidden])').length,
            action: f.getAttribute('action') || ''
          }));

        const accordions = Array.from(document.querySelectorAll(
          'details, [aria-expanded][role], [role="region"]'
        ))
          .filter(isVisible)
          .map(el => ({
            sel:  getSel(el),
            text: el.textContent.trim().slice(0, 80),
            open: el.tagName === 'DETAILS'
              ? el.open
              : el.getAttribute('aria-expanded') === 'true'
          }));

        const selectsFull = Array.from(document.querySelectorAll('select'))
          .filter(isVisible)
          .map(el => ({
            sel:     getSel(el),
            label:   resolveLabel(el),
            options: Array.from(el.options).map(o => ({ v: o.value, t: o.text, on: o.selected || undefined }))
          }));

        return {
          ...base,
          tier: 'full',
          allInputs,
          links,
          headings,
          forms,
          accordions,
          selectsFull
        };
      };

      if (tier === 'minimal') return buildMinimal();
      if (tier === 'full')    return buildFull();
      return buildAction();

    }, tier);

  } catch (err) {
    return {
      tier,
      url: '', title: '', ts: Date.now(),
      state: 'error', error: err.message,
      modal: false, focused: null,
      alerts: [], errors: [],
      inputs: [], selects: [], textareas: [], buttons: []
    };
  }
}


// =========================================================================
// Module API: capture(page, opts)
// =========================================================================

/**
 * Atomic: screenshot + DOM snapshot + flow.md registration.
 *
 * Writes two files per call:
 *   qa/knowledgebase/screenshots/<file>          ← PNG
 *   qa/knowledgebase/screenshots/<file>.dom.json ← inputs, buttons, links
 *
 * Returns { path, domPath, dom, file, registered, flowMd }
 * Use dom.inputs / dom.buttons / dom.links directly — no extra page.evaluate() needed.
 */
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
  const domPath = screenshotPath + '.dom.json';

  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  // 1. Screenshot + DOM snapshot in parallel — same page state
  const [, dom] = await Promise.all([
    playwrightPage.screenshot({ path: screenshotPath, fullPage }),
    extractDOM(playwrightPage),
  ]);
  fs.writeFileSync(domPath, JSON.stringify(dom, null, 2));

  // 2. Register in flow.md
  const result = appendEvidence(flow, step, action, file, observed || '(pending visual analysis)', page);

  return {
    path: screenshotPath,
    domPath,
    dom,
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

module.exports = { capture, extractDOM, appendEvidence, findFlowDir, audit, parseMarkdownTable };

if (require.main === module) {
  cli();
}
