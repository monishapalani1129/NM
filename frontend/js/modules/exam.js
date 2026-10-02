import { get, set } from "../core/storage.js";
import { ask, askJSON } from "../core/gemini.js";
import { addXP } from "../core/gamification.js";
import { listen } from "../core/voice.js";
import { aiFooter, copyToClipboard, renderMarkdown, skeleton, toast } from "../core/ui.js";

let vivaState = null;

function makeId() {
	return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function escapeHTML(value) {
	const element = document.createElement("span");
	element.textContent = String(value ?? "");
	return element.innerHTML;
}

function answerGuidance(marks) {
	if (marks === 2) return { words: "30–50 words", time: "2–3 minutes", format: "A concise definition followed by one key point." };
	if (marks === 5) return { words: "100–150 words", time: "5–7 minutes", format: "An introduction, key points, and one example." };
	if (marks === 10) return { words: "250–350 words", time: "12–15 minutes", format: "An introduction, definition, main explanation, manual diagram instructions, example, advantages and disadvantages, and conclusion." };
	return { words: "400–550 words", time: "18–25 minutes", format: "A developed introduction and definition, detailed explanation, manual diagram instructions, example, advantages and disadvantages, and conclusion." };
}

function answerTask(marks) {
	if (marks === 2) return "Answer as a 2-mark college exam response. Give a direct definition and exactly one relevant supporting point. Avoid long introductions.";
	if (marks === 5) return "Answer as a 5-mark college exam response. Structure it as a short introduction, key points, and one relevant example.";
	return `Answer as a ${marks}-mark college exam response. Structure it with an introduction, definition, main explanation, example, advantages and disadvantages, and conclusion. Include a section beginning exactly with 'Draw manually:' that describes clear labels and connections for a hand-drawn diagram. Never create or pretend to show a diagram.`;
}

function saveAnswer(subject, topic, content) {
	const saved = get("saved");
	const title = `${subject}: ${topic}`;
	const previous = saved.find((item) => item.type === "answer" && item.title === title);
	const entry = { id: previous?.id || makeId(), type: "answer", title, content, createdAt: new Date().toISOString() };
	set("saved", [entry, ...saved.filter((item) => item.id !== entry.id)].slice(0, 100));
	toast("Exam answer saved.", "success");
}

function renderAnswer(host, text, guidance, subject, topic) {
	host.replaceChildren();
	const metrics = document.createElement("div");
	metrics.className = "answer-guidance-row";
	metrics.innerHTML = `<span><small>SUGGESTED LENGTH</small><strong>${guidance.words}</strong></span><span><small>SUGGESTED TIME</small><strong>${guidance.time}</strong></span>`;
	const answer = document.createElement("div");
	answer.className = "exam-answer-content exam-print-target";
	answer.append(renderMarkdown(text), aiFooter());
	const actions = document.createElement("div");
	actions.className = "exam-result-actions no-print";
	const copy = document.createElement("button");
	copy.type = "button";
	copy.className = "button button--secondary";
	copy.textContent = "Copy";
	copy.addEventListener("click", async () => {
		try { await copyToClipboard(text); } catch { toast("Clipboard access is unavailable in this browser.", "error"); }
	});
	const save = document.createElement("button");
	save.type = "button";
	save.className = "button button--save";
	save.textContent = "Save";
	save.addEventListener("click", () => saveAnswer(subject, topic, text));
	const print = document.createElement("button");
	print.type = "button";
	print.className = "button button--secondary";
	print.textContent = "Print";
	print.addEventListener("click", () => window.print());
	actions.append(copy, save, print);
	host.append(metrics, answer, actions);
}

function rescueSchema() {
	return {
		type: "OBJECT",
		properties: {
			importantConcepts: { type: "ARRAY", items: { type: "STRING" } },
			quickDefinitions: { type: "ARRAY", items: { type: "OBJECT", properties: { term: { type: "STRING" }, definition: { type: "STRING" } }, required: ["term", "definition"] } },
			formulas: { type: "ARRAY", items: { type: "STRING" } },
			frequentlyTested: { type: "ARRAY", items: { type: "STRING" } },
			commonMistakes: { type: "ARRAY", items: { type: "STRING" } },
			rapidFire: { type: "ARRAY", items: { type: "OBJECT", properties: { question: { type: "STRING" }, answer: { type: "STRING" } }, required: ["question", "answer"] } },
			oneMinuteSummary: { type: "STRING" }
		},
		required: ["importantConcepts", "quickDefinitions", "formulas", "frequentlyTested", "commonMistakes", "rapidFire", "oneMinuteSummary"]
	};
}

function isRescueData(value) {
	return ["importantConcepts", "quickDefinitions", "formulas", "frequentlyTested", "commonMistakes"].every((key) => Array.isArray(value?.[key]))
		&& value.quickDefinitions.every((item) => typeof item.term === "string" && typeof item.definition === "string")
		&& Array.isArray(value.rapidFire) && value.rapidFire.length === 10
		&& value.rapidFire.every((item) => typeof item.question === "string" && typeof item.answer === "string")
		&& typeof value.oneMinuteSummary === "string";
}

function renderRescue(host, data, hours) {
	host.replaceChildren();
	const header = document.createElement("div");
	header.className = "rescue-header";
	header.innerHTML = `<span class="eyebrow">EXAM MODE</span><span class="rescue-hours"></span>`;
	header.querySelector(".rescue-hours").textContent = `${hours} hour${hours === 1 ? "" : "s"} left`;
	host.append(header);
	const columns = document.createElement("div");
	columns.className = "rescue-content-grid";
	const sections = [
		["Most important concepts", data.importantConcepts.map((item) => `- ${item}`).join("\n")],
		["Quick definitions", data.quickDefinitions.map((item) => `- **${item.term}:** ${item.definition}`).join("\n")],
		["Formulas", data.formulas.length ? data.formulas.map((item) => `- ${item}`).join("\n") : "No formulas identified."],
		["Frequently tested concepts", data.frequentlyTested.map((item) => `- ${item}`).join("\n")],
		["Common mistakes", data.commonMistakes.map((item) => `- ${item}`).join("\n")]
	];
	sections.forEach(([titleText, content]) => {
		const section = document.createElement("section");
		section.className = "rescue-section";
		const title = document.createElement("h3");
		title.textContent = titleText;
		section.append(title, renderMarkdown(content));
		columns.append(section);
	});
	const cards = document.createElement("section");
	cards.className = "rescue-section rescue-flashcards";
	const cardsTitle = document.createElement("h3");
	cardsTitle.textContent = "10 rapid-fire questions";
	const grid = document.createElement("div");
	grid.className = "rapid-fire-grid";
	data.rapidFire.forEach((item, index) => {
		const card = document.createElement("article");
		card.className = "rapid-fire-card";
		const question = document.createElement("strong");
		question.textContent = `${index + 1}. ${item.question}`;
		const reveal = document.createElement("button");
		reveal.type = "button";
		reveal.className = "rapid-fire-reveal";
		reveal.setAttribute("aria-expanded", "false");
		reveal.textContent = "Tap to reveal answer";
		const answer = document.createElement("p");
		answer.hidden = true;
		answer.textContent = item.answer;
		reveal.addEventListener("click", () => {
			const open = answer.hidden;
			answer.hidden = !open;
			reveal.setAttribute("aria-expanded", String(open));
			reveal.textContent = open ? "Hide answer" : "Tap to reveal answer";
		});
		card.append(question, reveal, answer);
		grid.append(card);
	});
	cards.append(cardsTitle, grid);
	const summary = document.createElement("section");
	summary.className = "rescue-one-minute";
	const summaryTitle = document.createElement("h3");
	summaryTitle.textContent = "One-minute revision summary";
	summary.append(summaryTitle, renderMarkdown(data.oneMinuteSummary));
	columns.append(cards, summary);
	host.append(columns, aiFooter());
}

function renderVivaQuestion(host, session) {
	host.replaceChildren();
	const header = document.createElement("div");
	header.className = "viva-progress-heading";
	const title = document.createElement("span");
	title.className = "eyebrow";
	title.textContent = `VIVA PRACTICE · QUESTION ${session.answers.length + 1} OF 8`;
	const difficulty = document.createElement("span");
	difficulty.className = "difficulty-pill";
	difficulty.textContent = session.difficulty;
	header.append(title, difficulty);
	const question = document.createElement("section");
	question.className = "surface viva-question-card";
	const prompt = document.createElement("h2");
	prompt.textContent = session.currentQuestion;
	const form = document.createElement("form");
	form.className = "viva-answer-form";
	form.innerHTML = `<label class="field"><span>Your answer</span><textarea name="answer" rows="5" maxlength="3000" required placeholder="Explain it in your own words..."></textarea></label><div class="viva-actions"><button class="button button--secondary" id="viva-speak" type="button">🎤 Speak answer</button><button class="button button--primary" type="submit">Submit answer <span aria-hidden="true">→</span></button></div>`;
	question.append(prompt, form, aiFooter());
	host.append(header, question);
	form.querySelector("#viva-speak").addEventListener("click", async (event) => {
		const button = event.currentTarget;
		button.disabled = true;
		const transcript = await listen({ language: get("profile").language });
		if (transcript) {
			const field = form.elements.answer;
			field.value = [field.value, transcript].filter(Boolean).join(" ");
			field.focus();
		}
		button.disabled = false;
	});
	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		if (!form.reportValidity()) return;
		const answer = form.elements.answer.value.trim();
		const submit = form.querySelector('button[type="submit"]');
		submit.disabled = true;
		host.append(skeleton(3));
		const index = session.answers.length + 1;
		const schema = { type: "OBJECT", properties: { isCorrect: { type: "BOOLEAN" }, keyPointsCovered: { type: "ARRAY", items: { type: "STRING" } }, missingPoints: { type: "ARRAY", items: { type: "STRING" } }, clarityScore: { type: "INTEGER" }, feedback: { type: "STRING" }, nextQuestion: { type: "STRING" }, isComplete: { type: "BOOLEAN" } }, required: ["isCorrect", "keyPointsCovered", "missingPoints", "clarityScore", "feedback", "nextQuestion", "isComplete"] };
		let evaluation;
		try {
			evaluation = await askJSON({
			task: "Evaluate this viva answer for correctness, key points covered, missing points, and clarity. Be supportive and ask one useful follow-up or next question. Set isComplete true only after at least five questions; cap the viva at eight.",
			context: `Subject: ${session.subject}\nTopic: ${session.topic}\nDifficulty: ${session.difficulty}\nQuestion number: ${index}\nViva question: ${session.currentQuestion}\nStudent answer: ${answer}`,
			demoType: "viva-evaluation",
			demoIndex: index,
			responseSchema: schema,
			outputFormat: "Return JSON with isCorrect:boolean, keyPointsCovered:string[], missingPoints:string[], clarityScore:integer 0-100, feedback:string, nextQuestion:string, isComplete:boolean."
			}, (value) => typeof value?.isCorrect === "boolean" && Array.isArray(value.keyPointsCovered) && Array.isArray(value.missingPoints) && Number.isInteger(value.clarityScore) && value.clarityScore >= 0 && value.clarityScore <= 100 && typeof value.feedback === "string" && typeof value.nextQuestion === "string" && typeof value.isComplete === "boolean");
		} catch {
			host.querySelectorAll(".skeleton-stack").forEach((item) => item.remove());
			submit.disabled = false;
			toast("Viva feedback could not be generated. Please try again.", "error");
			return;
		}
		session.answers.push({ question: session.currentQuestion, answer, ...evaluation });
		if (index >= 8 || (index >= 5 && evaluation.isComplete)) {
			finishViva(host, session);
			return;
		}
		renderVivaFeedback(host, session);
	});
}

