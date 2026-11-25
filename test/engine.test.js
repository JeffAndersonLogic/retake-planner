#!/usr/bin/env node
'use strict';
// The Retake Planner engine (retake-planner-engine.js). Offline; `npm test` runs it.
//
// What it proves, on invented questions and invented students only (a real test's
// questions are its answer key and never live in this public repository):
//   - both layouts Canvas might give (one row per student, one row per answer) read
//     to the same results, with Canvas's question order shuffled;
//   - questions are told apart by the answers students chose, even when every
//     question has the same wording;
//   - Canvas's score wins over the key when they disagree, and the count is reported;
//   - a blank answer counts as missed, a question a student never saw does not count;
//   - the latest attempt is the one used;
//   - "missed most" is never looser than "missed any";
//   - a broken map is refused with a reason, and an unknown file is not guessed at;
//   - the New Quizzes Student Analysis shape seen on 2026-11-23 (five columns per
//     question, no name column) reads, with students numbered by row;
//   - with no question map, Canvas's own points give the same right and wrong;
//   - grouping by topic, learning target or question;
//   - retake prompts carry no name or id, honour the question count, and list only
//     what the student missed; the class report sorts most missed first;
//   - negative controls show each check can fail.

const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, '..', 'retake-planner-engine.js'));

let failed = 0;
function ok(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${name}\n        ${String(e.message).split('\n').join('\n        ')}`); }
}

// Six invented questions on three targets. Every stem is the same on purpose.
function inventedMap(overrides) {
  const targets = { 'Z.1 LT1': 'I can explain one.', 'Z.1 LT2': 'I can explain two.', 'Z.2 LT1': 'I can compare three.' };
  const lts = Object.keys(targets);
  const questions = [];
  for (let n = 1; n <= 6; n += 1) {
    questions.push({ n, lt: lts[Math.floor((n - 1) / 2)], stem: 'The source best illustrates which development?',
      options: [1, 2, 3, 4].map(k => `Invented question ${n}, choice ${k}, a sentence long enough to read`), answer: (n + 1) % 4, points: 2 });
  }
  return Object.assign({ format: E.MAP_FORMAT, title: 'Invented', targets, questions }, overrides || {});
}
const MAP = E.parseMap(JSON.stringify(inventedMap())).map;
// who missed what: student index -> question numbers missed
const MISSES = { 0: [1], 1: [1, 2, 5], 2: [], 3: [3, 4, 6] };
const NAMES = ['Ann Invented', 'Ben Invented', 'Cat Invented', 'Dan Invented'];
const ORDER = [4, 1, 5, 0, 3, 2]; // Canvas shuffled the questions

function choiceFor(q, s) { return MISSES[s].includes(q.n) ? (q.answer + 1) % 4 : q.answer; }
function wide(opts) {
  const o = opts || {};
  const head = ['name', 'id', 'sis_id', 'section', 'section_id', 'section_sis_id', 'submitted', 'attempt'];
  ORDER.forEach(i => { head.push(`${500 + i}: <p>${MAP.questions[i].stem}</p>`); head.push('2.0'); });
  head.push('n correct', 'n incorrect', 'score');
  const rows = [head];
  NAMES.forEach((name, s) => {
    const r = [name, String(s + 1), '', s < 2 ? 'Green' : 'Silver', '', '', '2026-10-28', '1'];
    ORDER.forEach(i => {
      const q = MAP.questions[i];
      const c = choiceFor(q, s);
      r.push(q.options[c]);
      r.push(c === q.answer ? '2.0' : '0.0');
    });
    r.push('', '', '');
    rows.push(r);
  });
  if (o.mutate) o.mutate(rows);
  return rows.map(r => r.map(E.csvCell).join(',')).join('\n');
}
function long(opts) {
  const o = opts || {};
  const rows = [['Student Name', 'Student ID', 'Section', 'Attempt', 'Item Position', 'Item ID', 'Question Text', 'Answer', 'Points Received', 'Points Possible', 'Status']];
  NAMES.forEach((name, s) => ORDER.forEach((i, pos) => {
    const q = MAP.questions[i];
    const c = choiceFor(q, s);
    rows.push([name, String(s + 1), s < 2 ? 'Green' : 'Silver', '1', String(pos + 1), 'item-' + i, q.stem, q.options[c], c === q.answer ? '2' : '0', '2', 'Graded']);
  }));
  if (o.mutate) o.mutate(rows);
  return rows.map(r => r.map(E.csvCell).join(',')).join('\r\n');
}
function run(csv, options, map) {
  const m = map || MAP;
  const exp = E.readExport(csv);
  const matched = E.match(m, exp);
  return { exp, matched, a: E.analyze(m, exp, matched, options || {}) };
}
function summary(a) {
  return a.students.filter(s => s.took).map(s => `${s.name}:${s.earned}/${s.possible}:${s.targetsMissed.map(e => e.lt + '=' + e.questions.join('.')).join(',')}`).join(' | ');
}

const EXPECTED = 'Ann Invented:10/12:Z.1 LT1=1 | Ben Invented:6/12:Z.1 LT1=1.2,Z.2 LT1=5 | Cat Invented:12/12: | Dan Invented:6/12:Z.1 LT2=3.4,Z.2 LT1=6';

ok('CSV: quotes, doubled quotes, line breaks inside a cell, a byte-order mark', () => {
  const rows = E.parseCsv('﻿a,"b, c","say ""hi""","two\nlines"\r\n1,2,3,4\n');
  assert.deepStrictEqual(rows, [['a', 'b, c', 'say "hi"', 'two\nlines'], ['1', '2', '3', '4']]);
  assert.deepStrictEqual(E.parseCsv('x;y\n1;2'), [['x', 'y'], ['1', '2']], 'semicolon files from Excel');
});

ok('one row per student, Canvas order shuffled: every question placed by its answers', () => {
  const { exp, matched, a } = run(wide());
  assert.strictEqual(exp.layout, 'wide');
  assert.strictEqual(matched.pairs.length, 6);
  assert.strictEqual(matched.unmatchedQuestions.length, 0);
  matched.pairs.forEach(p => assert.ok(p.item.label.includes('source best illustrates'), 'the question wording is the label'));
  assert.strictEqual(summary(a), EXPECTED);
});

ok('one row per answer gives exactly the same results', () => {
  const { exp, a } = run(long());
  assert.strictEqual(exp.layout, 'long');
  assert.strictEqual(summary(a), EXPECTED);
});

ok('negative control: a different student\'s misses change the result', () => {
  const { a } = run(wide({ mutate: rows => { const q = MAP.questions[ORDER[0]]; rows[3][8] = q.options[(q.answer + 2) % 4]; rows[3][9] = '0.0'; } }));
  assert.notStrictEqual(summary(a), EXPECTED);
});

ok('a blank answer counts as missed; a question never shown does not count', () => {
  const { a } = run(long({ mutate: rows => {
    rows.forEach(r => {
      if (r[0] === 'Cat Invented' && r[5] === 'item-0') { r[7] = ''; r[8] = '0'; r[10] = 'No Answer'; }
      if (r[0] === 'Cat Invented' && r[5] === 'item-5') { r[7] = ''; r[8] = ''; r[10] = 'Not Attempted'; }
    });
  } }));
  const cat = a.students.find(s => s.name === 'Cat Invented');
  assert.strictEqual(cat.possible, 10, 'the unseen question leaves the denominator');
  assert.strictEqual(cat.earned, 8);
  assert.deepStrictEqual(cat.targetsMissed.map(e => e.lt), ['Z.1 LT1']);
  assert.strictEqual(cat.results.find(r => r.q.n === 1).status, 'blank');
});

ok('Canvas\'s score wins over the key, and the disagreement is reported', () => {
  // Canvas gave Ann full marks on question 1 (a regrade), though she chose a wrong choice.
  const col = 8 + ORDER.indexOf(0) * 2 + 1;
  const { a } = run(wide({ mutate: rows => { rows[1][col] = '2.0'; } }));
  const ann = a.students.find(s => s.name === 'Ann Invented');
  assert.strictEqual(ann.earned, 12);
  assert.strictEqual(ann.targetsMissed.length, 0);
  assert.ok(a.notes.some(n => /scored differently by Canvas than by the key/.test(n)), a.notes.join(' / '));
});

ok('with no score columns, the key decides', () => {
  const { a } = run(wide({ mutate: rows => rows.forEach(r => { for (let c = 9; c < 8 + 12; c += 2) r[c] = ''; }) }));
  assert.strictEqual(summary(a), EXPECTED);
});

ok('the latest attempt is used', () => {
  const { exp, a } = run(wide({ mutate: rows => {
    const retry = rows[2].slice(); // Ben again, attempt 2, everything right
    retry[7] = '2';
    ORDER.forEach((i, k) => { retry[8 + k * 2] = MAP.questions[i].options[MAP.questions[i].answer]; retry[9 + k * 2] = '2.0'; });
    rows.splice(1, 0, retry); // earlier in the file than attempt 1
  } }));
  assert.ok(exp.notes.some(n => /latest attempt/.test(n)));
  assert.strictEqual(a.students.find(s => s.name === 'Ben Invented').earned, 12);
});

ok('"missed most" never lists more than "missed any", and differs when it should', () => {
  const any = run(wide(), { rule: 'any' }).a;
  const most = run(wide(), { rule: 'most' }).a;
  const count = x => x.students.reduce((t, s) => t + s.targetsMissed.length, 0);
  assert.ok(count(most) <= count(any));
  // Dan missed both Z.1 LT2 questions (kept) and one of two Z.2 LT1 (dropped: half is not most).
  assert.deepStrictEqual(most.students.find(s => s.name === 'Dan Invented').targetsMissed.map(e => e.lt), ['Z.1 LT2']);
});

ok('a class filter keeps only that class', () => {
  const { a } = run(wide(), { section: 'Silver' });
  assert.deepStrictEqual(a.students.map(s => s.name), ['Cat Invented', 'Dan Invented']);
});

ok('the plan text and CSV carry every student, and projector safe carries no name', () => {
  const { a } = run(wide());
  const text = E.planText(a, {});
  NAMES.forEach(n => assert.ok(text.includes(n), n));
  assert.ok(/Cat Invented.*\n  Nothing to retake/.test(text));
  const anon = E.planText(a, { anon: true }) + E.planCsv(a, { anon: true });
  NAMES.forEach(n => assert.ok(!anon.includes(n), n + ' leaked'));
  assert.ok(anon.includes('Student 4'));
  const rows = E.parseCsv(E.planCsv(a, {}));
  assert.strictEqual(rows.length, 1 + 1 + 2 + 1 + 2, 'one row per student per target, one for a student with none');
});

ok('per question: percent correct and the most-chosen wrong answer', () => {
  const { a } = run(wide());
  const q1 = a.questions.find(x => x.q.n === 1);
  assert.strictEqual(q1.correct, 2);
  assert.strictEqual(q1.answered, 4);
  assert.strictEqual(q1.topWrong.count, 2);
  assert.strictEqual(q1.topWrong.choice, (MAP.questions[0].answer + 1) % 4);
});

ok('a map under the earlier format name is still read', () => {
  const old = inventedMap({ format: 'behistorical-retake-map/1' });
  assert.ok(E.parseMap(JSON.stringify(old)).map, 'legacy format refused');
  assert.ok(!E.parseMap(JSON.stringify(inventedMap({ format: 'someone-else/1' }))).map, 'negative control: another format must be refused');
});

ok('a broken map is refused with a reason', () => {
  assert.ok(/not a Retake Planner question map/.test(E.parseMap('{"hello":1}').problems[0]));
  assert.ok(/could not be read as JSON/.test(E.parseMap('name,id\n1,2').problems[0]));
  const bad = inventedMap();
  bad.questions[2].answer = 9;
  assert.ok(E.parseMap(JSON.stringify(bad)).problems.some(p => /Question 3 has no valid correct answer/.test(p)));
  const letter = inventedMap();
  letter.questions[0].answer = 'C';
  assert.strictEqual(E.parseMap(JSON.stringify(letter)).map.questions[0].answer, 2, 'a letter answer is read');
});

ok('a Canvas file from a different test matches nothing', () => {
  const other = inventedMap();
  other.questions.forEach(q => { q.options = q.options.map(o => o.replace('Invented', 'Unrelated')); q.stem = 'Something else entirely, question ' + q.n; });
  const { matched } = run(wide(), {}, E.parseMap(JSON.stringify(other)).map);
  assert.strictEqual(matched.pairs.length, 0);
});

ok('a file with no student column is not guessed at', () => {
  const exp = E.readExport('colour,size\nred,2\nblue,3');
  assert.strictEqual(exp.layout, 'unknown');
  assert.ok(/No student column/.test(exp.notes[0]));
});

ok('per-question columns named "... - Response" and "... - Points" are read too', () => {
  const head = ['Student Name', 'Student ID'];
  ORDER.forEach(i => { head.push(`Item ${i}: ${MAP.questions[i].stem} - Response`, `Item ${i}: ${MAP.questions[i].stem} - Points`); });
  const rows = [head];
  NAMES.forEach((name, s) => {
    const r = [name, String(s + 1)];
    ORDER.forEach(i => { const q = MAP.questions[i]; const c = choiceFor(q, s); r.push(q.options[c], c === q.answer ? '2' : '0'); });
    rows.push(r);
  });
  const { matched, a } = run(rows.map(r => r.map(E.csvCell).join(',')).join('\n'));
  assert.strictEqual(matched.pairs.length, 6);
  assert.strictEqual(summary(a), EXPECTED);
});

/* ── 2026-11-23: the real export shape, no-map mode, topics, prompts ─────── */

// The New Quizzes Student Analysis shape, with invented questions and answers:
// "Status, ItemID, ItemType, <wording>, EarnedPoints" per question, a summary at the
// end, trailing empty columns, and (as pasted by Jeff) no name column.
function studentAnalysis(opts) {
  const o = opts || {};
  const head = o.named ? ['Name', 'ID'] : [];
  ORDER.forEach(i => head.push('Status', 'ItemID', 'ItemType', MAP.questions[i].stem, 'EarnedPoints'));
  head.push('Status', 'NumberOfCorrect', 'NumberOfIncorrect', 'NoResponse', 'PointsPossible', 'OverallScore', '', '', '');
  const rows = [head];
  NAMES.forEach((name, s) => {
    const r = o.named ? [name, String(s + 1)] : [];
    ORDER.forEach(i => {
      const q = MAP.questions[i];
      const c = choiceFor(q, s);
      r.push('Graded', 'item-' + i, 'Multiple Choice', q.options[c], c === q.answer ? '2' : '0');
    });
    r.push('Submitted', '', '', '', '12', '', '', '', '');
    rows.push(r);
  });
  if (o.mutate) o.mutate(rows);
  return rows.map(r => r.map(E.csvCell).join(',')).join('\n');
}
// The same summary with "Row N" in place of each name: Ann is row 2.
const ROWS = EXPECTED.replace('Ann Invented', 'Row 2').replace('Ben Invented', 'Row 3').replace('Cat Invented', 'Row 4').replace('Dan Invented', 'Row 5');

ok('the Student Analysis shape with no name column: students by row, every question placed', () => {
  const { exp, matched, a } = run(studentAnalysis());
  assert.strictEqual(exp.shape, 'student-analysis');
  assert.strictEqual(exp.items.length, 6, 'Status, ItemID, ItemType and EarnedPoints are not questions');
  assert.strictEqual(exp.items[0].type, 'Multiple Choice');
  assert.ok(exp.notes.some(n => /no student name column/.test(n)));
  assert.strictEqual(matched.pairs.length, 6);
  assert.strictEqual(summary(a), ROWS);
  assert.strictEqual(summary(run(studentAnalysis({ named: true })).a), EXPECTED, 'with names, the names are used');
});

ok('negative control: without its EarnedPoints columns, a nameless file is not guessed at', () => {
  const csv = studentAnalysis().split('\n').map(line => line.replace(/EarnedPoints/g, 'Something'));
  assert.strictEqual(E.readExport(csv.join('\n')).layout, 'unknown');
});

ok('two questions worded the same stay two questions in the Student Analysis shape', () => {
  // Every invented question has the same wording; six columns must stay six.
  const exp = E.readExport(studentAnalysis());
  assert.strictEqual(new Set(exp.items.map(i => i.key)).size, 6);
});

ok('no question map: Canvas\'s points give the same right and wrong as the key', () => {
  const exp = E.readExport(wide());
  const k = E.mapFromExport(exp, 'Invented test');
  assert.ok(k.map && k.map.keyless);
  const a = E.analyze(k.map, exp, k.matched, {});
  assert.strictEqual(a.by, 'question');
  const byMap = run(wide()).a;
  const marks = x => x.students.map(s => s.name + ':' + s.earned + '/' + s.possible + ':' + s.results.filter(r => r.status !== 'correct').length).sort().join(' | ');
  assert.strictEqual(marks(a), marks(byMap));
  assert.strictEqual(a.notes.filter(n => /scored differently/.test(n)).length, 0, 'no false disagreement without a key');
  // Every invented question was answered right by someone, so each has a known answer.
  k.map.questions.forEach(q => assert.ok(q.answer >= 0, 'Q' + q.n + ' has no inferred answer'));
});

ok('no question map: a question nobody got right is wrong for everyone, with no answer guessed', () => {
  const col = 8 + ORDER.indexOf(0) * 2 + 1; // question 1's points
  const exp = E.readExport(wide({ mutate: rows => rows.slice(1).forEach(r => { r[col] = '0.0'; }) }));
  const k = E.mapFromExport(exp);
  const q = k.matched.pairs.find(p => p.item.label.includes('source') && Object.values(p.item.responses).every(r => r.score === 0)).q;
  assert.strictEqual(q.answer, -1);
  const a = E.analyze(k.map, exp, k.matched, {});
  const i = k.matched.pairs.findIndex(p => p.q === q);
  a.students.forEach(s => assert.strictEqual(s.results[i].status, 'wrong'));
});

ok('no question map and no points: refused with a reason', () => {
  const exp = E.readExport(wide({ mutate: rows => rows.forEach(r => { for (let c = 9; c < 8 + 12; c += 2) r[c] = ''; }) }));
  const k = E.mapFromExport(exp);
  assert.strictEqual(k.map, null);
  assert.ok(/no points/.test(k.problem));
});

ok('when only points earned are given, the most anyone earned stands for full marks', () => {
  const exp = E.readExport(studentAnalysis());
  exp.items.forEach(it => Object.values(it.responses).forEach(r => assert.strictEqual(r.possible, 2)));
});

// Topics: questions 1 to 4 are Z.1, 5 and 6 are Z.2.
function topicMap() {
  const m = inventedMap();
  m.questions.forEach(q => { q.topic = q.n <= 4 ? 'Z.1' : 'Z.2'; });
  m.topics = { 'Z.1': 'Invented topic one' };
  return E.parseMap(JSON.stringify(m)).map;
}

ok('grouping: topic by default when the map has topics, learning target or question on request', () => {
  const tm = topicMap();
  const t = run(wide(), {}, tm).a;
  assert.strictEqual(t.by, 'topic');
  assert.deepStrictEqual(t.targets.map(x => x.lt), ['Z.1', 'Z.2']);
  assert.strictEqual(t.targets[0].text, 'Invented topic one');
  assert.deepStrictEqual(t.targets[0].within.map(w => w.lt), ['Z.1 LT1', 'Z.1 LT2'], 'a topic lists its targets');
  const dan = t.students.find(s => s.name === 'Dan Invented');
  assert.deepStrictEqual(dan.targetsMissed.map(e => e.lt + '=' + e.questions.join('.')), ['Z.1=3.4', 'Z.2=6']);
  assert.strictEqual(summary(run(wide(), { by: 'lt' }, tm).a), EXPECTED, 'by learning target, the original plan');
  assert.strictEqual(run(wide(), { by: 'question' }, tm).a.targets.length, 6);
  assert.strictEqual(run(wide(), { by: 'topic' }).a.by, 'lt', 'a map with no topics falls back to targets');
  assert.deepStrictEqual(t.columns.map(c => c.key + ':' + c.cols.length), ['Z.1:4', 'Z.2:2'], 'heat map columns by topic');
});

ok('the class report: most missed first, and projector safe drops question wording', () => {
  const { a } = run(wide());
  const rows = E.reportRows(a);
  for (let i = 1; i < rows.length; i += 1) assert.ok(rows[i - 1].pct <= rows[i].pct, 'not sorted');
  // Z.1 LT1: 5 of 8 right. Z.2 LT1 and Z.1 LT2: 6 of 8 each; the one more students
  // need (Z.2 LT1: Ben and Dan) comes first.
  assert.deepStrictEqual(rows.map(r => r.lt), ['Z.1 LT1', 'Z.2 LT1', 'Z.1 LT2']);
  const csv = E.parseCsv(E.reportCsv(a));
  assert.strictEqual(csv[0][0], 'learning target');
  assert.strictEqual(csv[1][3], '63');
  const byQ = run(wide(), { by: 'question' }, topicMap()).a;
  assert.ok(/source best illustrates/.test(E.reportCsv(byQ)), 'negative control: the wording is there by default');
  assert.ok(!/source best illustrates/.test(E.reportCsv(byQ, { anon: true })), 'question wording leaked to the projector');
});

// A prompt must never carry a name or a student id.
function leaks(text) { return NAMES.filter(n => text.includes(n)).concat(NAMES.map(n => n.split(' ')[0]).filter(n => text.includes(n))); }

ok('a retake prompt: no names, the student number, what they missed, and the count asked for', () => {
  const { a } = run(wide(), {}, topicMap());
  const ben = a.students.find(s => s.name === 'Ben Invented');
  const p = E.retakePrompt(a, ben, { count: 4 });
  assert.deepStrictEqual(leaks(p), [], 'a name leaked');
  assert.ok(leaks('Ben Invented').length, 'negative control: the leak check finds a name');
  assert.ok(p.includes('Student ' + ben.n + ' missed'));
  assert.ok(/Write 4 new open-ended retake questions/.test(p));
  assert.ok(/Do not write multiple-choice questions/.test(p));
  // Ben missed questions 1, 2 and 5: exactly those, each with his answer and the right one.
  assert.strictEqual((p.match(/^\d+\. Topic/gm) || []).length, 3);
  [1, 2, 5].forEach(n => {
    const q = MAP.questions[n - 1];
    assert.ok(p.includes('question ' + n + '\n'), 'question ' + n + ' missing');
    assert.ok(p.includes('The student chose: ' + q.options[(q.answer + 1) % 4]), 'his answer to ' + n);
    assert.ok(p.includes('The correct answer: ' + q.options[q.answer]), 'the right answer to ' + n);
  });
  assert.ok(!p.includes('question 3\n'), 'a question he got right is listed');
  assert.ok(/Write 10 new/.test(E.retakePrompt(a, ben, { count: 99 })), 'the count is capped at 10');
  assert.ok(/Write 1 new open-ended retake question for/.test(E.retakePrompt(a, ben, { count: 1 })));
  assert.strictEqual(E.retakePrompt(a, a.students.find(s => s.name === 'Cat Invented'), {}), '', 'nothing missed, no prompt');
});

ok('test corrections, and one prompt for the whole class', () => {
  const { a } = run(wide());
  const dan = a.students.find(s => s.name === 'Dan Invented');
  const c = E.retakePrompt(a, dan, { style: 'corrections' });
  assert.ok(/Write test corrections/.test(c) && /Do not give the correct answer away/.test(c));
  const all = E.classPrompt(a, { count: 2 });
  assert.deepStrictEqual(leaks(all), []);
  const heads = all.match(/^=== Student \d+ ===$/gm) || [];
  assert.strictEqual(heads.length, 3, 'Ann, Ben and Dan missed something; Cat did not');
  assert.ok(!all.includes('=== Student ' + a.students.find(s => s.name === 'Cat Invented').n + ' ==='));
});

ok('no question map: a prompt still carries the question, the answer chosen and the right answer', () => {
  const exp = E.readExport(studentAnalysis());
  const k = E.mapFromExport(exp, 'Invented test');
  const a = E.analyze(k.map, exp, k.matched, {});
  const p = E.retakePrompt(a, a.students.find(s => s.name === 'Row 3'), { count: 3 });
  assert.ok(/Invented test/.test(p));
  assert.strictEqual((p.match(/^\d+\. Question \d+$/gm) || []).length, 3);
  assert.ok(/The correct answer: Invented question/.test(p));
});

/* ── 2026-11-24: class periods ────────────────────────────────────────── */

ok('a student keeps the same number whichever class is chosen', () => {
  const all = run(wide()).a;
  const silver = run(wide(), { section: 'Silver' }).a;
  silver.students.forEach(s => assert.strictEqual(s.n, all.students.find(x => x.key === s.key).n, s.name));
  assert.deepStrictEqual(silver.students.map(s => s.n), [3, 4], 'Cat and Dan are 3 and 4 in every view');
});

ok('class by class: each class\'s percent per target, only with no class chosen', () => {
  const { a } = run(wide());
  assert.deepStrictEqual(a.sections, ['Green', 'Silver']);
  assert.deepStrictEqual(a.byClass.map(c => c.section + ':' + c.took), ['Green:2', 'Silver:2']);
  // Z.1 LT1 (questions 1 and 2): Green missed 3 of 4 (Ann 1; Ben 1, 2); Silver missed none.
  const pctOf = (sec, lt) => a.byClass.find(c => c.section === sec).targets.find(t => t.lt === lt).pct;
  assert.strictEqual(pctOf('Green', 'Z.1 LT1'), 0.25);
  assert.strictEqual(pctOf('Silver', 'Z.1 LT1'), 1);
  assert.strictEqual(run(wide(), { section: 'Green' }).a.byClass.length, 0, 'negative control: one class has nothing to compare');
  const csv = E.parseCsv(E.reportCsv(a));
  assert.deepStrictEqual(csv[0].slice(-2), ['Green percent correct', 'Silver percent correct']);
});

ok('one file per class period combines into one plan, each file a class', () => {
  const a2 = studentAnalysis();
  const a5 = studentAnalysis({ mutate: rows => { rows.push(rows[1].slice()); } }); // a fifth student, a copy of row 2
  const exp = E.combineExports([{ text: a2, label: 'Period 2' }, { text: a5, label: 'Period 5' }]);
  assert.strictEqual(exp.students.length, 9);
  assert.strictEqual(exp.items.length, 6, 'the same six questions, lined up across files');
  assert.deepStrictEqual([...new Set(exp.students.map(s => s.section))], ['Period 2', 'Period 5']);
  assert.ok(exp.students.some(s => s.name === 'Period 5, Row 2'), 'unnamed rows say which class they are in');
  assert.strictEqual(new Set(exp.students.map(s => s.key)).size, 9, 'Row 2 in two files is two students');
  const matched = E.match(MAP, exp);
  assert.strictEqual(matched.pairs.length, 6);
  const a = E.analyze(MAP, exp, matched, {});
  assert.strictEqual(a.took, 9);
  assert.strictEqual(a.byClass.length, 2);
  // Per class, the same results the file gives on its own.
  const alone = run(a2).a;
  const p2 = E.analyze(MAP, exp, matched, { section: 'Period 2' });
  assert.deepStrictEqual(p2.students.map(s => s.earned), alone.students.map(s => s.earned));
  assert.ok(!exp.notes.some(n => /only some of the files/.test(n)));
});

ok('files from different tests are flagged, and an unreadable file is named', () => {
  const other = inventedMap();
  other.questions.forEach(q => { q.stem = 'A different test, question ' + q.n; });
  const otherCsv = studentAnalysis().replace(/The source best illustrates which development\?/g, 'A different test entirely?');
  const exp = E.combineExports([{ text: studentAnalysis(), label: 'Period 2' }, { text: otherCsv, label: 'Period 3' }, { text: 'colour,size\nred,2', label: 'Period 4' }]);
  assert.ok(exp.notes.some(n => /only some of the files/.test(n)), exp.notes.join(' / '));
  assert.ok(exp.notes.some(n => /^Period 4: No student column/.test(n)), exp.notes.join(' / '));
  assert.deepStrictEqual(exp.files.map(f => f.ok), [true, true, false]);
});

/* ── 2026-11-24: the full Student Analysis export ──────────────────────── */

// The header of a full export, as Jeff pasted it: student columns with Canvas's
// run-together names, then "ItemID, ItemType, wording, EarnedPoints, Status" per
// question (Status after), then the summary. Points: Canvas gives 1 each; the
// invented map counts 2.
function fullExport(opts) {
  const o = opts || {};
  const head = ['Name', 'ID', 'SISID', 'SectionIDs', 'SectionNames', 'SectionSISIDs', 'Submitted', 'ElapsedTime', 'Attempt'];
  ORDER.forEach(i => head.push('ItemID', 'ItemType', MAP.questions[i].stem, 'EarnedPoints', 'Status'));
  head.push('NumberOfCorrect', 'NumberOfIncorrect', 'NoResponse', 'PointsPossible', 'OverallScore');
  const rows = [head];
  NAMES.forEach((name, s) => {
    const r = [name, String(s + 1), 'S' + s, '77', s < 2 ? 'Period 2' : 'Period 5', 'P', '2026-11-20', '612', '1'];
    ORDER.forEach(i => {
      const q = MAP.questions[i];
      const c = choiceFor(q, s);
      r.push('item-' + i, 'MultipleChoice', q.options[c], c === q.answer ? '1' : '0', c === q.answer ? 'Correct' : 'Incorrect');
    });
    r.push('', '', '', '6', '');
    rows.push(r);
  });
  if (o.mutate) o.mutate(rows);
  return rows.map(r => r.map(E.csvCell).join(o.tab ? '\t' : ',')).join('\r\n');
}

ok('a full Student Analysis export: names, sections from SectionNames, no stray columns', () => {
  const { exp, matched, a } = run(fullExport({ tab: true }));
  assert.strictEqual(exp.items.length, 6, 'SISID, SectionIDs, ElapsedTime, PointsPossible and the rest are not questions: ' + exp.items.map(i => i.label).join(' | '));
  assert.strictEqual(matched.unmatchedItems.length, 0);
  assert.deepStrictEqual([...new Set(exp.students.map(s => s.section))], ['Period 2', 'Period 5']);
  assert.deepStrictEqual(a.sections, ['Period 2', 'Period 5']);
  assert.strictEqual(a.students.find(s => s.name === 'Ben Invented').section, 'Period 2');
});

ok('scores are in Canvas\'s points, not the key\'s', () => {
  const { a } = run(fullExport());
  // Canvas: 1 point each, six questions. The invented map says 2 each.
  assert.deepStrictEqual(a.students.map(s => s.earned + '/' + s.possible), ['5/6', '3/6', '6/6', '3/6']);
  assert.strictEqual(a.possible, 6);
  assert.deepStrictEqual(run(wide()).a.students.map(s => s.earned + '/' + s.possible), ['10/12', '6/12', '12/12', '6/12'], 'negative control: a file that says 2 points each still reads 2');
});

ok('a Status after EarnedPoints belongs to the question before it', () => {
  // Cat never saw the question in Canvas's second block: that one is left out, and the
  // question after it still counts.
  const cols = 9 + 1 * 5; // start of the second block
  const { exp, a } = run(fullExport({ mutate: rows => { rows[3][cols + 2] = ''; rows[3][cols + 3] = ''; rows[3][cols + 4] = 'Not Attempted'; } }));
  const second = exp.items[1].label, third = exp.items[2];
  const cat = a.students.find(s => s.name === 'Cat Invented');
  const inSecond = cat.results.find(r => norm(r.q.stem) === E.norm(second) && r.status === 'absent');
  assert.ok(inSecond, 'the unseen question is left out');
  assert.strictEqual(cat.possible, 5, 'five questions counted');
  assert.strictEqual(third.responses[Object.keys(third.responses)[2]].status, 'graded', 'the next question keeps its own status');
});
function norm(x) { return E.norm(x); }

ok('accents and quotes scrambled by Excel are repaired; untouched text is left alone', () => {
  const cp = { 0x80: 0x20AC, 0x93: 0x201C, 0x94: 0x201D, 0x9C: 0x153, 0x99: 0x2122 };
  const scramble = t => [...Buffer.from(t, 'utf8')].map(b => String.fromCodePoint(cp[b] || b)).join('');
  const good = 'name,id,Q\nAna Potosí,1,“in search of spices” é\n';
  const fixed = E.readExport(scramble(good));
  assert.strictEqual(fixed.students[0].name, 'Ana Potosí');
  assert.strictEqual(fixed.items[0].responses['1'].response, '“in search of spices” é');
  assert.ok(fixed.notes.some(n => /scrambled/.test(n)));
  const dropped = E.readExport(scramble(good).replace(/\u009d/g, ''));
  assert.strictEqual(dropped.students[0].name, 'Ana Potosí', 'a dropped byte still repairs the rest');
  const clean = E.readExport(good);
  assert.ok(!clean.notes.some(n => /scrambled/.test(n)), 'negative control: clean text is not touched');
  const mixed = 'name,id,Q\nLi 李,1,MÃ©xico\n';
  assert.strictEqual(E.readExport(mixed).students[0].name, 'Li 李', 'text Windows-1252 cannot hold is never re-read');
});

/* ── the Map Maker (2026-11-24) ─────────────────────────────────────────── */

// The Map Maker's questions, from the Canvas file alone, and the tags the teacher (or
// their AI) would give them: each question's real target, found by its correct answer.
function makerDraft(csv) { return E.mapFromExport(E.readExport(csv || wide()), 'Invented').map.questions; }
function realTags(draft) {
  const tags = {};
  draft.forEach(q => {
    const key = MAP.questions.find(m => m.options.includes(q.options[q.answer]));
    tags[q.n] = { topic: key.lt.slice(0, 3), lt: key.lt };
  });
  return tags;
}

ok('Map Maker: a pasted list of standards reads in the forms teachers paste', () => {
  const st = E.parseStandards('3.1 LT1: I can explain gunpowder\nKC-3.1.I\tEmpires expanded\n- WH.4.2 - Analyze trade\nSS.9.12 Explain revolutions\n2) I can compare empires\n\n');
  assert.deepStrictEqual(st.order, ['3.1 LT1', 'KC-3.1.I', 'WH.4.2', 'SS.9.12', 'T1']);
  assert.strictEqual(st.targets['KC-3.1.I'], 'Empires expanded');
  assert.strictEqual(st.targets.T1, 'I can compare empires', 'a line with no code is numbered');
  assert.deepStrictEqual(E.parseStandards('  \n\n').order, [], 'negative control: nothing pasted, no standards');
});

ok('Map Maker: the tagging prompt carries every question and standard, and no student', () => {
  const draft = makerDraft();
  const st = E.parseStandards('Z.1 LT1: I can explain one.\nZ.2 LT1: I can compare three.');
  const text = E.tagPrompt(draft, st, 'Invented');
  draft.forEach(q => assert.ok(text.includes('Q' + q.n + '. '), 'question ' + q.n + ' missing'));
  assert.ok(text.includes('Z.1 LT1: I can explain one.') && text.includes('Z.2 LT1: I can compare three.'), 'standards listed');
  assert.ok(text.includes('Q1 | topic | code'), 'the reply form is given');
  const leaks = t => NAMES.concat(NAMES.map(n => n.split(' ')[0])).filter(n => t.includes(n));
  assert.deepStrictEqual(leaks(text), [], 'a student name reached the prompt');
  assert.ok(!/\b(Green|Silver)\b/.test(text), 'a class name reached the prompt');
  assert.deepStrictEqual(leaks(text + ' Ben'), ['Ben'], 'negative control: the name check finds a name');
  assert.ok(/have not given a list/.test(E.tagPrompt(draft, E.parseStandards(''), 'Invented')), 'with no list, the AI is asked to name the targets');
});

ok('Map Maker: the AI\'s reply is read forgivingly, and its chatter is skipped', () => {
  const r = E.parseTags('Here are the tags you asked for:\n| Q# | Topic | Code |\n|---|---|---|\n| Q1 | 3.1 | KC-3.1.I |\n**Q2** | 3.2 | 3.1 LT1\n3. 3.3 | WH.4.2\nQuestion 4: LT9\n5\t3.1\tSS.9.12\n3.1 LT1: I can explain gunpowder\nLT9: I can do nine');
  assert.strictEqual(r.read, 5);
  assert.deepStrictEqual(r.tags[1], { topic: '3.1', lt: 'KC-3.1.I' });
  assert.deepStrictEqual(r.tags[2], { topic: '3.2', lt: '3.1 LT1' });
  assert.deepStrictEqual(r.tags[3], { topic: '3.3', lt: 'WH.4.2' }, '"3.1 LT1: I can ..." must not overwrite question 3');
  assert.deepStrictEqual(r.tags[4], { topic: '', lt: 'LT9' }, 'a code alone, no topic');
  assert.deepStrictEqual(r.tags[5], { topic: '3.1', lt: 'SS.9.12' }, 'tabs');
  assert.strictEqual(r.targets.LT9, 'I can do nine', 'a code the AI explained');
  assert.strictEqual(E.parseTags('Sure! I would be glad to help.\nTopic | Code').read, 0, 'negative control: no tags, none read');
});

ok('Map Maker: its map gives exactly the results of the hand-written key', () => {
  const draft = makerDraft();
  assert.strictEqual(draft.length, 6);
  assert.ok(draft.every(q => q.answer >= 0), 'every question has a correct answer from Canvas\'s points');
  const built = E.buildMap({ title: 'Invented', questions: draft, tags: realTags(draft), targets: MAP.targets });
  assert.deepStrictEqual(built.problems, []);
  const pm = E.parseMap(JSON.stringify(built.map));
  assert.deepStrictEqual(pm.problems, [], 'the saved file reads back');
  const { matched, a } = run(wide(), { by: 'lt' }, pm.map);
  assert.strictEqual(matched.pairs.length, 6);
  assert.ok(!matched.pairs.some(p => p.partial), 'no false alarm about choices it did not list');
  // A map made from the Canvas file numbers the questions in Canvas's order; the key
  // numbers them its own way. Translated to the key's numbers, every result is the same.
  const keyN = new Map(draft.map(q => [q.n, MAP.questions.find(m => m.options.includes(q.options[q.answer])).n]));
  const inKeyNumbers = x => { x.students.forEach(s => s.targetsMissed.forEach(e => { e.questions = e.questions.map(n => keyN.get(n)).sort((p, q) => p - q); })); return summary(x); };
  assert.strictEqual(inKeyNumbers(a), EXPECTED);
  assert.strictEqual(inKeyNumbers(run(long(), { by: 'lt' }, pm.map).a), EXPECTED, 'the same map reads the other layout too');
  const byTopic = run(wide(), {}, pm.map).a;
  assert.deepStrictEqual(byTopic.targets.map(t => t.lt), ['Z.1', 'Z.2'], 'grouped by the topics given');
  const wrongTags = realTags(draft);
  const swap = Object.keys(wrongTags).find(n => wrongTags[n].lt === 'Z.2 LT1');
  wrongTags[swap] = { topic: 'Z.1', lt: 'Z.1 LT1' };
  const off = E.parseMap(JSON.stringify(E.buildMap({ title: 'x', questions: draft, tags: wrongTags, targets: MAP.targets }).map)).map;
  assert.notStrictEqual(inKeyNumbers(run(wide(), { by: 'lt' }, off).a), EXPECTED, 'negative control: a wrong tag changes the results');
});

ok('Map Maker: an untagged question is named, and the map is not made', () => {
  const draft = makerDraft();
  const tags = realTags(draft);
  delete tags[4];
  tags[2] = { topic: '3.1', lt: '  ' };
  const b = E.buildMap({ title: 'x', questions: draft, tags });
  assert.strictEqual(b.problems.length, 1);
  assert.ok(/questions 2, 4\./.test(b.problems[0]), b.problems[0]);
});

ok('Map Maker: a question everyone got right, or nobody did, still makes a map', () => {
  // Everyone right on one question (one choice seen); everyone wrong on another (no answer known).
  const allRight = 8 + ORDER.indexOf(1) * 2;
  const allWrong = 8 + ORDER.indexOf(0) * 2;
  const csv = wide({ mutate: rows => rows.slice(1).forEach(r => {
    r[allRight] = MAP.questions[1].options[MAP.questions[1].answer]; r[allRight + 1] = '2.0';
    r[allWrong] = MAP.questions[0].options[(MAP.questions[0].answer + 1) % 4]; r[allWrong + 1] = '0.0';
  }) });
  const draft = makerDraft(csv);
  const one = draft.find(q => q.options.length === 1);
  const none = draft.find(q => q.answer < 0);
  assert.ok(one && none, 'both kinds are in the draft');
  const tags = {};
  draft.forEach(q => { tags[q.n] = { topic: 'Z', lt: 'Z LT' }; });
  const plainMap = E.parseMap(JSON.stringify(E.buildMap({ title: 'x', questions: draft, tags }).map));
  assert.deepStrictEqual(plainMap.problems, [], 'accepted: ' + plainMap.problems.join(' '));
  assert.ok(plainMap.warnings.some(w => /no correct answer in the map/.test(w)), 'the unknown answer is said');
  const exp = E.readExport(csv);
  const a = E.analyze(plainMap.map, exp, E.match(plainMap.map, exp), { by: 'question' });
  const q = a.questions.find(x => x.q.n === none.n);
  assert.strictEqual(q.correct, 0, 'Canvas\'s points still mark everyone wrong');
  const typed = E.buildMap({ title: 'x', questions: draft, tags, answers: { [none.n]: 'The real answer, typed by the teacher' } }).map;
  const tq = typed.questions.find(x => x.n === none.n);
  assert.strictEqual(tq.options[tq.answer], 'The real answer, typed by the teacher', 'a typed answer becomes the key');
  // Negative control: the relaxed rules are only for the Map Maker's own maps.
  const strict = JSON.parse(JSON.stringify(typed));
  strict.questions.forEach(x => { delete x.seen; });
  strict.questions.find(x => x.n === one.n).answer = 0;
  assert.ok(E.parseMap(JSON.stringify(strict)).problems.some(p => /fewer than two/.test(p)), 'a hand-written map still needs two choices');
});

/* ── standards coverage (2026-11-25) ────────────────────────────────────── */
// Jeff's rules: a standard is tested by at least 2 questions; a student has shown it when
// every one of its questions is right; the class and each student.
// The invented test: Z.1 LT1 is questions 1-2, Z.1 LT2 is 3-4, Z.2 LT1 is 5-6, and
// Ann missed 1; Ben 1, 2 and 5; Cat nothing; Dan 3, 4 and 6.
function covSummary(cov, a) {
  const name = new Map(a.students.map(s => [s.key, s.name.split(' ')[0]]));
  return cov.rows.map(r => r.lt + ':' + r.status + ':' + r.shown.map(k => name.get(k)).join('.') + '/' + r.notYet.map(k => name.get(k)).join('.') + '/' + r.few.map(k => name.get(k)).join('.')).join(' | ');
}

ok('standards: tested by 2 or more questions, shown only with every question right', () => {
  const { a } = run(wide());
  const cov = E.coverage(MAP, a);
  assert.strictEqual(E.MIN_QUESTIONS, 2);
  assert.strictEqual(covSummary(cov, a), 'Z.1 LT1:tested:Cat.Dan/Ann.Ben/ | Z.1 LT2:tested:Ann.Ben.Cat/Dan/ | Z.2 LT1:tested:Ann.Cat/Ben.Dan/');
  assert.strictEqual(cov.tested, 3);
  assert.deepStrictEqual(cov.students.map(s => s.shown), [2, 1, 3, 1], 'each student\'s count of standards shown');
  assert.strictEqual(cov.rows[0].pct, 0.5);
  // Negative control: one more miss for Cat turns her shown standard into not yet.
  const q = MAP.questions[0];
  const col = 8 + ORDER.indexOf(0) * 2;
  const { a: b } = run(wide({ mutate: rows => { rows[3][col] = q.options[(q.answer + 1) % 4]; rows[3][col + 1] = '0.0'; } }));
  assert.ok(/Z\.1 LT1:tested:Dan\/Ann\.Ben\.Cat\//.test(covSummary(E.coverage(MAP, b), b)), covSummary(E.coverage(MAP, b), b));
});

ok('standards: one question is too few to judge; a listed standard no question asks is not on the test', () => {
  const m = inventedMap();
  m.questions[5].lt = 'Z.3 LT1';
  m.targets['Z.3 LT1'] = 'I can explain three.';
  m.targets['Z.9 LT1'] = 'I can explain nine.';
  const map = E.parseMap(JSON.stringify(m)).map;
  const { a } = run(wide(), {}, map);
  const cov = E.coverage(map, a);
  const z2 = cov.rows.find(r => r.lt === 'Z.2 LT1');
  assert.strictEqual(z2.status, 'thin');
  assert.strictEqual(z2.few.length, 4, 'every student: too few questions');
  assert.strictEqual(z2.pct, null);
  assert.strictEqual(cov.rows.find(r => r.lt === 'Z.3 LT1').status, 'thin');
  assert.deepStrictEqual(cov.untested.map(r => r.lt), ['Z.9 LT1']);
  assert.strictEqual(cov.tested, 2);
  assert.strictEqual(cov.thin, 2);
  assert.deepStrictEqual(E.coverage(MAP, run(wide()).a).untested, [], 'negative control: a full list has nothing untested');
});

ok('standards: a student who saw only one of a standard\'s questions is not judged on it', () => {
  const { a } = run(long({ mutate: rows => rows.forEach(r => {
    if (r[0] === 'Cat Invented' && r[5] === 'item-1') { r[7] = ''; r[8] = ''; r[10] = 'Not Attempted'; }
  }) }));
  const cov = E.coverage(MAP, a);
  assert.strictEqual(covSummary(cov, a).split(' | ')[0], 'Z.1 LT1:tested:Dan/Ann.Ben/Cat');
  assert.strictEqual(cov.rows[0].pct, 1 / 3, 'judged on the three who saw both questions');
});

ok('standards: the download has a row per student and per class, and no names when projector safe', () => {
  const { a } = run(wide());
  const cov = E.coverage(MAP, a);
  const rows = E.parseCsv(E.coverageCsv(cov, a));
  assert.deepStrictEqual(rows[0], ['student', 'section', 'standards shown', 'standards tested', 'Z.1 LT1', 'Z.1 LT2', 'Z.2 LT1']);
  assert.deepStrictEqual(rows[1], ['Ann Invented', 'Green', '2', '3', 'not yet', 'shown', 'shown']);
  assert.deepStrictEqual(rows[5], ['Class: students who showed it', '', '', '', '2 of 4', '3 of 4', '2 of 4']);
  const anon = E.coverageCsv(cov, a, { anon: true });
  assert.ok(!NAMES.some(n => anon.includes(n.split(' ')[0])) && !/Green|Silver/.test(anon), 'projector safe: no names, no classes');
  assert.ok(/Student 1/.test(anon), 'students by number');
  assert.ok(NAMES.some(n => E.coverageCsv(cov, a).includes(n)), 'negative control: names are there when shown');
});

console.log(failed ? `\n${failed} failed` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
