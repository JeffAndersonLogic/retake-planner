# Retake Planner

**By ANDERSON*LOGIC* ai.** Drop in a multiple-choice test's results and see, right or wrong,
what every student missed: a heat map, a class report by topic, and a ready prompt for each
student's open-ended retake questions or test corrections.

It reads results. It does not grade. Canvas holds every grade.

**Open it:** https://jeffandersonlogic.github.io/retake-planner/

## How a teacher uses it

1. In Canvas, open the quiz (New Quizzes), choose **Reports**, then **Student Analysis**,
   generate it and choose **Export CSV**.
2. Open the Retake Planner and drop in that file. Add the test's **question map** too if you
   have one (see below); it is optional.
3. Read the results six ways:
   - **Heat map:** one row per student, one square per question, green for right and red for
     wrong (a blank counts as wrong). Columns are grouped by topic, and the bottom row is the
     class's percent right on each question.
   - **Class report:** each topic's percent correct, most missed first, with the learning
     targets inside it and who needs a retake on it. Print it or download it as a CSV.
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

How Canvas questions are matched to the map: by the answers students chose, since every answer
choice is unique across a test. That survives Canvas shuffling the order and each teacher's own
copy numbering questions differently. The page always says how many questions it matched and
lists any it could not place.

## What it handles, and what it does not yet

- Canvas **New Quizzes** Student Analysis exports, checked against a real export's header on
  2026-11-24: student columns (Name, ID, SISID, SectionNames and others, with Canvas's words run
  together), then five columns per question (ItemID, ItemType, the question's wording holding the
  student's answer, EarnedPoints, Status), then a summary. Two older shapes are also read: one row
  per student with a score column after each question, and one row per answer. When the file has
  no name column, students are shown by their row in the file.
- **Sections:** the SectionNames column makes each section a class.
- **Scores are in Canvas's points**, so a student reads 41 of 50 as Canvas shows it, even when the
  question map counts questions differently.
- **A file opened and saved in Excel** often comes back with its accents and curly quotes
  scrambled ("â€œ" for a quote). The reader repairs that and says so.
- **Question titles do not come through.** Canvas puts each question's wording in the file, not its
  title, so a title such as "Question 1 (Topic 3.1)" cannot give the topic; the question map does.
- **Single-answer multiple choice.** Questions with no points in the file are left out.
- When Canvas and the key disagree (a regraded question), Canvas's score wins and the count is
  shown. A blank answer counts as missed; a question a student never saw is left out.
- Not yet: Google Forms and Classroom, Schoology, or a plain spreadsheet. Canvas comes first
  (Jeff, 2026-11-21).

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
