/* Retake Planner, the page. Everything it reads stays in this tab: the files are read
 * with FileReader, held in memory, and dropped on Start over or when the tab closes.
 * Nothing is written to localStorage, sent, or logged. The engine
 * (retake-planner-engine.js) does the reading and counting; this file draws it.
 *
 * Views (Jeff, 2026-11-21): a right-or-wrong heat map, a class report by topic, the
 * student and question tables, and the retake questions, which are prompts the teacher
 * copies into their own AI. The page itself never contacts an AI.
 *
 * Every string from a file (a student's name, an answer, a question) is escaped
 * before it reaches the page. */
(function () {
  'use strict';
  const E = window.BHRetakePlanner;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = x => (x == null ? 'n/a' : Math.round(x * 100) + '%');

  const state = {
    exports: [], mapText: null, mapName: '', rule: 'any', anon: false, section: '', tab: 'heat', demo: false,
    by: 'topic', style: 'retake', count: 3, sort: 'class',
    // The Map Maker (2026-11-24): what the teacher has typed or pasted, kept only in this
    // tab. Tags are keyed by each question's wording, so adding a second class's file
    // keeps them. madeHere: the map in use was made on this page, so the Map Maker stays
    // open for changes.
    maker: { tags: {}, answers: {}, standards: '', replyTargets: {}, name: '' }, madeHere: false
  };
  let model = null; // { map, exp, matched, analysis }

  /* ── demo: invented questions, invented students ──────────────────────── */
  // Placeholder questions only. Nothing here comes from a real test.
  function demoFiles() {
    const targets = {
      'D.1 LT1': 'I can explain the first demo idea.',
      'D.1 LT2': 'I can describe the second demo idea.',
      'D.2 LT1': 'I can compare two demo cases.',
      'D.2 LT2': 'I can explain what caused the demo change.'
    };
    const lts = Object.keys(targets);
    const questions = [];
    for (let n = 1; n <= 8; n += 1) {
      const lt = lts[Math.floor((n - 1) / 2)];
      questions.push({
        n, topic: lt.slice(0, 3), lt, stem: 'Demo question ' + n + ', invented for this page (' + lt + ')',
        options: ['A', 'B', 'C', 'D'].map(l => 'Demo question ' + n + ', invented choice ' + l),
        answer: (n * 3) % 4, points: 2, rationale: 'Invented. Real maps carry the reason each wrong choice is wrong.'
      });
    }
    const map = { format: E.MAP_FORMAT, title: 'Demo test (invented)', version: 'demo', topics: { 'D.1': 'Invented topic one', 'D.2': 'Invented topic two' }, targets, questions };
    const names = ['Avery Demo', 'Blake Demo', 'Casey Demo', 'Devon Demo', 'Emery Demo', 'Finley Demo', 'Harper Demo', 'Jordan Demo', 'Kai Demo', 'Logan Demo', 'Morgan Demo', 'Quinn Demo'];
    // Canvas order is shuffled on purpose: the page must not depend on it.
    const order = [3, 0, 6, 1, 7, 4, 2, 5];
    const head = ['name', 'id', 'section', 'attempt'];
    order.forEach(i => { head.push((7000 + i) + ': ' + questions[i].stem); head.push('2.0'); });
    head.push('n correct', 'n incorrect', 'score');
    const rows = [head];
    names.forEach((name, s) => {
      const r = [name, String(100 + s), s % 2 ? 'Silver' : 'Green', '1'];
      order.forEach(i => {
        const q = questions[i];
        const miss = s !== 2 && s !== 8 && ((s * 5 + i * 3) % 7 === 0 || (s % 4 === 1 && i >= 6) || (s === 7 && i < 3));
        const blank = s === 10 && i === 4;
        const choice = miss ? (q.answer + 1 + (s % 3)) % 4 : q.answer;
        r.push(blank ? '' : q.options[choice]);
        r.push(miss || blank ? '0.0' : '2.0');
      });
      r.push('', '', '');
      rows.push(r);
    });
    return { map: JSON.stringify(map), csv: rows.map(r => r.map(E.csvCell).join(',')).join('\n') };
  }

  /* ── loading ──────────────────────────────────────────────────────────── */
  function looksLikeMap(text) {
    const t = String(text).replace(/^﻿/, '').trimStart();
    return t[0] === '{';
  }
  function readFile(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error || new Error('could not read'));
      fr.readAsText(file);
    });
  }
  async function takeFiles(list) {
    const files = [...list];
    for (const f of files) {
      let text;
      try { text = await readFile(f); } catch (e) { showStatus([{ kind: 'warn', html: esc(f.name) + ' could not be read.' }]); continue; }
      if (/\.json$/i.test(f.name) || looksLikeMap(text)) { state.mapText = text; state.mapName = f.name; state.madeHere = false; }
      // Each results file is kept: one per class period. The same file twice is one file.
      else if (!state.exports.some(x => x.text === text)) state.exports.push({ text, name: f.name, label: guessLabel(f.name, state.exports.length) });
    }
    state.demo = false;
    rebuild();
  }

  // "Period 3 Student Analysis Report.csv" names its class; otherwise Class 1, Class 2.
  function guessLabel(name, i) {
    const m = /(?:period|per\.?|hour|hr|block|section|sec)[\s_-]*0*(\d{1,2})\b/i.exec(String(name || ''));
    return m ? 'Period ' + m[1] : 'Class ' + (i + 1);
  }
  const MAP_IDLE = 'Not loaded. Adds topics, learning targets and correct answers. Without it you still see right and wrong on every question.';
  function fileState() {
    const n = state.exports.length;
    $('f-export').classList.toggle('ready', n > 0);
    $('f-map').classList.toggle('ready', !!state.mapText);
    $('f-export-state').textContent = n === 1 ? 'Loaded: ' + state.exports[0].name
      : (n > 1 ? n + ' files loaded, one class each. Name each class:' : 'Not loaded. A .csv file from the quiz\'s Student Analysis report. One file per class period works too.');
    $('f-map-state').textContent = state.mapText ? 'Loaded: ' + state.mapName : MAP_IDLE;
    $('clear').hidden = !(n || state.mapText);
    // With two or more files, each one is a class the teacher names.
    const list = $('class-files');
    list.hidden = n < 2;
    list.innerHTML = n < 2 ? '' : state.exports.map((x, i) => '<li><label class="sr-only" for="class-name-' + i + '">Class name for ' + esc(x.name) + '</label>'
      + '<input class="class-name" id="class-name-' + i + '" data-i="' + i + '" type="text" maxlength="40" value="' + esc(x.label) + '">'
      + '<span class="muted small" title="' + esc(x.name) + '">' + esc(x.name) + '</span>'
      + '<button class="btn remove" type="button" data-i="' + i + '" aria-label="Remove ' + esc(x.name) + '">Remove</button></li>').join('');
  }
  $('class-files').addEventListener('change', e => {
    const input = e.target.closest('input.class-name');
    if (!input) return;
    state.exports[Number(input.dataset.i)].label = input.value.trim() || 'Class ' + (Number(input.dataset.i) + 1);
    rebuild();
  });
  $('class-files').addEventListener('click', e => {
    const b = e.target.closest('button.remove');
    if (!b) return;
    state.exports.splice(Number(b.dataset.i), 1);
    rebuild();
  });

  function showStatus(items) {
    $('status').innerHTML = items.map(i => '<div class="notice ' + i.kind + '">' + i.html + '</div>').join('');
  }
  function hideResults() { $('results').hidden = true; $('maker').hidden = true; stats(null); }
  // "Era 2 Exam Student Analysis Report.csv" names the test well enough for a prompt.
  function titleFromFile(name) {
    const t = String(name || '').replace(/\.[a-z]+$/i, '').replace(/[_]+/g, ' ').replace(/\s*student analysis( report)?\s*/i, ' ').trim();
    return t || 'this test';
  }

  function rebuild() {
    fileState();
    model = null;
    const notices = [];
    let map = null;
    let mapRefused = false;
    if (state.mapText) {
      const pm = E.parseMap(state.mapText);
      if (!pm.map) {
        mapRefused = true;
        notices.push({ kind: 'warn', html: '<b>The question map could not be used.</b><ul>' + pm.problems.map(p => '<li>' + esc(p) + '</li>').join('') + '</ul>' });
      } else {
        map = pm.map;
        if (pm.warnings.length) notices.push({ kind: 'warn', html: '<b>About the question map:</b><ul>' + pm.warnings.map(p => '<li>' + esc(p) + '</li>').join('') + '</ul>' });
      }
    }
    let exp = null;
    if (state.exports.length) {
      exp = state.exports.length === 1 ? E.readExport(state.exports[0].text)
        : E.combineExports(state.exports.map(x => ({ text: x.text, label: x.label })));
      if (!exp.items.length || !exp.students.length) {
        notices.push({ kind: 'warn', html: '<b>The Canvas file could not be read as quiz results.</b><ul>' + (exp.notes.length ? exp.notes : ['No question columns were found.']).map(p => '<li>' + esc(p) + '</li>').join('') + '</ul>Use the Student Analysis report from the quiz\'s Reports page.' });
        exp = null;
      }
    }
    if (!exp || mapRefused) {
      if (!notices.length && state.mapText && !state.exports.length) notices.push({ kind: 'ok', html: 'Question map loaded. Add the Canvas results to see the plan.' });
      showStatus(notices);
      hideResults();
      return;
    }
    const head = state.demo ? '<b>Demo.</b> Every student and question here is invented. ' : '';
    let matched;
    if (map) {
      matched = E.match(map, exp);
      const total = map.questions.length;
      const placed = matched.pairs.length;
      if (!placed) {
        notices.push({ kind: 'warn', html: head + '<b>None of the Canvas questions matched this map.</b> Check that the map is for the same test (' + esc(map.title) + ') as the Canvas file.' });
        showStatus(notices);
        hideResults();
        return;
      }
      const sum = head + 'Matched <b>' + placed + ' of ' + total + '</b> questions in ' + esc(map.title) + (map.version && map.version !== 'demo' ? ' (Version ' + esc(map.version) + ')' : '') + ' to the Canvas file (' + (exp.layout === 'long' ? 'one row per answer' : 'one row per student') + ').';
      const problems = [];
      if (matched.unmatchedQuestions.length) problems.push('Not found in the Canvas file, so left out of every count: question' + (matched.unmatchedQuestions.length > 1 ? 's ' : ' ') + matched.unmatchedQuestions.map(q => q.n).join(', ') + '.');
      const stray = matched.unmatchedItems.filter(i => i.answered > 0);
      if (stray.length) problems.push(stray.length + ' Canvas column(s) with answers in them did not match any question in the map, for example "' + esc(stray[0].label.slice(0, 80)) + '".');
      matched.pairs.filter(p => p.partial).forEach(p => problems.push('Question ' + p.q.n + ' was matched, but some answers in that column are not among its choices (' + esc(p.how) + ').'));
      notices.push({ kind: problems.length ? 'warn' : 'ok', html: sum + (problems.length ? '<ul>' + problems.map(p => '<li>' + p + '</li>').join('') + '</ul>' : '') });
    } else {
      // No map: Canvas's own points decide right and wrong, question by question.
      const k = E.mapFromExport(exp, titleFromFile(state.exports[0].name));
      if (!k.map) {
        notices.push({ kind: 'warn', html: '<b>' + esc(k.problem) + '</b> Add the test\'s question map.' });
        showStatus(notices);
        hideResults();
        return;
      }
      map = k.map;
      matched = k.matched;
      const skipped = exp.items.length - map.questions.length;
      notices.push({ kind: 'ok', html: head + 'Read <b>' + map.questions.length + ' question' + (map.questions.length === 1 ? '' : 's') + '</b> from the Canvas file, scored by Canvas.'
        + (skipped > 0 ? ' ' + skipped + ' column(s) had no points and were left out.' : '')
        + ' Canvas\'s file does not say which topic each question is on, so the results are by question. Add the test\'s question map, or make one in the <b>Map Maker</b> below, to group them by topic or standard.' });
    }
    if (exp.files) {
      notices.push({ kind: 'ok', html: 'Combined <b>' + exp.files.length + ' results files</b>, one class each: '
        + exp.files.map(f => '<b>' + esc(f.label) + '</b> (' + (f.ok ? f.students + ' student' + (f.students === 1 ? '' : 's') : 'not read') + ')').join(', ') + '.' });
    }
    exp.notes.forEach(n => notices.push({ kind: 'ok', html: esc(n) }));
    model = { map, exp, matched };
    // The Map Maker's questions always come from the Canvas file itself.
    const fromCanvas = E.mapFromExport(exp, titleFromFile(state.exports[0].name));
    model.draft = fromCanvas.map ? fromCanvas.map.questions : [];
    model.defaultTitle = titleFromFile(state.exports[0].name);
    // Classes, for a department file holding several sections.
    const sections = [...new Set(exp.students.map(s => s.section).filter(Boolean))].sort();
    $('section-wrap').hidden = sections.length < 2;
    if (!sections.includes(state.section)) state.section = '';
    $('section').innerHTML = '<option value="">All classes</option>' + sections.map(s => '<option' + (s === state.section ? ' selected' : '') + ' value="' + esc(s) + '">' + esc(s) + '</option>').join('');
    // Grouping: only the choices this map can give.
    const hasTopic = !map.keyless && map.questions.some(q => q.topic);
    $('by-wrap').hidden = !!map.keyless;
    $('by').querySelector('[data-v="topic"]').hidden = !hasTopic;
    model.baseNotices = notices;
    draw();
  }

  /* ── drawing ──────────────────────────────────────────────────────────── */
  function stats(a) {
    $('s-students').textContent = a ? a.took : '0';
    const avg = a && a.took ? a.students.filter(s => s.took).reduce((t, s) => t + (s.possible ? s.earned / s.possible : 0), 0) / a.took : null;
    $('s-average').textContent = avg == null ? '0' : pct(avg);
    $('s-retake').textContent = a ? a.students.filter(s => s.took && s.targetsMissed.length).length : '0';
  }

  function who(s) { return E.display(s, state.anon); }
  function hidden() { return '<span class="hidden-note">hidden on the projector</span>'; }
  // The order students appear in on every view (Jeff, 2026-11-24): by class period,
  // by name, or by score, lowest first. "Class" means name when there is only one class.
  // On the projector, name order would hint at who is who, so numbers decide instead.
  function sortUsed(a) { return state.sort === 'class' && (a.sections.length < 2 || a.section) ? 'name' : state.sort; }
  function ordered(a) {
    const sort = sortUsed(a);
    const label = s => s.name || s.id || s.key;
    const byName = (x, y) => (state.anon ? x.n - y.n : label(x).localeCompare(label(y), 'en', { numeric: true, sensitivity: 'base' }) || x.n - y.n);
    const score = s => (s.possible ? s.earned / s.possible : 0);
    return a.students.filter(s => s.took).sort((x, y) => (sort === 'score' ? (score(x) - score(y)) || byName(x, y)
      : sort === 'class' ? String(x.section).localeCompare(String(y.section), 'en', { numeric: true }) || byName(x, y) : byName(x, y)));
  }
  // Said on every student list, so a sort that happens to leave the order as it was
  // still shows it was applied.
  function sortNote(a) {
    const sort = sortUsed(a);
    return sort === 'score' ? 'Students are sorted by score, lowest first.'
      : sort === 'class' ? 'Students are sorted by class, then ' + (state.anon ? 'number' : 'name') + '.'
      : 'Students are sorted by ' + (state.anon ? 'number' : 'name') + '.';
  }
  // Any list of student keys, in the chosen order.
  function inOrder(a, keys) {
    const rank = new Map(ordered(a).map((s, i) => [s.key, i]));
    return keys.slice().sort((x, y) => (rank.has(x) ? rank.get(x) : 1e9) - (rank.has(y) ? rank.get(y) : 1e9));
  }
  // A group's name as a person reads it: "Topic 3.1, Empires Expand", "3.1 LT2", "Q7".
  function groupName(a, key, words) {
    if (a.by === 'topic') return 'Topic ' + key + (words ? ', ' + words : '');
    if (a.by === 'question') return 'Question ' + key.replace(/^Q/, '');
    return key;
  }
  // Wording that is the test itself (a question's stem) never reaches the projector.
  function wordsShown(a, t) { return a.by === 'question' ? (state.anon ? '' : t.text) : t.text; }

  function draw() {
    if (!model) return;
    const a = E.analyze(model.map, model.exp, model.matched, { rule: state.rule, section: state.section, by: state.by });
    model.analysis = a;
    showStatus(model.baseNotices.concat(a.notes.map(n => ({ kind: 'warn', html: esc(n) }))));
    stats(a);
    $('results').hidden = false;
    $('anon-note').hidden = !state.anon;
    $('by').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === a.by)));
    $('rule-label').textContent = 'Retake a ' + a.byLabel.toLowerCase() + ' when the student';
    $('sort').querySelector('[data-v="class"]').hidden = a.sections.length < 2 || !!a.section;
    $('sort').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === sortUsed(a))));
    drawHeat(a);
    drawReport(a);
    drawStandards(a);
    drawStudents(a);
    drawQuestions(a);
    drawPrompts(a);
    drawGroups(a);
    drawMaker();
    // Widths through the style object: the page's lock refuses inline style attributes.
    $('results').querySelectorAll('[data-w]').forEach(el => { el.style.width = el.dataset.w + '%'; });
  }

  // The heat map: one row per student, one column per question, grouped under its
  // topic. Every cell is right or wrong, because the test is multiple choice
  // (Jeff, 2026-11-21); a blank counts as wrong and says so; a question the student
  // never saw is left empty.
  function drawHeat(a) {
    const took = a.students.filter(s => s.took);
    if (!took.length) { $('view-heat').innerHTML = '<p class="empty">No student in this class has answers in the file.</p>'; return; }
    const cols = a.columns;
    let h = '<p class="muted small intro">Each square is one student on one question: <span class="key right" aria-hidden="true">✓</span> right, <span class="key wrong" aria-hidden="true">✗</span> wrong or left blank. Columns are grouped by ' + esc(a.byLabel.toLowerCase()) + '; the bottom row is the class. <span class="sort-note">' + sortNote(a) + '</span></p>';
    h += '<div class="scroller heat-scroll"><table class="heat"><thead>';
    if (a.by !== 'question') {
      h += '<tr><th scope="col" class="who" rowspan="2">Student</th><th scope="col" class="score" rowspan="2">Score</th>'
        + cols.map(c => '<th scope="colgroup" class="grp" colspan="' + c.cols.length + '" title="' + esc(groupName(a, c.key, (a.targets.find(t => t.lt === c.key) || {}).text)) + '">' + esc(c.key) + '</th>').join('') + '</tr><tr>';
    } else {
      h += '<tr><th scope="col" class="who">Student</th><th scope="col" class="score">Score</th>';
    }
    cols.forEach((c, ci) => c.cols.forEach((i, k) => { h += '<th scope="col" class="qn' + (k === 0 && ci > 0 ? ' edge' : '') + '">' + esc(a.questions[i].q.n) + '</th>'; }));
    h += '</tr></thead><tbody>';
    const width = 2 + cols.reduce((t, c) => t + c.cols.length, 0);
    const headed = sortUsed(a) === 'class';
    let current = null;
    ordered(a).forEach(s => {
      if (headed && s.section !== current) {
        current = s.section;
        const c = a.byClass.find(x => x.section === current);
        h += '<tr class="sec"><th scope="rowgroup" colspan="' + width + '">' + esc(current || 'No class') + (c ? ' <span>· ' + c.took + ' student' + (c.took === 1 ? '' : 's') + ' · class average ' + pct(c.average) + '</span>' : '') + '</th></tr>';
      }
      const score = s.possible ? s.earned / s.possible : null;
      h += '<tr><th scope="row" class="who">' + esc(who(s)) + '</th><td class="score num">' + pct(score) + '</td>';
      cols.forEach((c, ci) => c.cols.forEach((i, k) => {
        const r = s.results[i];
        const edge = k === 0 && ci > 0 ? ' edge' : '';
        const label = who(s) + ', question ' + r.q.n + ': ';
        if (r.status === 'correct') h += '<td class="cell right' + edge + '" title="' + esc(label + 'right') + '">✓</td>';
        else if (r.status === 'wrong') h += '<td class="cell wrong' + edge + '" title="' + esc(label + 'wrong') + '">✗</td>';
        else if (r.status === 'blank') h += '<td class="cell wrong blank' + edge + '" title="' + esc(label + 'left blank') + '">✗</td>';
        else h += '<td class="cell none' + edge + '" title="' + esc(label + 'not counted') + '"></td>';
      }));
      h += '</tr>';
    });
    h += '</tbody><tfoot><tr><th scope="row" class="who">' + (a.section ? esc(a.section) : (a.sections.length > 1 ? 'All classes' : 'Class')) + '</th><td class="score num">' + pct(classAverage(a)) + '</td>';
    cols.forEach((c, ci) => c.cols.forEach((i, k) => {
      const x = a.questions[i];
      h += '<td class="cell pct band-' + band(x.pct) + (k === 0 && ci > 0 ? ' edge' : '') + '" title="' + esc('Question ' + x.q.n + ': ' + pct(x.pct) + ' right') + '">' + (x.pct == null ? '' : Math.round(x.pct * 100)) + '</td>';
    }));
    h += '</tr></tfoot></table></div>';
    $('view-heat').innerHTML = h;
  }
  function classAverage(a) {
    const took = a.students.filter(s => s.took);
    return took.length ? took.reduce((t, s) => t + (s.possible ? s.earned / s.possible : 0), 0) / took.length : null;
  }
  // Five bands for the class row and the report, from mostly missed to mostly right.
  function band(p) { return p == null ? 'na' : p < 0.4 ? 1 : p < 0.6 ? 2 : p < 0.75 ? 3 : p < 0.9 ? 4 : 5; }

  // The class report: every topic (or target, or question), most missed first, then
  // who needs each one.
  function drawReport(a) {
    const byKey = new Map(a.students.map(s => [s.key, s]));
    const rows = E.reportRows(a);
    let h = '<div class="report-head"><p class="muted small">' + esc(a.title) + ': ' + a.took + ' student' + (a.took === 1 ? '' : 's') + ', class average ' + pct(classAverage(a)) + '. ' + esc(a.byLabel) + 's are listed from most missed to least. Write retake questions for the ones at the top first.</p>'
      + '<button class="btn" type="button" id="download-report">Download the report (CSV)</button></div>';
    h += '<div class="scroller"><table class="report"><thead><tr><th scope="col">' + esc(a.byLabel) + '</th><th scope="col">Questions</th><th scope="col">Correct</th><th scope="col">Students to retake</th></tr></thead><tbody>'
      + rows.map(t => {
        const words = wordsShown(a, t);
        return '<tr><td><b>' + esc(a.by === 'topic' ? 'Topic ' + t.lt : (a.by === 'question' ? 'Question ' + t.lt.replace(/^Q/, '') : t.lt)) + '</b>' + (words ? '<div class="wording">' + esc(words) + '</div>' : (a.by === 'question' && state.anon ? '<div>' + hidden() + '</div>' : ''))
          + (t.within.length ? '<ul class="within">' + t.within.map(w => '<li><b>' + esc(w.lt) + '</b> ' + esc(w.text) + '</li>').join('') + '</ul>' : '') + '</td>'
          + '<td class="num">' + esc(t.questions.join(', ')) + '</td>'
          + '<td><div class="bar"><span class="track"><span class="fill band-' + band(t.pct) + '" data-w="' + (t.pct == null ? 0 : Math.round(t.pct * 100)) + '"></span></span><b>' + pct(t.pct) + '</b></div><span class="muted small">' + t.correct + ' of ' + t.answered + ' answers</span></td>'
          + '<td class="num">' + t.needCount + ' of ' + a.took + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    // Class by class: the same topics, each period's percent correct side by side.
    if (a.byClass.length) {
      h += '<h3 class="sub">Compare classes</h3><p class="muted small intro">Percent correct on each ' + esc(a.byLabel.toLowerCase()) + ', class by class. Choose a class at the top to see only that class everywhere.</p>'
        + '<div class="scroller"><table class="compare"><thead><tr><th scope="col">' + esc(a.byLabel) + '</th><th scope="col">All classes</th>'
        + a.byClass.map(c => '<th scope="col">' + esc(c.section) + '</th>').join('') + '</tr></thead><tbody>'
        + '<tr class="avg"><th scope="row">Average score</th><td class="num">' + pct(classAverage(a)) + '</td>' + a.byClass.map(c => '<td class="num">' + pct(c.average) + ' <span class="muted small">(' + c.took + ')</span></td>').join('') + '</tr>'
        + rows.map(t => '<tr><th scope="row">' + esc(a.by === 'topic' ? 'Topic ' + t.lt : (a.by === 'question' ? 'Question ' + t.lt.replace(/^Q/, '') : t.lt)) + '</th><td class="num band-' + band(t.pct) + '">' + pct(t.pct) + '</td>'
          + a.byClass.map(c => { const x = c.targets.find(y => y.lt === t.lt) || {}; return '<td class="num band-' + band(x.pct) + '">' + pct(x.pct) + '</td>'; }).join('') + '</tr>').join('')
        + '</tbody></table></div>';
    }
    h += '<h3 class="sub">Who needs each ' + esc(a.byLabel.toLowerCase()) + '</h3><p class="muted small intro sort-note">' + sortNote(a) + '</p><div class="targets">' + rows.filter(t => t.needCount).map(t => {
      const names = inOrder(a, t.need).map(k => byKey.get(k)).filter(Boolean);
      return '<article class="target"><div class="target-head"><span class="lt">' + esc(groupName(a, t.lt, a.by === 'question' ? '' : t.text)) + '</span><span class="muted small">' + names.length + ' to retake</span></div>'
        + '<div class="chips">' + names.map(s => '<span class="chip need">' + esc(who(s)) + '</span>').join('') + '</div></article>';
    }).join('') + '</div>';
    if (!rows.some(t => t.needCount)) h += '<p class="empty">Nobody needs a retake.</p>';
    $('view-targets').innerHTML = h;
    $('download-report').addEventListener('click', () => save(E.reportCsv(a, { anon: state.anon }), '-Class-Report.csv'));
  }

  // Standards (Jeff, 2026-11-25): which standards this test showed, for the class and for
  // each student. Tested means at least two questions; shown means all of them right.
  // Always by standard, whatever "Group by" says, and only with a question map.
  function drawStandards(a) {
    const v = $('view-standards');
    if (a.keyless) {
      v.innerHTML = '<p class="empty">Standards need a question map, which says what standard each question assesses. Make one in the Map Maker above, or drop in the test\'s map.</p>';
      return;
    }
    const cov = E.coverage(model.map, a);
    const min = cov.min;
    const bits = ['<b>' + cov.tested + ' of ' + cov.rows.length + '</b> standard' + (cov.rows.length === 1 ? ' was' : 's were') + ' tested by at least ' + min + ' questions'];
    if (cov.thin) bits.push(cov.thin + ' had too few questions to judge');
    if (cov.untested.length) bits.push(cov.untested.length + ' in your list ' + (cov.untested.length === 1 ? 'is' : 'are') + ' not on this test');
    let h = '<div class="report-head"><p class="muted small">Shown on multiple choice. A standard counts as tested when at least ' + min + ' questions assess it, and a student has shown it when every one of those questions is right. ' + bits.join('; ') + '.</p>'
      + '<button class="btn" type="button" id="download-standards">Download the standards (CSV)</button></div>';
    // The class: each standard in course order.
    h += '<div class="scroller"><table class="report standards"><thead><tr><th scope="col">Standard</th><th scope="col">Questions</th><th scope="col">Students who showed it</th></tr></thead><tbody>'
      + cov.rows.map(r => {
        const judged = r.shown.length + r.notYet.length;
        const cell = r.status === 'thin'
          ? '<span class="muted">Only ' + r.questions.length + ' question: too few to judge</span>'
          : '<div class="bar"><span class="track"><span class="fill band-' + band(r.pct) + '" data-w="' + (r.pct == null ? 0 : Math.round(r.pct * 100)) + '"></span></span><b>' + pct(r.pct) + '</b></div><span class="muted small">' + r.shown.length + ' of ' + judged + ' students' + (r.few.length ? '; ' + r.few.length + ' saw too few of its questions' : '') + '</span>';
        return '<tr' + (r.status === 'thin' ? ' class="thin"' : '') + '><td><b>' + esc(r.lt) + '</b>' + (r.text ? '<div class="wording">' + esc(r.text) + '</div>' : '') + '</td>'
          + '<td class="num">' + esc(r.questions.join(', ')) + '</td><td>' + cell + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    if (cov.untested.length) {
      h += '<h3 class="sub">Not on this test</h3><p class="muted small intro">In your list of standards, but no question assessed ' + (cov.untested.length === 1 ? 'it' : 'them') + '.</p><ul class="within untested">'
        + cov.untested.map(r => '<li><b>' + esc(r.lt) + '</b> ' + esc(r.text) + '</li>').join('') + '</ul>';
    }
    // Each student: one square per standard.
    const byKey = new Map(cov.students.map(s => [s.key, s]));
    h += '<h3 class="sub">Each student</h3><p class="muted small intro"><span class="key right" aria-hidden="true">✓</span> shown (every question right), <span class="key wrong" aria-hidden="true">✗</span> not yet, blank: too few questions to judge. <span class="sort-note">' + sortNote(a) + '</span></p>'
      + '<div class="scroller heat-scroll"><table class="heat standards-grid"><thead><tr><th scope="col" class="who">Student</th><th scope="col" class="score">Shown</th>'
      + cov.rows.map(r => '<th scope="col" class="qn std' + (r.status === 'thin' ? ' thin' : '') + '" title="' + esc(r.lt + (r.text ? ': ' + r.text : '')) + '">' + esc(r.lt) + '</th>').join('') + '</tr></thead><tbody>'
      + ordered(a).map(s => {
        const c = byKey.get(s.key);
        if (!c) return '';
        return '<tr><th scope="row" class="who">' + esc(who(s)) + '</th><td class="score num">' + c.shown + ' of ' + cov.tested + '</td>'
          + cov.rows.map(r => {
            const x = c.cells[r.lt];
            const label = esc(who(s) + ', ' + r.lt + ': ' + (x === 'shown' ? 'shown' : x === 'notyet' ? 'not yet' : 'too few questions'));
            return x === 'shown' ? '<td class="cell right" title="' + label + '">✓</td>' : x === 'notyet' ? '<td class="cell wrong" title="' + label + '">✗</td>' : '<td class="cell none" title="' + label + '"></td>';
          }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
    v.innerHTML = h;
    $('download-standards').addEventListener('click', () => save(E.coverageCsv(cov, a, { anon: state.anon }), '-Standards.csv'));
  }

  function drawStudents(a) {
    const took = ordered(a);
    $('view-students').innerHTML = took.length ? '<p class="muted small intro sort-note">' + sortNote(a) + '</p><div class="scroller"><table><thead><tr><th scope="col">Student</th>' + (state.anon ? '' : '<th scope="col">Class</th>') + '<th scope="col">Score</th><th scope="col">' + esc(a.byLabel) + 's to retake</th><th scope="col">Missed questions</th></tr></thead><tbody>'
      + took.map(s => {
        const missed = s.results.filter(r => r.status === 'wrong' || r.status === 'blank');
        const detail = missed.length ? '<details><summary>' + missed.length + ' missed</summary><ul class="misslist">' + missed.map(r => '<li><span class="mark ' + r.status + '">Q' + esc(r.q.n) + '</span> ' + (a.keyless ? '' : esc(a.by === 'topic' && r.q.topic ? 'Topic ' + r.q.topic + ', ' + r.q.lt : r.q.lt) + ': ')
          + (r.status === 'blank' ? 'left blank' : (state.anon ? hidden() : '<span class="answer">chose “' + esc(r.response) + '”</span>')) + '</li>').join('') + '</ul></details>' : '<span class="empty">none</span>';
        return '<tr><td>' + esc(who(s)) + '</td>' + (state.anon ? '' : '<td>' + esc(s.section) + '</td>') + '<td class="num">' + s.earned + ' / ' + s.possible + '</td><td>'
          + (s.targetsMissed.length ? '<div class="chips">' + s.targetsMissed.map(e => '<span class="chip lt" title="missed ' + e.missed + ' of ' + e.of + '">' + esc(e.lt) + ' · ' + e.missed + '/' + e.of + '</span>').join('') + '</div>' : '<span class="empty">nothing to retake</span>')
          + '</td><td>' + detail + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="empty">No student in this class has answers in the file.</p>';
  }

  function drawQuestions(a) {
    $('view-questions').innerHTML = '<p class="muted small intro">' + (a.keyless ? 'Numbered in the order of the Canvas file.' : 'Numbered as in the question map (the teacher key\'s order), not Canvas\'s order.') + ' The most-chosen wrong answer usually names the misunderstanding to reteach.</p><div class="scroller"><table><thead><tr><th scope="col">Q</th>'
      + (a.keyless ? '<th scope="col">Question</th>' : '<th scope="col">' + (a.by === 'topic' ? 'Topic' : 'Target') + '</th>') + '<th scope="col">Correct</th><th scope="col">Most-chosen wrong answer</th>' + (a.keyless ? '' : '<th scope="col">Why the wrong answers are wrong</th>') + '</tr></thead><tbody>'
      + a.questions.map(x => '<tr><td class="num">' + esc(x.q.n) + '</td><td>' + (a.keyless ? (state.anon ? hidden() : '<span class="answer">' + esc(x.q.stem) + '</span>') : esc(a.by === 'topic' && x.q.topic ? x.q.topic + ' · ' + x.q.lt : x.q.lt)) + '</td><td class="num">' + pct(x.pct) + ' <span class="muted small">(' + x.correct + ' of ' + x.answered + ')</span></td><td>'
        + (x.topWrong ? (state.anon ? hidden() : '<span class="answer">' + esc(x.topWrong.text) + '</span>') + ' <span class="muted small">(' + x.topWrong.count + ')</span>' : '<span class="empty">none</span>') + '</td>'
        + (a.keyless ? '' : '<td>' + (x.q.rationale ? (state.anon ? hidden() : '<details><summary>Show</summary><p class="answer reveal">' + esc(x.q.rationale) + '</p></details>') : '<span class="empty">not in the map</span>') + '</td>') + '</tr>').join('')
      + '</tbody></table></div>';
  }

  // Retake questions: the page writes a prompt; the teacher pastes it into the AI
  // their school allows and reviews what comes back. No name is ever in a prompt.
  function drawPrompts(a) {
    $('count-wrap').hidden = state.style !== 'retake';
    $('prompt-tools').hidden = state.anon;
    if (state.anon) {
      $('prompt-list').innerHTML = '<p class="empty">Retake prompts are hidden on the projector: they hold the test\'s questions and answers. Turn Projector safe off to see them.</p>';
      return;
    }
    const opts = { style: state.style, count: state.count };
    const withMisses = ordered(a).filter(s => E.retakePrompt(a, s, opts));
    let h = '<p class="muted small intro sort-note">' + sortNote(a) + '</p><ol class="howto"><li>Copy a student\'s prompt, or one prompt for the whole class.</li><li>Paste it into the AI your school allows (ChatGPT, Claude, Gemini, MagicSchool and others all work).</li><li>Read and edit what it writes before any student sees it. The prompt carries no student names; it uses the student numbers shown here.</li></ol>';
    if (!withMisses.length) { $('prompt-list').innerHTML = h + '<p class="empty">Nobody missed anything, so there is nothing to retake.</p>'; return; }
    h += '<div class="prompts">' + withMisses.map(s => {
      const text = E.retakePrompt(a, s, opts);
      const missed = s.results.filter(r => r.status === 'wrong' || r.status === 'blank').length;
      return '<article class="prompt" data-student="' + esc(s.key) + '"><div class="target-head"><span class="lt">Student ' + s.n + (s.name && s.name !== 'Student ' + s.n ? ' · ' + esc(s.name) : '') + '</span><span class="muted small">' + missed + ' question' + (missed === 1 ? '' : 's') + ' missed'
        + (a.keyless ? '' : ' · ' + esc(s.targetsMissed.map(e => e.lt).join(', '))) + '</span></div>'
        + '<div class="row"><button class="btn primary copy-one" type="button">Copy prompt</button><details><summary>Show the prompt</summary><pre class="prompt-text" tabindex="0">' + esc(text) + '</pre></details></div></article>';
    }).join('') + '</div>';
    $('prompt-list').innerHTML = h;
    $('prompt-list').querySelectorAll('.copy-one').forEach(btn => btn.addEventListener('click', () => {
      const pre = btn.closest('.prompt').querySelector('.prompt-text');
      copyText(pre.textContent, btn, pre);
    }));
  }

  function drawGroups(a) {
    const byKey = new Map(a.students.map(s => [s.key, s]));
    const shared = a.groups.filter(g => g.students.length > 1);
    $('view-groups').innerHTML = '<p class="muted small intro">Students who need exactly the same ' + esc(a.byLabel.toLowerCase()) + 's can take the same retake.</p>'
      + (shared.length ? '<div class="targets">' + shared.map(g => '<article class="target"><div class="target-head"><span class="lt">' + g.students.length + ' students</span></div><div class="chips">' + g.lts.map(lt => '<span class="chip lt">' + esc(lt) + '</span>').join('') + '</div><div class="chips">' + inOrder(a, g.students).map(k => '<span class="chip need">' + esc(who(byKey.get(k))) + '</span>').join('') + '</div></article>').join('') + '</div>'
        : '<p class="empty">No two students need exactly the same set. Use the Class report to write one set of questions per ' + esc(a.byLabel.toLowerCase()) + ' and give each student the sets they need.</p>');
  }

  /* ── the Map Maker ────────────────────────────────────────────────────── */
  // Shown when the results came from the Canvas file alone, or from a map made here. The
  // teacher tags each question with a topic and a standard, by typing or by pasting the
  // reply of their own AI to a prompt this page writes, then uses or saves the map.
  // Nothing here leaves the page; the prompt holds the test's questions and no student.

  // One key per question, from its wording, so tags survive a second class's file.
  function makerKeys(qs) {
    const seen = new Map();
    return qs.map(q => {
      const base = E.norm(q.stem) || 'q' + q.n;
      const k = (seen.get(base) || 0) + 1;
      seen.set(base, k);
      return base + '#' + k;
    });
  }
  function makerStatus(items) {
    $('maker-status').innerHTML = items.map(i => '<div class="notice ' + i.kind + '">' + i.html + '</div>').join('');
  }
  function makerCodes() {
    const st = E.parseStandards(state.maker.standards);
    $('maker-codes').innerHTML = st.order.map(c => '<option value="' + esc(c) + '">' + esc(st.targets[c]) + '</option>').join('');
  }
  function shorten(s, n) { const t = E.plain(s); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; }

  function drawMaker() {
    const show = !!(model && model.draft && model.draft.length && (model.map.keyless || state.madeHere));
    $('maker').hidden = !show;
    if (!show) return;
    $('maker-hidden').hidden = !state.anon;
    $('maker-body').hidden = state.anon;
    if (state.anon) return;
    if (!$('maker-name').value) $('maker-name').value = state.maker.name || model.defaultTitle;
    makerCodes();
    const keys = makerKeys(model.draft);
    $('maker-table').innerHTML = '<div class="scroller"><table class="maker"><thead><tr><th scope="col">Q</th><th scope="col">Question</th><th scope="col">Correct answer</th><th scope="col">Topic</th><th scope="col">Standard or target</th></tr></thead><tbody>'
      + model.draft.map((q, i) => {
        const k = keys[i];
        const t = state.maker.tags[k] || {};
        const known = q.answer >= 0 && q.options[q.answer];
        return '<tr data-k="' + esc(k) + '"><td class="num">' + esc(q.n) + '</td>'
          + '<td class="q"><span class="answer" title="' + esc(E.plain(q.stem)) + '">' + esc(shorten(q.stem, 220)) + '</span></td>'
          + '<td class="q">' + (known ? '<span class="answer">' + esc(shorten(q.options[q.answer], 140)) + '</span>'
            : '<input class="text ans" type="text" aria-label="Correct answer for question ' + esc(q.n) + '" placeholder="Nobody chose it: type it (optional)" value="' + esc(state.maker.answers[k] || '') + '">') + '</td>'
          + '<td><input class="text topic" type="text" maxlength="40" aria-label="Topic for question ' + esc(q.n) + '" value="' + esc(t.topic || '') + '"></td>'
          + '<td><input class="text lt" type="text" maxlength="60" list="maker-codes" aria-label="Standard for question ' + esc(q.n) + '" value="' + esc(t.lt || '') + '"></td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  $('maker-table').addEventListener('input', e => {
    const row = e.target.closest('tr[data-k]');
    if (!row) return;
    const k = row.dataset.k;
    if (e.target.classList.contains('ans')) { state.maker.answers[k] = e.target.value; return; }
    const t = state.maker.tags[k] || (state.maker.tags[k] = { topic: '', lt: '' });
    if (e.target.classList.contains('topic')) t.topic = e.target.value;
    if (e.target.classList.contains('lt')) t.lt = e.target.value;
  });
  $('maker-standards').addEventListener('input', e => { state.maker.standards = e.target.value; makerCodes(); });
  $('maker-name').addEventListener('input', e => { state.maker.name = e.target.value; });

  $('maker-copy').addEventListener('click', () => {
    if (!model || !model.draft || state.anon) return;
    const text = E.tagPrompt(model.draft, E.parseStandards(state.maker.standards), $('maker-name').value.trim() || model.defaultTitle);
    copyText(text, $('maker-copy'));
  });

  $('maker-read').addEventListener('click', () => {
    if (!model || !model.draft) return;
    const r = E.parseTags($('maker-reply').value);
    if (!r.read) {
      makerStatus([{ kind: 'warn', html: '<b>No tags were found in the reply.</b> Each line should look like <code>Q1 | 3.1 | 3.1 LT1</code>: the question number, its topic, then its standard.' }]);
      return;
    }
    const st = E.parseStandards(state.maker.standards);
    const keys = makerKeys(model.draft);
    const missing = [];
    const strange = [];
    let filled = 0;
    model.draft.forEach((q, i) => {
      const t = r.tags[q.n];
      if (!t) { missing.push(q.n); return; }
      state.maker.tags[keys[i]] = { topic: t.topic, lt: t.lt };
      filled += 1;
      if (st.order.length && !(t.lt in st.targets)) strange.push('question ' + q.n + ' (' + t.lt + ')');
    });
    state.maker.replyTargets = r.targets;
    drawMaker();
    const notes = [];
    if (missing.length) notes.push('The reply has no tag for question' + (missing.length > 1 ? 's ' : ' ') + missing.join(', ') + '. Type ' + (missing.length > 1 ? 'those' : 'that one') + ' in the table.');
    if (strange.length) notes.push('Not in your list of standards: ' + esc(strange.join(', ')) + '. Check ' + (strange.length > 1 ? 'them' : 'it') + ' in the table.');
    makerStatus([{ kind: notes.length ? 'warn' : 'ok', html: 'Filled in <b>' + filled + ' of ' + model.draft.length + '</b> questions from the reply. Check the table; the AI can be wrong.'
      + (notes.length ? '<ul>' + notes.map(n => '<li>' + n + '</li>').join('') + '</ul>' : '') }]);
  });

  // The map, from the table as it stands now.
  function makerMap() {
    const keys = makerKeys(model.draft);
    const tags = {};
    const answers = {};
    model.draft.forEach((q, i) => {
      if (state.maker.tags[keys[i]]) tags[q.n] = state.maker.tags[keys[i]];
      if (state.maker.answers[keys[i]]) answers[q.n] = state.maker.answers[keys[i]];
    });
    // Every pasted standard is kept, tested or not; a code the AI explained is kept
    // only when a question uses it.
    const used = new Set(Object.values(tags).map(t => E.plain(t.lt)));
    const targets = {};
    Object.keys(state.maker.replyTargets || {}).forEach(c => { if (used.has(c)) targets[c] = state.maker.replyTargets[c]; });
    Object.assign(targets, E.parseStandards(state.maker.standards).targets);
    return E.buildMap({ title: $('maker-name').value.trim() || model.defaultTitle, questions: model.draft, tags, targets, answers });
  }
  function makerReady() {
    if (!model || !model.draft) return null;
    const b = makerMap();
    if (b.problems.length) { makerStatus([{ kind: 'warn', html: '<b>Not finished yet.</b> ' + esc(b.problems.join(' ')) }]); return null; }
    return b.map;
  }
  $('maker-use').addEventListener('click', () => {
    const map = makerReady();
    if (!map) return;
    state.mapText = JSON.stringify(map);
    state.mapName = map.title + ' (made in the Map Maker, not saved yet)';
    state.maker.name = map.title;
    state.madeHere = true;
    rebuild();
    makerStatus([{ kind: 'ok', html: 'The results above now use this map, grouped by topic. Choose <b>Save the map file</b> to use it again next time. Change anything in the table, then choose <b>Use this map</b> again.' }]);
  });
  $('maker-save').addEventListener('click', () => {
    const map = makerReady();
    if (!map) return;
    download(JSON.stringify(map, null, 2) + '\n', fileStem(map.title) + '-Retake-Map.json', 'application/json');
    if (state.madeHere) { state.mapName = map.title + ' (made in the Map Maker)'; fileState(); }
    makerStatus([{ kind: 'ok', html: 'Saved <b>' + esc(fileStem(map.title)) + '-Retake-Map.json</b>. It is the answer key: keep it off student-shared drives.' }]);
  });

  /* ── controls ─────────────────────────────────────────────────────────── */
  function seg(id, after) {
    $(id).addEventListener('click', e => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      $(id).querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      after(b.dataset.v);
      draw();
    });
  }
  seg('rule', v => { state.rule = v; });
  seg('names', v => { state.anon = v === 'anon'; });
  seg('by', v => { state.by = v; });
  seg('style', v => { state.style = v; });
  seg('sort', v => { state.sort = v; });
  $('section').addEventListener('change', e => { state.section = e.target.value; draw(); });
  $('count').addEventListener('change', e => { state.count = Number(e.target.value) || 3; draw(); });

  const TABS = ['heat', 'targets', 'standards', 'students', 'questions', 'prompts', 'groups'];
  function selectTab(name, focus) {
    state.tab = name;
    TABS.forEach(t => {
      const on = t === name;
      $('tab-' + t).setAttribute('aria-selected', String(on));
      $('tab-' + t).tabIndex = on ? 0 : -1;
      $('view-' + t).hidden = !on;
    });
    if (focus) $('tab-' + name).focus();
  }
  TABS.forEach((t, i) => {
    $('tab-' + t).addEventListener('click', () => selectTab(t));
    $('tab-' + t).addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        selectTab(TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length], true);
      }
    });
  });

  $('filepick').addEventListener('change', e => { takeFiles(e.target.files); e.target.value = ''; });
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length) takeFiles(e.dataTransfer.files); });
  // A file dropped anywhere else would make the browser navigate away from the page.
  ['dragover', 'drop'].forEach(ev => window.addEventListener(ev, e => e.preventDefault()));

  $('demo').addEventListener('click', () => {
    const d = demoFiles();
    state.mapText = d.map; state.mapName = 'Demo-Retake-Map.json (invented)';
    state.exports = [{ text: d.csv, name: 'Demo Student Analysis Report.csv (invented)', label: 'Class 1' }];
    state.demo = true;
    state.madeHere = false;
    rebuild();
  });
  $('clear').addEventListener('click', () => {
    Object.assign(state, { exports: [], mapText: null, mapName: '', section: '', demo: false, madeHere: false,
      maker: { tags: {}, answers: {}, standards: '', replyTargets: {}, name: '' } });
    model = null;
    ['maker-standards', 'maker-reply', 'maker-name'].forEach(id => { $(id).value = ''; });
    $('maker-status').innerHTML = '';
    $('maker-open').open = false;
    $('status').innerHTML = '';
    hideResults();
    fileState();
  });

  function flash(btn, text) {
    const was = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = was; }, 1800);
  }
  // No clipboard permission (an older browser, or a file:// page): select the text so
  // Ctrl+C copies it, or show it to copy by hand.
  async function copyText(text, btn, pre) {
    try { await navigator.clipboard.writeText(text); flash(btn, 'Copied'); }
    catch (e) {
      if (pre) {
        const d = pre.closest('details');
        if (d) d.open = true;
        const range = document.createRange();
        range.selectNodeContents(pre);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        flash(btn, 'Selected: press Ctrl+C');
      } else {
        showStatus(model.baseNotices.concat([{ kind: 'ok', html: '<b>Copy this by hand:</b><pre class="copytext">' + esc(text) + '</pre>' }]));
      }
    }
  }
  $('copy').addEventListener('click', () => {
    if (!model || !model.analysis) return;
    copyText(E.planText(model.analysis, { anon: state.anon }), $('copy'));
  });
  $('copy-class').addEventListener('click', () => {
    if (!model || !model.analysis || state.anon) return;
    const text = E.classPrompt(model.analysis, { style: state.style, count: state.count });
    if (text) copyText(text, $('copy-class'));
  });
  function fileStem(title) { return String(title || 'Retake').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'Retake'; }
  function save(text, suffix) { download('﻿' + text, fileStem(model.map.title) + suffix, 'text/csv;charset=utf-8'); }
  function download(text, name, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('download').addEventListener('click', () => {
    if (!model || !model.analysis) return;
    save(E.planCsv(model.analysis, { anon: state.anon }), '-Retake-Plan.csv');
  });
  $('print').addEventListener('click', () => window.print());

  fileState();
})();
