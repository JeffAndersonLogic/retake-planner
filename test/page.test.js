#!/usr/bin/env node
/**
 * page.test.js
 *
 * The Retake Planner page in Chromium.
 *
 * What it proves:
 *   - the page asks nothing of any host: the only requests are its own four files, its
 *     two brand fonts and its logo images, all on this site, and its security policy refuses anything else (a fetch from the page is
 *     blocked, which the test proves by trying one);
 *   - the invented demo loads, matches every question and counts every student;
 *   - the heat map has one row per student and one right-or-wrong square per question,
 *     and its wrong squares agree with By student; the class report groups by topic,
 *     and by learning target when asked;
 *   - the retake prompts: one per student who missed something, no names in any,
 *     the question count honoured, hidden on the projector, and the class prompt
 *     reaches the clipboard;
 *   - the Canvas file alone, in the Student Analysis shape with no name column,
 *     gives a heat map by question;
 *   - class periods: one file per period, each named by the teacher, combine into one
 *     plan; choosing a class narrows every view; students sort by class, name or
 *     score; the report compares classes; renaming or removing a file updates it;
 *   - two files chosen through the file picker, in either order and in the
 *     one-row-per-answer layout, give the same plan as the demo's other layout;
 *   - a file that is not a question map is refused with a reason, not drawn;
 *   - projector safe leaves no student name and no question or answer wording on
 *     the results, and turning it off brings the names back (the check can fail);
 *   - the downloaded plan is a CSV with one row per student per target;
 *   - "missed most" never lists more students than "missed any";
 *   - no console error and no security-policy violation;
 *   - it fits a phone without sideways scrolling.
 *
 *   npm ci
 *   npm run test:browser
 */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright-core')); }
catch (e) {
  console.error('This test needs the pinned playwright-core dependency. Install it first:\n  npm ci');
  process.exit(2);
}

