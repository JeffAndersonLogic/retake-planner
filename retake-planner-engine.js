/* Retake Planner engine, by ANDERSONLOGIC ai. Shared by the page and Node, with no
 * network, no storage and no provider of its own (Jeff, 2026-11-17).
 *
 * What it is for. A student who retakes a test, or writes test corrections, has
 * usually seen their test, so asking the same questions again measures whether they
 * remember the answer rather than whether they understand the idea. The Retake
 * Planner reads which questions each student missed, turns those into the learning
 * targets each student has not yet shown, and so lets a teacher write new questions
 * on those targets. It reads results; it does not grade, and nothing it shows feeds a
 * grade. Canvas holds every grade.
 *
 * Two files, both picked by the teacher on their own computer and read in the tab:
 *
 * 1. The Canvas export: New Quizzes, Reports, Student Analysis, Export CSV. Canvas
 *    does not publish the exact columns of that file and sources disagree on details
 *    (all attempts or the latest), so this reader does not depend on column names
 *    for the questions. It recognises the student columns by name, treats every other
 *    column as a possible question, and decides which question each one is by what
 *    students answered in it: every Unit 3 answer choice is unique across the quiz,
 *    so the choices students picked identify the question even if Canvas shuffled
 *    the order or the teacher's copy numbers them differently. Both shapes are read:
 *    one row per student (wide) and one row per student per question (long).
 *    readExport() reports the shape it found and match() reports every question it
 *    could not place, so an unfamiliar file says so on screen instead of quietly
 *    producing a wrong plan.
 *
 * 2. The question map, which holds the answer key and so never lives in this public
 *    repository (test/no-maps.test.js). Whoever writes the test makes it alongside
 *    the test (for Jeff's own tests, build_retake_map.py in the private
 *    AndersonLogic-OS repository). Format "retake-planner-map/1" (the earlier name
 *    "behistorical-retake-map/1" is still read), JSON:
 *
 *      { format, title, version, subtitle,
 *        topics:    { "3.1": "Empires Expand", ... }          (optional)
 *        targets:   { "3.1 LT1": "I can explain ...", ... },
 *        questions: [ { n, topic, lt, kc, skill, reasoning, source, stem,
 *                       options: [text, ...], answer: index (or "B"), points,
 *                       rationale } ] }
 *
 * Who is right when Canvas and the key disagree. Canvas's score is the grade, so a
 * question Canvas scored full marks is correct here even if the key says otherwise
 * (a regraded question, for instance). The count of such answers is reported.
 *
 *   parseCsv(text)                       -> rows (arrays of strings)
 *   parseMap(text)                       -> { map, problems, warnings }
 *   readExport(text)                     -> { layout, students, items, notes }
 *   combineExports([{ text, label }])    -> one export from several class files
 *   match(map, exp)                      -> { pairs, unmatchedItems, unmatchedQuestions }
 *   mapFromExport(exp, title)            -> { map, matched } from Canvas's own points, no map file
 *   parseStandards(text)                 -> { targets, order } from a pasted list of standards
 *   tagPrompt(questions, standards, t)   -> a prompt asking the teacher's AI to tag each question
 *   parseTags(text)                      -> { tags: { n: { topic, lt } }, targets, read } from its reply
 *   buildMap({ title, questions, tags, targets, answers }) -> { map, problems }: the Map Maker's map
 *   analyze(map, exp, matched, options)  -> { students, targets, questions, columns, by, notes, ... }
 *                                           options: rule 'any'|'most', section, by 'topic'|'lt'|'question'
 *                                           also: sections, byClass (each class's percent per topic)
 *   planText(analysis, options)          -> plain text, one block per student
 *   planCsv(analysis, options)           -> CSV, one row per student per topic or target
 *   reportRows(analysis)                 -> topics (or targets, or questions), most missed first
 *   reportCsv(analysis, options)         -> the class report as CSV
 *   coverage(map, analysis)              -> each standard: tested (2+ questions) or not, who showed it
 *   coverageCsv(coverage, analysis, o)   -> one row per student, one column per standard
 *   retakePrompt(analysis, student, o)   -> a prompt for the teacher's own AI, no name in it
 *   classPrompt(analysis, o)             -> one prompt for every student who missed something
 *                                           o: style 'retake'|'corrections', count 1 to 10 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BHRetakePlanner = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 'retake-planner/1.4.1';
  const MAP_FORMAT = 'retake-planner-map/1';
  // The format's name before the planner left BeHistorical (2026-11-17); maps built
  // under it are read unchanged.
  const MAP_FORMATS = [MAP_FORMAT, 'behistorical-retake-map/1'];
  const LETTERS = 'ABCDEFGH';

  /* ── text ─────────────────────────────────────────────────────────────── */

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: '-', mdash: '-', hellip: '...' };
  function stripHtml(s) {
    return String(s == null ? '' : s)
      .replace(/<\/?[a-z][a-z0-9]*(?:\s+[^<>]*|\s*\/?)>/gi, ' ')
      .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
        if (e[0] === '#') {
          const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
          return Number.isInteger(code) && code >= 0 && code <= 0x10FFFF && !(code >= 0xD800 && code <= 0xDFFF) ? String.fromCodePoint(code) : m;
        }
        const v = ENTITIES[e.toLowerCase()];
        return v == null ? m : v;
      });
  }
  // Compare text the way a person would: case, accents, quotes, dashes, spacing and
  // punctuation do not make two answers different.
  function norm(s) {
    return stripHtml(s)
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/([^\p{L}\p{N}\s])/gu, ' $1 ')
      .replace(/[^\p{L}\p{N}<>=+*/^%−-]+/gu, ' ')
      .trim();
  }
  function plain(s) { return stripHtml(s).replace(/\s+/g, ' ').trim(); }

  /* ── CSV ──────────────────────────────────────────────────────────────── */

  function parseCsv(text) {
    const s = String(text == null ? '' : text).replace(/^﻿/, '');
    // Excel saved as "CSV" in some locales uses semicolons; Canvas uses commas.
    const firstLine = s.slice(0, s.search(/\r?\n|$/));
    const delim = (firstLine.split(';').length > firstLine.split(',').length && firstLine.indexOf('\t') < 0) ? ';'
      : (firstLine.split('\t').length > firstLine.split(',').length ? '\t' : ',');
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < s.length; i += 1) {
      const c = s[i];
      if (quoted) {
        if (c === '"') {
          if (s[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
        } else cell += c;
      } else if (c === '"' && cell === '') quoted = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && s[i + 1] === '\n') i += 1;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (quoted) throw new Error('The CSV has an unfinished quoted cell. Download the original Student Analysis CSV again.');
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(v => String(v).trim() !== ''));
  }

  function csvCell(v) {
    const s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  // Only downloads use this: importing a CSV must preserve the original text.
  function downloadCell(v) {
    const s = v == null ? '' : String(v);
    return csvCell(typeof v !== 'number' && /^(?:\s*[=+@-]|[\t\r\n])/.test(s) ? "'" + s : s);
  }

  /* ── the question map ─────────────────────────────────────────────────── */

  function parseMap(text) {
    const problems = [];
    const warnings = [];
    let data;
    try { data = typeof text === 'string' ? JSON.parse(String(text).replace(/^﻿/, '')) : text; }
    catch (e) { return { map: null, problems: ['This is not a question map: it could not be read as JSON. Pick the file that ends in Retake-Map.json.'], warnings }; }
    if (!data || typeof data !== 'object') return { map: null, problems: ['This is not a question map.'], warnings };
    if (!MAP_FORMATS.includes(data.format)) {
      return { map: null, problems: ['This is not a Retake Planner question map (its format line is "' + (data.format || 'missing') + '", expected "' + MAP_FORMAT + '").'], warnings };
    }
    const targets = data.targets && typeof data.targets === 'object' ? data.targets : {};
    const qs = Array.isArray(data.questions) ? data.questions : [];
    if (!qs.length) problems.push('The question map has no questions.');
    const seenN = new Set();
    const questions = [];
    qs.forEach((q, i) => {
      const label = 'Question ' + (q && q.n != null ? q.n : i + 1);
      if (!q || typeof q !== 'object') { problems.push(label + ' is empty.'); return; }
      // "seen": the Map Maker wrote this question from the Canvas file, so its choices are
      // the answers students chose, not the test's full list. A question everyone got right
      // has one, and one nobody got right may have no known answer (answer: null); Canvas's
      // points still decide right and wrong for it.
      const seen = q.seen === true;
      const options = Array.isArray(q.options) ? q.options.map(String) : [];
      if (!seen && options.length < 2) { problems.push(label + ' has fewer than two answer choices.'); return; }
      let answer = q.answer;
      if (typeof answer === 'string' && /^[A-Ha-h]$/.test(answer.trim())) answer = LETTERS.indexOf(answer.trim().toUpperCase());
      if (seen && answer == null) {
        answer = -1;
        warnings.push(label + ' has no correct answer in the map (nobody chose it), so Canvas\'s points decide it.');
      } else if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) { problems.push(label + ' has no valid correct answer.'); return; }
      const n = q.n != null ? q.n : i + 1;
      if (seenN.has(String(n))) { problems.push(label + ' appears twice.'); return; }
      seenN.add(String(n));
      if (!q.lt) { problems.push(label + ' does not name a learning target.'); return; }
      // A label the teacher typed in the Map Maker needs no wording to be useful.
      if (!targets[q.lt] && !seen) warnings.push(label + ' names ' + q.lt + ', which has no wording in the map.');
      const normed = options.map(norm);
      if (new Set(normed).size !== normed.length) warnings.push(label + ' has two answer choices that read the same.');
      const points = Number(q.points);
      questions.push({
        n, itemId: String(q.itemId || ''), topic: String(q.topic || ''), lt: String(q.lt), kc: String(q.kc || ''), skill: String(q.skill || ''),
        reasoning: String(q.reasoning || ''), source: String(q.source || ''), stem: String(q.stem || ''),
        options, answer, points: Number.isFinite(points) && points > 0 ? points : 1, rationale: String(q.rationale || ''), seen,
        _opts: normed, _stem: norm(q.stem || '')
      });
    });
    // A choice that appears in two questions cannot tell them apart by itself.
    const owners = new Map();
    questions.forEach(q => q._opts.forEach(o => { if (!owners.has(o)) owners.set(o, new Set()); owners.get(o).add(q.n); }));
    const shared = [...owners.values()].filter(set => set.size > 1).length;
    if (shared) warnings.push(shared + ' answer choice(s) appear in more than one question; those questions are told apart by their wording instead.');
    if (problems.length) return { map: null, problems, warnings };
    return {
      map: {
        format: data.format, title: String(data.title || 'Untitled assessment'), version: String(data.version || ''),
        subtitle: String(data.subtitle || ''), targets, questions, _owners: owners,
        // Optional topic names, { "3.1": "Empires Expand" }, shown beside a topic's number.
        topics: data.topics && typeof data.topics === 'object' ? data.topics : {}
      },
      problems, warnings
    };
  }

  /* ── the Canvas export ────────────────────────────────────────────────── */

  // Student and bookkeeping columns, by their header with case and punctuation
  // ignored. Anything not listed here is a possible question.
  const ROLE = {
    name: ['name', 'student', 'student name', 'full name', 'user name', 'display name', 'sortable name'],
    id: ['id', 'student id', 'user id', 'canvas user id', 'canvas id', 'student canvas id', 'participant id'],
    sis: ['sis id', 'sisid', 'sis user id', 'student sis id', 'sis login id', 'login id'],
    // "SectionNames", as Canvas writes it in a Student Analysis export (seen 2026-11-24).
    section: ['section', 'section name', 'section names', 'sections', 'student section'],
    attempt: ['attempt', 'attempt number', 'attempt no', 'attempt id'],
    meta: ['section id', 'section sis id', 'submitted', 'submitted at', 'submission date', 'n correct', 'n incorrect', 'score',
      'total score', 'attempt score', 'final score', 'quiz score', 'points', 'total points', 'kept score', 'percentage', 'percent',
      'time', 'time spent', 'duration', 'started', 'started at', 'finished', 'finished at', 'email', 'course', 'course id',
      'quiz id', 'quiz title', 'assignment id', 'user', 'graded', 'graded at',
      'section ids', 'section sis ids', 'section sisids', 'elapsed time', 'points possible',
      // The summary at the end of a New Quizzes Student Analysis row (seen 2026-11-23).
      'numberofcorrect', 'numberofincorrect', 'noresponse', 'pointspossible', 'overallscore',
      'number of correct', 'number of incorrect', 'no response', 'overall score']
  };
  // New Quizzes Student Analysis: every question is five columns. A full export
  // (2026-11-24) runs "ItemID, ItemType, <the question's wording>, EarnedPoints, Status";
  // a header pasted with its first columns cut off (2026-11-23) began with a Status.
  // The wording column holds the answer the student chose. ItemID and ItemType belong
  // to the question after them; EarnedPoints, and a Status right after it, to the one
  // before.
  const BLOCK_BEFORE = { status: 'status', itemid: 'itemId', 'item id': 'itemId', itemtype: 'type', 'item type': 'type' };
  const BLOCK_AFTER = ['earnedpoints', 'earned points'];
  // Long layout: one row per student per question.
  const LONG = {
    item: ['item id', 'question id', 'item', 'question', 'item name', 'question name', 'item title', 'question title', 'title',
      'question text', 'item text', 'stem', 'item position', 'question position', 'position', 'question number', 'item number'],
    text: ['question text', 'item text', 'question', 'item title', 'question title', 'title', 'stem', 'item name', 'question name', 'item'],
    pos: ['item position', 'question position', 'position', 'question number', 'item number'],
    response: ['response', 'answer', 'answers', 'student answer', 'student response', 'answer text', 'selected answer', 'selected answers', 'response text', 'student answer text'],
    score: ['score', 'points', 'points earned', 'points received', 'points awarded', 'item score', 'question score', 'earned'],
    possible: ['points possible', 'possible points', 'max score', 'max points', 'item points possible', 'question points possible', 'points available'],
    status: ['status', 'item status', 'question status', 'state']
  };
  // A per-question column's suffix in a wide layout ("... - Points", "(Status)").
  // A separator is required, so a question whose own wording ends in "answer" stays
  // a question.
  const SUFFIX = /^(.*?)\s*(?:[-–—:|]|[([])\s*(response|answer|student answer|points earned|points possible|points|score|status|correct)\s*[)\]]?\s*$/i;

  function findCol(heads, names) {
    for (const want of names) {
      const i = heads.indexOf(want);
      if (i >= 0) return i;
    }
    return -1;
  }
  function num(v) {
    const s = String(v == null ? '' : v).trim().replace(/,/g, '.');
    if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return null;
    return Number(s);
  }
  function statusOf(v) {
    const s = norm(v);
    if (!s) return '';
    if (s === 'not attempted' || s === 'not supported' || s === 'n a' || s === 'n/a' || s === 'n / a' || s === 'na') return 'absent';
    if (s === 'no answer' || s === 'unanswered' || s === 'blank' || s === 'no response' || s === 'not answered' || s === 'skipped') return 'blank';
    if (s === 'not graded' || s === 'needs grading' || s === 'pending') return 'ungraded';
    return 'graded';
  }

  function supportedItem(it) {
    const type = norm(it.type || '').replace(/[^a-z]/g, '');
    return !it.typeConflict && (!plain(it.type) || type === 'multiplechoice' || type === 'multiplechoicequestion');
  }
  function finishExport(exp) {
    exp.skippedItems = exp.items.filter(it => !supportedItem(it));
    exp.items = exp.items.filter(supportedItem);
    if (exp.skippedItems.length) exp.notes.push(exp.skippedItems.length + ' item(s) skipped: only single-answer multiple choice is supported. Types: '
      + [...new Set(exp.skippedItems.map(it => it.typeConflict ? 'conflicting item types' : it.type))].join(', ') + '.');
    exp.unknownTypes = exp.items.filter(it => !it.type).length;
    if (exp.unknownTypes) exp.notes.push(exp.unknownTypes + ' item(s) have no exported question type. Confirm these are single-answer multiple choice.');
    return exp;
  }

  // A file opened in Excel and saved again can come back with its accents and curly
  // quotes turned into pairs of odd letters ("â€œ" for a quote, "Ã­" for í): its
  // UTF-8 bytes were read as Windows-1252. Seen in a real export on 2026-11-24. When
  // every odd character maps back to a byte and the bytes read as UTF-8, the text is
  // repaired; otherwise it is left exactly as it was.
  const CP1252 = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88,
    0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94,
    0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
  function repairMojibake(text) {
    const s = String(text == null ? '' : text);
    if (!/[ÃÂâ][\u0080-\u00BF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013-\u2122\u20AC]/.test(s) || typeof TextDecoder === 'undefined') return s;
    const bytes = [];
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (c < 0x100) bytes.push(c);
      else if (CP1252[c] != null) bytes.push(CP1252[c]);
      else return s; // a character Windows-1252 cannot hold: this text was not misread
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)); }
    catch (e) {
      // Excel sometimes drops a byte it has no letter for (the end of a closing quote),
      // leaving a broken pair. The rest is still repaired; the broken pair is dropped.
      const loose = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
      const broken = (loose.match(/\uFFFD/g) || []).length;
      return broken * 20 < bytes.length ? loose.replace(/\uFFFD/g, '') : s;
    }
  }
  // Canvas runs a column's words together ("SectionNames", "SectionIDs", "SISID",
  // "PointsPossible"). Every column name this reader knows is also known with its
  // spaces taken out, so "SectionIDs" is read as "section ids". A question's wording
  // is never one of them, so it is left as it is.
  let COMPACT = null;
  function headNorm(h) {
    if (!COMPACT) {
      COMPACT = new Map();
      [].concat(...Object.values(ROLE), ...Object.values(LONG), Object.keys(BLOCK_BEFORE), BLOCK_AFTER)
        .forEach(n => { if (!COMPACT.has(n.replace(/ /g, ''))) COMPACT.set(n.replace(/ /g, ''), n); });
    }
    const n = norm(h);
    return COMPACT.get(n.replace(/ /g, '')) || n;
  }

  function readExport(text) {
    const repaired = repairMojibake(text);
    let rows;
    try { rows = parseCsv(repaired); }
    catch (e) { return { layout: 'unknown', students: [], items: [], notes: [e.message] }; }
    const notes = [];
    if (rows.length < 2) return { layout: 'empty', students: [], items: [], notes: ['The Canvas file has no student rows.'] };
    const header = rows[0].map(h => String(h));
    const heads = header.map(headNorm);
    const col = {
      name: findCol(heads, ROLE.name), id: findCol(heads, ROLE.id), sis: findCol(heads, ROLE.sis),
      section: findCol(heads, ROLE.section), attempt: findCol(heads, ROLE.attempt)
    };
    const totalEarned = findCol(heads, ['overall score', 'overallscore', 'final score', 'quiz score', 'total score']);
    const totalPossible = findCol(heads, ['points possible', 'pointspossible', 'total points']);
    const totalsOf = r => ({ earned: totalEarned >= 0 ? num(r[totalEarned]) : null, possible: totalPossible >= 0 ? num(r[totalPossible]) : null });
    if (repaired !== String(text)) notes.push('Accents and quotation marks in the file had been scrambled (it was probably opened and saved in Excel), and were repaired.');
    const respCol = findCol(heads, LONG.response);
    const itemCol = findCol(heads, LONG.item);
    const isBlock = heads.some(h => BLOCK_AFTER.includes(h));
    const isLong = !isBlock && respCol >= 0 && itemCol >= 0 && itemCol !== respCol;
    // A Student Analysis file can arrive with no name column (a teacher removed it, or
    // a school's export leaves it out). Only that recognised shape is read without
    // one, and its students are numbered by their row in the file; any other file
    // with no student column is not guessed at.
    const unnamed = col.name < 0 && col.id < 0 && col.sis < 0;
    if (unnamed && !isBlock) {
      return { layout: 'unknown', students: [], items: [], notes: ['No student column was found. The first row should name a column "name", "student name" or "id".'] };
    }
    if (unnamed) notes.push('The file has no student name column, so each student is shown by their row in the file (Row 2 is the first student under the header).');
    const rowOf = new Map(rows.map((r, i) => [r, i + 1]));
    const studentKeyOf = r => {
      const id = col.id >= 0 ? String(r[col.id] || '').trim() : '';
      const sis = col.sis >= 0 ? String(r[col.sis] || '').trim() : '';
      const name = col.name >= 0 ? String(r[col.name] || '').trim() : '';
      return id || sis || name || (unnamed ? 'Row ' + rowOf.get(r) : '');
    };

    const students = new Map();
    const touch = r => {
      const key = studentKeyOf(r);
      if (!key) return null;
      if (!students.has(key)) {
        students.set(key, {
          key,
          name: col.name >= 0 ? plain(r[col.name]) : (unnamed ? key : ''),
          id: col.id >= 0 ? String(r[col.id] || '').trim() : '',
          sis: col.sis >= 0 ? String(r[col.sis] || '').trim() : '',
          section: col.section >= 0 ? plain(r[col.section]) : ''
        });
      }
      return key;
    };
    const attemptOf = r => (col.attempt >= 0 ? num(r[col.attempt]) : null);

    if (isLong) {
      const textCol = findCol(heads, LONG.text);
      const posCol = findCol(heads, LONG.pos);
      const scoreCol = findCol(heads, LONG.score);
      const possibleCol = findCol(heads, LONG.possible);
      const statusCol = findCol(heads, LONG.status);
      const typeCol = findCol(heads, ['item type', 'question type']);
      const idCol = findCol(heads, ['item id', 'question id']);
      const items = new Map();
      // Latest attempt per student, decided before anything is recorded.
      const latest = new Map();
      rows.slice(1).forEach(r => {
        const k = studentKeyOf(r);
        if (!k) return;
        const a = attemptOf(r);
        if (a != null && (!latest.has(k) || a > latest.get(k))) latest.set(k, a);
      });
      let multi = 0;
      rows.slice(1).forEach(r => {
        const k = touch(r);
        if (!k) return;
        const a = attemptOf(r);
        if (latest.has(k) && a != null && a !== latest.get(k)) { multi += 1; return; }
        students.get(k).canvas = totalsOf(r);
        const itemKey = String(r[itemCol] || '').trim() || (posCol >= 0 ? String(r[posCol] || '').trim() : '');
        if (!itemKey) return;
        if (!items.has(itemKey)) {
          items.set(itemKey, {
            key: itemKey,
            itemId: idCol >= 0 ? String(r[idCol] || '') : '',
            label: plain(textCol >= 0 ? r[textCol] : r[itemCol]),
            position: posCol >= 0 ? num(r[posCol]) : null,
            responses: {}
          });
        }
        if (typeCol >= 0 && r[typeCol]) {
          const it = items.get(itemKey);
          const type = plain(r[typeCol]);
          if (it.type && norm(it.type) !== norm(type)) it.typeConflict = true;
          it.type = type;
        }
        items.get(itemKey).responses[k] = {
          response: plain(r[respCol]),
          score: scoreCol >= 0 ? num(r[scoreCol]) : null,
          possible: possibleCol >= 0 ? num(r[possibleCol]) : null,
          status: statusCol >= 0 ? statusOf(r[statusCol]) : ''
        };
      });
      if (multi) notes.push('Some students have more than one attempt; the latest attempt is used.');
      const longItems = [...items.values()];
      fillPossible(longItems);
      return finishExport({ layout: 'long', shape: 'rows', students: [...students.values()], items: longItems, notes });
    }

    // Wide: one row per student, questions across the columns.
    const known = new Set(Object.values(col).filter(i => i >= 0));
    heads.forEach((h, i) => { if (ROLE.meta.includes(h)) known.add(i); });
    const groups = new Map();
    let lastGroup = null;
    if (isBlock) {
      // Keyed by column, not wording: two questions may be worded the same.
      let pending = {};
      heads.forEach((h, i) => {
        if (known.has(i) || h === '') return;
        if (BLOCK_AFTER.includes(h)) { if (lastGroup && lastGroup.score < 0) lastGroup.score = i; return; }
        // A full export (2026-11-24) runs "ItemID, ItemType, wording, EarnedPoints,
        // Status": a Status straight after a question's EarnedPoints is that question's.
        if (h === 'status' && lastGroup && i > 0 && BLOCK_AFTER.includes(heads[i - 1])) { lastGroup.status = i; return; }
        if (BLOCK_BEFORE[h]) { pending[BLOCK_BEFORE[h]] = i; return; }
        const g = { key: 'column ' + (i + 1), label: plain(header[i]), response: i, score: -1, possible: -1,
          status: pending.status != null ? pending.status : -1, type: pending.type != null ? pending.type : -1,
          itemId: pending.itemId != null ? pending.itemId : -1, first: i };
        groups.set(g.key, g);
        pending = {};
        lastGroup = g;
      });
    }
    if (!isBlock) heads.forEach((h, i) => {
      if (known.has(i)) { lastGroup = null; return; }
      const raw = header[i];
      // A bare number header ("2.0") is the score column for the question before it,
      // the way Canvas lays out a Student Analysis report.
      if (num(raw) != null || h === '') {
        if (lastGroup && lastGroup.score < 0) lastGroup.score = i;
        return;
      }
      const m = SUFFIX.exec(plain(raw));
      let key = plain(raw);
      let role = 'response';
      if (m && m[1] && norm(m[1])) {
        key = plain(m[1]);
        const word = norm(m[2]);
        role = word === 'status' ? 'status' : (word === 'points possible' ? 'possible' : (/points|score|correct/.test(word) ? 'score' : 'response'));
      }
      if (!groups.has(key)) groups.set(key, { key, label: key, response: -1, score: -1, possible: -1, status: -1, first: i });
      const g = groups.get(key);
      if (g[role] < 0) g[role] = i;
      lastGroup = g;
    });
    const items = [...groups.values()].filter(g => g.response >= 0).sort((a, b) => a.first - b.first).map((g, idx) => ({
      key: g.key, label: g.label.replace(/^\s*\d+\s*:\s*/, ''), position: idx + 1, responses: {}, _cols: g
    }));
    // One row per student: the highest attempt number, or the later row when the
    // file has no attempt column.
    const byStudent = new Map();
    rows.slice(1).forEach(r => {
      const k = studentKeyOf(r);
      if (!k) return;
      const a = attemptOf(r);
      const prev = byStudent.get(k);
      if (!prev) { byStudent.set(k, { r, a, multi: false }); return; }
      prev.multi = true;
      if (a == null || prev.a == null || a >= prev.a) { prev.r = r; prev.a = a; }
    });
    let multi = 0;
    byStudent.forEach(({ r, multi: m }) => {
      if (m) multi += 1;
      const k = touch(r);
      students.get(k).canvas = totalsOf(r);
      items.forEach(it => {
        const c = it._cols;
        it.responses[k] = {
          response: plain(r[c.response]),
          score: c.score >= 0 ? num(r[c.score]) : null,
          possible: c.possible >= 0 ? num(r[c.possible]) : (c.score >= 0 && num(header[c.score]) != null ? num(header[c.score]) : null),
          status: c.status >= 0 ? statusOf(r[c.status]) : ''
        };
        if (c.type >= 0 && r[c.type]) {
          const type = plain(r[c.type]);
          if (it.type && norm(it.type) !== norm(type)) it.typeConflict = true;
          it.type = type;
        }
        if (c.itemId >= 0 && r[c.itemId]) {
          const id = String(r[c.itemId]);
          if (!it.itemId && !it.itemIdConflict) it.itemId = id;
          else if (it.itemId !== id) { it.itemId = ''; it.itemIdConflict = true; }
        }
      });
    });
    items.forEach(it => { delete it._cols; });
    fillPossible(items);
    if (multi) notes.push(multi + ' student(s) appear on more than one row; the latest attempt is used.');
    return finishExport({ layout: 'wide', shape: isBlock ? 'student-analysis' : 'columns', students: [...students.values()], items, notes });
  }

  // When a file gives the points a student earned but not the points a question was
  // worth, the most anyone earned on it stands in: on a one-answer multiple-choice
  // question that is full marks, unless nobody got it right, when every score is 0
  // and every answer is wrong either way.
  function fillPossible(items) {
    items.forEach(it => {
      const rs = Object.values(it.responses);
      if (rs.some(r => r.possible != null)) return;
      const scores = rs.map(r => r.score).filter(s => s != null);
      if (!scores.length) return;
      const most = Math.max.apply(null, scores);
      if (most > 0) rs.forEach(r => { r.possible = most; r.inferredPossible = true; });
    });
  }

  // Several results files at once, one per class period (Jeff, 2026-11-24). A teacher
  // whose periods are separate Canvas courses downloads one file per course; each
  // becomes a class named by the teacher. A file that carries its own section column
  // keeps it. Questions are matched independently across files by identity evidence;
  // unresolved alignment and overlapping student IDs stop a combined analysis.
  //   files: [{ text, label }]  ->  the same shape readExport returns, plus files: [...]
  function combineExports(files, map) {
    const list = (files || []).map((f, i) => ({ label: String(f.label || '').trim() || 'Class ' + (i + 1), exp: readExport(f.text) }));
    const notes = [];
    const students = [];
    const items = new Map();
    const summary = [];
    const identities = new Map();
    const skippedItems = [];
    let blocked = false;
    let reference = map || null;
    list.forEach(({ label, exp }, fi) => {
      const ok = exp.items.length > 0 && exp.students.length > 0;
      summary.push({ label, students: ok ? exp.students.length : 0, questions: ok ? exp.items.length : 0, ok, layout: exp.layout });
      if (!ok) { blocked = true; notes.push(label + ': ' + (exp.notes[0] || 'this file could not be read as quiz results.')); return; }
      skippedItems.push(...(exp.skippedItems || []));
      const prefix = 'File ' + (fi + 1) + ': ';
      const keyOf = new Map();
      exp.students.forEach(s => {
        const identity = s.id ? 'id:' + s.id : s.sis ? 'sis:' + s.sis : '';
        if (identity) {
          if (identities.has(identity)) {
            blocked = true;
            if (!notes.some(n => /overlapping students/.test(n))) notes.push('These files have overlapping students. Remove the older export or load one file at a time; the same student must not be counted twice.');
          } else identities.set(identity, fi);
        }
        const key = prefix + s.key;
        keyOf.set(s.key, key);
        const unnamed = s.name === s.key && /^Row \d+$/.test(s.key);
        students.push({ ...s, key, name: unnamed ? label + ', ' + s.name : s.name, section: s.section || label });
      });
      // Match each file independently. Column order cannot align repeated stems.
      const first = !reference;
      if (first) reference = { questions: exp.items.map((it, i) => ({ n: i + 1, itemId: it.itemId || '', stem: it.label,
        _stem: norm(it.label), _opts: [...new Set(Object.values(it.responses).map(r => norm(r.response)).filter(Boolean))] })) };
      const aligned = first ? exp.items.map((it, i) => ({ item: it, q: reference.questions[i] })) : match(reference, exp).pairs;
      if (aligned.length !== exp.items.length) {
        blocked = true;
        notes.push(label + ': questions could not be aligned safely with the other files. Load a complete question map, or analyze each class separately.');
      }
      aligned.forEach(({ item: it, q }) => {
        const key = 'question ' + q.n;
        if (!items.has(key)) items.set(key, { key, label: it.label, position: items.size + 1, type: it.type, itemId: q.itemId || '', responses: {}, _files: 0 });
        const into = items.get(key);
        if (norm(into.label) !== norm(it.label)) {
          blocked = true;
          return; // the same ID with changed wording is a different assessment version
        }
        into._files += 1;
        Object.keys(it.responses).forEach(sk => { into.responses[keyOf.get(sk)] = it.responses[sk]; });
      });
      exp.notes.forEach(n => { if (!notes.includes(n)) notes.push(n); });
    });
    const good = summary.filter(f => f.ok).length;
    const all = [...items.values()];
    if (all.some(it => it._files < good)) {
      blocked = true;
      notes.push('Some questions are in only some of the files. Check that every file is from the same test. Remove the mismatched file or analyze each class separately.');
    }
    all.forEach(it => { delete it._files; });
    return { layout: 'combined', shape: 'combined', students, items: all, notes, files: summary, skippedItems,
      unknownTypes: all.filter(it => !it.type).length, blocked };
  }

  /* ── matching Canvas's questions to the map ───────────────────────────── */

  function optionIndex(q, response) {
    const r = norm(response);
    if (!r) return -1;
    let i = q._opts.indexOf(r);
    if (i >= 0) return i;
    // A response Canvas cut short, or one carrying a leading "B." or a trailing note.
    if (r.length >= 20) {
      i = q._opts.findIndex(o => o.length >= 20 && (o.startsWith(r) || r.startsWith(o) || r.endsWith(' ' + o)));
    }
    return i;
  }

  function match(map, exp) {
    const candidates = [];
    const stemCount = new Map();
    map.questions.forEach(q => stemCount.set(q._stem, (stemCount.get(q._stem) || 0) + 1));
    const optionOwners = new Map();
    map.questions.forEach((q, qi) => q._opts.forEach(o => {
      if (!optionOwners.has(o)) optionOwners.set(o, new Set());
      optionOwners.get(o).add(qi);
    }));
    exp.items.forEach((it, ii) => {
      if (!supportedItem(it)) return;
      const answers = Object.values(it.responses).map(r => r.response).filter(Boolean);
      const distinct = [...new Set(answers.map(norm))].filter(Boolean);
      const label = norm(it.label);
      map.questions.forEach((q, qi) => {
        let hits = 0;
        distinct.forEach(a => { if (optionIndex(q, a) >= 0) hits += 1; });
        const stemHit = q._stem.length >= 12 && label.length >= 12 && (label.includes(q._stem) || q._stem.includes(label));
        const uniqueStem = stemHit && stemCount.get(q._stem) === 1;
        const idHit = !!(q.itemId && it.itemId && q.itemId === it.itemId);
        const distinctive = distinct.some(a => {
          const oi = optionIndex(q, a);
          return oi >= 0 && q._opts[oi].length >= 12 && optionOwners.get(q._opts[oi]).size === 1;
        });
        const ratio = distinct.length ? hits / distinct.length : 0;
        // Position never resolves identity. Common choices alone are not evidence.
        if (!idHit && !stemHit && !(distinctive && ratio >= 0.5)) return;
        const score = (idHit ? 100 : uniqueStem ? 60 : distinctive && ratio >= 0.5 ? 30 : 10) + ratio;
        candidates.push({ ii, qi, score, hits, distinct: distinct.length, stemHit,
          how: idHit ? 'its Canvas item ID matches' : uniqueStem ? 'its wording matches' : 'its distinctive answer choices match' });
      });
    });
    candidates.sort((a, b) => b.score - a.score || a.qi - b.qi);
    const usedI = new Set();
    const usedQ = new Set();
    const pairs = [];
    // Require a unique best candidate in both directions, using the original set.
    // Removing one match must not turn weak leftover evidence into a confident match.
    const uniqueBest = (c, key) => {
      const others = candidates.filter(x => x !== c && x[key] === c[key]);
      return others.every(x => c.score > x.score + 1e-9);
    };
    const ambiguousItems = [];
    candidates.forEach(c => {
      if (usedI.has(c.ii) || usedQ.has(c.qi)) return;
      if (!uniqueBest(c, 'ii') || !uniqueBest(c, 'qi') || c.score < 30) {
        if (!ambiguousItems.some(it => it === exp.items[c.ii])) ambiguousItems.push(exp.items[c.ii]);
        return;
      }
      usedI.add(c.ii); usedQ.add(c.qi);
      // A Map Maker question lists only the answers one set of classes chose, so another
      // class choosing a new wrong answer is expected there, not a sign of a wrong match.
      pairs.push({ item: exp.items[c.ii], q: map.questions[c.qi], how: c.how, partial: c.hits < c.distinct && !map.questions[c.qi].seen });
    });
    pairs.sort((a, b) => map.questions.indexOf(a.q) - map.questions.indexOf(b.q));
    // An item nobody answered with words (no responses at all) is usually a stimulus
    // or a text block, not a missed question; it is listed separately.
    const unmatchedItems = exp.items.filter((it, i) => !usedI.has(i)).map(it => ({
      label: it.label, answered: Object.values(it.responses).filter(r => r.response).length
    }));
    const unmatchedQuestions = map.questions.filter((q, i) => !usedQ.has(i));
    return { pairs, unmatchedItems, unmatchedQuestions, ambiguousItems: ambiguousItems.filter(it => !pairs.some(p => p.item === it)) };
  }

  /* ── no question map: Canvas's own scores ─────────────────────────────── */

  // A teacher with only the Canvas file still gets right and wrong for every student
  // on every question, because Canvas scored them. Each question is its own group,
  // its "choices" are the answers students gave, and its correct answer is the one a
  // student earned full marks with (unknown when nobody did). Topics and learning
  // targets need a map, since the Canvas file does not carry them (seen 2026-11-23).
  function mapFromExport(exp, title) {
    const questions = [];
    const pairs = [];
    exp.items.forEach((it, i) => {
      if (!supportedItem(it)) return;
      const rs = Object.values(it.responses);
      if (!rs.some(r => r.score != null)) return;
      const n = i + 1;
      const options = [];
      rs.forEach(r => { if (r.response && !options.some(o => norm(o) === norm(r.response))) options.push(r.response); });
      const full = rs.find(r => r.response && r.score != null && r.score > 0 && (r.possible == null || r.score >= r.possible - 1e-9));
      const worth = rs.map(r => r.possible).find(p => p != null && p > 0);
      const q = {
        n, itemId: it.itemId || '', topic: '', lt: 'Q' + n, kc: '', skill: '', reasoning: '', source: '', stem: it.label, options,
        answer: full ? options.findIndex(o => norm(o) === norm(full.response)) : -1, points: worth || 1, rationale: '',
        _opts: options.map(norm), _stem: norm(it.label)
      };
      questions.push(q);
      pairs.push({ item: it, q, how: 'scored by Canvas', partial: false });
    });
    if (!questions.length) {
      return { map: null, matched: null, problem: 'The Canvas file has no points for its questions, so right and wrong cannot be told apart without a question map.' };
    }
    return {
      map: { format: MAP_FORMAT, title: title || 'This test', version: '', subtitle: '', targets: {}, questions, keyless: true, _owners: new Map() },
      matched: { pairs, unmatchedItems: [], unmatchedQuestions: [] }
    };
  }

  /* ── the Map Maker: a question map made from the Canvas file ──────────── */

  // Jeff, 2026-11-24: a map written by hand in JSON is more than most teachers will
  // ever do, so the page makes one. The Canvas file already holds each question's
  // wording, the answers students chose and, from Canvas's points, which one is right
  // (mapFromExport). What it lacks is each question's topic and standard. The teacher
  // types those beside each question, or pastes their standards into a prompt for their
  // own AI and pastes the AI's reply back. The prompt carries the test's questions and
  // nothing about any student. A map made this way marks each question "seen": its
  // choices are the answers students chose, not the test's full list.

  // A list of standards, one per line, as a teacher would paste it:
  //   "3.1 LT1: I can explain ...", "KC-3.1.I<tab>The Ottoman ...", "WH.4.2 - Analyze ...",
  //   "SS.9.12 Explain ..." (a code, then a space). A line with no code is numbered T1, T2.
  //   -> { targets: { code: wording }, order: [code, ...] }
  function parseStandards(text) {
    const targets = {};
    const order = [];
    let unnumbered = 0;
    String(text == null ? '' : text).split(/\r?\n/).forEach(line => {
      let code = '';
      let words = '';
      const raw = String(line).replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '');
      const tab = raw.indexOf('\t');
      if (tab > 0) { code = raw.slice(0, tab); words = raw.slice(tab + 1); }
      else {
        const s = plain(raw);
        const m = /^(.{1,40}?)\s*(?::|\s[-–—|]\s)\s*(.+)$/.exec(s)
          // A code is one word with a digit in it ("SS.9.12", "KC-3.1.I"), then the wording.
          || /^(\S*\d\S*)\s+(.{3,})$/.exec(s);
        if (m) { code = m[1]; words = m[2]; } else { words = s; }
      }
      code = plain(code);
      words = plain(words);
      if (!code && !words) return;
      if (!code) { unnumbered += 1; code = 'T' + unnumbered; }
      if (!(code in targets)) order.push(code);
      targets[code] = words;
    });
    return { targets, order };
  }

  // The prompt the teacher pastes into their own AI. It lists the test's questions,
  // the choices students made and the correct one when Canvas shows it, never a student.
  //   questions: mapFromExport(...).map.questions;  standards: parseStandards(...)
  function tagPrompt(questions, standards, title) {
    const st = standards || { targets: {}, order: [] };
    const has = st.order.length > 0;
    const lines = ['I am a teacher. I am tagging each question on a multiple-choice test, ' + (title || 'my test') + ', with the standard or learning target it assesses, so I can see which standards my students have shown and plan retakes.', ''];
    if (has) {
      lines.push('These are the standards, one per line, each starting with its code:', '');
      st.order.forEach(c => lines.push(c + (st.targets[c] ? ': ' + st.targets[c] : '')));
      lines.push('', 'For each question, choose the one standard it assesses most directly and give its code exactly as written above. Use only codes from this list.');
    } else {
      lines.push('I have not given a list of standards. For each question, write a short code for the learning target it assesses (for example "LT1"), and give the same code to questions that assess the same idea. After the list of questions, add one line per code with what it means, in this form: "LT1: I can explain ...".');
    }
    lines.push('Also give each question a topic: the unit or topic number its standard belongs to (for example 3.1), so related standards group together. If there is no such number, use a short name of two or three words.',
      '', 'Reply with one line per question, in exactly this form, and nothing else before the list:', 'Q1 | topic | code', '', 'The questions:', '');
    questions.forEach(q => {
      lines.push('Q' + q.n + '. ' + plain(q.stem));
      if (q.options.length) lines.push('   Answers students chose: ' + q.options.map(plain).join(' / '));
      if (q.answer >= 0 && q.options[q.answer]) lines.push('   The correct answer: ' + plain(q.options[q.answer]));
      lines.push('');
    });
    return lines.join('\n');
  }

  // The AI's reply, read forgivingly: "Q1 | 3.1 | KC-3.1.I", "1. 3.1 | 3.1 LT2",
  // "Question 4: 3.2 | LT1", a Markdown table row "| Q5 | 3.2 | LT1 |", or just a code
  // ("Q6 | LT3"). Anything else (the AI's opening sentence, a header row) is skipped.
  // A line like "LT1: I can explain ..." after the list is a code's wording.
  //   -> { tags: { n: { topic, lt } }, targets: { code: wording }, read }
  function parseTags(text) {
    const tags = {};
    const targets = {};
    let read = 0;
    String(text == null ? '' : text).split(/\r?\n/).forEach(line => {
      const s = String(line).replace(/[*`]/g, '').replace(/^\s*\|/, '').replace(/\|\s*$/, '').trim();
      // "Q1" or "Question 1" may be followed by anything; a bare number only by a
      // separator and a "|" list, so "3.1 LT1: I can ..." is never read as question 3.
      const m = /^Q(?:uestion)?\s*(\d{1,3})\b\s*[.:)\-|]?\s*(.*)$/i.exec(s)
        || /^(\d{1,3})(?:\s*[.:)]\s+|\s*\|\s*|\t)(.*[|\t].*)$/.exec(s);
      if (m && m[2]) {
        const parts = m[2].split(/\s*\|\s*|\t+/).map(plain).filter(Boolean);
        if (!parts.length) return;
        const topic = parts.length > 1 ? parts[0] : '';
        const lt = parts.length > 1 ? parts[1] : parts[0];
        if (/^(topic|code|standard)$/i.test(lt)) return; // a header row
        tags[Number(m[1])] = { topic, lt };
        read += 1;
        return;
      }
      const w = /^([A-Za-z][\w.\-]{0,20})\s*:\s*(.{3,})$/.exec(plain(s));
      if (w) targets[w[1]] = w[2];
    });
    return { tags, targets, read };
  }

  // The finished map, in the retake-planner-map/1 format parseMap reads.
  //   o: { title, questions (mapFromExport's), tags: { n: { topic, lt } },
  //        targets: { code: wording }, answers: { n: typed correct answer } }
  //   -> { map (a plain object, ready for JSON), problems: [...] }
  function buildMap(o) {
    const tags = o.tags || {};
    const typed = o.answers || {};
    const problems = [];
    const untagged = o.questions.filter(q => !(tags[q.n] && plain(tags[q.n].lt))).map(q => q.n);
    if (untagged.length) problems.push('Give every question a standard or learning target. Still empty: question' + (untagged.length > 1 ? 's ' : ' ') + untagged.join(', ') + '.');
    const questions = o.questions.map(q => {
      const options = q.options.slice();
      let answer = q.answer >= 0 ? q.answer : null;
      const t = plain(typed[q.n]);
      if (t) {
        const i = options.findIndex(x => norm(x) === norm(t));
        answer = i >= 0 ? i : options.push(t) - 1;
      }
      const tag = tags[q.n] || {};
      return { n: q.n, itemId: q.itemId || '', topic: plain(tag.topic), lt: plain(tag.lt), stem: q.stem, options, answer, points: q.points,
        rationale: q.rationale || '', kc: q.kc || '', skill: q.skill || '', reasoning: q.reasoning || '', source: q.source || '', seen: q.seen !== false };
    });
    const targets = {};
    Object.keys(o.targets || {}).forEach(k => { targets[k] = String(o.targets[k] || ''); });
    const map = { format: MAP_FORMAT, title: plain(o.title) || 'Untitled test', subtitle: String(o.subtitle || ''),
      version: plain(o.version || ''), made: 'Retake Planner Map Maker', targets, topics: o.topics || {}, questions };
    if (!problems.length) problems.push(...parseMap(map).problems);
    return { map, problems };
  }

  /* ── the analysis ─────────────────────────────────────────────────────── */

  function judge(pair, r) {
    const q = pair.q;
    if (!r) return { status: 'absent', response: '', choice: -1 };
    if (r.status === 'absent') return { status: 'absent', response: r.response, choice: -1 };
    const choice = optionIndex(q, r.response);
    if (r.status === 'blank' || (!r.response && r.score == null)) return { status: 'blank', response: '', choice: -1 };
    if (r.status === 'ungraded' && r.score == null) return { status: 'absent', response: r.response, choice };
    const keyRight = choice === q.answer;
    let right = keyRight;
    let disagree = false;
    if (r.score != null) {
      const possible = r.possible != null && r.possible > 0 ? r.possible : null;
      right = possible != null ? r.score >= possible - 1e-9 : r.score > 0;
      if (choice >= 0 && q.answer >= 0 && right !== keyRight) disagree = true;
    } else if (choice < 0 || q.answer < 0) {
      return { status: 'unknown', response: r.response, choice };
    }
    if (!r.response && !right) return { status: 'blank', response: '', choice: -1, disagree };
    return { status: right ? 'correct' : 'wrong', response: r.response, choice, disagree };
  }

  // options.rule: 'any' (a target needs a retake if any of its questions was missed,
  // the default) or 'most' (only if more than half were missed).
  // options.by: what a "target" is in every count and view. 'topic' (the default,
  // Jeff 2026-11-23) when the map gives topics, else the learning target; 'lt' for the
  // learning target; 'question' for each question on its own. With no map, every
  // question is its own group, because the Canvas file names no topic.
  const BY_LABEL = { topic: 'Topic', lt: 'Learning target', question: 'Question' };
  function groupingOf(map, want) {
    if (map.keyless) return 'question';
    const hasTopic = map.questions.some(q => q.topic);
    if (want === 'question') return 'question';
    if (want === 'lt') return 'lt';
    return hasTopic ? 'topic' : 'lt';
  }
  function groupKey(by, q) { return by === 'topic' ? (q.topic || q.lt) : (by === 'question' ? 'Q' + q.n : q.lt); }
  function groupWords(by, map, key, q) {
    if (by === 'topic') return (map.topics && map.topics[key]) || '';
    if (by === 'question') return q ? plain(q.stem) : '';
    return map.targets[key] || '';
  }

  // The counts for one set of students: each question, each topic (or target), and
  // the groups who need exactly the same retake.
  function tally(pairs, took, ltOrder, gk, by, map) {
    const questions = pairs.map((p, pi) => {
      const rs = took.map(s => s.results[pi]).filter(r => r.status !== 'absent' && r.status !== 'unknown');
      const correct = rs.filter(r => r.status === 'correct').length;
      const wrongCounts = new Map();
      rs.forEach(r => {
        if (r.status !== 'wrong' || !r.response) return;
        const key = norm(r.response);
        const entry = wrongCounts.get(key) || { choice: r.choice, text: r.response, count: 0 };
        entry.count += 1;
        wrongCounts.set(key, entry);
      });
      let topWrong = null;
      wrongCounts.forEach(entry => { if (!topWrong || entry.count > topWrong.count) topWrong = entry; });
      return { q: p.q, answered: rs.length, correct, blank: rs.filter(r => r.status === 'blank').length,
        pct: rs.length ? correct / rs.length : null, topWrong };
    });
    const targets = ltOrder.map(lt => {
      const qs = questions.filter(x => gk(x.q) === lt);
      const answered = qs.reduce((t, x) => t + x.answered, 0);
      const correct = qs.reduce((t, x) => t + x.correct, 0);
      const need = took.filter(s => s.targetsMissed.some(e => e.lt === lt));
      // The learning targets inside a topic, so a topic's card can say what it asks.
      const lts = [...new Set(qs.map(x => x.q.lt))].filter(x => by === 'topic' && map.targets[x]);
      return { lt, text: groupWords(by, map, lt, qs[0] && qs[0].q), questions: qs.map(x => x.q.n), pct: answered ? correct / answered : null,
        need: need.map(s => s.key), needCount: need.length, answered, correct, missed: answered - correct,
        within: lts.map(x => ({ lt: x, text: map.targets[x] })) };
    });
    // Students who need exactly the same targets can take the same retake.
    const groupMap = new Map();
    took.forEach(s => {
      const key = s.targetsMissed.map(e => e.lt).join(' + ');
      if (!groupMap.has(key)) groupMap.set(key, { lts: s.targetsMissed.map(e => e.lt), students: [] });
      groupMap.get(key).students.push(s.key);
    });
    const groups = [...groupMap.values()].filter(g => g.lts.length).sort((a, b) => b.students.length - a.students.length || a.lts.length - b.lts.length);
    const average = took.length ? took.reduce((t, s) => t + (s.possible ? s.earned / s.possible : 0), 0) / took.length : null;
    return { questions, targets, groups, average };
  }

  function analyze(map, exp, matched, options) {
    const rule = options && options.rule === 'most' ? 'most' : 'any';
    const section = options && options.section ? options.section : '';
    const by = groupingOf(map, options && options.by);
    const gk = q => groupKey(by, q);
    const notes = [];
    const pairs = matched.pairs;
    const ltOrder = [];
    map.questions.forEach(q => { if (!ltOrder.includes(gk(q))) ltOrder.push(gk(q)); });
    // "3.1 LT2" before "3.1 LT10" before "3.2 LT1": course order, not quiz order.
    ltOrder.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

    // What each question is worth, in Canvas's points when the file says, so a score
    // reads as Canvas shows it (41 of 50, not 82 of 100 from a key that counts 2 each).
    // A question nobody got right says nothing; it takes the usual worth of the others.
    const known = pairs.map(p => { const r = Object.values(p.item.responses).find(x => x.possible != null && x.possible > 0); return r ? r.possible : null; });
    const usual = known.filter(x => x != null).sort((x, y) => x - y)[Math.floor(known.filter(x => x != null).length / 2)];
    const worth = pairs.map((p, i) => (known[i] != null ? known[i] : (usual != null ? usual : p.q.points)));
    // Every student in the file is read first, whatever class is chosen, so that a
    // student's number is the same in every class view, every sort and every copy.
    const everyone = exp.students.map(s => {
      let disagree = 0;
      let unknown = 0;
      const results = pairs.map((p, pi) => {
        const raw = p.item.responses[s.key];
        const j = judge(p, raw);
        if (j.disagree) disagree += 1;
        if (j.status === 'unknown') unknown += 1;
        return Object.assign({ q: p.q, worth: worth[pi], score: raw ? raw.score : null,
          estimated: !!(raw && raw.inferredPossible) || known[pi] == null }, j);
      });
      const counted = results.filter(r => r.status !== 'absent' && r.status !== 'unknown');
      const itemEarned = counted.reduce((t, r) => t + (r.score != null ? r.score : r.status === 'correct' ? r.worth : 0), 0);
      const itemPossible = counted.reduce((t, r) => t + r.worth, 0);
      const canvas = s.canvas;
      const hasTotal = canvas && canvas.earned != null && canvas.possible != null && canvas.possible > 0;
      const estimated = counted.some(r => r.estimated);
      const earned = hasTotal ? canvas.earned : itemEarned;
      const possible = hasTotal ? canvas.possible : itemPossible;
      const scoreSource = hasTotal ? 'canvas' : estimated ? 'estimated' : 'items';
      const byLt = new Map();
      counted.forEach(r => {
        const g = gk(r.q);
        if (!byLt.has(g)) byLt.set(g, { lt: g, of: 0, missed: 0, questions: [] });
        const e = byLt.get(g);
        e.of += 1;
        if (r.status !== 'correct') { e.missed += 1; e.questions.push(r.q.n); }
      });
      const targetsMissed = ltOrder.map(lt => byLt.get(lt)).filter(e => e && e.missed > 0 && (rule === 'any' || e.missed * 2 > e.of));
      return { key: s.key, name: s.name, id: s.id, section: s.section, results, earned, possible, scoreSource, itemEarned, itemPossible,
        took: counted.length > 0, targetsMissed, _disagree: disagree, _unknown: unknown };
    });
    // "Student 3" means the same student on every panel and in every copy.
    everyone.filter(s => s.took).forEach((s, i) => { s.n = i + 1; });
    const students = everyone.filter(s => !section || s.section === section);
    const took = students.filter(s => s.took);
    const main = tally(pairs, took, ltOrder, gk, by, map);

    // Class by class, for comparing periods. Only when the file holds more than one
    // class and no single class is chosen.
    const sectionNames = [...new Set(everyone.filter(s => s.took && s.section).map(s => s.section))]
      .sort((x, y) => x.localeCompare(y, 'en', { numeric: true }));
    const byClass = !section && sectionNames.length > 1 ? sectionNames.map(name => {
      const t = tally(pairs, everyone.filter(s => s.took && s.section === name), ltOrder, gk, by, map);
      const n = everyone.filter(s => s.took && s.section === name).length;
      return { section: name, took: n, average: t.average, targets: t.targets.map(x => ({ lt: x.lt, pct: x.pct, needCount: x.needCount })) };
    }) : [];

    const disagreements = students.reduce((t, s) => t + s._disagree, 0);
    const unknown = students.reduce((t, s) => t + s._unknown, 0);
    everyone.forEach(s => { delete s._disagree; delete s._unknown; });
    if (disagreements) notes.push(disagreements + ' answer(s) were scored differently by Canvas than by the key. Canvas holds the grade, so Canvas\'s score was used. A regraded question is the usual reason.');
    if (unknown) notes.push(unknown + ' answer(s) could not be read as one of the choices and had no Canvas score, so they are left out of every count.');
    const absent = students.length - took.length;
    if (absent) notes.push(absent + ' student(s) have no answers to any matched question and are left out.');
    if (took.some(s => s.scoreSource === 'estimated')) notes.push('Some scores are estimates: Canvas did not supply complete overall totals or explicit question maximums. Confirm the score in Canvas.');
    if (took.some(s => s.scoreSource === 'canvas')) notes.push('Canvas score uses the exported overall total, including items outside this analysis. The heat map and standards use only matched, supported questions.');
    if (took.some(s => s.scoreSource === 'canvas' && (Math.abs(s.earned - s.itemEarned) > 1e-9 || Math.abs(s.possible - s.itemPossible) > 1e-9))) {
      notes.push('Canvas totals differ from the analyzed item totals. This can reflect skipped or unmatched items, adjusted grades, or estimated question maximums. The displayed score uses Canvas totals.');
    }

    return {
      version: VERSION, rule, section, title: map.title, by, byLabel: BY_LABEL[by], keyless: !!map.keyless,
      // The heat map's columns: every question, grouped under its topic or target in
      // course order, each an index into students[].results and questions.
      columns: ltOrder.map(g => ({ key: g,
        cols: pairs.map((p, i) => i).filter(i => gk(pairs[i].q) === g) })).filter(c => c.cols.length),
      students, took: took.length, questions: main.questions, targets: main.targets, groups: main.groups, average: main.average,
      sections: sectionNames, byClass, notes,
      possible: worth.reduce((t, w) => t + w, 0)
    };
  }

  /* ── output a teacher can keep ───────────────────────────────────────── */

  function display(s, anon) { return anon ? 'Student ' + s.n : (s.name || s.id || s.key); }

  function planText(a, options) {
    const anon = !!(options && options.anon);
    const lines = [a.title + ': retake plan', 'A target is listed when the student ' + (a.rule === 'most' ? 'missed most of its questions.' : 'missed any of its questions.'), ''];
    a.students.filter(s => s.took).forEach(s => {
      lines.push(display(s, anon) + (s.section && !anon ? ' (' + s.section + ')' : '') + ': ' + s.earned + ' of ' + s.possible + ' points'
        + (s.scoreSource === 'canvas' ? ' (Canvas overall total)' : s.scoreSource === 'estimated' ? ' (estimated; confirm in Canvas)' : ' (analyzed items)'));
      if (!s.targetsMissed.length) lines.push('  Nothing to retake.');
      s.targetsMissed.forEach(e => {
        const t = a.targets.find(x => x.lt === e.lt);
        const words = t && t.text && !(anon && a.by === 'question') ? ': ' + t.text : '';
        lines.push('  ' + (a.by === 'topic' ? 'Topic ' : '') + e.lt + ' (missed ' + e.missed + ' of ' + e.of + '; question' + (e.questions.length > 1 ? 's ' : ' ') + e.questions.join(', ') + ')' + (a.by === 'question' ? '' : words));
      });
      lines.push('');
    });
    return lines.join('\n').replace(/\n+$/, '\n');
  }

  function planCsv(a, options) {
    const anon = !!(options && options.anon);
    const head = ['student', 'section', 'points', 'points possible', (a.byLabel || 'Learning target').toLowerCase(), 'missed', 'of', 'questions missed', 'wording', 'score source'];
    const out = [head.map(downloadCell).join(',')];
    a.students.filter(s => s.took).forEach(s => {
      const base = [display(s, anon), anon ? '' : s.section, s.earned, s.possible];
      if (!s.targetsMissed.length) out.push(base.concat(['(none)', 0, '', '', '', s.scoreSource]).map(downloadCell).join(','));
      s.targetsMissed.forEach(e => {
        const t = a.targets.find(x => x.lt === e.lt);
        out.push(base.concat([e.lt, e.missed, e.of, e.questions.join(' '), t && !(anon && a.by === 'question') ? t.text : '', s.scoreSource]).map(downloadCell).join(','));
      });
    });
    return out.join('\r\n') + '\r\n';
  }

  // The class report: one row per topic (or target, or question), most missed first.
  function reportRows(a) {
    return a.targets.slice().sort((x, y) => ((x.pct == null ? 2 : x.pct) - (y.pct == null ? 2 : y.pct)) || (y.needCount - x.needCount)
      || x.lt.localeCompare(y.lt, 'en', { numeric: true }));
  }
  function reportCsv(a, options) {
    const anon = !!(options && options.anon);
    const classes = a.byClass || [];
    const head = [a.byLabel.toLowerCase(), 'wording', 'questions', 'percent correct', 'answers correct', 'answers counted', 'students to retake']
      .concat(classes.map(c => c.section + ' percent correct'));
    const out = [head.map(downloadCell).join(',')];
    const pc = p => (p == null ? '' : Math.round(p * 100));
    reportRows(a).forEach(t => {
      // Projector safe: a question's own wording is the test, so it stays out.
      const words = anon && a.by === 'question' ? '' : t.text;
      out.push([t.lt, words, t.questions.join(' '), pc(t.pct), t.correct, t.answered, t.needCount]
        .concat(classes.map(c => pc((c.targets.find(x => x.lt === t.lt) || {}).pct))).map(downloadCell).join(','));
    });
    return out.join('\r\n') + '\r\n';
  }

  /* ── standards coverage: which standards this test showed ─────────────── */

  // Jeff, 2026-11-25. A multiple-choice test can show a standard only if it asks enough
  // about it, and a student shows it only by getting all of that right:
  //   - a standard is TESTED when at least MIN_QUESTIONS questions assess it ("2
  //     questions to meet a standard"); with fewer, a lucky guess could pass it;
  //   - a student has SHOWN a tested standard when every one of its questions they were
  //     given is correct ("all questions answered correctly"), and NOT YET otherwise;
  //   - a student given fewer than MIN_QUESTIONS of its questions (the rest unseen) has
  //     too little evidence either way;
  //   - a standard in the map's list that no question assesses is NOT ON THIS TEST.
  // Always by standard (each question's learning target), whatever the grouping chosen
  // elsewhere, and for both the class and each student. It says "shown on multiple
  // choice", never more: a multiple-choice test cannot show a skill such as writing an
  // argument.
  const MIN_QUESTIONS = 2;
  function coverage(map, a) {
    const took = a.students.filter(s => s.took);
    const order = [];
    map.questions.forEach(q => { if (!order.includes(q.lt)) order.push(q.lt); });
    order.sort((p, q) => p.localeCompare(q, 'en', { numeric: true }));
    const words = map.targets || {};
    const cells = new Map(took.map(s => [s.key, {}]));
    const rows = order.map(lt => {
      const qs = map.questions.filter(q => q.lt === lt).map(q => q.n);
      const missing = qs.filter(n => !a.questions.some(x => x.q.n === n));
      const status = missing.length ? 'unmatched' : qs.length >= MIN_QUESTIONS ? 'tested' : 'thin';
      const shown = [];
      const notYet = [];
      const few = [];
      took.forEach(s => {
        const counted = s.results.filter(r => r.q.lt === lt && r.status !== 'absent' && r.status !== 'unknown');
        let cell;
        if (status === 'unmatched') cell = 'missing';
        else if (status !== 'tested' || counted.length < MIN_QUESTIONS) cell = 'few';
        else cell = counted.every(r => r.status === 'correct') ? 'shown' : 'notyet';
        cells.get(s.key)[lt] = cell;
        (cell === 'shown' ? shown : cell === 'notyet' ? notYet : few).push(s.key);
      });
      const judged = shown.length + notYet.length;
      return { lt, text: String(words[lt] || ''), questions: qs, missing, status, shown, notYet, few, pct: judged ? shown.length / judged : null };
    });
    // Standards the map lists that this test never asked about (the Map Maker keeps every
    // standard the teacher pasted, tested or not).
    const untested = Object.keys(words).filter(lt => !order.includes(lt))
      .sort((p, q) => p.localeCompare(q, 'en', { numeric: true }))
      .map(lt => ({ lt, text: String(words[lt] || ''), questions: [], status: 'untested' }));
    return {
      min: MIN_QUESTIONS, rows, untested,
      students: took.map(s => ({ key: s.key, n: s.n, cells: cells.get(s.key), shown: rows.filter(r => r.status === 'tested' && cells.get(s.key)[r.lt] === 'shown').length })),
      tested: rows.filter(r => r.status === 'tested').length,
      unmatched: rows.filter(r => r.status === 'unmatched').length,
      thin: rows.filter(r => r.status === 'thin').length
    };
  }
  // One row per student, one column per standard, then a row for the class.
  const CELL_WORD = { shown: 'shown', notyet: 'not yet', few: 'too few questions', missing: 'missing imported questions' };
  function coverageCsv(cov, a, options) {
    const anon = !!(options && options.anon);
    const byKey = new Map(a.students.map(s => [s.key, s]));
    const cols = cov.rows;
    const out = [['student', 'section', 'standards shown', 'standards tested'].concat(cols.map(r => r.lt)).map(downloadCell).join(',')];
    cov.students.forEach(st => {
      const s = byKey.get(st.key);
      out.push([display(s, anon), anon ? '' : s.section, st.shown, cov.tested].concat(cols.map(r => CELL_WORD[st.cells[r.lt]])).map(downloadCell).join(','));
    });
    out.push(['Class: students who showed it', '', '', ''].concat(cols.map(r => (r.status === 'tested' ? r.shown.length + ' of ' + (r.shown.length + r.notYet.length) : r.status === 'unmatched' ? 'missing imported questions' : 'only ' + r.questions.length + ' question'))).map(downloadCell).join(','));
    cov.untested.forEach(r => out.push(['Not on this test: ' + r.lt, '', '', ''].concat(cols.map(() => '')).map(downloadCell).join(',')));
    return out.join('\r\n') + '\r\n';
  }

  /* ── retake questions: a prompt for the teacher's own AI ──────────────── */

  // Jeff, 2026-11-21: the planner writes the prompt and the teacher pastes it into
  // whichever AI they use, so nothing leaves this page by itself. A prompt never
  // carries a student's name or id: students are "Student 3", the number every
  // panel shows. It carries the questions the student missed, the answer they chose
  // and, when known, the correct answer, because that is what lets the AI ask about
  // the same idea without asking the same question.
  const STYLES = ['retake', 'corrections'];
  function missedFor(a, s) {
    const eligible = new Set(s.targetsMissed.map(t => t.lt));
    return s.results.filter(r => (r.status === 'wrong' || r.status === 'blank') && eligible.has(groupKey(a.by, r.q))).map(r => {
      const key = groupKey(a.by, r.q);
      const t = a.targets.find(x => x.lt === key);
      return { r, key, words: t ? t.text : '', lt: r.q.lt, ltWords: (t && t.within.find(w => w.lt === r.q.lt) || {}).text || '' };
    });
  }
  function describeMiss(a, m, i) {
    const q = m.r.q;
    const lines = [(i + 1) + '. ' + (a.by === 'question' ? 'Question ' + q.n : a.byLabel + ' ' + m.key + (m.words ? ' (' + m.words + ')' : '') + ', question ' + q.n)];
    if (a.by === 'topic' && m.ltWords) lines.push('   Learning target: ' + m.lt + ', ' + m.ltWords);
    else if (a.by === 'lt' && m.words) lines.push('   Learning target: ' + m.words);
    if (q.source) lines.push('   It was about this source: ' + plain(q.source));
    lines.push('   Question: ' + plain(q.stem));
    lines.push('   The student ' + (m.r.status === 'blank' ? 'left it blank.' : 'chose: ' + plain(m.r.response)));
    if (q.answer >= 0 && q.options[q.answer]) lines.push('   The correct answer: ' + plain(q.options[q.answer]));
    if (q.rationale) lines.push('   Why the other answers are wrong: ' + plain(q.rationale));
    return lines.join('\n');
  }
  function instructions(style, count, many) {
    const who = many ? 'each student below' : 'this student';
    if (style === 'corrections') {
      return [
        'Write test corrections for ' + who + '. For every question listed, write one open-ended correction prompt that asks the student to explain, in their own words, why the answer they chose is not the best answer and which idea the best answer depends on.',
        'Do not give the correct answer away in the prompt. Do not write multiple-choice questions.',
        'After each prompt, add "What a strong answer includes:" with two or three short points for the teacher.'
      ];
    }
    return [
      'Write ' + count + ' new open-ended retake question' + (count > 1 ? 's' : '') + ' for ' + who + '. Each question must check the same understanding the missed questions checked, but must not repeat those questions, their wording or their answer choices.',
      'Spread the questions across what the student missed, giving more to the topics or targets with more misses.',
      'Each question should ask the student to explain, with specific evidence, in a short paragraph. Do not write multiple-choice questions. Match the reading level of the original questions.',
      'After each question, add "What a strong answer includes:" with two or three short points for the teacher.'
    ];
  }
  function header(a, style) {
    return 'I am a teacher. My students took a multiple-choice test, ' + a.title + ', and I am giving them ' +
      (style === 'corrections' ? 'test corrections' : 'a retake') + ' on what they missed. Student names are left out on purpose.';
  }
  function retakePrompt(a, s, options) {
    const o = options || {};
    const style = STYLES.includes(o.style) ? o.style : 'retake';
    const count = Math.max(1, Math.min(10, Math.round(Number(o.count) || 3)));
    const missed = missedFor(a, s);
    if (!missed.length) return '';
    return [header(a, style), '', ...instructions(style, count, false), '',
      'Student ' + s.n + ' missed these questions:', '', missed.map((m, i) => describeMiss(a, m, i)).join('\n\n'), ''].join('\n');
  }
  // One prompt for the whole class: one paste, every student's questions back,
  // each under the student's number.
  function classPrompt(a, options) {
    const o = options || {};
    const style = STYLES.includes(o.style) ? o.style : 'retake';
    const count = Math.max(1, Math.min(10, Math.round(Number(o.count) || 3)));
    const who = a.students.filter(s => s.took && missedFor(a, s).length);
    if (!who.length) return '';
    return [header(a, style), '', ...instructions(style, count, true),
      'Put each student\'s questions under a heading with their student number, for example "Student 3".', '',
      who.map(s => '=== Student ' + s.n + ' ===\n' + missedFor(a, s).map((m, i) => describeMiss(a, m, i)).join('\n\n')).join('\n\n'), ''].join('\n');
  }

  return { VERSION, MAP_FORMAT, MAP_FORMATS, BY_LABEL, parseCsv, csvCell, norm, plain, display, parseMap, readExport, combineExports, match, mapFromExport,
    parseStandards, tagPrompt, parseTags, buildMap, analyze, planText, planCsv, reportRows, reportCsv, MIN_QUESTIONS, coverage, coverageCsv,
    retakePrompt, classPrompt };
});
