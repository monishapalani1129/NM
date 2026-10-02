import { get, set } from "../core/storage.js";
import { askJSON } from "../core/gemini.js";
import { addXP } from "../core/gamification.js";
import { aiFooter, renderMarkdown, skeleton, toast } from "../core/ui.js";

const questionSchema = {
	type: "OBJECT",
	properties: {
		q: { type: "STRING" },
		options: { type: "ARRAY", items: { type: "STRING" } },
		correctIndex: { type: "INTEGER" },
		explanation: { type: "STRING" },
		subtopic: { type: "STRING" }
	},
	required: ["q", "options", "correctIndex", "explanation", "subtopic"]
};
const difficultyNames = ["Easy", "Medium", "Hard"];
const difficultyValues = ["easy", "medium", "hard"];
let activeMode = "standard";
let routePrefill = { subject: "", topic: "" };
let activeMockQuiz = null;
let mockTimer = null;
let unloadHandlerInstalled = false;
let routeHandlerInstalled = false;

function makeId() {
	return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isQuestion(question) {
	return typeof question?.q === "string" && question.q.trim().length > 0
		&& Array.isArray(question.options) && question.options.length === 4
		&& question.options.every((option) => typeof option === "string" && option.trim().length > 0)
		&& Number.isInteger(question.correctIndex) && question.correctIndex >= 0 && question.correctIndex < 4
		&& typeof question.explanation === "string" && question.explanation.trim().length > 0
		&& typeof question.subtopic === "string" && question.subtopic.trim().length > 0;
}

function isQuestionSet(value, count) {
	return Array.isArray(value?.questions) && value.questions.length === count && value.questions.every(isQuestion);
}

function findMockDraft() {
	return get("quizHistory").find((quiz) => quiz.mode === "mock" && quiz.status === "in-progress");
}

function saveQuizRecord(record) {
	const history = get("quizHistory");
	const existingIndex = history.findIndex((item) => item.id === record.id);
	if (existingIndex >= 0) history[existingIndex] = record;
	else history.unshift(record);
	set("quizHistory", history.slice(0, 100));
}

function recordActivity(type, label) {
	const activity = get("activity");
	activity.unshift({ id: makeId(), type, label, ts: new Date().toISOString() });
	set("activity", activity.slice(0, 100));
}

function updateTopicMastery(record) {
	const topics = get("topics");
	const subject = String(record.subject || "General").trim() || "General";
	const topic = String(record.topic || "Practice").trim() || "Practice";
	const existing = topics.find((item) => String(item.subject || "").toLowerCase() === subject.toLowerCase() && String(item.topic || "").toLowerCase() === topic.toLowerCase());
	const percentage = record.total ? Math.round((record.score / record.total) * 100) : 0;
	const mastery = existing ? Math.max(0, Math.min(100, Math.round(existing.mastery * 0.65 + percentage * 0.35))) : percentage;
	const updated = existing
		? { ...existing, mastery, studiedAt: new Date().toISOString(), nextReviewAt: new Date(Date.now() + 86400000).toISOString() }
		: { id: makeId(), subject, topic, savedExplanation: "", studiedAt: new Date().toISOString(), mastery, leitnerBox: 1, nextReviewAt: new Date(Date.now() + 86400000).toISOString() };
	set("topics", existing ? topics.map((item) => item.id === existing.id ? updated : item) : [updated, ...topics]);
}

function completeQuiz(record) {
	const completed = { ...record, status: "completed" };
	saveQuizRecord(completed);
	updateTopicMastery(completed);
	recordActivity("quiz-completed", `${completed.mode} quiz · ${completed.score}/${completed.total}`);
	const award = addXP(Math.max(5, completed.score * 5), `${completed.mode} quiz`);
	award.badgesUnlocked?.forEach((badge) => toast(`Badge earned: ${badge.name}`, "success"));
	return completed;
}

function normalizeQuestion(question, answer = null, confidence = null) {
	return {
		q: question.q,
		options: question.options,
		correctIndex: question.correctIndex,
		chosenIndex: Number.isInteger(answer) ? answer : null,
		explanation: question.explanation,
		subtopic: question.subtopic,
		confidence: confidence === null ? null : Number(confidence)
	};
}

function renderSetupForm(host, mode, prefill = {}) {
	const mockFields = mode === "mock"
		? `<label class="field"><span>Test duration</span><select name="duration"><option value="5">5 minutes</option><option value="10" selected>10 minutes</option><option value="20">20 minutes</option></select></label>`
		: "";
	const modeLabel = mode === "standard" ? "Start standard quiz" : mode === "adaptive" ? "Start adaptive quiz" : "Start mock test";
	host.innerHTML = `<section class="surface practice-setup"><div><span class="eyebrow">${mode === "standard" ? "STANDARD QUIZ" : mode === "adaptive" ? "ADAPTIVE PRACTICE" : "EXAM SIMULATION"}</span><h2>${mode === "standard" ? "Practice with purpose." : mode === "adaptive" ? "Meet the next question at your level." : "Set up your mock test."}</h2><p>${mode === "standard" ? "Choose a topic and a question count. Answers stay hidden until you submit." : mode === "adaptive" ? "Eight questions adjust in difficulty as your understanding takes shape." : "Your answers save as you go, so you can resume after a refresh."}</p></div><form class="practice-setup-form" data-mode="${mode}"><label class="field"><span>Subject</span><input name="subject" maxlength="100" required placeholder="e.g. Biology"></label><label class="field"><span>Topic</span><input name="topic" maxlength="140" required placeholder="e.g. Cell structure"></label><label class="field"><span>Difficulty</span><select name="difficulty"><option value="easy">Easy</option><option value="medium" selected>Medium</option><option value="hard">Hard</option></select></label>${mode === "adaptive" ? "" : `<label class="field"><span>Number of questions</span><select name="count"><option value="5">5 questions</option><option value="10">10 questions</option><option value="15">15 questions</option></select></label>`}${mockFields}<button class="button button--primary" type="submit">${modeLabel} <span aria-hidden="true">→</span></button></form><div class="practice-setup-status" aria-live="polite"></div></section>`;
	const form = host.querySelector(".practice-setup-form");
	form.elements.subject.value = prefill.subject || "";
	form.elements.topic.value = prefill.topic || "";
	if (prefill.difficulty && form.elements.difficulty) form.elements.difficulty.value = prefill.difficulty;
	if (prefill.count && form.elements.count) form.elements.count.value = String(prefill.count);
	form.addEventListener("submit", (event) => {
		event.preventDefault();
		if (!form.reportValidity()) return;
		const values = Object.fromEntries(new FormData(form));
		if (mode === "standard") startStandardQuiz(host, values);
		else if (mode === "adaptive") startAdaptiveQuiz(host, values);
		else startMockQuiz(host, values);
	});
}

function quizPromptSchema(count) {
	return {
		type: "OBJECT",
		properties: { questions: { type: "ARRAY", items: questionSchema } },
		required: ["questions"]
	};
}

async function requestQuestions(mode, values, count) {
	const context = `Subject: ${values.subject}\nTopic: ${values.topic}\nDifficulty: ${values.difficulty}\nQuestion count: ${count}`;
	return askJSON({
		task: `Create ${count} distinct multiple-choice practice questions. Each question must have exactly four plausible options, one correct index, a useful explanation, and a specific subtopic.`,
		context,
		demoType: mode === "mock" ? "practice-mock" : "practice-standard",
		demoCount: count,
		demoDifficulty: values.difficulty,
		responseSchema: quizPromptSchema(count),
		outputFormat: `Return JSON shaped as {questions:[{q:string,options:[string,string,string,string],correctIndex:integer 0-3,explanation:string,subtopic:string}]}. Return exactly ${count} questions.`
	}, (value) => isQuestionSet(value, count));
}

function renderQuestionCard(question, index, answer = {}, includeConfidence = false) {
	const card = document.createElement("fieldset");
	card.className = "practice-question-card";
	card.dataset.questionIndex = String(index);
	const legend = document.createElement("legend");
	legend.innerHTML = `<span class="question-number">${String(index + 1).padStart(2, "0")}</span><span class="question-prompt"></span>`;
	legend.querySelector(".question-prompt").textContent = question.q;
	card.append(legend);
	const options = document.createElement("div");
	options.className = "practice-options";
	question.options.forEach((option, optionIndex) => {
		const label = document.createElement("label");
		label.className = "practice-option";
		const input = document.createElement("input");
		input.type = "radio";
		input.name = `question-${index}`;
		input.value = String(optionIndex);
		input.checked = answer.chosenIndex === optionIndex;
		const marker = document.createElement("span");
		marker.className = "option-marker";
		marker.textContent = String.fromCharCode(65 + optionIndex);
		const text = document.createElement("span");
		text.textContent = option;
		label.append(input, marker, text);
		options.append(label);
	});
	card.append(options);
	if (includeConfidence) {
		const confidence = document.createElement("label");
		confidence.className = "field confidence-field";
		confidence.innerHTML = `<span>How sure are you?</span><select name="confidence-${index}"><option value="">Choose confidence</option><option value="1">Guess</option><option value="2">Somewhat sure</option><option value="3">Sure</option></select>`;
		confidence.querySelector("select").value = answer.confidence ? String(answer.confidence) : "";
		card.append(confidence);
	}
	return card;
}

async function startStandardQuiz(host, values) {
	const form = host.querySelector(".practice-setup-form");
	const submit = form.querySelector("button[type=submit]");
	const status = host.querySelector(".practice-setup-status");
	const count = Number(values.count);
	submit.disabled = true;
	status.replaceChildren(skeleton(4));
	try {
		const data = await requestQuestions("standard", values, count);
		if (!isQuestionSet(data, count)) throw new Error("Invalid question set");
		const state = { values, questions: data.questions, answers: data.questions.map(() => ({ chosenIndex: null, confidence: null })), startedAt: Date.now() };
		renderStandardQuestions(host, state);
	} catch {
		status.textContent = "Questions could not be prepared. Please try again.";
		toast(status.textContent, "error");
		submit.disabled = false;
	}
}

function renderStandardQuestions(host, state) {
	host.innerHTML = `<section class="practice-active"><div class="practice-active-heading"><div><span class="eyebrow">STANDARD QUIZ</span><h2></h2><p>${state.questions.length} questions · answers are revealed after submission</p></div><span class="difficulty-pill"></span></div><div class="standard-question-list"></div><button id="submit-standard-quiz" class="button button--primary" type="button">Submit quiz <span aria-hidden="true">→</span></button></section>`;
	host.querySelector("h2").textContent = state.values.topic;
	host.querySelector(".difficulty-pill").textContent = `${state.values.difficulty} difficulty`;
	const list = host.querySelector(".standard-question-list");
	state.questions.forEach((question, index) => list.append(renderQuestionCard(question, index, state.answers[index], true)));
	list.addEventListener("change", (event) => {
		const card = event.target.closest("[data-question-index]");
		if (!card) return;
		const index = Number(card.dataset.questionIndex);
		if (event.target.matches('input[type="radio"]')) state.answers[index].chosenIndex = Number(event.target.value);
		if (event.target.matches("select[name^=confidence-]")) state.answers[index].confidence = event.target.value ? Number(event.target.value) : null;
	});
	host.querySelector("#submit-standard-quiz").addEventListener("click", () => {
		const questions = state.questions.map((question, index) => normalizeQuestion(question, state.answers[index].chosenIndex, state.answers[index].confidence));
		const record = completeQuiz({ id: makeId(), date: new Date().toISOString(), subject: state.values.subject, topic: state.values.topic, difficulty: state.values.difficulty, mode: "standard", score: questions.filter((question) => question.chosenIndex === question.correctIndex).length, total: questions.length, timeSpentSec: Math.round((Date.now() - state.startedAt) / 1000), questions });
		renderCompletedQuiz(host, record, "Standard quiz", true);
	});
}

function getWeakSubtopics(questions) {
	const counts = new Map();
	questions.forEach((question) => {
		if (question.chosenIndex !== question.correctIndex) counts.set(question.subtopic || "Review", (counts.get(question.subtopic || "Review") || 0) + 1);
	});
	return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([subtopic]) => subtopic);
}

