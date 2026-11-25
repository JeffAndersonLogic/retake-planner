'use strict';
// Invented data only. These cases reproduce the November 25 product audit.
const assert = require('assert');
const E = require('../retake-planner-engine.js');
let failed = 0;
function check(name, fn) {
  try { fn(); console.log('  PASS  ' + name); }
  catch (e) { failed += 1; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}
const csv = rows => rows.map(r => r.map(E.csvCell).join(',')).join('\n');
function results(items, people) {
  const head = ['Name', 'ID', 'SectionNames'];
  items.forEach(q => head.push('ItemID', 'ItemType', q.stem, 'EarnedPoints', 'Status'));
  head.push('PointsPossible', 'OverallScore');
  return csv([head, ...people.map((p, i) => [p.name || 'Invented person ' + i, p.id || String(i + 1), p.section || 'Invented class',
    ...items.flatMap((q, j) => [q.id || 'item-' + j, q.type || 'MultipleChoice', p.answers[j], p.points[j], p.status && p.status[j] || 'Graded']),
    p.possible == null ? '' : p.possible, p.earned == null ? '' : p.earned])]);
}
function mapped(qs, targets) {
  const pm = E.parseMap({ format: E.MAP_FORMAT, title: 'Invented audit', targets: targets || { T: 'Invented target' }, questions: qs });
  assert.ok(pm.map, pm.problems.join('; '));
  return pm.map;
}
const question = (n, changes) => Object.assign({ n, lt: 'T', topic: 'Invented topic', stem: 'Which invented object belongs in set ' + n + '?',
  options: ['Invented answer ' + n + ' alpha', 'Invented answer ' + n + ' beta'], answer: 0 }, changes);
function analyze(text, map, options) {
  const exp = E.readExport(text);
  const k = map ? { map, matched: E.match(map, exp) } : E.mapFromExport(exp, 'Invented audit');
  return { exp, ...k, a: k.map && E.analyze(k.map, exp, k.matched, options) };
}

check('matching rejects unrelated questions with generic shared choices', () => {
  const map = mapped([question(1, { options: ['Yes', 'No'] }), question(2, { options: ['Yes', 'No'] })]);
  const exp = E.readExport(results([{ stem: 'Was the invented red object round?' }, { stem: 'Was the invented blue object square?' }],
    [{ answers: ['Yes', 'No'], points: [1, 0] }]));
  assert.strictEqual(E.match(map, exp).pairs.length, 0);
  exp.items.forEach((it, i) => { it.label = map.questions[i].stem; });
  assert.strictEqual(E.match(map, exp).pairs.length, 2, 'distinct wording resolves generic choices');
});

check('matching refuses tied evidence instead of trusting position', () => {
  const qs = [question(1), question(2)].map(q => Object.assign(q, { stem: 'Which invented statement is true?', options: ['Yes', 'No'] }));
  const exp = E.readExport(results(qs, [{ answers: ['Yes', 'No'], points: [1, 0] }]));
  const m = E.match(mapped(qs), exp);
  assert.strictEqual(m.pairs.length, 0);
  assert.strictEqual(m.ambiguousItems.length, 2);
  qs.forEach((q, i) => { q.itemId = 'item-' + i; });
  assert.strictEqual(E.match(mapped(qs), exp).pairs.length, 2, 'stable IDs resolve the ambiguity');
});

check('retake rules govern individual and class prompts, including their topic scope', () => {
  const qs = [1, 2, 3, 4].map(n => question(n, { topic: n < 4 ? 'A' : 'B', lt: n < 4 ? 'A' : 'B' }));
  const text = results(qs, [{ answers: qs.map(q => q.options[1]), points: [0, 1, 1, 0] },
    { answers: qs.map(q => q.options[1]), points: [0, 1, 1, 1] }]);
  const map = mapped(qs, { A: 'Invented A', B: 'Invented B' });
  const { a } = analyze(text, map, { rule: 'most' });
  assert.strictEqual(a.students.filter(s => s.targetsMissed.length).length, 1);
  const p = E.retakePrompt(a, a.students[0]);
  assert.ok(p.includes(qs[3].stem));
  assert.ok(!p.includes(qs[0].stem), 'a nonqualifying topic must not reach the prompt');
  assert.strictEqual(E.retakePrompt(a, a.students[1]), '');
  assert.strictEqual((E.classPrompt(a).match(/^=== Student/gm) || []).length, 1);
  assert.strictEqual(E.retakePrompt(a, a.students[1], { style: 'corrections' }), '', 'corrections follow the selected rule too');
  const any = analyze(text, map, { rule: 'any' }).a;
  assert.strictEqual((E.classPrompt(any).match(/^=== Student/gm) || []).length, 2, 'the looser rule changes the prompts');
});

check('actual Canvas totals survive a universally incorrect weighted item', () => {
  const qs = [question(1), question(2)];
  const text = results(qs, [{ answers: qs.map(q => q.options[0]), points: [1, 0], possible: 6, earned: 1 }]);
  const { a } = analyze(text);
  assert.deepStrictEqual([a.students[0].earned, a.students[0].possible], [1, 6]);
  assert.strictEqual(a.students[0].scoreSource, 'canvas');
  assert.ok(a.notes.some(n => /estimat|differ|total/i.test(n)));
  const b = analyze(results(qs, [{ answers: qs.map(q => q.options[0]), points: [1, 0] }])).a;
  assert.strictEqual(b.students[0].scoreSource, 'estimated', 'without totals the estimate is labeled');
});

check('unsupported types are excluded from both keyed and keyless analysis', () => {
  const qs = [question(1), question(2, { type: 'Essay' }), question(3, { type: 'MultipleAnswer' })];
  const text = results(qs, [{ answers: qs.map(q => q.options[0]), points: [1, 2, 1], possible: 4, earned: 4 }]);
  const r = analyze(text);
  assert.strictEqual(r.exp.items.length, 1);
  assert.strictEqual(r.exp.skippedItems.length, 2);
  assert.strictEqual(r.map.questions.length, 1);
  assert.strictEqual(analyze(text, mapped(qs)).matched.pairs.length, 1);
  const noMC = analyze(results([qs[1]], [{ answers: ['Invented essay'], points: [2] }]));
  assert.strictEqual(noMC.map, null);
});

check('a universally blank item makes a usable, reloadable map', () => {
  const { map: draft } = analyze(results([question(1)], [{ answers: [''], points: [0] }]));
  const b = E.buildMap({ title: 'Invented blank', questions: draft.questions, tags: { 1: { lt: 'T' } } });
  assert.deepStrictEqual(b.problems, []);
  const pm = E.parseMap(JSON.stringify(b.map));
  assert.ok(pm.map, pm.problems.join('; '));
  assert.strictEqual(pm.map.questions[0].answer, -1);
  const text = results([question(1)], [{ answers: [''], points: [0] }]);
  assert.strictEqual(analyze(text, pm.map).a.students[0].results[0].status, 'blank');
  const invalid = E.buildMap({ questions: draft.questions, tags: {} });
  assert.ok(invalid.problems.length, 'a missing standard still stops the map');
});

check('an edited map can replace a previously inferred answer', () => {
  const q = question(1, { seen: true });
  const b = E.buildMap({ questions: [q], tags: { 1: { lt: 'T' } }, answers: { 1: 'Invented corrected answer' } });
  const pm = E.parseMap(b.map);
  assert.strictEqual(pm.map.questions[0].options[pm.map.questions[0].answer], 'Invented corrected answer');
});

check('new wrong choices remain visible when a saved map is reused', () => {
  const q = question(1, { options: ['Invented correct answer'], seen: true });
  const map = mapped([q]);
  const r = analyze(results([q], [{ answers: ['Invented new wrong answer'], points: [0] }]), map);
  assert.strictEqual(r.a.questions[0].topWrong.text, 'Invented new wrong answer');
  assert.strictEqual(r.a.questions[0].topWrong.count, 1);
  assert.strictEqual(r.a.questions[0].correct, 0);
});

check('unmatched map questions are missing evidence, not standards absent from the test', () => {
  const qs = [question(1), question(2, { lt: 'OTHER' })];
  const map = mapped(qs, { T: 'Invented target', OTHER: 'Invented other', UNUSED: 'Invented unused' });
  const { a } = analyze(results([qs[0]], [{ answers: [qs[0].options[0]], points: [1] }]), map);
  const c = E.coverage(map, a);
  assert.deepStrictEqual(c.untested.map(r => r.lt), ['UNUSED']);
  assert.strictEqual(c.rows.find(r => r.lt === 'OTHER').status, 'unmatched');
});

check('duplicate and overlapping exports cannot silently double-count named students', () => {
  const q = question(1);
  const one = results([q], [{ id: '1', answers: [q.options[0]], points: [1] }]);
  const overlap = results([q], [{ id: '1', answers: [q.options[1]], points: [0] }]);
  const exp = E.combineExports([{ text: one, label: 'A' }, { text: overlap, label: 'B' }]);
  assert.strictEqual(exp.blocked, true);
  assert.ok(exp.notes.some(n => /overlap|same student/i.test(n)));
  const clean = E.combineExports([{ text: one, label: 'A' }, { text: results([q], [{ id: '2', answers: [q.options[0]], points: [1] }]), label: 'B' }]);
  assert.ok(!clean.blocked, 'different students can still combine');
});

check('repeated stems align across classes by identity, never by column order', () => {
  const stem = 'Which invented statement is true?';
  const a = { id: 'a', stem }, b = { id: 'b', stem };
  const one = results([a, b], [{ id: '1', answers: ['Yes', 'No'], points: [1, 0] }]);
  const two = results([b, a], [{ id: '2', answers: ['Yes', 'No'], points: [0, 0] }]);
  const exp = E.combineExports([{ text: one }, { text: two }]);
  assert.ok(!exp.blocked, exp.notes.join('; '));
  const student = exp.students.find(s => s.id === '2');
  assert.strictEqual(exp.items.find(it => it.itemId === 'a').responses[student.key].response, 'No');
  assert.strictEqual(exp.items.find(it => it.itemId === 'b').responses[student.key].response, 'Yes');
});

check('a malformed CSV is refused with a useful message', () => {
  const exp = E.readExport('Name,ID,Question\nInvented,1,"unfinished');
  assert.strictEqual(exp.layout, 'unknown');
  assert.strictEqual(exp.items.length, 0);
  assert.ok(/unfinished quoted cell/.test(exp.notes[0]));
  assert.strictEqual(E.readExport('Name,ID,Question\nInvented,1,"finished"').items.length, 1, 'a complete quoted cell remains valid');
});

check('spreadsheet downloads neutralize formulas without changing import CSV semantics', () => {
  assert.strictEqual(E.csvCell('=1+1'), '=1+1', 'the general CSV encoder preserves input data');
  const map = mapped([question(1)]);
  const text = results([question(1)], [{ name: '=1+1', section: '@invented', answers: ['Invented wrong'], points: [0] }]);
  const { a } = analyze(text, map);
  const rows = E.parseCsv(E.planCsv(a));
  assert.strictEqual(rows[1][0], "'=1+1");
  assert.strictEqual(rows[1][1], "'@invented");
  assert.strictEqual(rows[1][2], '0', 'numeric cells remain numeric');
});

check('text normalization preserves mathematical distinctions and non-Latin text', () => {
  assert.doesNotThrow(() => E.norm('&#999999999;'));
  assert.notStrictEqual(E.norm('x < 5 and y > 2'), E.norm('x > 5 and y < 2'));
  assert.notStrictEqual(E.norm('北京'), E.norm('東京'));
  assert.strictEqual(E.norm('<p>Caf&eacute; test</p>'), E.norm('Caf&eacute; test'), 'HTML still strips');
});

console.log(failed ? '\n' + failed + ' reliability checks failed' : '\nAll reliability checks passed.');
process.exitCode = failed ? 1 : 0;
