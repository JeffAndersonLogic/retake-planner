# Retake Planner, Claude Code rules

A product of ANDERSONLOGIC ai (Jeff Anderson). Strategy and decisions live in the private
AndersonLogic-OS repository, `04_PRODUCTS/Retake-Planner/`. This repository holds the code only.

## Rules that must not be broken

- **This repository is public and GitHub Pages serves every file.** Never commit a question map
  (it is an answer key) or a Canvas export (it names students). `test/no-maps.test.js` fails on
  either. Tests and the demo use invented questions and invented students only.
- **The page reaches nothing.** Its Content-Security-Policy allows only its own scripts, styles,
  fonts and images. No fetch, no analytics, no third-party font or script, no `localStorage` for
  student data. The browser test proves the policy blocks a fetch.
- **No inline `style=""` in generated markup**: the policy refuses it. Set sizes through
  `element.style`.
- **Escape every string that came from a file** before it reaches the page.
- **Canvas's score wins** over the key. A blank counts as missed; an unseen question does not count.
- **Projector safe** hides names and every question, answer, rationale and prompt.
- It reads results and never feeds a grade.
- **A retake prompt never carries a student's name or id**, only "Student N". The page writes the
  prompt; the teacher pastes it into their own AI. The page never contacts an AI.
- **Projector safe also hides the retake prompts**: they hold the test's questions and answers.
- **The Map Maker's tagging prompt carries the test's questions and nothing about any student**,
  and Projector safe hides the Map Maker. A map it saves is an answer key like any other.
- **Standards (Jeff, 2026-11-25):** a standard is tested when at least 2 questions assess it
  (`MIN_QUESTIONS`), and a student has shown it only when every one of its questions is right.
  Report both the class and each student, and say "shown on multiple choice", never more.
- Writing: no em dashes or en dashes in running prose.

## Brand

ANDERSONLOGIC ai: the logo files in `assets/images/brand/andersonlogic/` are cut from the original
in AndersonLogic-OS `02_BRAND/Logos/` (white and gold artwork, dark grounds only). Palette and type
are the brand's interim set (tokens at the top of `retake-planner.css`). In text the name is
`ANDERSON<i>LOGIC</i> ai`.

## Tests

`npm test` (offline) and `npm run test:browser` (install the pinned tooling with `npm ci`, then
`npx --no-install playwright-core install chromium`). Any check
used as evidence must be shown capable of failing; each test carries negative controls.