const ROOT = path.resolve(__dirname, '..');
const EXE = process.env.PW_CHROME || (function () {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const dir = (fs.existsSync(base) ? fs.readdirSync(base) : [])
    .filter(d => /^chromium-\d+$/.test(d)).sort().pop();
  const found = dir && ['chrome-linux', 'chrome-linux64'].map(d => path.join(base, dir, d, 'chrome')).find(f => fs.existsSync(f));
  return found || (fs.existsSync(path.join(base, 'chromium')) ? path.join(base, 'chromium') : undefined);
})();
const E = require(path.join(ROOT, 'retake-planner-engine.js'));
const SHOTS = process.env.SHOTS || '';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// Invented test files, written to a temporary folder: never committed, never real.
function fixtures(dir) {
  const targets = { 'X.1 LT1': 'I can explain invented idea one.', 'X.1 LT2': 'I can explain invented idea two.', 'X.2 LT1': 'I can compare invented cases.' };
  const lts = Object.keys(targets);
  const questions = [];
  for (let n = 1; n <= 6; n += 1) {
    questions.push({ n, lt: lts[(n - 1) % 3], stem: 'Fixture question ' + n, options: [1, 2, 3, 4].map(k => 'Fixture ' + n + ' option ' + k), answer: n % 4, points: 1, rationale: 'Fixture reason ' + n });
  }
  const map = { format: E.MAP_FORMAT, title: 'Fixture test', version: '1', targets, questions };
  const people = ['Pat Fixture', 'Sam Fixture', 'Lee Fixture'];
  const long = [['Student Name', 'Student ID', 'Section', 'Attempt', 'Item Position', 'Question Text', 'Answer', 'Points Received', 'Points Possible', 'Status']];
  people.forEach((p, s) => questions.forEach((q, i) => {
    const miss = (s + i) % 3 === 0;
    long.push([p, String(s + 1), 'Period 2', '1', String(6 - i), q.stem, q.options[miss ? (q.answer + 1) % 4 : q.answer], miss ? '0' : '1', '1', 'Graded']);
  }));
  // The New Quizzes Student Analysis shape (seen 2026-11-23), with no name column.
  const block = [[]];
  questions.forEach(q => block[0].push('Status', 'ItemID', 'ItemType', q.stem, 'EarnedPoints'));
  block[0].push('Status', 'NumberOfCorrect', 'NumberOfIncorrect', 'NoResponse', 'PointsPossible', 'OverallScore', '', '');
  let blockMisses = 0;
  people.forEach((p, s) => {
    const r = [];
    questions.forEach((q, i) => {
      const miss = (s + i) % 3 === 1;
      if (miss) blockMisses += 1;
      r.push('Graded', 'item-' + i, 'Multiple Choice', q.options[miss ? (q.answer + 2) % 4 : q.answer], miss ? '0' : '1');
    });
    r.push('Submitted', '', '', '', '6', '', '', '');
    block.push(r);
  });
  const blockFile = path.join(dir, 'Fixture Quiz Student Analysis Report.csv');
  fs.writeFileSync(blockFile, block.map(r => r.map(E.csvCell).join(',')).join('\n'));
  // Two class periods, one file each, in the long layout with named students.
  const periodFile = (who, name) => {
    const rows = [['Student Name', 'Student ID', 'Attempt', 'Item Position', 'Question Text', 'Answer', 'Points Received', 'Points Possible', 'Status']];
    who.forEach((p, s) => questions.forEach((q, i) => {
      const miss = (s * 2 + i) % 4 === 0;
      rows.push([p, name + s, '1', String(i + 1), q.stem, q.options[miss ? (q.answer + 1) % 4 : q.answer], miss ? '0' : '1', '1', 'Graded']);
    }));
    const f = path.join(dir, name);
    fs.writeFileSync(f, rows.map(r => r.map(E.csvCell).join(',')).join('\n'));
    return f;
  };
  const periodA = periodFile(['Ada Fixture', 'Bo Fixture', 'Cy Fixture'], 'Period 2 Student Analysis Report.csv');
  const periodB = periodFile(['Di Fixture', 'Ed Fixture', 'Flo Fixture'], 'Per 5 Student Analysis Report.csv');
  const mapFile = path.join(dir, 'Fixture-Retake-Map.json');
  const csvFile = path.join(dir, 'Fixture Student Analysis Report.csv');
  const notMap = path.join(dir, 'something-else.json');
  fs.writeFileSync(mapFile, JSON.stringify(map));
  fs.writeFileSync(csvFile, long.map(r => r.map(E.csvCell).join(',')).join('\r\n'));
  fs.writeFileSync(notMap, JSON.stringify({ hello: 'world' }));
  return { mapFile, csvFile, notMap, people, blockFile, blockMisses, periodA, periodB };
}

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log('  PASS  ' + name); }
  catch (e) { failed += 1; console.log('  FAIL  ' + name + '\n        ' + String(e && e.message || e).split('\n').join('\n        ')); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

(async () => {
  const server = await serve();
  const port = server.address().port;
  const origin = 'http://127.0.0.1:' + port;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'retake-planner-'));
  const fx = fixtures(tmp);
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const page = await ctx.newPage();
  const requests = [];
  const errors = [];
  page.on('request', r => requests.push(r.url()));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
  });
  await page.goto(origin + '/index.html', { waitUntil: 'load' });

  const resultsText = () => page.locator('#results').innerText();
  const allResultsText = () => page.evaluate(() => {
    // Every panel, the hidden tabs and closed details included.
    return [...document.querySelectorAll('#results [role=tabpanel]')].map(p => p.textContent).join('\n');
  });

  await check('the demo matches every question and counts every student', async () => {
    await page.click('#demo');
    await page.waitForSelector('#results:not([hidden])');
    const status = await page.locator('#status').innerText();
    assert(/Matched 8 of 8/.test(status), 'status: ' + status);
    assert(/Demo\./.test(status), 'the demo must say it is invented');
    assert(await page.locator('#s-students').innerText() === '12', 'students');
    assert(await page.locator('#view-targets table.report tbody tr').count() === 2, 'the report groups the demo\'s two topics');
    assert(/Topic D\.1/.test(await page.locator('#view-targets').textContent()), 'topics named');
    assert(/Avery Demo/.test(await allResultsText()), 'names show by default');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'retake-targets.png'), fullPage: true });
  });

  await check('the heat map: a row per student, a right-or-wrong square per question, agreeing with By student', async () => {
    assert(await page.locator('#view-heat').isVisible(), 'the heat map is the first view');
    assert(await page.locator('#view-heat tbody tr:not(.sec)').count() === 12, 'rows');
    assert(await page.locator('#view-heat tbody tr.sec').count() === 2, 'one heading per class (Green, Silver)');
    assert(await page.locator('#view-heat tbody td.cell').count() === 12 * 8, 'squares');
    const wrong = await page.locator('#view-heat tbody td.cell.wrong').count();
    const right = await page.locator('#view-heat tbody td.cell.right').count();
    assert(wrong > 0 && right > 0 && wrong + right === 96, 'every square is right or wrong: ' + right + ' + ' + wrong);
    // The same misses, counted from By student's "N missed".
    const missed = await page.evaluate(() => [...document.querySelectorAll('#view-students details summary')].reduce((t, el) => t + parseInt(el.textContent, 10), 0));
    assert(missed === wrong, 'heat map ' + wrong + ' wrong, By student ' + missed + ' missed');
    assert(await page.locator('#view-heat thead th.grp').count() === 2, 'columns grouped by topic');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'retake-heat.png'), fullPage: true });
  });

  await check('group by learning target, then back to topic', async () => {
    await page.click('#by button[data-v="lt"]');
    assert(await page.locator('#view-targets table.report tbody tr').count() === 4, 'four targets');
    assert(await page.locator('#view-heat thead th.grp').count() === 4, 'heat map regrouped');
    await page.click('#by button[data-v="topic"]');
    assert(await page.locator('#view-targets table.report tbody tr').count() === 2, 'negative control: back to two topics');
    // A bar's fill was once an inline element, which cannot take a width: every bar
    // drew empty with every other check green.
    await page.click('#tab-targets');
    const widths = await page.$$eval('#view-targets .bar .fill', els => els.map(e => e.getBoundingClientRect().width));
    assert(widths.length === 2 && widths.every(w => w > 20), 'the report bars are drawn: ' + widths.join(', '));
    await page.click('#tab-heat');
  });

  await check('retake prompts: one per student who missed something, no names, the count honoured', async () => {
    await page.click('#tab-prompts');
    const retake = Number(await page.locator('#s-retake').innerText());
    assert(await page.locator('#view-prompts .prompt').count() === retake, 'one prompt per student with something to retake');
    const prompts = await page.locator('#view-prompts pre.prompt-text').allTextContents();
    assert(prompts.length && prompts.every(p => !/[A-Z][a-z]+ Demo/.test(p)), 'a name is in a prompt');
    assert(prompts.every(p => /Write 3 new open-ended/.test(p)), 'three questions by default');
    await page.selectOption('#count', '5');
    assert((await page.locator('#view-prompts pre.prompt-text').first().textContent()).includes('Write 5 new'), 'the count changes the prompt');
    await page.click('#copy-class');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    assert(/=== Student \d+ ===/.test(clip) && /Write 5 new/.test(clip), 'class prompt copied: ' + clip.slice(0, 80));
    assert(!/[A-Z][a-z]+ Demo/.test(clip), 'a name is in the class prompt');
    await page.click('#style button[data-v="corrections"]');
    assert(/Write test corrections/.test(await page.locator('#view-prompts pre.prompt-text').first().textContent()), 'corrections');
    assert(await page.locator('#count-wrap').isHidden(), 'no count for corrections');
    await page.click('#style button[data-v="retake"]');
    await page.selectOption('#count', '3');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'retake-prompts.png'), fullPage: true });
    await page.click('#tab-heat');
  });

  await check('By student lists every student who took it', async () => {
    await page.click('#tab-students');
    assert(await page.locator('#view-students tbody tr').count() === 12, 'rows');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'retake-students.png'), fullPage: true });
    await page.click('#tab-questions');
    assert(await page.locator('#view-questions tbody tr').count() === 8, 'question rows');
    await page.click('#tab-targets');
  });

  await check('projector safe hides every name and every question or answer wording', async () => {
    await page.click('#names button[data-v="anon"]');
    const text = await allResultsText();
    assert(!/[A-Z][a-z]+ Demo/.test(text), 'a student name is still on the page');
    assert(!/invented choice/.test(text), 'an answer choice is still on the page');
    assert(!/Invented\. Real maps/.test(text), 'a rationale is still on the page');
    assert(/Student 1/.test(text), 'numbers replace names');
    // Negative control: the same check on the named view must find names.
    await page.click('#names button[data-v="show"]');
    assert(/[A-Z][a-z]+ Demo/.test(await allResultsText()), 'the name check cannot fail');
  });

  await check('the retake count and individual/class prompts follow the selected rule', async () => {
    const any = Number(await page.locator('#s-retake').innerText());
    await page.click('#rule button[data-v="most"]');
    const most = Number(await page.locator('#s-retake').innerText());
    assert(most <= any, most + ' > ' + any);
    assert(any > 0, 'the demo should have students to retake');
    await page.click('#tab-prompts');
    assert(await page.locator('#view-prompts .prompt').count() === most, 'prompts must agree with the retake counter');
    assert(/3 questions missed/.test(await page.locator('#view-prompts .prompt .target-head').innerText()), 'the card must count only qualifying misses, not all four');
    await page.click('#copy-class');
    const classText = await page.evaluate(() => navigator.clipboard.readText());
    assert((classText.match(/^=== Student /gm) || []).length === most, 'the class prompt must use the same students');
    await page.click('#rule button[data-v="any"]');
    assert(await page.locator('#view-prompts .prompt').count() === any, 'negative control: the looser rule has more prompts');
    await page.click('#tab-targets');
  });

  await check('the downloaded plan has one row per student per target', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
    const text = fs.readFileSync(await dl.path(), 'utf8').replace(/^﻿/, '');
    const rows = E.parseCsv(text);
    assert(rows[0][0] === 'student' && rows[0][4] === 'topic', 'header: ' + rows[0].join('|'));
    const students = new Set(rows.slice(1).map(r => r[0]));
    assert(students.size === 12, 'every student appears: ' + students.size);
  });

  await check('a file that is not a question map is refused with a reason', async () => {
    await page.click('#clear');
    await page.setInputFiles('#filepick', [fx.notMap]);
    await page.waitForFunction(() => document.getElementById('status').textContent.trim() !== '');
    const status = await page.locator('#status').innerText();
    assert(/not a Retake Planner question map/.test(status), status);
    assert(await page.locator('#results').isHidden(), 'nothing drawn');
  });

  await check('two chosen files, one row per answer, Canvas order reversed', async () => {
    await page.click('#clear');
    await page.setInputFiles('#filepick', [fx.csvFile]);
    await page.waitForFunction(() => document.getElementById('status').textContent.trim() !== '');
    // The Canvas file alone already gives results, by question.
    await page.waitForSelector('#results:not([hidden])');
    assert(/scored by Canvas/.test(await page.locator('#status').innerText()), 'the Canvas file alone is read');
    assert(await page.locator('#by-wrap').isHidden(), 'no grouping without a map');
    await page.setInputFiles('#filepick', [fx.mapFile]);
    await page.waitForFunction(() => /Matched/.test(document.getElementById('status').textContent));
    await page.waitForSelector('#results:not([hidden])');
    const status = await page.locator('#status').innerText();
    assert(/Matched 6 of 6/.test(status), status);
    assert(/one row per answer/.test(status), 'layout named');
    assert(await page.locator('#s-students').innerText() === '3', 'students');
    const text = await allResultsText();
    fx.people.forEach(p => assert(text.includes(p), p + ' missing'));
  });

  await check('the Canvas Student Analysis shape, no name column, no map: a heat map by question', async () => {
    await page.click('#clear');
    await page.setInputFiles('#filepick', [fx.blockFile]);
    await page.waitForSelector('#results:not([hidden])');
    const status = await page.locator('#status').innerText();
    assert(/Read 6 questions/.test(status), status);
    assert(/no student name column/.test(status), 'says why students are numbered');
    assert(await page.locator('#view-heat tbody tr').count() === 3, 'three students');
    assert(/Row 2/.test(await page.locator('#view-heat').textContent()), 'students by row');
    assert(await page.locator('#view-heat tbody td.cell.wrong').count() === fx.blockMisses, 'every miss is a red square');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'retake-canvas-only.png'), fullPage: true });
  });

  await check('Standards: the class table and each student agree, and projector safe hides names', async () => {
    await page.click('#clear');
    await page.click('#demo');
    await page.waitForSelector('#results:not([hidden])');
    await page.click('#tab-standards');
    const view = page.locator('#view-standards');
    assert(await view.locator('table.standards tbody tr').count() === 4, 'four standards in the demo');
    assert(/4 of 4<\/b> standards were tested by at least 2 questions/.test(await view.innerHTML()), 'the summary line');
    assert(await view.locator('table.standards-grid tbody tr').count() === 12, 'a row per student');
    // The class table's "n of m students" must add up to the squares in the grid.
    const fromTable = (await view.locator('table.standards tbody td .muted.small').allInnerTexts()).map(t => Number(/^(\d+) of/.exec(t)[1])).reduce((x, y) => x + y, 0);
    const ticks = await view.locator('table.standards-grid td.cell.right').count();
    const crosses = await view.locator('table.standards-grid td.cell.wrong').count();
    assert(ticks === fromTable, 'grid ' + ticks + ' vs table ' + fromTable);
    assert(ticks > 0 && crosses > 0 && ticks + crosses === 48, 'negative control: neither all shown nor none: ' + ticks + '/' + crosses);
    // Each student's count matches their row, and a perfect score shows every standard.
    const rows = await page.$$eval('#view-standards table.standards-grid tbody tr', trs => trs.map(tr => ({ who: tr.querySelector('th').textContent, shown: tr.querySelector('td.score').textContent, ticks: tr.querySelectorAll('td.cell.right').length })));
    rows.forEach(r => assert(r.shown === r.ticks + ' of 4', r.who + ': ' + r.shown + ' but ' + r.ticks + ' ticks'));
    assert(rows.find(r => r.who === 'Casey Demo').ticks === 4, 'a perfect score shows all four');
    assert(rows.find(r => r.who === 'Jordan Demo').ticks < 4, 'a student with misses does not');
    await page.click('#names [data-v="anon"]');
    assert(!/Demo/.test(await view.locator('table.standards-grid').innerText()), 'no names on the projector');
    assert(/Student 1/.test(await view.innerText()), 'numbers instead');
    await page.click('#names [data-v="show"]');
    await page.click('#clear');
    await page.setInputFiles('#filepick', [fx.blockFile]);
    await page.waitForSelector('#results:not([hidden])');
    await page.click('#tab-standards');
    assert(/Standards need a question map/.test(await view.innerText()), 'without a map, it says what is needed');
    await page.click('#tab-heat');
  });

  await check('the Map Maker: tag with an AI\'s reply, fix what it missed, use the map, save it', async () => {
    await page.click('#clear');
    assert(await page.locator('#maker').isHidden(), 'no Map Maker before a file');
    await page.setInputFiles('#filepick', [fx.csvFile]);
    await page.waitForSelector('#results:not([hidden])');
    assert(await page.locator('#maker').isVisible(), 'the Map Maker is offered with the Canvas file alone');
    assert(/Map Maker/.test(await page.locator('#status').innerText()), 'the status points to it');
    await page.click('#maker summary');
    assert(await page.locator('#maker-table tbody tr').count() === 6, 'one row per question');
    // Which Canvas question is which: the fixture's wording names its number.
    const stems = await page.$$eval('#maker-table tbody tr', rows => rows.map(r => r.querySelector('td.q').textContent));
    const ltOf = k => ['X.1 LT1', 'X.1 LT2', 'X.2 LT1'][(k - 1) % 3];
    const fixtureN = stems.map(s => Number(/Fixture question (\d+)/.exec(s)[1]));
    await page.fill('#maker-standards', 'X.1 LT1: I can explain invented idea one.\nX.1 LT2: I can explain invented idea two.\nX.2 LT1: I can compare invented cases.\nX.9 LT1: I can explain an idea this test never asks about.');
    await page.click('#maker-copy');
    const prompt = await page.evaluate(() => navigator.clipboard.readText());
    assert(/Q1\. Fixture question/.test(prompt) && /X\.2 LT1: I can compare/.test(prompt), 'the prompt lists questions and standards');
    fx.people.forEach(p => assert(!prompt.includes(p) && !prompt.includes(p.split(' ')[0]), p + ' reached the prompt'));
    assert(!/Period 2/.test(prompt), 'a class name reached the prompt');
    // The AI's reply, with chatter, and with the last question left out.
    const reply = ['Here you go:'].concat(fixtureN.slice(0, 5).map((k, i) => 'Q' + (i + 1) + ' | ' + ltOf(k).slice(0, 3) + ' | ' + ltOf(k))).join('\n');
    await page.fill('#maker-reply', reply);
    await page.click('#maker-read');
    const read = await page.locator('#maker-status').innerText();
    assert(/Filled in 5 of 6/.test(read) && /no tag for question 6/.test(read), read);
    if (SHOTS) await page.locator('#maker').screenshot({ path: path.join(SHOTS, 'retake-map-maker.png') });
    await page.click('#maker-use');
    assert(/Not finished yet.*question 6/.test(await page.locator('#maker-status').innerText()), 'an untagged question stops it, by number');
    assert(/scored by Canvas/.test(await page.locator('#status').innerText()), 'negative control: nothing changed yet');
    const last = page.locator('#maker-table tbody tr').nth(5);
    await last.locator('input.topic').fill(ltOf(fixtureN[5]).slice(0, 3));
    await last.locator('input.lt').fill(ltOf(fixtureN[5]));
    await page.click('#maker-use');
    await page.waitForFunction(() => /Matched/.test(document.getElementById('status').textContent));
    assert(/Matched 6 of 6/.test(await page.locator('#status').innerText()), await page.locator('#status').innerText());
    assert(await page.locator('#by-wrap').isVisible(), 'grouping is offered now');
    assert(await page.locator('#view-targets table.report tbody tr').count() === 2, 'two topics, X.1 and X.2');
    assert(/I can compare invented cases/.test(await allResultsText()), 'the pasted wording reaches the report');
    assert(await page.locator('#maker').isVisible(), 'the Map Maker stays open for changes');
    assert(await page.locator('#maker-table tbody tr').nth(5).locator('input.lt').inputValue() === ltOf(fixtureN[5]), 'the table keeps what was typed');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#maker-save')]);
    assert(/-Retake-Map\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    const saved = E.parseMap(fs.readFileSync(await dl.path(), 'utf8'));
    assert(saved.map && !saved.problems.length, 'the saved map reads back: ' + saved.problems.join(' '));
    assert(saved.map.questions.length === 6 && Object.keys(saved.map.targets).length === 4, 'every question and standard saved, tested or not');
    // The standard no question asks about is named as a gap.
    await page.click('#tab-standards');
    const std = await page.locator('#view-standards').innerText();
    assert(/3 of 3 standards were tested/.test(std) && /Not on this test/.test(std) && /X\.9 LT1/.test(std), std.slice(0, 400));
    await page.click('#tab-heat');
    // Projector safe: the Map Maker shows the test, so it hides.
    await page.click('#names [data-v="anon"]');
    assert(await page.locator('#maker-body').isHidden() && await page.locator('#maker-hidden').isVisible(), 'hidden on the projector');
    assert(!/Fixture question/.test(await page.locator('#maker').innerText()), 'no question wording on the projector');
    await page.click('#names [data-v="show"]');
    // A map file brought in replaces it, and the Map Maker steps aside.
    await page.setInputFiles('#filepick', [fx.mapFile]);
    await page.waitForFunction(() => /Fixture-Retake-Map/.test(document.getElementById('f-map-state').textContent));
    assert(await page.locator('#maker').isVisible(), 'a loaded map can be edited in Map Maker');
  });

  await check('class periods: one file each, named, compared, filtered and sorted', async () => {
    await page.click('#clear');
    await page.setInputFiles('#filepick', [fx.periodA, fx.periodB, fx.mapFile]);
    await page.waitForFunction(() => /Combined/.test(document.getElementById('status').textContent));
    const names = await page.$$eval('#class-files input.class-name', els => els.map(e => e.value));
    assert(names.join('|') === 'Period 2|Period 5', 'class names guessed from the file names: ' + names.join('|'));
    assert(/Matched 6 of 6/.test(await page.locator('#status').innerText()), 'both files read against the map');
    assert(await page.locator('#s-students').innerText() === '6', 'students from both files');
    assert(await page.locator('#view-heat tbody tr.sec').count() === 2, 'a heading per period');
    // Rename a class: the dropdown, the headings and the comparison follow.
    await page.fill('#class-name-1', 'Period 6');
    await page.press('#class-name-1', 'Enter');
    await page.waitForFunction(() => /Period 6/.test(document.getElementById('section').textContent));
    await page.click('#tab-targets');
    const heads = await page.$$eval('#view-targets table.compare thead th', els => els.map(e => e.textContent));
    assert(heads.join('|') === 'Learning target|All classes|Period 2|Period 6', 'compare columns: ' + heads.join('|'));
    // One class only: every view narrows, and student numbers do not change.
    await page.click('#tab-heat');
    const before = await page.$$eval('#view-heat tbody tr:not(.sec) th.who', els => els.map(e => e.textContent));
    await page.click('#names button[data-v="anon"]');
    const numbersAll = await page.$$eval('#view-heat tbody tr:not(.sec) th.who', els => els.map(e => e.textContent));
    await page.selectOption('#section', 'Period 6');
    const numbersOne = await page.$$eval('#view-heat tbody tr:not(.sec) th.who', els => els.map(e => e.textContent));
    assert(numbersOne.length === 3 && numbersOne.every(n => numbersAll.includes(n)), 'numbers kept: ' + numbersOne.join(',') + ' of ' + numbersAll.join(','));
    assert(numbersAll.length === 6, 'negative control: all classes shows everyone');
    assert(await page.locator('#view-heat tbody tr.sec').count() === 0, 'no class headings inside one class');
    assert(await page.locator('#view-targets table.compare').count() === 0, 'no comparison inside one class');
    await page.click('#names button[data-v="show"]');
    await page.selectOption('#section', '');
    // Sort by score: lowest first.
    await page.click('#sort button[data-v="score"]');
    const scores = await page.$$eval('#view-heat tbody tr:not(.sec) td.score', els => els.map(e => parseInt(e.textContent, 10)));
    assert(scores.every((x, i) => i === 0 || scores[i - 1] <= x), 'not lowest first: ' + scores.join(','));
    assert(await page.locator('#view-heat tbody tr.sec').count() === 0, 'no class headings when sorted by score');
    await page.click('#sort button[data-v="name"]');
    const named = await page.$$eval('#view-heat tbody tr:not(.sec) th.who', els => els.map(e => e.textContent));
    assert(named.join() === named.slice().sort((x, y) => x.localeCompare(y, 'en', { numeric: true })).join(), 'by name: ' + named.join(','));
    assert(named.join() !== before.join() || before.join() === named.slice().sort().join(), 'sorting changed nothing it should have');
    await page.click('#sort button[data-v="class"]');
    // Remove a file: back to one class.
    await page.click('#class-files button.remove >> nth=1');
    await page.waitForFunction(() => document.getElementById('s-students').textContent === '3');
    assert(await page.locator('#class-files').isHidden(), 'one file needs no class names');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'retake-classes.png'), fullPage: true });
  });

  await check('every student list follows the sort and says how it is sorted', async () => {
    await page.click('#clear');
    await page.click('#demo');
    await page.waitForSelector('#results:not([hidden])');
    const lists = async () => ({
      heat: await page.$$eval('#view-heat tbody tr:not(.sec) th.who', els => els.map(e => e.textContent)),
      students: await page.$$eval('#view-students tbody tr td:first-child', els => els.map(e => e.textContent)),
      prompts: await page.$$eval('#view-prompts .prompt .lt', els => els.map(e => e.textContent.replace(/^Student \d+ · /, ''))),
      chips: await page.$$eval('#view-targets .targets .target .chip.need', els => els.map(e => e.textContent)),
      groups: await page.$$eval('#view-groups .chip.need', els => els.map(e => e.textContent))
    });
    // A list follows the heat map's order when its names appear in that order (each card on its own).
    const follows = (part, whole) => part.join() === whole.filter(n => part.includes(n)).join();
    const byScore = await (async () => { await page.click('#sort button[data-v="score"]'); return lists(); })();
    const byName = await (async () => { await page.click('#sort button[data-v="name"]'); return lists(); })();
    assert(byScore.heat.join() !== byName.heat.join(), 'negative control: score and name orders differ on the demo');
    for (const [label, l] of [['score', byScore], ['name', byName]]) {
      assert(l.students.join() === l.heat.join(), label + ': By student ignores the sort');
      assert(follows(l.prompts, l.heat), label + ': the prompts ignore the sort');
      const cards = await page.$$eval('#view-targets .targets .target', els => els.length);
      assert(cards > 0, 'the class report lists who needs each topic');
    }
    assert(byScore.chips.join() !== byName.chips.join(), 'the class report\'s names do not move with the sort');
    assert(/sorted by name/.test(await page.locator('#view-students .sort-note').textContent()), 'the sort is said');
    await page.click('#sort button[data-v="score"]');
    assert(/sorted by score, lowest first/.test(await page.locator('#view-heat .sort-note').textContent()), 'the sort is said');
    await page.click('#sort button[data-v="class"]');
  });

  const inventedUpload = (name, rows) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(rows.map(r => r.map(E.csvCell).join(',')).join('\n')) });

  await check('import review separates actual Canvas totals from supported-item analysis', async () => {
    await page.click('#clear');
    const data = inventedUpload('Invented weighted export.csv', [
      ['Name', 'ID', 'ItemID', 'ItemType', 'Invented one-point item?', 'EarnedPoints', 'Status', 'ItemID', 'ItemType', 'Invented five-point item?', 'EarnedPoints', 'Status', 'ItemID', 'ItemType', 'Invented essay?', 'EarnedPoints', 'Status', 'PointsPossible', 'OverallScore'],
      ['Pat Invented', '1', 'a', 'MultipleChoice', 'Invented first answer', '1', 'Correct', 'b', 'MultipleChoice', 'Invented second answer', '0', 'Incorrect', 'c', 'Essay', 'Invented essay response', '0', 'Graded', '8', '1']
    ]);
    await page.setInputFiles('#filepick', data);
    await page.waitForSelector('#results:not([hidden])');
    const review = await page.locator('#import-summary').innerText();
    assert(/2 questions analyzed; 1 unsupported/.test(review), review);
    assert(/Canvas overall totals/.test(review), review);
    await page.click('#tab-students');
    assert(/1 \/ 8/.test(await page.locator('#view-students').innerText()), 'the actual exported total must show');
    assert(await page.locator('#view-heat tbody td.cell').count() === 2, 'the essay must not appear in the heat map');
    // Negative control: with no supplied total, the source is explicitly estimated.
    const rows = E.parseCsv(data.buffer.toString());
    rows[1][rows[1].length - 1] = '';
    rows[1][rows[1].length - 2] = '';
    await page.click('#clear');
    await page.setInputFiles('#filepick', inventedUpload('Invented missing total.csv', rows));
    await page.waitForSelector('#results:not([hidden])');
    assert(/estimated item totals/.test(await page.locator('#import-summary').innerText()), 'estimated scores need a label');
  });

  await check('ambiguous matches stop and the teacher can return to Canvas-only analysis', async () => {
    await page.click('#clear');
    const stem = 'Which invented statement is true?';
    const map = { format: E.MAP_FORMAT, title: 'Invented ambiguous map', targets: { T: 'Invented standard' },
      questions: [1, 2].map(n => ({ n, lt: 'T', stem, options: ['Yes', 'No'], answer: 0 })) };
    await page.setInputFiles('#filepick', [
      inventedUpload('Invented ambiguous.csv', [['Name', 'ID', 'ItemID', 'ItemType', stem, 'EarnedPoints', 'Status', 'ItemID', 'ItemType', stem, 'EarnedPoints', 'Status'],
        ['Pat Invented', '1', 'a', 'MultipleChoice', 'Yes', '1', 'Correct', 'b', 'MultipleChoice', 'No', '0', 'Incorrect']]),
      { name: 'Invented-Map.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(map)) }
    ]);
    await page.waitForFunction(() => /uncertain matches/.test(document.getElementById('status').textContent));
    assert(await page.locator('#results').isHidden(), 'ambiguous identities cannot make an authoritative report');
    await page.click('#remove-map');
    await page.waitForSelector('#results:not([hidden])');
    assert(/2 questions analyzed/.test(await page.locator('#import-summary').innerText()), 'raw scored questions remain usable without claiming identity');
  });

  await check('a loaded map is editable, keeps numbering and survives repeated use and save', async () => {
    await page.click('#clear');
    await page.setInputFiles('#filepick', [fx.csvFile, fx.mapFile]);
    await page.waitForSelector('#results:not([hidden])');
    await page.click('#maker summary');
    await page.fill('#maker-version', 'audit.1');
    await page.getByLabel('Correct answer for question 1', { exact: true }).fill('Invented corrected answer');
    await page.getByLabel('Standard for question 1', { exact: true }).fill('X.NEW');
    await page.click('#maker-use');
    assert(/Matched 6 of 6/.test(await page.locator('#status').innerText()), 'updated map still matches');
    await page.click('#maker-use');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#maker-save')]);
    const pm = E.parseMap(fs.readFileSync(await dl.path(), 'utf8'));
    assert(pm.map, pm.problems.join('; '));
    assert(pm.map.version === 'audit.1', 'the version survives');
    const q = pm.map.questions.find(x => x.n === 1);
    assert(q.lt === 'X.NEW' && q.options[q.answer] === 'Invented corrected answer', 'both edits survive');
    assert(q.rationale === 'Fixture reason 1', 'authored metadata survives');
    assert(pm.map.questions.length === 6, 'no question was silently dropped');
  });

  await check('a universally blank item can be tagged, used and saved', async () => {
    await page.click('#clear');
    await page.setInputFiles('#filepick', inventedUpload('Invented blank.csv', [
      ['Name', 'ID', 'ItemID', 'ItemType', 'Which invented item was left blank?', 'EarnedPoints', 'Status'],
      ['Pat Invented', '1', 'blank-item', 'MultipleChoice', '', '0', 'Graded']
    ]));
    await page.waitForSelector('#maker:not([hidden])');
    await page.click('#maker summary');
    await page.getByLabel('Standard for question 1', { exact: true }).fill('T.BLANK');
    await page.click('#maker-use');
    assert(/Matched 1 of 1/.test(await page.locator('#status').innerText()), 'the blank item remains in the analysis');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#maker-save')]);
    const pm = E.parseMap(fs.readFileSync(await dl.path(), 'utf8'));
    assert(pm.map && pm.map.questions[0].answer === -1, 'unknown answers are saved without guessing');
  });

  await check('overlapping exports are blocked until the extra file is removed', async () => {
    await page.click('#clear');
    const header = ['Name', 'ID', 'ItemID', 'ItemType', 'Which invented item belongs here?', 'EarnedPoints', 'Status'];
    await page.setInputFiles('#filepick', [
      inventedUpload('Invented first.csv', [header, ['Pat Invented', '1', 'q', 'MultipleChoice', 'Invented answer', '1', 'Correct']]),
      inventedUpload('Invented second.csv', [header, ['Pat Invented', '1', 'q', 'MultipleChoice', 'Invented different answer', '0', 'Incorrect']])
    ]);
    await page.waitForFunction(() => /overlapping students/.test(document.getElementById('status').textContent));
    assert(await page.locator('#results').isHidden(), 'no doubled class report');
    await page.locator('#class-files button.remove').nth(1).click();
    await page.waitForSelector('#results:not([hidden])');
    assert(await page.locator('#s-students').innerText() === '1', 'one source restores the valid analysis');
  });

  await check('the page asks for this version\'s own script and styles, so a browser cannot keep last version\'s', async () => {
    const version = require(path.join(ROOT, 'package.json')).version;
    const asked = requests.map(u => u.replace(origin, '')).filter(u => /retake-planner[-.a-z]*\.(js|css)/.test(u));
    ['/retake-planner.css', '/retake-planner-engine.js', '/retake-planner-app.js'].forEach(f => {
      assert(asked.includes(f + '?v=' + version), f + ' was not asked for as version ' + version + ': ' + asked.join(', '));
    });
    assert(await page.evaluate(() => window.BHRetakePlanner.VERSION) === 'retake-planner/' + version, 'the engine says a different version');
  });

  await check('the page reaches nothing but its own files, brand fonts and logo', async () => {
    const own = new Set(['/index.html', '/retake-planner.css', '/retake-planner-engine.js', '/retake-planner-app.js',
      '/assets/fonts/andersonlogic/manrope-latin-var.woff2', '/assets/fonts/andersonlogic/inter-latin-var.woff2',
      '/assets/images/brand/andersonlogic/al-logo-mark.png', '/assets/images/brand/andersonlogic/al-logo-wordmark.png',
      '/assets/images/brand/andersonlogic/al-logo-lockup.png', '/assets/images/brand/andersonlogic/al-favicon.png']);
    const stray = requests.filter(u => !u.startsWith('data:') && !u.startsWith('blob:') && !own.has(u.replace(origin, '').replace(/\?v=[\d.]+$/, '')));
    assert(!stray.length, 'unexpected requests: ' + stray.join(', '));
    // Negative control: a fetch from the page is refused by its policy and recorded.
    const outcome = await page.evaluate(() => fetch('https://example.com/x').then(() => 'sent', () => 'blocked'));
    assert(outcome === 'blocked', 'a fetch was allowed');
    // The browser reports the violation a moment after refusing the fetch; wait for it,
    // or it lands in the next check instead.
    const seen = await page.waitForFunction(() => window.__csp.some(v => /connect-src/.test(v)), null, { timeout: 5000 }).then(() => true, () => false);
    assert(seen, 'the blocked fetch should be recorded as a violation');
    await page.evaluate(() => { window.__csp.length = 0; });
  });

  await check('the brand shows: the ANDERSONLOGIC ai logo images load, and its fonts really load', async () => {
    // A logo that fails to load still occupies its box and reads its alt text, so "the
    // img is there" proves nothing; a loaded image has a natural width.
    const logos = await page.evaluate(() => [...document.querySelectorAll('.topbar img, .hero-logo')].map(i => ({ alt: i.alt, ok: i.complete && i.naturalWidth > 0 })));
    assert(logos.length === 3, 'mark, wordmark and lockup: ' + logos.length);
    assert(logos.every(l => l.ok), 'an image did not load: ' + JSON.stringify(logos));
    assert(logos.some(l => l.alt === 'ANDERSONLOGIC ai'), 'the wordmark image names the brand for a screen reader');
    const broken = await page.evaluate(() => new Promise(res => { const i = new Image(); i.onload = i.onerror = () => res(i.naturalWidth); i.src = 'data:image/png;base64,AAAA'; }));
    assert(broken === 0, 'negative control: an image that fails must show a natural width of 0');
    const footer = (await page.locator('footer .al-wordmark').innerText()).replace(/\s+/g, ' ').trim();
    assert(footer === 'ANDERSONLOGIC ai', 'footer wordmark: ' + footer);
    assert(!/BeHistorical/.test(await page.locator('body').innerText()), 'no BeHistorical branding left on the page');
    // document.fonts.check() answers true for a face that does not exist at all, so it
    // proves nothing; the list of faces whose files actually loaded does.
    const loaded = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, '')); });
    assert(loaded.includes('Manrope') && loaded.includes('Inter'), 'loaded faces: ' + loaded.join(', '));
    assert(!loaded.includes('Cinzel'), 'negative control: a face this page never loads must not be listed');
  });

  await check('no console error and no security-policy violation', async () => {
    const csp = await page.evaluate(() => window.__csp.slice());
    const real = errors.filter(e => !/example\.com|Content Security Policy|Failed to fetch/.test(e));
    assert(!real.length, 'console: ' + real.join(' | '));
    assert(!csp.length, 'policy: ' + csp.join(' | '));
  });

  await check('it fits a phone without sideways scrolling', async () => {
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await phone.goto(origin + '/index.html', { waitUntil: 'load' });
    await phone.click('#demo');
    await phone.waitForSelector('#results:not([hidden])');
    for (const tab of ['targets', 'standards', 'students', 'questions']) {
      await phone.click('#tab-' + tab);
      const over = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(over <= 1, tab + ' scrolls sideways by ' + over + 'px');
    }
    if (SHOTS) { await phone.click('#tab-targets'); await phone.screenshot({ path: path.join(SHOTS, 'retake-phone.png'), fullPage: true }); }
    // The Map Maker's wide table scrolls inside its own box (it pushed the page 400px wide once).
    await phone.click('#clear');
    await phone.setInputFiles('#filepick', [fx.csvFile]);
    await phone.waitForSelector('#maker:not([hidden])');
    await phone.click('#maker summary');
    const makerOver = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(makerOver <= 1, 'the Map Maker scrolls sideways by ' + makerOver + 'px');
    await phone.close();
  });

  await browser.close();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? '\n' + failed + ' failed' : '\nAll checks passed.');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