function renderVivaFeedback(host, session) {
	host.replaceChildren();
	const result = session.answers.at(-1);
	const feedback = document.createElement("section");
	feedback.className = "surface viva-feedback";
	const title = document.createElement("h2");
	title.textContent = result.isCorrect ? "Good answer." : "Good attempt. Let’s sharpen it.";
	const score = document.createElement("span");
	score.className = "viva-clarity-score";
	score.textContent = `Clarity · ${result.clarityScore}%`;
	const answer = document.createElement("p");
	answer.textContent = result.feedback;
	const strengths = document.createElement("div");
	strengths.innerHTML = `<h3>Key points covered</h3>`;
	strengths.append(renderMarkdown(result.keyPointsCovered.length ? result.keyPointsCovered.map((point) => `- ${point}`).join("\n") : "- Keep building your explanation."));
	const gaps = document.createElement("div");
	gaps.innerHTML = `<h3>Missing points</h3>`;
	gaps.append(renderMarkdown(result.missingPoints.length ? result.missingPoints.map((point) => `- ${point}`).join("\n") : "- No major gaps identified."));
	feedback.append(title, score, answer, strengths, gaps, aiFooter());
	const next = document.createElement("button");
	next.type = "button";
	next.className = "button button--primary";
	next.textContent = `Next question ${session.answers.length + 1} of 8 →`;
	next.addEventListener("click", async () => {
		next.disabled = true;
		host.replaceChildren(skeleton(2));
		const schema = { type: "OBJECT", properties: { question: { type: "STRING" } }, required: ["question"] };
		let data;
		try {
			data = await askJSON({ task: "Ask one next viva question that follows naturally from the student's answer and probes the same topic at the selected difficulty.", context: `Subject: ${session.subject}\nTopic: ${session.topic}\nDifficulty: ${session.difficulty}\nPrevious question: ${result.question}\nStudent answer: ${result.answer}\nPrevious feedback: ${result.feedback}\nQuestion number: ${session.answers.length + 1}`, demoType: "viva-question", demoIndex: session.answers.length, responseSchema: schema, outputFormat: "Return JSON with question:string." }, (value) => typeof value?.question === "string" && value.question.trim().length > 0);
		} catch {
			toast("The next viva question could not be loaded. Please try again.", "error");
			renderVivaFeedback(host, session);
			return;
		}
		session.currentQuestion = data.question;
		renderVivaQuestion(host, session);
	});
	host.append(feedback, next);
}

