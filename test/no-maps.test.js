#!/usr/bin/env node
'use strict';
// No question map and no real Canvas export is ever committed to this repository.
//
// The repository is public, and GitHub Pages serves every file in it. A question map
// lists every correct answer to a real test; a Canvas Student Analysis export lists
// students by name. Both belong on the teacher's own computer, or in a private store,
// never here. .gitignore keeps the usual names out; this check catches the rest.

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FORMATS = ['retake-planner-map/', 'behistorical-retake-map/'];

function problem(file, text) {
  if (/\.(csv|xlsx|xls|tsv)$/i.test(file)) return 'a spreadsheet or CSV (Canvas exports carry student names)';
  if (/retake-map/i.test(file)) return 'a question map by its name';
  // Maps are data files. A documentation example (the README's sample map) is not one.
  if (text != null && /\.(json|txt)$/i.test(file) && FORMATS.some(f => text.includes('"format"') && text.includes(f)) && /"answer"\s*:/.test(text)) {
    return 'a question map by its contents';
  }
  return null;
}

let failed = 0;
function ok(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${name}\n        ${e.message}`); }
}

ok('negative control: maps and exports are caught, by name and by contents', () => {
  assert.ok(problem('Unit-3-Retake-Map.json', '{}'));
  assert.ok(problem('exports/Unit 3 Quiz Student Analysis Report.csv', ''));
  assert.ok(problem('notes/key.json', '{"format": "retake-planner-map/1", "questions": [{"answer": 2}]}'));
  assert.ok(problem('old.json', '{"format": "behistorical-retake-map/1", "questions": [{"answer": "B"}]}'));
  assert.strictEqual(problem('retake-planner-engine.js', "const MAP_FORMAT = 'retake-planner-map/1';"), null, 'the engine names the format without being a map');
  assert.strictEqual(problem('package.json', '{"name": "retake-planner"}'), null);
  assert.strictEqual(problem('README.md', '{"format": "retake-planner-map/1", "questions": [{"answer": 1}]}'), null, 'a documented example is not a map');
});

ok('no question map or Canvas export is committed', () => {
  let files;
  try { files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean); }
  catch (e) { throw new Error('git ls-files failed: run this inside the repository'); }
  const bad = [];
  for (const f of files) {
    const full = path.join(ROOT, f);
    const text = /\.(json|txt)$/i.test(f) && fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
    const why = problem(f, text);
    if (why) bad.push(`${f}  (${why})`);
  }
  assert.strictEqual(bad.length, 0, 'remove these; this repository is public:\n        ' + bad.join('\n        '));
});

console.log(failed ? `\n${failed} failed` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
