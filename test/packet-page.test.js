'use strict';
// Browser round trips use invented records and invented AI output, never a real service.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright-core');
const E = require('../retake-planner-engine.js');
const ROOT = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'retake-packets-'));
const people = ['Nora Invented', 'Ethan Invented', 'Imani Invented', 'Bo Invented', 'Cy Invented', 'Dee Invented', 'Flo Invented', 'Gus Invented'];
const qs = [1, 2, 3].map(n => ({ n, itemId: 'invented-q-' + n, lt: n === 3 ? 'B' : 'A', topic: n === 3 ? 'Two' : 'One',
  stem: 'Which invented outcome matches case ' + n + '?', options: ['Invented correct ' + n, 'Invented wrong ' + n], answer: 0, points: 1 }));
const map = { format: E.MAP_FORMAT, title: 'Invented packet browser exam', targets: { A: 'Explain invented causes', B: 'Compare invented cases' }, questions: qs };
const rows = [['Student Name', 'ID', 'Section', 'ItemID', 'ItemType', 'Question Text', 'Answer', 'Points Received', 'Points Possible', 'Status']];
people.forEach((name, s) => qs.forEach((q, i) => {
  const miss = s !== 7 && i !== 1;
  rows.push([name, 'private-id-' + s, s < 4 ? 'Period 2' : 'Period 5', q.itemId, 'MultipleChoice', q.stem, q.options[miss ? 1 : 0], miss ? 0 : 1, 1, 'Graded']);
}));
const uploads = [{ name: 'Invented packet results.csv', mimeType: 'text/csv', buffer: Buffer.from(rows.map(r => r.map(E.csvCell).join(',')).join('\n')) },
  { name: 'Invented packet map.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(map)) }];
let failed = 0;
async function check(name, fn) { try { await fn(); console.log('  PASS  ' + name); } catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + e.message); } }
function response(prompt, style) {
  const requestId = /"requestId": "([^"]+)"/.exec(prompt)[1];
  const roster = prompt.split('\n').filter(l => l.startsWith('{"student":')).map(JSON.parse);
  return { format: 'retake-planner-response/1', requestId, students: roster.map(s => ({ student: s.student,
    questions: Array.from({ length: s.questionCount }, (_, i) => ({ id: 'S' + s.student + '-Q' + (i + 1),
      sourceQuestions: style === 'corrections' ? [s.missed[i].n] : s.missed.map(q => q.n),
      question: 'Explain invented example ' + (i + 1) + ' with specific evidence for learner ' + s.student + '.',
      teacherGuidance: ['TEACHER_ONLY_SECRET: invented expected evidence', 'Invented expected reasoning'],
      rubric: 'RUBRIC_ONLY_SECRET: award up to four points for evidence and reasoning.', points: 4 })) })) };
}
(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(ROOT, '.' + decodeURIComponent(req.url.split('?')[0]));
    if (path.relative(ROOT, file).startsWith('..') || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.PW_CHROME, args: ['--no-sandbox'] });
    const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
    const origin = 'http://127.0.0.1:' + server.address().port;
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    const page = await ctx.newPage();
    const errors = [], requests = [], csp = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (!r.url().startsWith(origin)) requests.push(r.url()); });
    await page.addInitScript(() => {
      window.__packetPrint = [];
      window.__packetCsp = [];
      document.addEventListener('securitypolicyviolation', e => window.__packetCsp.push(e.violatedDirective));
      window.print = () => { window.__packetPrint.push(document.getElementById('packet-print-root').innerHTML); };
    });
    await page.goto(origin + '/index.html');
    await page.setInputFiles('#filepick', uploads);
    await page.waitForSelector('#results:not([hidden])');
    await page.click('#tab-packets');
    let prompt, data;
    async function prepare() {
      await page.click('#packet-copy');
      prompt = await page.locator('#packet-prompt').textContent();
      data = response(prompt, await page.locator('#packet-style').inputValue());
    }
    async function importData(value) {
      await page.fill('#packet-reply', JSON.stringify(value));
      await page.click('#packet-import');
    }

    await check('packet prompts use small stable batches and contain no names or IDs', async () => {
      assert.strictEqual(await page.locator('#packet-batch option').count(), 2);
      await page.fill('#packet-grade', '9th grade');
      await page.fill('#packet-course', 'AP World History');
      await prepare();
      assert.strictEqual(data.students.length, 5);
      people.forEach(name => assert.ok(!prompt.includes(name)));
      assert.ok(!prompt.includes('private-id-'));
      assert.ok(prompt.includes('9th grade') && prompt.includes('AP World History'));
      assert.strictEqual(await page.evaluate(() => navigator.clipboard.readText()), prompt);
      assert.ok(await page.locator('#packet-batch').isDisabled(), 'an active batch is protected from accidental replacement');
    });
    await check('incomplete or stale replies fail; a valid import requires explicit approval', async () => {
      const missing = JSON.parse(JSON.stringify(data)); missing.students.pop();
      await importData(missing);
      assert.match(await page.locator('#packet-status').innerText(), /missing from the reply/);
      assert.strictEqual(await page.locator('#packet-review .packet-card').count(), 0);
      const stale = { ...data, requestId: 'another-request' };
      await importData(stale);
      assert.match(await page.locator('#packet-status').innerText(), /different or older request/);
      await importData(data);
      assert.strictEqual(await page.locator('#packet-review .packet-card').count(), 5);
      assert.ok(await page.locator('#packet-save-students').isDisabled());
      assert.strictEqual(await page.locator('#packet-review input[data-approve]:checked').count(), 0);
    });
    await check('approved student downloads and teacher keys remain separate', async () => {
      await page.locator('#packet-review [data-approve]').first().check();
      const [studentDownload] = await Promise.all([page.waitForEvent('download'), page.click('#packet-save-students')]);
      const studentHtml = fs.readFileSync(await studentDownload.path(), 'utf8');
      assert.ok(studentHtml.includes(people[0]) && !studentHtml.includes(people[1]));
      assert.ok(!/TEACHER_ONLY_SECRET|RUBRIC_ONLY_SECRET|What a strong answer includes/.test(studentHtml));
      assert.strictEqual((studentHtml.match(/class="packet-lines"/g) || []).length, 18);
      const [teacherDownload] = await Promise.all([page.waitForEvent('download'), page.click('#packet-save-key')]);
      const teacherHtml = fs.readFileSync(await teacherDownload.path(), 'utf8');
      assert.ok(/TEACHER_ONLY_SECRET/.test(teacherHtml) && /RUBRIC_ONLY_SECRET/.test(teacherHtml));
      assert.ok(!teacherHtml.includes('class="packet-lines"'));
      const doc = await ctx.newPage();
      await doc.setContent(studentHtml);
      assert.strictEqual(await doc.locator('.packet').count(), 1);
      assert.strictEqual(await doc.locator('script').count(), 0);
      if (process.env.SHOTS) await doc.screenshot({ path: path.join(process.env.SHOTS, 'student-packet-document.png'), fullPage: true });
      await doc.close();
    });
    await check('printing shows only the approved document and clears it afterward', async () => {
      await page.click('#packet-print-students');
      await page.emulateMedia({ media: 'print' });
      assert.ok(await page.locator('#packet-print-root').isVisible());
      assert.ok(await page.locator('main').isHidden());
      assert.ok(!/TEACHER_ONLY_SECRET|RUBRIC_ONLY_SECRET/.test(await page.locator('#packet-print-root').textContent()));
      assert.ok(await page.locator('#view-packets').isHidden());
      await page.pdf({ path: path.join(tmp, 'invented-student-packets.pdf'), format: 'Letter', printBackground: true });
      if (process.env.SHOTS) fs.copyFileSync(path.join(tmp, 'invented-student-packets.pdf'), path.join(process.env.SHOTS, 'student-print-proof.pdf'));
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
      await page.emulateMedia({ media: 'screen' });
      assert.strictEqual(await page.locator('#packet-print-root').textContent(), '');
      await page.click('#packet-print-key');
      assert.match(await page.locator('#packet-print-root').textContent(), /TEACHER_ONLY_SECRET/);
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
      assert.ok(await page.locator('#print').isDisabled(), 'generic print must not print the review screen');
    });
    await check('edits and changed directions revoke approval; repeated copying preserves the draft', async () => {
      await page.click('#packet-copy');
      assert.strictEqual(await page.locator('#packet-review .packet-card').count(), 5);
      assert.strictEqual(await page.locator('#packet-prompt').textContent(), prompt);
      const editor = page.locator('#packet-review textarea[data-field="question"]').first();
      await editor.fill('Explain this revised invented case. <img src=x onerror=alert(1)>');
      assert.strictEqual(await page.locator('#packet-review input[data-approve]:checked').count(), 0);
      assert.ok(await page.locator('#packet-save-students').isDisabled());
      assert.strictEqual(await page.locator('#packet-review img').count(), 0);
      await page.locator('#packet-review [data-approve]').first().check();
      await page.fill('#packet-instructions', 'Use evidence in every answer.');
      assert.ok(await page.locator('#packet-print-students').isDisabled());
      const points = page.locator('#packet-review input[data-field="points"]').first();
      await points.fill('0');
      await page.locator('#packet-review [data-approve]').first().click();
      assert.strictEqual(await page.locator('#packet-review input[data-approve]:checked').count(), 0);
      assert.match(await page.locator('#packet-status').innerText(), /whole-number points/);
      await points.fill('4');
      await page.locator('#packet-review [data-approve]').first().check();
    });
    await check('projector safe hides reply, questions, names and teacher notes and disables exports', async () => {
      await page.click('#names button[data-v="anon"]');
      assert.ok(await page.locator('#packet-body').isHidden());
      assert.strictEqual(await page.locator('#packet-prompt').textContent(), '');
      assert.strictEqual(await page.locator('#packet-review').textContent(), '');
      assert.strictEqual(await page.locator('#packet-reply').inputValue(), '');
      assert.ok(await page.locator('#packet-save-students').isDisabled());
      assert.ok(await page.locator('#packet-print-key').isDisabled());
      await page.click('#names button[data-v="show"]');
      assert.strictEqual(await page.locator('#packet-review .packet-card').count(), 5);
    });
    await check('changed counts, rules, classes and source files invalidate old replies and approvals', async () => {
      await page.selectOption('#packet-count', '2');
      assert.strictEqual(await page.locator('#packet-review .packet-card').count(), 0);
      assert.ok(await page.locator('#packet-import').isDisabled());
      assert.match(await page.locator('#packet-status').innerText(), /changed/);
      await prepare(); await importData(data);
      await page.locator('#packet-review [data-approve]').first().check();
      await page.click('#rule button[data-v="most"]');
      assert.ok(await page.locator('#packet-save-students').isDisabled());
      await prepare();
      await page.selectOption('#section', { label: 'Period 2' });
      assert.ok(await page.locator('#packet-import').isDisabled());
      await prepare(); await importData(data);
      await page.click('#clear');
      assert.strictEqual(await page.locator('#packet-review .packet-card').count(), 0);
      assert.strictEqual(await page.locator('#packet-print-root').textContent(), '');
    });
    await check('corrections and one-student batches use distinct complete requests', async () => {
      await page.setInputFiles('#filepick', uploads);
      await page.waitForSelector('#results:not([hidden])');
      await page.click('#tab-packets');
      await page.click('#rule button[data-v="any"]');
      await page.selectOption('#packet-style', 'corrections');
      await page.selectOption('#packet-batch-size', '1');
      await prepare();
      assert.strictEqual(data.students.length, 1);
      assert.strictEqual(data.students[0].questions.length, 2);
      await importData(data);
      assert.strictEqual(await page.locator('#packet-review .packet-card').count(), 1);
      const firstId = data.requestId;
      await page.click('#packet-new');
      await page.selectOption('#packet-batch', { index: 1 });
      await prepare();
      assert.notStrictEqual(data.requestId, firstId);
      assert.strictEqual(data.students[0].student, 2);
    });
    await check('packet review fits a phone and has no script, CSP or network errors', async () => {
      await importData(data);
      await page.setViewportSize({ width: 390, height: 844 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, 'page overflows by ' + overflow);
      if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, 'packet-review-phone.png'), fullPage: true });
      assert.deepStrictEqual(errors, []);
      assert.deepStrictEqual(requests, []);
      csp.push(...await page.evaluate(() => window.__packetCsp));
      assert.deepStrictEqual(csp, []);
    });
    await check('invented demo replies let a teacher try the full workflow without contacting an AI', async () => {
      assert.ok(await page.locator('#packet-demo').isHidden(), 'invented replies are not offered for uploaded results');
      await page.click('#clear');
      await page.click('#demo');
      await page.click('#tab-packets');
      await page.selectOption('#packet-style', 'retake');
      await prepare();
      await page.click('#packet-demo');
      assert.strictEqual(await page.locator('#packet-review .packet-card').count(), data.students.length);
      assert.ok(await page.locator('#packet-save-students').isDisabled(), 'the demo still requires teacher approval');
      assert.match(await page.locator('#packet-review textarea[data-field="question"]').first().inputValue(), /workflow example/);
      assert.deepStrictEqual(requests, []);
    });
  } finally {
    if (browser) await browser.close();
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failed ? '\n' + failed + ' packet browser checks failed' : '\nAll packet browser checks passed.');
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
