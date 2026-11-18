# Retake Planner

**By ANDERSON*LOGIC* ai.** See which learning targets each student missed on a test, so a
retake or test correction can ask **new** questions on those targets instead of the ones the
student has already seen.

It reads results. It does not grade. Canvas holds every grade.

**Open it:** https://jeffandersonlogic.github.io/retake-planner/

## How a teacher uses it

1. In Canvas, open the quiz (New Quizzes), choose **Reports**, then **Student Analysis**,
   generate it and choose **Export CSV**.
2. Open the Retake Planner and drop in that file plus the test's **question map**, in
   either order.
3. Read the plan four ways:
   - **By learning target:** how the class did on each target and who needs new questions on it.
     Write retake questions for the targets at the top first.
   - **By student:** each student's score, missed targets, and the wrong answer they chose.
   - **By question:** percent correct and the most-chosen wrong answer, which usually names
     the misunderstanding to reteach.
   - **Same retake:** students who missed exactly the same targets.
4. **Copy the retake plan** or **Download** it as a CSV.

**Projector safe** replaces names with numbers and hides every question and answer, so a
projected screen gives nothing away before a retake.

Try it first with **Try it with invented students**: every name and question in the demo is made up.

## Privacy

- **Nothing leaves the teacher's computer.** The page's security policy lets it load only its
  own files from this site; it can contact no other service. The Canvas file and the map are
  read in the browser tab and forgotten when it closes. Nothing is saved.
- **No student data and no answer key is ever stored in this repository.** It is public.
  `test/no-maps.test.js` fails if a question map or a CSV is committed.

## The question map

The map is the answer key, so each teacher keeps it privately and shares it only with
colleagues who give the same test. It is a JSON file in the format `retake-planner-map/1`
(`behistorical-retake-map/1`, the earlier name, is also read):

```json
{
  "format": "retake-planner-map/1",
  "title": "Unit 3 Quiz",
  "version": "3.1",
  "targets": { "3.1 LT1": "I can explain how gunpowder technology ..." },
  "questions": [
    { "n": 1, "lt": "3.1 LT1", "stem": "The source best illustrates ...",
      "options": ["First choice", "Second choice", "Third choice", "Fourth choice"],
      "answer": 1, "points": 2, "rationale": "Why the wrong answers are wrong." }
  ]
}
```

`answer` is the index of the correct choice (0 is the first) or its letter. `targets` can use
any labels: a learning target, a state standard, a CED topic. The best moment to make a map is
when the test is written: whoever writes the questions (a teacher, or an AI writing them from
the course's standards) tags each one with its target and saves the map beside the test.

How Canvas questions are matched to the map: by the answers students chose, since every answer
choice is unique across a test. That survives Canvas shuffling the order and each teacher's own
copy numbering questions differently. The page always says how many questions it matched and
lists any it could not place.

## What it handles, and what it does not yet

- Canvas **New Quizzes** Student Analysis exports, in either layout (one row per student, or one
  row per answer). Canvas does not publish that file's exact columns; if a real export reports
  fewer matched questions than the map holds, keep its header row (no student rows) and the
  reader can be adjusted to it.
- **Single-answer multiple choice.** Essay, multiple-answer, matching and numeric questions are
  skipped.
- When Canvas and the key disagree (a regraded question), Canvas's score wins and the count is
  shown. A blank answer counts as missed; a question a student never saw is left out.

## Development

```bash
npm test                # the engine and the no-maps guard; needs only Node
npm i --no-save playwright-core
npm run test:browser    # the page in Chromium
```

Publishing: GitHub Pages serves `main` from the repository root (Settings, Pages, Deploy from a
branch, `main`, `/ (root)`). Every push runs both test jobs in `.github/workflows/validate.yml`.

Fonts: Manrope and Inter, under the SIL Open Font License (licences in `assets/fonts/andersonlogic/`).
The ANDERSON*LOGIC* ai logo is a trademark of ANDERSON*LOGIC* ai and is not licensed for reuse.
