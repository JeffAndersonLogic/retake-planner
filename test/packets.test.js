'use strict';
const assert = require('assert');
const E = require('../retake-planner-engine.js');
const P = require('../retake-planner-packets.js');
let failed = 0;
function check(name, fn) { try { fn(); console.log('  PASS  ' + name); } catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + e.message); } }
const qs = [1, 2, 3].map(n => ({ n, lt: n === 3 ? 'B' : 'A', topic: n === 3 ? 'Second' : 'First', stem: 'Which invented result fits case ' + n + '?',
  options: ['Invented correct choice ' + n, 'Invented wrong choice ' + n], answer: 0, points: 1 }));
const map = E.parseMap({ format: E.MAP_FORMAT, title: 'Invented packet exam', targets: { A: 'Explain invented cause', B: 'Compare invented cases' }, questions: qs }).map;
const rows = [['Name', 'ID', ...qs.flatMap(q => [q.stem, '1.0'])],
  ['PrivateName Alpha', 'secret-id-11', qs[0].options[1], 0, qs[1].options[0], 1, qs[2].options[1], 0],
  ['PrivateName Beta', 'secret-id-22', qs[0].options[0], 1, qs[1].options[0], 1, qs[2].options[0], 1]];
const exp = E.readExport(rows.map(r => r.map(E.csvCell).join(',')).join('\n'));
function analysis(o) { return E.analyze(map, exp, E.match(map, exp), o); }
function request(o, a) { return P.createRequest(a || analysis(), o || { count: 3 }, 'invented-request-1'); }
function reply(r) { return { format: P.FORMAT, requestId: r.id, students: r.students.map(s => ({ student: s.student,
  questions: Array.from({ length: s.expected }, (_, i) => ({ id: 'S' + s.student + '-Q' + (i + 1),
    sourceQuestions: r.options.style === 'corrections' ? [s.sources[i].n] : s.sources.map(q => q.n),
    question: 'Explain invented case ' + (i + 1) + ' using evidence, student ' + s.student + '.',
    teacherGuidance: ['TEACHER_ONLY_TOKEN: invented expected evidence', 'Invented expected reasoning'],
    rubric: 'TEACHER_RUBRIC_TOKEN: one point per supported claim, up to four.', points: 4 })) })) }; }