function renderCompletedQuiz(host, record, label, includeConfidenceInsight) {
	host.replaceChildren();
	const percentage = record.total ? Math.round(record.score / record.total * 100) : 0;
	const header = document.createElement("section");
	header.className = "surface quiz-completion-header";
	const title = document.createElement("div");
	title.innerHTML = `<span class="eyebrow">${label.toUpperCase()}</span><h2></h2><p>Your results are saved in Quiz History.</p>`;
	title.querySelector("h2").textContent = record.topic;
	const score = document.createElement("div");
	score.className = "quiz-score-block";
	score.innerHTML = `<strong>${record.score}<span>/${record.total}</span></strong><small>${percentage}% correct</small>`;
	header.append(title, score);
	host.append(header);

	const weak = getWeakSubtopics(record.questions);
	const insight = document.createElement("div");
	insight.className = "quiz-insight-grid";
	const weakSection = document.createElement("section");
	weakSection.className = "surface quiz-insight";
	const weakTitle = document.createElement("h3");
	weakTitle.textContent = "Weak subtopics";
	const weakText = document.createElement("p");
	weakText.textContent = weak.length ? weak.join(" · ") : "No weak subtopics surfaced in this attempt.";
	weakSection.append(weakTitle, weakText);
	const nextSection = document.createElement("section");
	nextSection.className = "surface quiz-insight";
	const nextTitle = document.createElement("h3");
	nextTitle.textContent = "Recommended next action";
	const nextText = document.createElement("p");
	nextText.textContent = weak.length ? `Review ${weak[0]}, then try another short quiz.` : "Try an adaptive set to stretch your understanding.";
	const nextLink = document.createElement("a");
	nextLink.className = "text-link";
	nextLink.href = "#/learn";
	nextLink.textContent = "Open Learn →";
	nextSection.append(nextTitle, nextText, nextLink);
	insight.append(weakSection, nextSection);
	host.append(insight);

	if (includeConfidenceInsight) {
		const overconfident = record.questions.map((question, index) => ({ question, index })).filter(({ question }) => question.chosenIndex !== question.correctIndex && question.confidence === 3);
		const confidenceSection = document.createElement("section");
		confidenceSection.className = "overconfidence-insight";
		const confidenceTitle = document.createElement("strong");
		confidenceTitle.textContent = "Overconfidence insight";
		const confidenceText = document.createElement("p");
		confidenceText.textContent = overconfident.length
			? `You marked ${overconfident.length} missed ${overconfident.length === 1 ? "answer" : "answers"} as Sure. That is useful feedback: revisit the reasoning, not just the result.`
			: "Your confidence matched your answers well, or you left confidence unset. Keep checking your reasoning as you practice.";
		confidenceSection.append(confidenceTitle, confidenceText);
		host.append(confidenceSection);
	}

	const reviewTitle = document.createElement("h3");
	reviewTitle.className = "answer-review-heading";
	reviewTitle.textContent = "Answer review";
	host.append(reviewTitle);
	const review = document.createElement("div");
	review.className = "answer-review-list";
	record.questions.forEach((question, index) => {
		const correct = question.chosenIndex === question.correctIndex;
		const item = document.createElement("article");
		item.className = `surface answer-review-item ${correct ? "is-correct" : "is-incorrect"}`;
		const heading = document.createElement("div");
		heading.className = "answer-review-title";
		const qLabel = document.createElement("strong");
		qLabel.textContent = `Question ${index + 1} · ${correct ? "Correct" : question.chosenIndex === null ? "Unanswered" : "Review"}`;
		const subtopic = document.createElement("span");
		subtopic.textContent = question.subtopic;
		heading.append(qLabel, subtopic);
		const prompt = document.createElement("p");
		prompt.className = "answer-review-prompt";
		prompt.textContent = question.q;
		const selected = document.createElement("p");
		selected.textContent = `Your answer: ${question.chosenIndex === null ? "No answer" : question.options[question.chosenIndex]}`;
		const correctAnswer = document.createElement("p");
		correctAnswer.textContent = `Correct answer: ${question.options[question.correctIndex]}`;
		const explanation = document.createElement("div");
		explanation.className = "answer-review-explanation";
		explanation.append(renderMarkdown(question.explanation));
		item.append(heading, prompt, selected, correctAnswer, explanation);
		if (!correct) {
			const explainButton = document.createElement("button");
			explainButton.type = "button";
			explainButton.className = "button button--secondary explain-mistake-button";
			explainButton.dataset.explainMistake = String(index);
			explainButton.textContent = "Explain my mistake";
			item.append(explainButton);
		}
		item.append(aiFooter());
		review.append(item);
	});
	host.append(review);
	const setupAgain = document.createElement("button");
	setupAgain.type = "button";
	setupAgain.className = "button button--primary practice-again-button";
	setupAgain.textContent = "Set up another quiz";
	setupAgain.addEventListener("click", () => document.querySelector('[data-practice-mode="standard"]').click());
	host.append(setupAgain);
	review.addEventListener("click", async (event) => {
		const button = event.target.closest("[data-explain-mistake]");
		if (!button) return;
		const question = record.questions[Number(button.dataset.explainMistake)];
		button.disabled = true;
		button.textContent = "Explaining...";
		const target = document.createElement("div");
		target.className = "mistake-explanation";
		target.append(skeleton(2));
		button.after(target);
		const schema = { type: "OBJECT", properties: { explanation: { type: "STRING" } }, required: ["explanation"] };
		const data = await askJSON({
			task: "Explain simply why the selected answer is wrong and why the correct answer is right. Be supportive and point to the key distinction.",
			context: `Question: ${question.q}\nOptions: ${question.options.map((option, index) => `${index}: ${option}`).join("\n")}\nStudent selected: ${question.chosenIndex === null ? "No answer" : question.options[question.chosenIndex]}\nCorrect answer: ${question.options[question.correctIndex]}\nOriginal explanation: ${question.explanation}`,
			demoType: "practice-mistake",
			responseSchema: schema,
			outputFormat: "Return JSON with explanation:string."
		}, (value) => typeof value?.explanation === "string" && value.explanation.trim().length > 0);
		target.replaceChildren(renderMarkdown(data.explanation), aiFooter());
		button.remove();
	});
}