function finishViva(host, session) {
	const answers = session.answers;
	const average = answers.length ? Math.round(answers.reduce((sum, answer) => sum + answer.clarityScore, 0) / answers.length) : 0;
	const strong = [...new Set(answers.flatMap((answer) => answer.keyPointsCovered))];
	const improve = [...new Set(answers.flatMap((answer) => answer.missingPoints))];
	const activity = get("activity");
	activity.unshift({ id: makeId(), type: "viva-completed", label: `Viva practice: ${session.topic} · ${answers.length} questions`, ts: new Date().toISOString() });
	set("activity", activity.slice(0, 100));
	const points = 10 + Math.round(average / 10);
	const award = addXP(points, `Completed viva on ${session.topic}`);
	award.badgesUnlocked?.forEach((badge) => toast(`Badge earned: ${badge.name}`, "success"));
	host.replaceChildren();
	const report = document.createElement("section");
	report.className = "surface viva-report";
	report.innerHTML = `<span class="eyebrow">VIVA PERFORMANCE</span><h2></h2><p class="viva-practice-estimate"></p><div class="viva-report-grid"><section><h3>Strong areas</h3><div class="viva-strong"></div></section><section><h3>Areas to improve</h3><div class="viva-improve"></div></section></div><section class="viva-revise-topics"><h3>Topics to revise</h3><p></p></section>`;
	report.querySelector("h2").textContent = `${answers.length} questions answered`;
	report.querySelector(".viva-practice-estimate").textContent = `Approximate score · ${average}% practice estimate. Not a formal assessment.`;
	report.querySelector(".viva-strong").replaceChildren(renderMarkdown(strong.length ? strong.map((item) => `- ${item}`).join("\n") : "No strong points recorded yet."));
	report.querySelector(".viva-improve").replaceChildren(renderMarkdown(improve.length ? improve.map((item) => `- ${item}`).join("\n") : "No major gaps recorded."));
	report.querySelector(".viva-revise-topics p").textContent = `${session.subject} · ${session.topic}${improve.length ? ` · ${improve.slice(0, 2).join(" · ")}` : ""}`;
	report.append(aiFooter());
	host.append(report);
	toast(`Viva complete · +${points} XP`, "success");
}

