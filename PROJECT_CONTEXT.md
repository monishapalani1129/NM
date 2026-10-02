# PRODUCT
EduGenie: an AI learning platform for college students (Learn, Notes, Practice, Exam Zone, Insights, Planner).
Tagline: "Learn Smarter. Understand Faster. Achieve More."
Must feel like a real product, not a chatbot.

# TECH RULES
- Frontend: HTML5, CSS3, Vanilla JS (ES modules). NO React/Vue/Angular.
- Single-page app: ONE index.html for the app shell (sidebar + topbar) and a hash router (#/dashboard, #/learn, ...). Each module is a JS file that exports render(container) and init(). Landing page is separate: landing.html.
- Allowed CDN libs only: marked.js (markdown), DOMPurify (sanitize all AI HTML). No chart libs; use CSS/SVG for charts and progress rings.
- Backend: Node.js + Express proxy. The Gemini API key lives ONLY in backend/.env (GEMINI_API_KEY). GEMINI_MODEL is also an env var (default: gemini-2.5-flash; user will update from Google AI Studio docs).
- Backend endpoints: POST /api/generate (normal), POST /api/generate-json (uses responseMimeType application/json + responseSchema), POST /api/stream (SSE streaming), GET /api/health. Add express-rate-limit, cors, input length limit (max 30,000 chars), and friendly error codes.
- Storage: localStorage via one utility (frontend/js/core/storage.js). No other module touches localStorage directly.

# FOLDER STRUCTURE
edugenie/
├── frontend/
│   ├── landing.html
│   ├── index.html            (app shell)
│   ├── css/ (base.css, layout.css, components.css, themes.css, responsive.css)
│   ├── js/
│   │   ├── core/ (router.js, storage.js, gemini.js, prompts.js, ui.js, i18n.js, gamification.js, demoData.js, voice.js)
│   │   └── modules/ (dashboard.js, learn.js, notes.js, practice.js, exam.js, insights.js, planner.js, extras.js, profile.js)
│   └── assets/
├── backend/ (server.js, package.json, .env.example)
├── README.md
├── DEMO_GUIDE.md
└── .gitignore  (must include .env and node_modules)

# LOCALSTORAGE SCHEMA (prefix "edugenie:")
profile: { name, course, year, language: "en"|"ta"|"tanglish", level: "beginner"|"intermediate"|"advanced", dailyMinutes, examDate|null, createdAt }
settings: { theme: "light"|"dark", demoMode: bool, usingSampleData: bool }
topics: [{ id, subject, topic, savedExplanation, studiedAt, mastery(0-100), leitnerBox(1-5), nextReviewAt }]
quizHistory: [{ id, date, subject, topic, difficulty, mode: "standard"|"adaptive"|"mock", score, total, timeSpentSec, questions: [{ q, options[4], correctIndex, chosenIndex, explanation, subtopic, confidence: 1-3|null }] }]
plans: [{ id, title, examDate, createdAt, days: [{ date, subject, topic, minutes, done }] }]
notes: [{ id, title, content, createdAt, flashcards: [{front, back, box}] }]
saved: [{ id, type: "explanation"|"summary"|"answer"|"project"|"lab", title, content, createdAt }]
activity: [{ id, type, label, ts }]
gamification: { xp, level, streak, lastActiveDate, badges: [badgeId], studyMinutes }
chatSessions: [{ id, title, messages: [{role, text, ts}] }]  (keep last 10)

# AI RULES
- Every AI call goes through core/gemini.js which calls prompts.js builders. No ad-hoc prompt strings inside modules.
- Every prompt has these blocks: SYSTEM ROLE, STUDENT PROFILE (name, course, year, level, language), TASK, CONTEXT, OUTPUT FORMAT, SAFETY & ACCURACY ("If unsure, say so. Do not fabricate facts, formulas, citations. Mention when a diagram must be drawn manually.").
- Language: "en" = English, "ta" = Tamil script, "tanglish" = Tamil written in English letters mixed with English technical terms.
- All JSON responses must be validated (shape check + retry once with a "return valid JSON only" reminder) before use.
- Show footer note on AI output: "AI can make mistakes. Verify important information."
- Demo Mode: if API fails or settings.demoMode is true, gemini.js returns pre-written sample responses from demoData.js so the demo never breaks.

# UI RULES
- Blue/indigo/purple gradient accents, rounded cards, soft shadows, light + dark theme via CSS variables, Noto Sans Tamil + Inter fonts.
- Desktop: sidebar. Mobile: bottom nav. Topbar: search icon, language selector, theme toggle, profile menu. NO notification bell (not implemented).
- Accessible: labels, visible focus, keyboard navigation, aria-live for loading/results.
- Loading skeletons, friendly error toasts, empty states with a call-to-action.

# QUALITY RULES
- No fake buttons. Every visible control works or is hidden/disabled with a tooltip "Coming soon".
- Small reusable functions, meaningful names, comments only for important logic.
- Never show raw stack traces to the student.
- After each task: list files changed, how to test, and known limitations.

# NAVIGATION (6 modules + dashboard)
Dashboard | Learn | Notes Studio | Practice | Exam Zone | Insights | Planner | (Extras under "More") | Profile