function renderAdaptiveSetup(host, prefill) {
	renderSetupForm(host, "adaptive", prefill);
}

async function requestAdaptiveQuestion(state) {
	const context = `Subject: ${state.subject}\nTopic: ${state.topic}\nCurrent difficulty: ${state.difficulty}\nQuestion number: ${state.answers.length + 1}`;
	const schema = { type: "OBJECT", properties: { question: questionSchema }, required: ["question"] };
	return askJSON({
		task: "Create one multiple-choice question at the requested difficulty. Use four plausible options and include a concise explanation and specific subtopic.",
		context,
		demoType: "practice-adaptive",
		demoDifficulty: state.difficulty,
		demoIndex: state.answers.length,
		responseSchema: schema,
		outputFormat: "Return JSON with question:{q,options,correctIndex,explanation,subtopic}."
	}, (value) => isQuestion(value?.question));
}

function renderAdaptiveQuestion(host, state) {
	host.replaceChildren();
	const header = document.createElement("div");
	header.className = "adaptive-status surface";
	header.innerHTML = `<div><span class="eyebrow">ADAPTIVE QUIZ</span><strong class="adaptive-count"></strong></div><span class="difficulty-pill"></span>`;
	header.querySelector(".adaptive-count").textContent = `Question ${state.answers.length + 1} of 8`;
	header.querySelector(".difficulty-pill").textContent = `${state.difficulty} difficulty`;
	const card = renderQuestionCard(state.currentQuestion, state.answers.length);
	card.classList.add("adaptive-question-card");
	const submit = document.createElement("button");
	submit.type = "button";
	submit.className = "button button--primary adaptive-submit";
	submit.textContent = "Submit answer";
	submit.disabled = true;
	card.addEventListener("change", (event) => {
		if (!event.target.matches('input[type="radio"]')) return;
		state.selectedIndex = Number(event.target.value);
		submit.disabled = false;
	});
	submit.addEventListener("click", () => submitAdaptiveAnswer(host, state));
	card.append(submit);
	host.append(header, card);
}