function rescueHoursTask(hours) {
	if (hours <= 1) return "Create an emergency, high-yield exam rescue sheet. Prioritize only the most essential concepts, minimal definitions and formulas, common mistakes, ten very short rapid-fire Q&A cards, and an extremely concise one-minute summary.";
	if (hours <= 3) return "Create a high-yield exam rescue sheet. Prioritize core concepts, quick definitions and formulas, frequently tested concepts, common mistakes, ten concise rapid-fire Q&A cards, and a one-minute revision summary.";
	return "Create a focused exam revision rescue sheet with concepts, definitions, formulas, frequently tested ideas, common mistakes, ten rapid-fire Q&A cards, and a useful one-minute revision summary.";
}

export function render(container) {
	container.innerHTML = `<section class="page-heading exam-heading"><span class="eyebrow">EXAM ZONE</span><h1>Walk in prepared.</h1><p>Shape a clear answer, rescue a last-minute review, or practise your viva out loud.</p></section><div class="exam-tabs" role="tablist" aria-label="Exam tools"><button class="exam-tab is-active" type="button" role="tab" aria-selected="true" data-exam-tab="answers">Answer Generator</button><button class="exam-tab" type="button" role="tab" aria-selected="false" data-exam-tab="rescue" tabindex="-1">Exam Rescue Mode</button><button class="exam-tab" type="button" role="tab" aria-selected="false" data-exam-tab="viva" tabindex="-1">AI Viva</button></div><section class="exam-panel is-active" data-exam-panel="answers"><div class="surface exam-tool-surface"><div class="exam-tool-heading"><span class="eyebrow">EXAM ANSWER GENERATOR</span><h2>Build an answer to the mark scheme.</h2><p>Choose the mark value so the answer depth fits the time available.</p></div><form id="exam-answer-form" class="exam-form"><label class="field"><span>Subject</span><input name="subject" maxlength="100" required placeholder="e.g. Biology"></label><label class="field"><span>Topic</span><input name="topic" maxlength="140" required placeholder="e.g. Mitosis"></label><label class="field field--wide"><span>Question</span><textarea name="question" rows="4" maxlength="3000" required placeholder="Paste or type your exam question..."></textarea></label><label class="field"><span>Marks</span><select name="marks"><option value="2">2 marks</option><option value="5" selected>5 marks</option><option value="10">10 marks</option><option value="15">15 marks</option></select></label><button class="button button--primary" type="submit">Generate answer <span aria-hidden="true">→</span></button></form><div id="exam-answer-result" class="exam-answer-result" aria-live="polite" hidden></div></div></section><section class="exam-panel" data-exam-panel="rescue" hidden><div class="exam-rescue-zone"><header class="rescue-form-heading"><span class="eyebrow">EXAM MODE · FOCUSED REVIEW</span><h2>Use the time you have.</h2><p>Build a prioritised revision sheet for the hours remaining.</p></header><form id="exam-rescue-form" class="rescue-form"><label class="field"><span>Subject</span><input name="subject" maxlength="100" required placeholder="e.g. Chemistry"></label><label class="field"><span>Topic</span><input name="topic" maxlength="140" required placeholder="e.g. Electrochemistry"></label><label class="field"><span>Hours left</span><input name="hours" type="number" min="0.5" max="72" step="0.5" value="3" required></label><button class="button button--lime" type="submit">Build rescue sheet <span aria-hidden="true">↗</span></button></form><div id="exam-rescue-result" class="exam-rescue-result" aria-live="polite"></div></div></section><section class="exam-panel" data-exam-panel="viva" hidden><div class="surface viva-setup"><div class="exam-tool-heading"><span class="eyebrow">AI VIVA PRACTICE</span><h2>Think it through out loud.</h2><p>Answer one question at a time. You’ll get a practice estimate, strong points, and revision targets.</p></div><form id="viva-setup-form" class="exam-form"><label class="field"><span>Subject</span><input name="subject" maxlength="100" required placeholder="e.g. Computer Science"></label><label class="field"><span>Topic</span><input name="topic" maxlength="140" required placeholder="e.g. Data structures"></label><label class="field"><span>Difficulty</span><select name="difficulty"><option value="beginner">Beginner</option><option value="intermediate" selected>Intermediate</option><option value="advanced">Advanced</option></select></label><button class="button button--primary" type="submit">Start viva <span aria-hidden="true">→</span></button></form><div id="viva-session" class="viva-session" aria-live="polite"></div></div></section>`;
}

