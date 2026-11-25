/* Local packet requests, AI-reply validation and printable documents. No network or storage. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RetakePackets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const FORMAT = 'retake-planner-response/1';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const key = s => String(s).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  function eligible(a) {
    return a.students.filter(s => s.took && s.targetsMissed.length).slice().sort((x, y) => x.n - y.n);
  }
  function options(o) {
    return { style: o && o.style === 'corrections' ? 'corrections' : 'retake',
      count: Math.max(1, Math.min(10, Math.round(Number(o && o.count) || 3))),
      grade: String(o && o.grade || '').trim().slice(0, 80), course: String(o && o.course || '').trim().slice(0, 80) };
  }
  function sourceItems(s) {
    const ids = new Set(s.targetsMissed.flatMap(t => t.questions).map(String));
    return s.results.filter(r => ids.has(String(r.q.n)) && (r.status === 'wrong' || r.status === 'blank'));
  }
  // This signature stays local. It includes identities to invalidate stale name mappings.
  function context(a, opts) {
    return JSON.stringify([a.title, a.rule, a.by, a.section, options(opts), eligible(a).map(s => [s.n, s.key, s.name, s.section,
      sourceItems(s).map(r => [r.q.n, r.q.lt, r.q.topic, r.q.stem, r.q.options, r.q.answer, r.q.source, r.q.rationale, r.response, r.status])])]);
  }
  function createRequest(a, opts, requestId, numbers) {
    const o = options(opts);
    const students = eligible(a).filter(s => !numbers || numbers.includes(s.n));
    if (!requestId || !students.length) throw new Error('Choose students who meet the retake rule before copying a packet prompt.');
    const roster = students.map(s => {
      const sources = sourceItems(s).map(r => ({ n: String(r.q.n), target: r.q.lt, topic: r.q.topic || '', stem: r.q.stem,
        response: r.status === 'blank' ? '(left blank)' : r.response,
        correct: r.q.answer >= 0 ? r.q.options[r.q.answer] : '(unknown; verify the concept before writing)',
        source: r.q.source || '', rationale: r.q.rationale || '' }));
      return { student: s.n, key: s.key, name: s.name || s.id || 'Student ' + s.n, section: s.section || '',
        expected: o.style === 'corrections' ? sources.length : o.count, sources };
    });
    const schema = { format: FORMAT, requestId, students: [{ student: roster[0].student, questions: [{
      id: 'S' + roster[0].student + '-Q1', sourceQuestions: [roster[0].sources[0].n],
      question: 'Student-facing question only. Do not include answers or scoring advice here.',
      teacherGuidance: ['Expected evidence or understanding', 'Expected reasoning'],
      rubric: 'Explain how to award the suggested points.', points: 4
    }] }] };
    const prompt = [
      'I am a teacher preparing ' + (o.style === 'corrections' ? 'test corrections' : 'new open-ended retake questions') + ' for ' + a.title + '.',
      o.grade ? 'Grade or reading level: ' + o.grade + '.' : 'Match the reading level of the original questions.',
      o.course ? 'Course: ' + o.course + '.' : '',
      'Student names and IDs are intentionally excluded. Use only the student numbers provided.',
      'Write exactly the requested number of distinct questions for EVERY student below. Check the same understanding using new wording and examples; do not repeat original questions or answer choices.',
      o.style === 'corrections' ? 'Write one correction per source question, with exactly that one sourceQuestions number. Ask students to explain and correct their original thinking without giving the answer away.'
        : 'Spread the questions across ALL the student\'s missed learning targets, weighting more misses more heavily. A question may cover more than one source question when necessary.',
      'Ask for a short paragraph with specific evidence and reasoning. Include any source or stimulus a student needs IN the question; do not assume they have the original test.',
      'Return 2 to 8 short teacherGuidance points, a clear scoring rubric and suggested whole-number points (1 to 20) for each question. These belong only in the teacher fields.',
      'The question field is for students: exclude answers, teacher notes, rubrics and scoring explanations. A teacher will review every question before use.',
      'Return ONLY one JSON object in the exact format below, without commentary. Copy requestId exactly. Number IDs S<student>-Q1, S<student>-Q2 and so on. Use sourceQuestions numbers only from that student\'s list.',
      JSON.stringify(schema, null, 2), '', 'Students and their missed questions (this is input context, not text to copy into the student packet):',
      ...roster.map(s => JSON.stringify({ student: s.student, questionCount: s.expected, missed: s.sources }))
    ].filter(Boolean).join('\n\n');
    return { id: requestId, signature: context(a, o), title: a.title, options: o, students: roster, prompt };
  }

  function validateReply(data, request) {
    const problems = [];
    const object = x => x && typeof x === 'object' && !Array.isArray(x);
    const fields = (x, allowed, label) => {
      if (object(x) && Object.keys(x).some(k => !allowed.includes(k))) problems.push(label + ' contains unexpected fields. Use the exact reply format from the packet prompt.');
    };
    if (!request || !object(data)) return { draft: null, problems: ['Create a packet prompt first, then paste the complete reply from that request.'] };
    fields(data, ['format', 'requestId', 'students'], 'The reply');
    if (data.format !== FORMAT) problems.push('The reply is not in the packet format. Ask the AI to follow the complete packet prompt.');
    if (data.requestId !== request.id) problems.push('This reply belongs to a different or older request. Copy a new packet prompt and use its reply.');
    if (!Array.isArray(data.students) || data.students.length > 100) return { draft: null, problems: problems.concat('The reply needs a students list.') };
    const seen = new Set();
    const clean = [];
    data.students.forEach(st => {
      const number = st && st.student;
      const label = 'Student ' + number;
      const expected = request.students.find(s => s.student === number);
      if (!object(st) || !Number.isInteger(number) || !expected) { problems.push('The reply includes an unknown student number.'); return; }
      fields(st, ['student', 'questions'], label);
      if (seen.has(number)) { problems.push(label + ' appears twice.'); return; }
      seen.add(number);
      if (!Array.isArray(st.questions) || st.questions.length !== expected.expected) { problems.push(label + ' needs exactly ' + expected.expected + ' questions.'); return; }
      const textSeen = new Set(), usedSources = new Set(), covered = new Set();
      const questions = [];
      st.questions.forEach((q, i) => {
        const labelQ = label + ', question ' + (i + 1);
        if (!object(q)) { problems.push(labelQ + ' is missing.'); return; }
        fields(q, ['id', 'sourceQuestions', 'question', 'teacherGuidance', 'rubric', 'points'], labelQ);
        const id = 'S' + number + '-Q' + (i + 1);
        if (q.id !== id) problems.push(labelQ + ' must have ID ' + id + '.');
        if (typeof q.question !== 'string' || !q.question.trim() || q.question.length > 6000) problems.push(labelQ + ' needs a student-facing question (up to 6,000 characters).');
        else {
          const text = key(q.question);
          if (textSeen.has(text)) problems.push(labelQ + ' repeats another question for this student.');
          textSeen.add(text);
        }
        if (!Array.isArray(q.teacherGuidance) || q.teacherGuidance.length < 2 || q.teacherGuidance.length > 8
          || q.teacherGuidance.some(t => typeof t !== 'string' || !t.trim() || t.length > 2000)) problems.push(labelQ + ' needs 2 to 8 teacher guidance points.');
        if (typeof q.rubric !== 'string' || !q.rubric.trim() || q.rubric.length > 4000) problems.push(labelQ + ' needs scoring guidance (up to 4,000 characters).');
        if (!Number.isInteger(q.points) || q.points < 1 || q.points > 20) problems.push(labelQ + ' needs whole-number points from 1 to 20.');
        const source = Array.isArray(q.sourceQuestions) ? q.sourceQuestions.map(String) : [];
        if (!source.length || new Set(source).size !== source.length || source.some(n => !expected.sources.some(s => s.n === n))) problems.push(labelQ + ' must reference only this student\'s qualifying missed question numbers, without repeats.');
        source.forEach(n => {
          const s = expected.sources.find(s => s.n === n);
          if (s) covered.add(s.target);
          if (request.options.style === 'corrections' && usedSources.has(n)) problems.push(labelQ + ' repeats a correction for the same original question.');
          usedSources.add(n);
        });
        if (request.options.style === 'corrections' && source.length !== 1) problems.push(labelQ + ' must correct exactly one original question.');
        questions.push({ id, sourceQuestions: source, question: String(q.question || '').trim(),
          teacherGuidance: Array.isArray(q.teacherGuidance) ? q.teacherGuidance.map(t => String(t).trim()) : [], rubric: String(q.rubric || '').trim(), points: q.points });
      });
      if (expected.sources.some(s => !covered.has(s.target))) problems.push(label + '\'s questions do not cover every qualifying missed learning target.');
      clean.push({ student: number, questions });
    });
    request.students.forEach(s => { if (!seen.has(s.student)) problems.push('Student ' + s.student + ' is missing from the reply.'); });
    return { draft: problems.length ? null : { format: FORMAT, requestId: request.id, students: clean }, problems: [...new Set(problems)] };
  }
  function parseReply(text, request) {
    const raw = String(text || '').trim();
    if (raw.length > 2000000) return { draft: null, problems: ['The reply is too large. Generate a smaller batch.'] };
    try { return validateReply(JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')), request); }
    catch (e) { return { draft: null, problems: ['The reply could not be read. Paste the complete response, including its opening and closing braces. If it was cut off, ask the AI to regenerate the complete batch.'] }; }
  }

  const PRINT_CSS = '@page{size:letter;margin:0.65in}*{box-sizing:border-box}body{font:12pt/1.5 Arial,sans-serif;color:#111;background:white;margin:0}h1{font-size:19pt;margin:0 0 8pt}h2{font-size:14pt}h3{font-size:12pt;margin:12pt 0 5pt}.packet{break-before:page}.packet:first-child{break-before:auto}.packet-meta{border-bottom:1px solid #777;padding-bottom:10pt}.packet-question{break-inside:avoid;margin-top:18pt}.packet-question p,.packet-instructions,.teacher-rubric{white-space:pre-wrap;overflow-wrap:anywhere}.packet-lines{height:22pt;border-bottom:1px solid #aaa}.packet-focus{font-size:10pt;color:#333}.teacher-banner{font-weight:bold;border:2px solid #222;padding:8pt}.packet-meta span{display:inline-block;margin-right:18pt}ul{padding-left:20pt}@media screen{body{max-width:8.5in;margin:30px auto;padding:25px}.packet{margin-bottom:50px}}';
  function documentFor(request, draft, approved, opts) {
    const checked = validateReply(draft, request);
    if (checked.problems.length) throw new Error('Resolve the reply problems before printing.');
    const selected = checked.draft.students.filter(s => approved.includes(s.student));
    if (!selected.length) throw new Error('Review and approve at least one packet first.');
    const teacher = opts && opts.mode === 'teacher';
    const lines = Math.max(3, Math.min(16, Math.round(Number(opts && opts.lines) || 6)));
    const directions = String(opts && opts.instructions || 'Answer in complete sentences. Use specific evidence and explain your reasoning.');
    const body = selected.map(st => {
      const person = request.students.find(s => s.student === st.student);
      return '<section class="packet"><h1>' + esc(request.title) + ': ' + (teacher ? 'Teacher key' : request.options.style === 'corrections' ? 'Test corrections' : 'Retake') + '</h1>'
        + (teacher ? '<p class="teacher-banner">TEACHER KEY: keep separate from student packets.</p>' : '')
        + '<div class="packet-meta"><span>Name: ' + esc(person.name) + '</span><span>Class: ' + esc(person.section || '________') + '</span><span>Student ' + person.student + '</span><span>Date: __________</span><span>Total possible: ' + st.questions.reduce((sum, q) => sum + q.points, 0) + ' points</span></div>'
        + '<p class="packet-instructions">' + esc(directions) + '</p>'
        + st.questions.map((q, i) => '<article class="packet-question"><h3>' + (i + 1) + '. (' + q.points + ' points)</h3><p>' + esc(q.question) + '</p>'
          + (teacher ? '<p class="packet-focus">Original missed questions: ' + esc(q.sourceQuestions.join(', ')) + '</p><h3>What a strong answer includes</h3><ul>'
            + q.teacherGuidance.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul><h3>Scoring guidance</h3><p class="teacher-rubric">' + esc(q.rubric) + '</p>'
            : Array.from({ length: lines }, () => '<div class="packet-lines" aria-hidden="true"></div>').join('')) + '</article>').join('') + '</section>';
    }).join('');
    const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">'
      + '<title>' + esc(request.title) + (teacher ? ' - Teacher key' : ' - Student packets') + '</title><style>' + PRINT_CSS + '</style></head><body>' + body + '</body></html>';
    return { html, body, count: selected.length };
  }
  return { FORMAT, eligible, sourceItems, context, createRequest, validateReply, parseReply, documentFor };
});