async function submitAdaptiveAnswer(host, state) {
	const question = state.currentQuestion;
	const chosenIndex = state.selectedIndex;
	const correct = chosenIndex === question.correctIndex;
	state.answers.push(normalizeQuestion(question, chosenIndex));
	const currentRank = difficultyValues.indexOf(state.difficulty);
	const nextRank = Math.max(0, Math.min(difficultyValues.length - 1, currentRank + (correct ? 1 : -1)));
	state.difficulty = difficultyValues[nextRank];
	host.replaceChildren();
	const feedback = document.createElement("section");
	feedback.className = `surface adaptive-feedback ${correct ? "is-correct" : "is-incorrect"}`;
	const title = document.createElement("h2");
	title.textContent = correct ? "That’s right." : "Good place to learn from.";
	const answer = document.createElement("p");
	answer.textContent = `Correct answer: ${question.options[question.correctIndex]}`;
	feedback.append(title, answer);
	if (correct) feedback.append(renderMarkdown(question.explanation));
	else {
		const simpleStatus = document.createElement("p");
		simpleStatus.className = "muted";
		simpleStatus.textContent = "Let’s make the idea simpler.";
		feedback.append(simpleStatus, skeleton(2));
	}
	feedback.append(aiFooter());
	host.append(feedback);
	if (!correct) {
		const schema = { type: "OBJECT", properties: { simplerExplanation: { type: "STRING" } }, required: ["simplerExplanation"] };
		const simpler = await askJSON({ task: "Explain the correct answer in simpler language. Focus on the key idea the student should notice.", context: `Topic: ${state.topic}\nQuestion: ${question.q}\nCorrect answer: ${question.options[question.correctIndex]}\nExplanation: ${question.explanation}`, demoType: "practice-simpler", responseSchema: schema, outputFormat: "Return JSON with simplerExplanation:string." }, (value) => typeof value?.simplerExplanation === "string" && value.simplerExplanation.trim().length > 0);
		feedback.querySelector(".skeleton-stack")?.replaceWith(renderMarkdown(simpler.simplerExplanation));
	}
	const difficultyNote = document.createElement("p");
	difficultyNote.className = "adaptive-next-difficulty";
	difficultyNote.textContent = `Next difficulty: ${difficultyNames[nextRank]}`;
	feedback.append(difficultyNote);
	if (state.answers.length >= 8) {
		finishAdaptiveQuiz(host, state);
		return;
	}
	const next = document.createElement("button");
	next.type = "button";
	next.className = "button button--primary";
	next.textContent = "Next question →";
	next.addEventListener("click", async () => {
		next.disabled = true;
		host.replaceChildren(skeleton(4));
		try {
			const data = await requestAdaptiveQuestion(state);
			if (!isQuestion(data.question)) throw new Error("Invalid question");
			state.currentQuestion = data.question;
			state.selectedIndex = null;
			renderAdaptiveQuestion(host, state);
		} catch {
			toast("The next adaptive question could not be prepared. Try again.", "error");
			next.disabled = false;
		}
	});
	feedback.append(next);
}

