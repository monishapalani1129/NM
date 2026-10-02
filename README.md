# EduGenie

**Learn Smarter. Understand Faster. Achieve More.**

EduGenie is a personalized learning workspace for college students. It connects topic explanations, notes, practice, revision planning, exam preparation, and progress insights in one browser-based app.

## Problem

Students often study from disconnected notes and generic resources. They may not know which topics need another review, how to divide preparation time, or how to practise explaining what they have learned.

## Proposed Solution

EduGenie adapts explanations and study activities to a student's profile, records learning progress locally, and uses Gemini through a small Express proxy for generated learning content. Core progress calculations, quiz scoring, topic performance, and Leitner scheduling happen locally so the app remains useful in Demo Mode.

## Features

- **Dashboard:** study metrics, recent quizzes, weak topics, today's plan, and achievements.
- **Learn:** streaming tutor chat, structured topic explanations, concept maps, and Feynman-style teach-back.
- **Notes Studio:** paste or import text/Markdown/PDF, summarize, ask grounded questions, create study questions, and review Leitner flashcards.
- **Practice:** standard confidence-aware quizzes, adaptive practice, and resumable timed mock tests.
- **Exam Zone:** mark-specific answer guidance, last-minute Exam Rescue Mode, and AI viva practice.
- **Insights:** quiz-derived topic/subtopic classifications, spaced revision, next-step guidance, and SVG/CSS progress visualizations.
- **Planner:** exam-date plans, daily study limits, rescheduling, completion tracking, and Pomodoro focus sessions.
- **Extras:** project ideas, safe lab exercises, and encouraging English speaking practice.
- **Profile:** learning preferences, Demo Mode, backup/restore, and learning-data reset.
- **Demo Mode:** prewritten sample responses keep major AI workflows usable when the API is not configured or unreachable.

## Architecture

```text
Browser: frontend/index.html
  ├── Hash router -> lazy-loaded module render(container) + init()
  ├── Core services -> prompts, Gemini client, storage, UI, i18n, voice, analytics, gamification
  └── localStorage -> one boundary: frontend/js/core/storage.js
                         │ same-origin /api/*
                         ▼
Node.js + Express (backend/server.js)
  ├── rate limiting, localhost CORS, input validation, friendly errors
  └── Google Gemini API (key remains in backend/.env)
```

## Tech Stack

- Frontend: HTML5, CSS3, vanilla JavaScript ES modules.
- Backend: Node.js, Express, Google Gen AI SDK.
- Persistence: browser localStorage through `frontend/js/core/storage.js`.
- Allowed presentation libraries: marked.js and DOMPurify. Charts use SVG/CSS; PDF text extraction uses pdf.js.
- AI model: `GEMINI_MODEL` from the environment; defaults to `gemini-2.5-flash`.

## Folder Structure

```text
.
├── package.json                   # root npm workspace scripts
├── frontend/
│   ├── index.html                 # SPA shell and CDN libraries
│   ├── landing.html
│   ├── css/                       # base, layout, components, themes, responsive
│   ├── assets/
│   └── js/
│       ├── app.js                 # shell, topbar, and global search
│       ├── core/                  # router, storage, Gemini, prompts, UI, i18n, voice, analytics
│       └── modules/               # dashboard, learn, notes, practice, exam, insights, planner, extras, profile
├── backend/
│   ├── server.js
│   ├── package.json
│   └── .env.example
├── PROJECT_CONTEXT.md
├── README.md
├── DEMO_GUIDE.md
└── .gitignore
```

## Gemini Setup

1. Install a supported Node.js LTS release and npm.
2. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/app/apikey).
3. From the repository root, copy `backend/.env.example` to `backend/.env`.
4. Set `GEMINI_API_KEY` to the key from AI Studio. Set `GEMINI_MODEL` to a model currently available to your account; the default is `gemini-2.5-flash`.
5. Keep `backend/.env` private. The API key must never be added to frontend code or committed.

Example `backend/.env`:

```dotenv
GEMINI_API_KEY=your_key_from_google_ai_studio
GEMINI_MODEL=gemini-2.5-flash
PORT=3000
```

## Install and Run

Run these commands from the repository root:

```powershell
npm install
Copy-Item backend/.env.example backend/.env
# Edit backend/.env and add your key, then:
npm start
```

Open `http://localhost:3000`. For backend hot reload during development, use `npm run dev` from the root. The UI can also be explored without a configured key; failed AI requests use Demo Mode fixtures.

## Testing Checklist

- Open `/api/health` and confirm it returns `status: "ok"`.
- Complete onboarding, change language/theme, and refresh to confirm settings persist.
- Load Dashboard sample data; confirm the Sample data label and computed counts appear.
- Generate a standard quiz, submit answers/confidence, and check Insights after refresh.
- Generate a plan, complete a day, and verify the Dashboard's Today section updates.
- Start a mock test, answer/flag a question, refresh, and resume.
- In Notes Studio, summarize text, ask a grounded question, generate/flip flashcards, and reopen the note.
- In Exam Zone, compare 2- and 10-mark answer structures, reveal Rescue cards, and finish a viva.
- Search for a topic, note, saved item, quiz, and plan; verify each result opens the corresponding content.
- Check keyboard navigation, `/` search shortcut, visible focus, and layouts at 360px, 768px, and 1280px.
- With networking unavailable, enable Demo Mode in Profile and repeat a generated workflow.

## Future Enhancements

- Add richer quiz authoring and adaptive question banks.
- Add OCR for scanned PDFs and a more complete offline cache.
- Add optional account sync and cross-device backup.
- Add faculty-created course collections and collaborative study groups.
- Add accessibility testing with screen readers and broader Tamil voice coverage.

## Team Contributions

| Team member | Contribution |
| --- | --- |
| Member 1 | Product scope, user research, and demo coordination |
| Member 2 | Frontend shell, accessibility, and responsive styling |
| Member 3 | Learning modules, prompts, and Gemini integration |
| Member 4 | Backend, testing, documentation, and deployment |

Replace the generic member labels with your project team's names and actual contributions.

## Known Limitations

- Learning records are browser-local unless the user exports a backup; there is no account sync.
- AI output can be incorrect. The interface includes reminders, but important facts should be verified.
- Demo Mode content is illustrative and is not a substitute for live, topic-specific model output.
- PDF extraction requires selectable text and CDN access; scanned PDFs need OCR outside the current app.
- Browser speech recognition and Tamil speech voices vary by browser and operating system.