const clone = x => JSON.parse(JSON.stringify(x));
check('packet requests include only eligible misses and exclude local identities', () => {
  const r = request({ count: 2, grade: '9th grade', course: 'AP World History' });
  assert.deepStrictEqual(r.students.map(s => s.student), [1]);
  assert.ok(!/PrivateName|secret-id/.test(r.prompt));
  assert.ok(r.prompt.includes('9th grade') && r.prompt.includes('AP World History'));
  assert.ok(r.students[0].name.includes('PrivateName'), 'names stay in the local mapping');
  assert.deepStrictEqual(r.students[0].sources.map(s => s.n), ['1', '3']);
  assert.ok(!r.prompt.includes(qs[1].stem), 'correct answers to nonqualifying items are not included');
  const most = request({}, analysis({ rule: 'most', by: 'topic' }));
  assert.deepStrictEqual(most.students[0].sources.map(s => s.n), ['3'], 'the stricter rule changes the request');
});
check('a complete reply and a fenced complete reply import as unapproved data', () => {
  const r = request(), data = reply(r);
  assert.ok(P.parseReply(JSON.stringify(data), r).draft);
  assert.ok(P.parseReply('```json\n' + JSON.stringify(data) + '\n```', r).draft);
  assert.strictEqual(P.parseReply(JSON.stringify(data).slice(0, -1), r).draft, null, 'truncation cannot silently import');
  assert.ok(!('approved' in P.parseReply(JSON.stringify(data), r).draft));
});
check('old requests, missing students and unknown student numbers are rejected', () => {
  const r = request(), data = reply(r);
  for (const mutate of [d => { d.requestId = 'another-exam'; }, d => { d.students = []; }, d => { d.students[0].student = 99; }, d => { d.students.push(clone(d.students[0])); }]) {
    const bad = clone(data); mutate(bad); assert.strictEqual(P.validateReply(bad, r).draft, null);
  }
  assert.ok(P.validateReply(data, r).draft, 'the real request still works');
});
check('question counts, IDs, duplicates, answers, rubrics and points are checked', () => {
  const r = request(), data = reply(r);
  for (const mutate of [d => d.students[0].questions.pop(), d => { d.students[0].questions[0].id = 'S1-Q99'; },
    d => { d.students[0].questions[1].question = d.students[0].questions[0].question; }, d => { delete d.students[0].questions[0].teacherGuidance; },
    d => { d.students[0].questions[0].rubric = ''; }, d => { d.students[0].questions[0].points = 2.5; },
    d => { d.students[0].questions[0].points = 0; }, d => { d.students[0].questions[0].points = 21; }]) {
    const bad = clone(data); mutate(bad); assert.ok(P.validateReply(bad, r).problems.length);
  }
  assert.deepStrictEqual(P.validateReply(data, r).problems, []);
});
check('sources must be qualifying misses and cover every requested learning target', () => {
  const r = request(), data = reply(r);
  const bad = clone(data); bad.students[0].questions[0].sourceQuestions = ['2'];
  assert.ok(P.validateReply(bad, r).problems.some(p => /qualifying missed/.test(p)));
  const incomplete = clone(data); incomplete.students[0].questions.forEach(q => { q.sourceQuestions = ['1']; });
  assert.ok(P.validateReply(incomplete, r).problems.some(p => /every qualifying missed/.test(p)));
  assert.ok(P.validateReply(data, r).draft);
});
check('corrections require exactly one distinct correction per missed original item', () => {
  const r = request({ style: 'corrections', count: 10 });
  assert.strictEqual(r.students[0].expected, 2);
  const data = reply(r); assert.ok(P.validateReply(data, r).draft);
  data.students[0].questions[1].sourceQuestions = data.students[0].questions[0].sourceQuestions;
  assert.strictEqual(P.validateReply(data, r).draft, null);
});
check('unexpected fields and excessive replies cannot bypass the contract', () => {
  const r = request(), data = reply(r);
  data.students[0].name = 'Unexpected name';
  assert.ok(P.validateReply(data, r).problems.some(p => /unexpected fields/.test(p)));
  assert.strictEqual(P.parseReply('x'.repeat(2000001), r).draft, null);
  assert.strictEqual(P.parseReply('Here is your reply: ' + JSON.stringify(reply(r)), r).draft, null);
});
check('student documents contain names and writing space but exclude all teacher fields', () => {
  const r = request(), data = reply(r);
  assert.throws(() => P.documentFor(r, data, [], {}), /approve/);
  const student = P.documentFor(r, data, [1], { lines: 3 });
  assert.ok(student.html.includes('PrivateName Alpha'));
  assert.ok(!student.html.includes('PrivateName Beta'));
  assert.ok(!/TEACHER_ONLY_TOKEN|TEACHER_RUBRIC_TOKEN|Original missed questions|What a strong answer includes/.test(student.html));
  assert.strictEqual((student.body.match(/class="packet-lines"/g) || []).length, 9);
  const teacher = P.documentFor(r, data, [1], { mode: 'teacher' });
  assert.ok(/TEACHER_ONLY_TOKEN/.test(teacher.html) && /TEACHER_RUBRIC_TOKEN/.test(teacher.html));
  assert.ok(/TEACHER KEY/.test(teacher.html));
  assert.ok(!teacher.body.includes('class="packet-lines"'));
});
check('downloaded HTML escapes AI text and stays self-contained without scripts', () => {
  const r = request(), data = reply(r);
  data.students[0].questions[0].question = '<img src=x onerror=alert(1)> & "invented"';
  const doc = P.documentFor(r, data, [1], {});
  assert.ok(doc.html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!doc.html.includes('<img') && !doc.html.includes('<script'));
  assert.ok(doc.html.includes('default-src'));
  const invalid = clone(data); invalid.students[0].questions[0].question = '';
  assert.throws(() => P.documentFor(r, invalid, [1], {}), /Resolve/);
});
check('local context changes invalidate requests but sorting does not', () => {
  const a = analysis(), sig = P.context(a, { count: 3 });
  const sorted = clone(a); sorted.students.reverse();
  assert.strictEqual(P.context(sorted, { count: 3 }), sig);
  assert.notStrictEqual(P.context(a, { count: 2 }), sig);
  const changed = clone(a); changed.students[0].name = 'New local identity';
  assert.notStrictEqual(P.context(changed, { count: 3 }), sig);
  assert.notStrictEqual(P.context(analysis({ by: 'question' }), { count: 3 }), sig);
});
check('batch selection uses stable numbers and empty eligibility stops requests', () => {
  assert.strictEqual(P.createRequest(analysis(), {}, 'another-request', [1]).students.length, 1);
  assert.throws(() => P.createRequest(analysis(), {}, 'another-request', [2]), /Choose students/);
  assert.throws(() => P.createRequest({ ...analysis(), students: [] }, {}, 'id'), /Choose students/);
});
console.log(failed ? '\n' + failed + ' packet checks failed' : '\nAll packet checks passed.');
process.exitCode = failed ? 1 : 0;