async function startAdaptiveQuiz(host, values) {
	const form = host.querySelector(".practice-setup-form");
	const submit = form.querySelector("button[type=submit]");
	submit.disabled = true;
	host.querySelector(".practice-setup-status").replaceChildren(skeleton(4));
	const state = { subject: values.subject, topic: values.topic, difficulty: "medium", answers: [], currentQuestion: null, selectedIndex: null, startedAt: Date.now() };
	try {
		const data = await requestAdaptiveQuestion(state);
		if (!isQuestion(data.question)) throw new Error("Invalid question");
		state.currentQuestion = data.question;
		renderAdaptiveQuestion(host, state);
	} catch {
		toast("The first adaptive question could not be prepared. Please try again.", "error");
		submit.disabled = false;
	}
}

function finishAdaptiveQuiz(host, state) {
	const questions = state.answers;
	const score = questions.filter((question) => question.chosenIndex === question.correctIndex).length;
	const percentage = score / questions.length;
	const estimate = percentage >= 0.85 ? "Strong" : percentage >= 0.65 ? "Intermediate" : percentage >= 0.4 ? "Developing" : "Beginner";
	const record = completeQuiz({ id: makeId(), date: new Date().toISOString(), subject: state.subject, topic: state.topic, difficulty: state.difficulty, mode: "adaptive", score, total: questions.length, timeSpentSec: Math.round((Date.now() - state.startedAt) / 1000), questions });
	host.replaceChildren();
	const panel = document.createElement("section");
	panel.className = "surface adaptive-estimate";
	const eyebrow = document.createElement("span");
	eyebrow.className = "eyebrow";
	eyebrow.textContent = "YOUR ADAPTIVE CHECK-IN";
	const title = document.createElement("h2");
	title.textContent = estimate;
	const scoreLine = document.createElement("p");
	scoreLine.textContent = `${score} of ${questions.length} correct across questions that adjusted to your responses.`;
	const note = document.createElement("p");
	note.className = "learning-estimate-note";
	note.textContent = "This is a learning estimate, not a formal assessment.";
	panel.append(eyebrow, title, scoreLine, note, aiFooter());
	renderCompletedQuiz(host, record, "Adaptive quiz", false);
	host.prepend(panel);
}