export function init() {
	const root = document.querySelector("#page-content");
	const tabs = [...root.querySelectorAll("[data-exam-tab]")];
	const panels = [...root.querySelectorAll("[data-exam-panel]")];
	const selectTab = (name) => {
		tabs.forEach((tab) => {
			const active = tab.dataset.examTab === name;
			tab.classList.toggle("is-active", active);
			tab.setAttribute("aria-selected", String(active));
			tab.tabIndex = active ? 0 : -1;
		});
		panels.forEach((panel) => { panel.hidden = panel.dataset.examPanel !== name; });
	};
	tabs.forEach((tab, index) => {
		tab.addEventListener("click", () => selectTab(tab.dataset.examTab));
		tab.addEventListener("keydown", (event) => {
			if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
			event.preventDefault();
			const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
			tabs[next].focus();
			selectTab(tabs[next].dataset.examTab);
		});
	});
	root.querySelector("#exam-answer-form").addEventListener("submit", async (event) => {
		event.preventDefault();
		if (!event.currentTarget.reportValidity()) return;
		const values = Object.fromEntries(new FormData(event.currentTarget));
		const marks = Number(values.marks);
		const guidance = answerGuidance(marks);
		const host = root.querySelector("#exam-answer-result");
		const button = event.currentTarget.querySelector("button[type=submit]");
		button.disabled = true;
		host.hidden = false;
		host.replaceChildren(skeleton(5));
		const context = `Subject: ${values.subject}\nTopic: ${values.topic}\nQuestion: ${values.question}\nMarks: ${marks}\nSuggested length: ${guidance.words}`;
		const answer = await ask({ task: answerTask(marks), context, demoType: "exam-answer", demoMarks: marks, outputFormat: `${guidance.format} Suggested word count ${guidance.words}; suggested time ${guidance.time}. For 10 and 15 marks, a section beginning 'Draw manually:' with clear hand-drawn diagram instructions is mandatory.` });
		renderAnswer(host, answer, guidance, values.subject, values.topic);
		button.disabled = false;
	});
	root.querySelector("#exam-rescue-form").addEventListener("submit", async (event) => {
		event.preventDefault();
		if (!event.currentTarget.reportValidity()) return;
		const values = Object.fromEntries(new FormData(event.currentTarget));
		const hours = Number(values.hours);
		const host = root.querySelector("#exam-rescue-result");
		const button = event.currentTarget.querySelector("button[type=submit]");
		button.disabled = true;
		host.replaceChildren(skeleton(7));
		const data = await askJSON({ task: rescueHoursTask(hours), context: `Subject: ${values.subject}\nTopic: ${values.topic}\nHours left: ${hours}`, demoType: "exam-rescue", demoHours: hours, responseSchema: rescueSchema(), outputFormat: "Return JSON with importantConcepts:string[], quickDefinitions:[{term,definition}], formulas:string[], frequentlyTested:string[], commonMistakes:string[], exactly ten rapidFire:[{question,answer}], oneMinuteSummary:string." }, isRescueData);
		renderRescue(host, data, hours);
		button.disabled = false;
	});
	root.querySelector("#viva-setup-form").addEventListener("submit", async (event) => {
		event.preventDefault();
		if (!event.currentTarget.reportValidity()) return;
		const values = Object.fromEntries(new FormData(event.currentTarget));
		vivaState = { subject: values.subject, topic: values.topic, difficulty: values.difficulty, currentQuestion: "", answers: [] };
		const host = root.querySelector("#viva-session");
		host.replaceChildren(skeleton(2));
		const schema = { type: "OBJECT", properties: { question: { type: "STRING" } }, required: ["question"] };
		const data = await askJSON({ task: "Start a viva by asking exactly one concise open-ended question about the topic at the selected difficulty. Do not include its answer.", context: `Subject: ${vivaState.subject}\nTopic: ${vivaState.topic}\nDifficulty: ${vivaState.difficulty}`, demoType: "viva-question", demoIndex: 0, responseSchema: schema, outputFormat: "Return JSON with question:string only." }, (value) => typeof value?.question === "string" && value.question.trim().length > 0);
		vivaState.currentQuestion = data.question;
		renderVivaQuestion(host, vivaState);
	});
}
