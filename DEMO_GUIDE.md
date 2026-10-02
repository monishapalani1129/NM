# EduGenie Demo Guide

**Target duration:** about 2 minutes 45 seconds

## Before the Demo

- Start the app with `npm start` and open `http://localhost:3000`.
- Complete onboarding with a name, course, year, language, and level. For the personalization comparison, use **Intermediate** and **English** first.
- If the browser has no existing history, keep the Dashboard's **Load sample data** button visible; it is clearly marked Sample data.

## Demo Script

| Time | What to show and say | Exact action / input | Expected result |
| --- | --- | --- | --- |
| 0:00–0:20 | “EduGenie is a study workspace, not just a chat window. It connects study, practice, planning, and progress.” | Open Dashboard. If it is empty, click **Load sample data**. | Topic/quiz/study stats, weak topics, today's plan, recent results, achievements, and the global Sample data badge appear. |
| 0:20–0:40 | “The same topic can be explained at the student's chosen level and language.” | Open Profile. Set level to **Beginner**, language to **English**, save. Open Learn → **Smart Topic Explainer**. Enter subject **Biology**, topic **Mitosis**, then explain. | A definition, simple explanation, process, example, key points, mistakes, exam points, and related topics appear. Point out the AI accuracy footer. |
| 0:40–1:05 | “Practice turns those topics into measurable feedback.” | Open Practice → Standard Quiz. Use subject **Biology**, topic **Mitosis**, 5 questions. Choose option **B** and confidence **Sure** for question 1; choose option **A** and **Somewhat sure** for the other four. Submit. | Score, explanations, weak subtopics, and a kind overconfidence insight appear. Mention the result is stored in quiz history and affects Insights. |
| 1:05–1:25 | “Insights calculates topic performance locally and spaces revision with Leitner boxes.” | Open Insights. Show the weak-topic classification, then click **Start revision** for a due topic. Select answers and finish. | Weak Topic Detector, due queues, score charts, progress rings, activity heatmap, and the revised box/next interval update. |
| 1:25–1:45 | “A plan respects the time available and keeps revision near the exam.” | Open Planner. Enter subjects: `Biology: Cell structure, Genetics` and `Computer Science: Recursion, Graphs`. Set exam date to four days from today, daily hours to `1.5`, difficulty **Balanced**, level **Intermediate**. Generate. | A saved day-by-day plan appears with revision/quiz days near the end. Mark today's task complete; XP and the Dashboard's Today widget update. |
| 1:45–2:05 | “Exam Rescue prioritizes the most useful material when time is short.” | Open Exam Zone → Exam Rescue Mode. Enter subject **Biology**, topic **Mitosis**, hours left `1`. Build the rescue sheet and tap **Tap to reveal answer** on a rapid-fire card. | A concise emergency review, definitions, formulas if present, common mistakes, ten revealable questions, and a one-minute summary appear. |
| 2:05–2:25 | “Viva checks spoken reasoning; Teach-Back checks whether the student can explain from memory.” | In Exam Zone → **AI Viva Practice**, enter subject `Computer Science`, topic `Arrays`, difficulty **Beginner**; start and answer `An array stores multiple values of the same type in indexed positions.` Then open Learn → **Teach-Back**, subject `Biology`, topic `Mitosis`; enter `Mitosis is cell division that separates copied chromosomes into two daughter cells.` | Viva feedback highlights strengths and revision targets. Teach-Back shows correct points, missing details, misconceptions, and a clearly labelled learning estimate. This is a brisk click-through; allow another 15 seconds if you want to complete the full viva. |
| 2:25–2:45 | “The final tools help students explore and communicate.” | Open Extras → **Project Ideas**. Subject **Computer Science**, interest **campus recycling**, level **Beginner**. Generate; then show English Practice or the global search shortcut `/`. | A structured project idea with Save/Copy appears. Search opens grouped results without leaving the current page. |

## Personalization Moment

To show profile adaptation, repeat a short Learn prompt after switching Profile from **Beginner / English** to **Advanced / Tamil** or **Tanglish**. Change one setting at a time and point out that each AI request includes the saved student profile. The interface language selector also persists across refresh.

## Backup Plan: Internet/API Failure

1. Open Profile and enable **Use demo responses**. If the API is unavailable, the app also falls back to sample responses automatically.
2. Return to Dashboard and click **Load sample data** if the account has no learning history. The visible Sample data badge makes the fixture data explicit.
3. Continue the same demo path. Plan validation, quiz scoring, weak-topic analytics, Leitner movement, timers, navigation, and storage remain local; generated prose/questions use clearly illustrative sample responses.

## Reset After the Demo

Open Profile → **Reset learning data** and confirm. This clears topics, plans, notes, quizzes, activity, XP, and the sample-data label while preserving the profile and preferences.

## Presenter Notes

- Have the app and API key configured before presenting if you want live Gemini output. Never show or paste the key into the browser.
- Browser speech recognition may require microphone permission and a secure context such as `localhost`.
- The AI outputs are demonstrations, not authoritative course answers; the verification footer remains visible.
