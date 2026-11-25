# Release verification

GitHub Pages serves `main`. A working branch, passing check or package version alone does not
prove a live deployment. Check the deployed page after a merge. Never use real student data in
this public repository, its issues, screenshots, test fixtures or Actions artifacts.

## 1.4.1: reliable imports and consistent retake plans

Fixes the six reproduced November 25 defects: uncertain question matching, prompts ignoring
the retake rule, incorrect reconstructed scores, unsupported item types, blank-item map round
trips, and missing newly observed distractors. Also adds import review, safe multi-file alignment,
overlap detection, loaded-map editing and versions, missing-import standards evidence, safer CSV
downloads, malformed-input handling and pinned browser-test tooling.

### Automated release checks

- `npm test`: existing engine tests, audit regression cases and the public-data guard.
- `npm ci` and `npm run test:browser`: the actual page, uploads, downloads, map editing, rules,
  sorting, classes, Projector safe, phone layout, console errors and CSP enforcement.
- The new regression cases were first run against the unfixed engine and demonstrated failures.
- GitHub Validate must pass on the exact candidate commit before release.
- After publishing, verify the deployed script version and demo before reporting it live.

### Classroom validation still required

Do this locally in the teacher's own browser; do not upload student records into a development
session or the repository.

1. Load a real Canvas Student Analysis export and its map. Compare unique students, sections,
   supported item count and uncertain/unmatched items against Canvas.
2. Reconcile several individual overall totals, including a student with many misses. If a score
   is estimated, confirm it in Canvas rather than treating the estimate as a grade.
3. Spot-check known right, wrong, blank and unseen responses; inspect a mixed-format quiz if one
   is available. Unsupported items must not enter the heat map or standards evidence.
4. Switch the retake rule, class and grouping. Counts, plans and prompts must agree. Check that
   the prompts contain only the intended students and qualifying topics or targets.
5. Save and reload a map, then reuse it with a second class. Verify edited keys and new wrong
   choices. Review every AI-generated question before giving it to students.
6. Record the version, file shape, reconciliation result, time to a useful result and remaining
   blockers without recording student identities or test content in public.

### Subsequent product work

After local validation, pilot across a small range of teachers, subjects and test structures.
The follow-up to 1.4.1 is the structured AI-reply and packet workflow described under 1.6.0 below.
Additional LMS importers still require representative validated fixtures.

Broader distribution, licensing, support and pricing remain product decisions. Their private
strategy belongs in AndersonLogic-OS; this file records technical release requirements only.

## 1.6.0: reviewed AI replies and student-ready packets

Adds a Student packets workflow on top of 1.4.1. Teachers copy a structured packet prompt to
Raina or another approved AI, paste the reply back, edit questions and teacher guidance, approve
individual packets, and print/download student documents separately from teacher keys. Batches
of 1, 3 or 5 bound the reply size. No automatic AI connection or grading was added.

### Verification

- Packet unit checks cover identity exclusion, request matching, completeness, counts, duplicate
  questions, permitted source questions and target coverage, correction scope, required answer
  guidance and rubrics, point limits, malformed replies, approval requirements, HTML escaping
  and student/key separation.
- Browser checks exercise copy/paste round trips, invalid and stale replies, review/editing,
  explicit approvals, print isolation and cleanup, HTML downloads, projector privacy, stale
  context invalidation, batch changes, corrections, small-screen layout and CSP/network checks.
- Tests use invented records and invented AI responses. They do not establish Raina's real
  adherence to the return format or the educational quality of generated questions.
- The source and exact-commit GitHub checks must pass before release. Publishing and real-export
  classroom validation remain separate gates from building the feature.

### Local pilot additions

1. Use a small real export locally. Copy a one-student packet prompt to the teacher-approved AI
   and verify that its full reply imports. If cut off, reduce the batch or question count.
2. Check source alignment, historical accuracy, reading level, independent answerability, and
   that student-facing prose contains no answer hints or teacher notes. Edit before approving.
3. Print one student packet and its key. Verify names, writing space, page breaks and that the
   student version contains no teacher guidance. Test the browser's Save as PDF on the actual
   classroom device and printer.
4. Reuse a prompt, change a rule/class, and start a new batch. Verify that old responses cannot
   be assigned to a new roster and that edits/settings changes remove outdated approvals.
5. Keep private packets and keys off student-shared drives and out of the public repository.
