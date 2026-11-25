# Retake Planner

**By ANDERSON*LOGIC* ai.** Drop in a multiple-choice test's results and see, right or wrong,
what every student missed: a heat map, a class report by topic, and a ready prompt for each
student's open-ended retake questions or test corrections.

It reads results. It does not grade. Canvas holds every grade.

**Open it:** https://jeffandersonlogic.github.io/retake-planner/

## Reliability update: 1.4.1

This source version fixes the November 25 audit findings. A version on a working branch is
not a deployed release: GitHub Pages serves `main`. See [RELEASES.md](RELEASES.md) for the
validation and classroom-pilot checklist.

- **Check this import** lists the students, class files, analyzed questions, unsupported items,
  unmatched map questions, and score source before a teacher prepares retakes.
- Matching uses Canvas item IDs when available, distinct wording, or distinctive answer choices.
  Common choices such as Yes/No and question order cannot resolve an uncertain match. Unresolved
  questions are left out with a warning. Remove the map to analyze Canvas's scored questions on
  their own, or correct the map and reload it. Several files are aligned independently; overlapping
  student IDs, incompatible question sets and uncertain alignment stop the combined analysis.
- The selected **missed any / missed most** rule applies to the plan, counts, groups and both
  individual and whole-class prompts, including test corrections. Prompts include only misses
  within topics or targets that qualify under that rule.
- Exported overall Canvas totals are shown as **Canvas total**, including any items outside the
  analysis. Without usable totals, the page labels reconstructed scores as **analyzed items** or
  **estimated**. Estimated maximums cannot establish a precise Canvas grade. The heat map and
  standards remain based on matched, supported questions, independently of the overall score.
- Known unsupported question types, including essays and multiple-answer items, are skipped.
  Older exports without question types still work, with a request to confirm they are
  single-answer multiple choice.
- Map Maker edits loaded maps, answers and versions; retains authored metadata; and validates
  every map before use or save. Universally blank items keep an unknown answer until a teacher
  supplies it. New wrong choices from later classes remain in the distractor report.
- Missing imported questions are distinguished from standards absent from the test. Downloaded
  CSV text cells are protected against spreadsheet formulas. Malformed CSV quotes are refused;
  normalization handles invalid entities, non-Latin text and mathematical comparisons.

## How a teacher uses it

1. In Canvas, open the quiz (New Quizzes), choose **Reports**, then **Student Analysis**,
   generate it and choose **Export CSV**.
2. Open the Retake Planner and drop in that file. Add the test's **question map** too if you
   have one (see below); it is optional, and the **Map Maker** makes one from the Canvas file.
3. Read the results seven ways:
   - **Heat map:** one row per student, one square per question, green for right and red for
     wrong (a blank counts as wrong). Columns are grouped by topic, and the bottom row is the
     class's percent right on each question.
   - **Class report:** each topic's percent correct, most missed first, with the learning
     targets inside it and who needs a retake on it. Print it or download it as a CSV.
   - **Standards:** which standards this test showed, for the class and for each student (see
     below). Needs a question map.
   - **By student:** each student's score, what they missed, and the wrong answer they chose.
   - **By question:** percent correct and the most-chosen wrong answer, which usually names
     the misunderstanding to reteach.
   - **Retake questions:** a prompt per student (or one for the whole class) to paste into the
     AI your school allows. Choose **New retake questions** and how many per student, or
     **Test corrections**. The AI writes open-ended questions on what each student missed;
     read and edit them before a student sees them.
   - **Same retake:** students who missed exactly the same topics.
4. **Group by** topic (the default), learning target, or question.
5. **Sort students by** class, name, or score (lowest first). The same order is used on every view.

### Class periods

- **All your periods in one Canvas course:** if Canvas's file has a section column, each section is
  a class automatically.
- **Each period in its own Canvas course:** download the Student Analysis file in each course and
  drop them all in together. Each file becomes a class; name it (for example, Period 3) in the box
  beside the file name. A file whose name includes "Period 3" is named for you.
- **Class** at the top shows one class on every view; **All classes** shows everyone, with a heading
  per class on the heat map and a **Compare classes** table in the class report. The report's
  download adds a column per class.
- A student's number ("Student 7") stays the same whichever class is shown or however students are
  sorted, so a retake prompt always matches the right student.

**Projector safe** replaces names with numbers and hides every question, answer and prompt, so
a projected screen gives nothing away before a retake.

Try it first with **Try it with invented students**: every name and question in the demo is made up.

### With only the Canvas file