function mockTimeRemaining(mock) {
	return Math.max(0, Math.ceil((mock.endsAt - Date.now()) / 1000));
}

function persistMockDraft(mock) {
	mock.timeRemainingSec = mockTimeRemaining(mock);
	mock.status = "in-progress";
	saveQuizRecord(mock);
}

function renderMockResume(host, draft) {
	host.innerHTML = `<section class="surface mock-resume"><span class="eyebrow">SAVED MOCK TEST</span><h2></h2><p class="mock-resume-detail"></p><p>Your answers and remaining time were saved automatically.</p><div class="mock-resume-actions"><button id="resume-mock" class="button button--primary" type="button">Resume test <span aria-hidden="true">→</span></button><button id="discard-mock" class="button button--secondary" type="button">Discard test</button></div></section>`;
	host.querySelector("h2").textContent = draft.topic;
	host.querySelector(".mock-resume-detail").textContent = `${draft.subject} · ${draft.questions.filter((question) => question.chosenIndex !== null).length}/${draft.total} answered`;
	host.querySelector("#resume-mock").addEventListener("click", () => resumeMockTest(host, draft));
	host.querySelector("#discard-mock").addEventListener("click", () => {
		set("quizHistory", get("quizHistory").filter((item) => item.id !== draft.id));
		renderSetupForm(host, "mock", { subject: draft.subject, topic: draft.topic, difficulty: draft.difficulty, count: draft.total });
	});
}

function renderMockSetup(host, prefill) {
	const draft = findMockDraft();
	if (draft) renderMockResume(host, draft);
	else renderSetupForm(host, "mock", prefill);
}

function renderMockNavigator(host, mock) {
	const navigator = host.querySelector("#mock-navigator");
	navigator.replaceChildren();
	mock.questions.forEach((question, index) => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "mock-nav-number";
		const answered = question.chosenIndex !== null;
		const flagged = mock.flaggedIndexes.includes(index);
		button.classList.toggle("is-answered", answered);
		button.classList.toggle("is-flagged", flagged);
		button.classList.toggle("is-current", mock.currentIndex === index);
		button.textContent = String(index + 1);
		button.setAttribute("aria-current", mock.currentIndex === index ? "true" : "false");
		button.setAttribute("aria-label", `Question ${index + 1}, ${answered ? "answered" : "unanswered"}${flagged ? ", flagged" : ""}`);
		button.addEventListener("click", () => {
			mock.currentIndex = index;
			persistMockDraft(mock);
			renderMockNavigator(host, mock);
			renderMockQuestion(host, mock);
		});
		navigator.append(button);
	});
}

