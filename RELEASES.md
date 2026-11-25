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
The next feature milestone is a structured AI-reply import with teacher editing and separate
student packets and teacher keys. Additional LMS importers require representative validated
fixtures. Neither feature is implemented or claimed complete by this reliability update.

Broader distribution, licensing, support and pricing remain product decisions. Their private
strategy belongs in AndersonLogic-OS; this file records technical release requirements only.