Canvas's Student Analysis file has each question's wording, the answer each student chose and
the points they earned, but **not** the question's topic or learning target. So with the Canvas
file alone, the planner shows right and wrong (from Canvas's own points) question by question,
and the retake prompts still carry each missed question and the answer chosen. The question map
adds topics, learning targets, the correct answer for questions nobody got right, and the
reason each wrong answer is wrong.

### Standards: what this test showed

The **Standards** tab answers "which standards has this test shown?", by each question's
standard (its learning target in the map), for the class and for each student. The rules are
Jeff's (2026-11-25):

- A standard is **tested** when at least **2 questions** assess it. With one question, a lucky
  guess could pass it, so it is marked too few to judge.
- A student has **shown** a tested standard when **every one** of its questions is right, and
  **not yet** otherwise. A student who saw fewer than 2 of its questions is not judged on it.
- A standard in the map's list that no question assesses is listed as **not on this test**. The
  Map Maker keeps every standard pasted into it, so its maps show these gaps.

It says "shown on multiple choice" and no more: a multiple-choice test cannot show a skill such
as writing an argument. The download has a row per student, a column per standard and a row for
the class; Projector safe numbers the students.

### The Map Maker: a question map without writing one

The **Map Maker** appears under the status. It makes a question map from Canvas results, or
edits a loaded map, so no one writes JSON:

1. **Paste your standards** (optional), one per line with its code first: learning targets
   (`3.1 LT1: I can explain ...`), state standards, or College Board CED Key Concepts.
2. **Tag the questions.** Type a topic and a standard beside each question, or choose **Copy the
   tagging prompt**, paste it into the AI your school allows, and paste its reply back
   (`Q1 | 3.1 | 3.1 LT1`, one line per question). The reply fills in the table; the page names
   any question the reply left out and any code that is not in your list.
3. **Check or correct the answers** and optionally name a map version. **Use this map** groups
   the results by topic and standard at once. **Save the map file** keeps
   it for the next class, the next year, or a colleague who gives the same test.

The tagging prompt carries the test's questions, the answers students chose and the correct one;
it carries nothing about any student. A map made this way lists only the answers students
actually chose (`"seen": true` on each question), because that is all the Canvas file holds. A
question nobody got right has no known answer until the teacher types it; Canvas's points still
decide right and wrong for it. Every standard pasted is kept in the map, tested or not.

### The retake prompts and privacy

The page never contacts an AI. It writes text; the teacher copies it into their own AI. A prompt
never carries a student's name or id: students are numbered ("Student 3"), and the same number
is used on every view, so the teacher can match the AI's answer back to the student. A prompt
does carry the missed questions, the answer chosen and the correct answer, because that is what
lets the AI ask about the same idea without repeating the question.

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
  "topics": { "3.1": "Empires Expand" },
  "targets": { "3.1 LT1": "I can explain how gunpowder technology ..." },
  "questions": [
    { "n": 1, "topic": "3.1", "lt": "3.1 LT1", "stem": "The source best illustrates ...",
      "options": ["First choice", "Second choice", "Third choice", "Fourth choice"],
      "answer": 1, "points": 2, "rationale": "Why the wrong answers are wrong." }
  ]
}
```

`answer` is the index of the correct choice (0 is the first) or its letter. `topic` and the
`topics` names are optional; without them the planner groups by learning target. `targets` can
use any labels: a learning target, a state standard, a CED topic. The best moment to make a map is
when the test is written: whoever writes the questions (a teacher, or an AI writing them from
the course's standards) tags each one with its target and saves the map beside the test.

How Canvas questions are matched to the map: by stable `itemId` values when available, distinct
question wording, or distinctive answer choices. That supports shuffled order and copied tests
while refusing ties. The page always says how many questions matched and warns about questions
it could not place. A complete authored map is more reliable than a map made from a few observed
answer choices, especially when several questions have identical wording.

## What it handles, and what it does not yet

- Canvas **New Quizzes** Student Analysis exports, checked against a real export's header on
  2026-11-24: student columns (Name, ID, SISID, SectionNames and others, with Canvas's words run
  together), then five columns per question (ItemID, ItemType, the question's wording holding the
  student's answer, EarnedPoints, Status), then a summary. Two older shapes are also read: one row
  per student with a score column after each question, and one row per answer. When the file has
  no name column, students are shown by their row in the file.
- **Sections:** the SectionNames column makes each section a class.
- **Exported overall scores are kept as Canvas totals.** Where the export lacks overall totals,
  reconstructed item scores are labeled and estimates must be confirmed in Canvas.
- **A file opened and saved in Excel** often comes back with its accents and curly quotes
  scrambled ("â€œ" for a quote). The reader repairs that and says so.
- **Question titles do not come through.** Canvas puts each question's wording in the file, not its
  title, so a title such as "Question 1 (Topic 3.1)" cannot give the topic; the question map does.
- **Single-answer multiple choice.** Other known item types are skipped. Without a map, questions
  with no points in the file are left out. A missing item type requires teacher confirmation.
- When Canvas and the key disagree (a regraded question), Canvas's score wins and the count is
  shown. A blank answer counts as missed; a question a student never saw is left out.
- Not yet: Google Forms and Classroom, Schoology, or a plain spreadsheet. Canvas comes first
  (Jeff, 2026-11-21).

## Development

```bash
npm test                # engine, reliability regressions and the no-maps guard; needs only Node
npm ci                  # pinned browser-test dependency from package-lock.json
npx --no-install playwright-core install chromium
npm run test:browser    # the page in Chromium
```

Publishing: GitHub Pages serves `main` from the repository root (Settings, Pages, Deploy from a
branch, `main`, `/ (root)`). Every push runs both test jobs in `.github/workflows/validate.yml`.
Validate a working branch before merging it: branch-based Pages publishing is independent of
the validation jobs. The public-data guard helps catch mistakes but cannot retract data already
pushed to a public repository or detect every possible representation of a key.

Fonts: Manrope and Inter, under the SIL Open Font License (licences in `assets/fonts/andersonlogic/`).
The ANDERSON*LOGIC* ai logo is a trademark of ANDERSON*LOGIC* ai and is not licensed for reuse.