function renderMockQuestion(host, mock) {
	const questionHost = host.querySelector("#mock-question");
	questionHost.replaceChildren();
	const question = mock.questions[mock.currentIndex];
	const card = renderQuestionCard(question, mock.currentIndex, question, false);
	card.classList.add("mock-question-card");
	card.addEventListener("change", (event) => {
		if (!event.target.matches('input[type="radio"]')) return;
		question.chosenIndex = Number(event.target.value);
		persistMockDraft(mock);
		renderMockNavigator(host, mock);
	});
	const flag = document.createElement("button");
	flag.type = "button";
	flag.className = `button button--secondary mock-flag-button${mock.flaggedIndexes.includes(mock.currentIndex) ? " is-flagged" : ""}`;
	flag.textContent = mock.flaggedIndexes.includes(mock.currentIndex) ? "⚑ Flagged" : "⚐ Flag for review";
	flag.addEventListener("click", () => {
		if (mock.flaggedIndexes.includes(mock.currentIndex)) mock.flaggedIndexes = mock.flaggedIndexes.filter((index) => index !== mock.currentIndex);
		else mock.flaggedIndexes.push(mock.currentIndex);
		persistMockDraft(mock);
		renderMockNavigator(host, mock);
		renderMockQuestion(host, mock);
	});
	card.append(flag);
	questionHost.append(card);
	host.querySelector("#mock-progress").textContent = `Question ${mock.currentIndex + 1} of ${mock.total} · ${mock.questions.filter((item) => item.chosenIndex !== null).length} answered`;
	host.querySelector("#mock-previous").disabled = mock.currentIndex === 0;
	host.querySelector("#mock-next").disabled = mock.currentIndex === mock.total - 1;
}

function updateMockTimer(host, mock) {
	const remaining = mockTimeRemaining(mock);
	const minutes = Math.floor(remaining / 60).toString().padStart(2, "0");
	const seconds = (remaining % 60).toString().padStart(2, "0");
	const timer = host.querySelector("#mock-timer");
	if (timer) {
		timer.textContent = `${minutes}:${seconds}`;
		timer.classList.toggle("is-urgent", remaining <= 30);
	}
	if (remaining <= 0) submitMockTest(host, mock, true);
}

function startMockTimer(host, mock) {
	if (mockTimer) clearInterval(mockTimer);
	updateMockTimer(host, mock);
	mockTimer = window.setInterval(() => updateMockTimer(host, mock), 1000);
}

function renderMockWorkspace(host, mock) {
	activeMockQuiz = mock;
	host.innerHTML = `<section class="mock-workspace"><header class="mock-test-header surface"><div><span class="eyebrow">MOCK TEST</span><h2></h2><p class="mock-progress" id="mock-progress"></p></div><div class="mock-timer-wrap"><span>TIME LEFT</span><strong id="mock-timer" role="timer" aria-live="off"></strong></div></header><div class="mock-test-layout"><nav id="mock-navigator" class="mock-navigator surface" aria-label="Question navigator"></nav><div id="mock-question" class="mock-question-area"></div></div><div class="mock-test-footer"><p class="mock-status-legend"><span class="legend-answered"></span>Answered <span class="legend-flagged"></span>Flagged</p><div><button id="mock-previous" class="button button--secondary" type="button">← Previous</button><button id="mock-next" class="button button--secondary" type="button">Next →</button><button id="mock-submit" class="button button--primary" type="button">Submit test</button></div></div></section>`;
	host.querySelector(".mock-test-header h2").textContent = mock.topic;
	host.querySelector(".mock-progress").textContent = `${mock.subject} · ${mock.questions.length} questions`;
	renderMockNavigator(host, mock);
	renderMockQuestion(host, mock);
	host.querySelector("#mock-previous").addEventListener("click", () => {
		mock.currentIndex = Math.max(0, mock.currentIndex - 1);
		persistMockDraft(mock);
		renderMockNavigator(host, mock);
		renderMockQuestion(host, mock);
	});
	host.querySelector("#mock-next").addEventListener("click", () => {
		mock.currentIndex = Math.min(mock.total - 1, mock.currentIndex + 1);
		persistMockDraft(mock);
		renderMockNavigator(host, mock);
		renderMockQuestion(host, mock);
	});
	host.querySelector("#mock-submit").addEventListener("click", () => submitMockTest(host, mock, false));
	startMockTimer(host, mock);
}

function resumeMockTest(host, draft) {
	const remaining = mockTimeRemaining(draft);
	activeMockQuiz = draft;
	if (remaining <= 0) {
		submitMockTest(host, draft, true);
		return;
	}
	renderMockWorkspace(host, draft);
}

async function startMockQuiz(host, values) {
	const form = host.querySelector(".practice-setup-form");
	const submit = form.querySelector("button[type=submit]");
	submit.disabled = true;
	host.querySelector(".practice-setup-status").replaceChildren(skeleton(4));
	const count = Number(values.count);
	try {
		const data = await requestQuestions("mock", values, count);
		if (!isQuestionSet(data, count)) throw new Error("Invalid question set");
		const now = Date.now();
		const durationSec = Number(values.duration) * 60;
		const mock = {
			id: makeId(), date: new Date(now).toISOString(), subject: values.subject, topic: values.topic, difficulty: values.difficulty,
			mode: "mock", score: 0, total: count, timeSpentSec: 0,
			questions: data.questions.map((question) => normalizeQuestion(question)),
			status: "in-progress", startedAt: now, endsAt: now + durationSec * 1000, timeLimitSec: durationSec,
			timeRemainingSec: durationSec, currentIndex: 0, flaggedIndexes: []
		};
		saveQuizRecord(mock);
		renderMockWorkspace(host, mock);
	} catch {
		toast("The mock test could not be prepared. Please try again.", "error");
		submit.disabled = false;
	}
}

function submitMockTest(host, mock, automatic) {
	if (!activeMockQuiz || activeMockQuiz.id !== mock.id) return;
	if (!automatic) {
		const unanswered = mock.questions.filter((question) => question.chosenIndex === null).length;
		const message = unanswered ? `You have ${unanswered} unanswered questions. Submit this test?` : "Submit your mock test now?";
		if (!window.confirm(message)) return;
	}
	if (mockTimer) clearInterval(mockTimer);
	mockTimer = null;
	const questions = mock.questions.map((question) => ({ ...question }));
	const score = questions.filter((question) => question.chosenIndex === question.correctIndex).length;
	const timeSpentSec = Math.min(mock.timeLimitSec, Math.round((Date.now() - mock.startedAt) / 1000));
	const record = completeQuiz({ ...mock, score, total: questions.length, timeSpentSec, questions, status: "completed", completedAt: new Date().toISOString() });
	activeMockQuiz = null;
	renderCompletedQuiz(host, record, automatic ? "Mock test · time expired" : "Mock test", false);
}

function renderMode(host, mode, prefill) {
	activeMode = mode;
	if (mode === "standard") renderSetupForm(host, mode, prefill);
	else if (mode === "adaptive") renderAdaptiveSetup(host, prefill);
	else renderMockSetup(host, prefill);
}

export function render(container) {
	if (mockTimer) clearInterval(mockTimer);
	mockTimer = null;
	activeMockQuiz = null;
	const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
	routePrefill = { subject: params.get("subject") || "", topic: params.get("topic") || "" };
	const draft = findMockDraft();
	activeMode = draft ? "mock" : "standard";
	container.innerHTML = `<section class="page-heading practice-heading"><span class="eyebrow">PRACTICE</span><h1>Make it stick.</h1><p>Build recall, adjust to the challenge, or rehearse under exam conditions.</p></section><div class="practice-mode-tabs" role="tablist" aria-label="Practice modes"><button class="practice-mode-tab ${activeMode === "standard" ? "is-active" : ""}" type="button" role="tab" aria-selected="${activeMode === "standard"}" data-practice-mode="standard">Standard Quiz</button><button class="practice-mode-tab" type="button" role="tab" aria-selected="false" data-practice-mode="adaptive">Adaptive Quiz</button><button class="practice-mode-tab ${activeMode === "mock" ? "is-active" : ""}" type="button" role="tab" aria-selected="${activeMode === "mock"}" data-practice-mode="mock">Mock Test</button></div><div id="practice-mode-content" role="tabpanel" aria-live="polite"></div>`;
}

export function init() {
	const host = document.querySelector("#practice-mode-content");
	const tabs = [...document.querySelectorAll("[data-practice-mode]")];
	function activateMode(mode) {
		if (activeMockQuiz && mode !== "mock") {
			toast("Finish or submit the active mock test before changing modes.", "error");
			return;
		}
		tabs.forEach((tab) => {
			const active = tab.dataset.practiceMode === mode;
			tab.classList.toggle("is-active", active);
			tab.setAttribute("aria-selected", String(active));
			tab.tabIndex = active ? 0 : -1;
		});
		renderMode(host, mode, routePrefill);
	}
	tabs.forEach((tab, index) => {
		tab.addEventListener("click", () => activateMode(tab.dataset.practiceMode));
		tab.addEventListener("keydown", (event) => {
			if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
			event.preventDefault();
			const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
			tabs[next].focus();
			activateMode(tabs[next].dataset.practiceMode);
		});
	});
	const currentDraft = findMockDraft();
	const reviewId = new URLSearchParams(window.location.hash.split("?")[1] || "").get("review");
	const savedReview = reviewId ? get("quizHistory").find((quiz) => quiz.id === reviewId && quiz.status !== "in-progress") : null;
	if (savedReview) renderCompletedQuiz(host, savedReview, `${savedReview.mode} quiz review`, savedReview.mode === "standard");
	else if (currentDraft) renderMockResume(host, currentDraft);
	else renderSetupForm(host, activeMode, routePrefill);
	if (!unloadHandlerInstalled) {
		window.addEventListener("beforeunload", (event) => {
			if (!activeMockQuiz) return;
			event.preventDefault();
			event.returnValue = "Your mock test is saved. Leave this page?";
		});
		unloadHandlerInstalled = true;
	}
	if (!routeHandlerInstalled) {
		window.addEventListener("hashchange", () => {
			if (window.location.hash.replace(/^#\/?/, "").split(/[/?]/)[0] === "practice") return;
			if (mockTimer) clearInterval(mockTimer);
			mockTimer = null;
			activeMockQuiz = null;
		});
		routeHandlerInstalled = true;
	}
}