import { get, set } from "../core/storage.js";
import { askJSON } from "../core/gemini.js";
import { addXP, checkBadges, getBadgeDefinitions } from "../core/gamification.js";
import { aggregateQuizPerformance, activityByDate, getProgressMetrics, getRevisionGroups, scoreTrend, updateLeitnerTopic } from "../core/analytics.js";
import { aiFooter, renderMarkdown, skeleton, toast } from "../core/ui.js";

const revisionQuestionSchema = {
	type: "OBJECT",
	properties: { questions: { type: "ARRAY", items: {
		type: "OBJECT",
		properties: { q: { type: "STRING" }, options: { type: "ARRAY", items: { type: "STRING" } }, correctIndex: { type: "INTEGER" }, explanation: { type: "STRING" }, subtopic: { type: "STRING" } },
		required: ["q", "options", "correctIndex", "explanation", "subtopic"]
	} } },
	required: ["questions"]
};

function escapeHTML(value) {
	const element = document.createElement("span");
	element.textContent = String(value ?? "");
	return element.innerHTML;
}

function hasData() {
	return get("topics").length > 0 || get("quizHistory").some((quiz) => quiz.status !== "in-progress") || get("activity").length > 0;
}

function practiceLink(subject, topic) {
	return `#/practice?subject=${encodeURIComponent(subject)}&topic=${encodeURIComponent(topic)}`;
}

function statusClass(status) {
	return status.toLowerCase().replaceAll(" ", "-");
}

function renderWeakTopics(host, analytics) {
	host.replaceChildren();
	if (!analytics.topics.length) {
		host.innerHTML = `<div class="insights-empty"><p>Complete a quiz to see strengths and areas to practice.</p><a class="text-link" href="#/practice">Start a quiz →</a></div>`;
		return;
	}
	analytics.topics.forEach((topic) => {
		const article = document.createElement("article");
		article.className = "weak-analysis-item";
		const head = document.createElement("div");
		head.className = "weak-analysis-head";
		const title = document.createElement("div");
		title.innerHTML = `<strong></strong><small></small>`;
		title.querySelector("strong").textContent = topic.topic;
		title.querySelector("small").textContent = topic.subject;
		const status = document.createElement("span");
		status.className = `topic-classification ${statusClass(topic.classification)}`;
		status.textContent = `${topic.classification} · ${topic.percentage}%`;
		head.append(title, status);
		const subtopics = document.createElement("div");
		subtopics.className = "subtopic-results";
		if (topic.subtopics.length) {
			topic.subtopics.forEach((subtopic) => {
				const row = document.createElement("div");
				row.className = "subtopic-result-row";
				row.innerHTML = `<span></span><b></b><small></small>`;
				row.querySelector("span").textContent = subtopic.name;
				row.querySelector("b").textContent = `${subtopic.percentage}%`;
				row.querySelector("small").textContent = subtopic.classification;
				row.querySelector("small").className = `topic-classification ${statusClass(subtopic.classification)}`;
				subtopics.append(row);
			});
		} else {
			const note = document.createElement("p");
			note.className = "muted";
			note.textContent = "Subtopic detail will appear as quiz questions include subtopic labels.";
			subtopics.append(note);
		}
		const actions = document.createElement("div");
		actions.className = "weak-analysis-actions";
		const recommend = document.createElement("button");
		recommend.type = "button";
		recommend.className = "text-link recommend-topic-button";
		recommend.dataset.recommendSubject = topic.subject;
		recommend.dataset.recommendTopic = topic.topic;
		recommend.textContent = "Recommended next step →";
		const practice = document.createElement("a");
		practice.className = "button button--secondary";
		practice.href = practiceLink(topic.subject, topic.topic);
		practice.textContent = "Practice this now";
		actions.append(recommend, practice);
		const recommendation = document.createElement("div");
		recommendation.className = "topic-recommendation";
		recommendation.hidden = true;
		article.append(head, subtopics, actions, recommendation);
		host.append(article);
	});
}

function trendSvg(trend) {
	if (!trend.length) return `<div class="chart-empty">Complete a quiz to build your score trend.</div>`;
	const width = 640;
	const height = 210;
	const left = 32;
	const right = width - 20;
	const top = 18;
	const bottom = height - 32;
	const points = trend.map((item, index) => {
		const x = trend.length === 1 ? width / 2 : left + index * ((right - left) / (trend.length - 1));
		const y = bottom - item.percentage / 100 * (bottom - top);
		return { x, y, ...item };
	});
	const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
	const grid = [0, 25, 50, 75, 100].map((value) => {
		const y = bottom - value / 100 * (bottom - top);
		return `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" class="chart-grid-line"/><text x="${left - 8}" y="${y + 3}" text-anchor="end" class="chart-axis-label">${value}</text>`;
	}).join("");
	const dots = points.map((point, index) => `<circle cx="${point.x}" cy="${point.y}" r="4" class="trend-dot"><title>${escapeHTML(point.label)}: ${point.percentage}%</title></circle><text x="${point.x}" y="${height - 7}" text-anchor="middle" class="chart-axis-label">${index + 1}</text>`).join("");
	return `<svg class="score-trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Quiz score trend for ${trend.length} attempts">${grid}<polyline points="${polyline}" class="trend-line"/>${dots}</svg><p class="chart-caption">Recent quiz attempts · score percent</p>`;
}

function renderSubjectBars(subjects) {
	if (!subjects.length) return `<div class="chart-empty">Subject scores will appear after a quiz.</div>`;
	return `<div class="subject-bar-chart">${subjects.map((subject) => `<div class="subject-bar-row"><span>${escapeHTML(subject.subject)}</span><div class="subject-bar-track" role="img" aria-label="${escapeHTML(subject.subject)} ${subject.percentage}%"><i style="--bar-value:${subject.percentage}%"></i></div><b>${subject.percentage}%</b></div>`).join("")}</div>`;
}

function ringMarkup(label, value, detail) {
	const percentage = Math.max(0, Math.min(100, Math.round(value)));
	return `<div class="progress-ring-wrap"><div class="progress-ring" role="img" aria-label="${escapeHTML(label)} ${percentage}%" style="--ring-value:${percentage}%"><span>${percentage}%</span></div><strong>${escapeHTML(label)}</strong><small>${escapeHTML(detail)}</small></div>`;
}

function heatmapMarkup(activity) {
	const max = Math.max(1, ...activity.map((item) => item.count));
	const cells = activity.map((item) => {
		const intensity = item.count === 0 ? 0 : Math.max(1, Math.ceil(item.count / max * 4));
		return `<span class="heatmap-cell heat-${intensity}" role="img" aria-label="${item.date}: ${item.count} study activities" title="${item.date} · ${item.count} activities"></span>`;
	}).join("");
	return `<div class="activity-heatmap" role="group" aria-label="Study activity in the last four weeks">${cells}</div><div class="heatmap-legend"><span>Less</span><i class="heat-0"></i><i class="heat-1"></i><i class="heat-2"></i><i class="heat-3"></i><i class="heat-4"></i><span>More</span></div>`;
}

function revisionTopicRows(host, topics, emptyText) {
	host.replaceChildren();
	if (!topics.length) {
		const empty = document.createElement("p");
		empty.className = "insights-empty-text";
		empty.textContent = emptyText;
		host.append(empty);
		return;
	}
	topics.forEach((topic) => {
		const item = document.createElement("article");
		item.className = "revision-topic-row";
		const text = document.createElement("span");
		text.innerHTML = `<strong></strong><small></small>`;
		text.querySelector("strong").textContent = topic.topic;
		text.querySelector("small").textContent = `${topic.subject} · Box ${topic.leitnerBox} · ${topic.mastery || 0}% mastery`;
		const action = document.createElement("button");
		action.type = "button";
		action.className = "button button--secondary";
		action.dataset.startRevision = topic.id;
		action.textContent = topic.leitnerBox === 5 && topic.mastery >= 75 ? "Review mastered topic" : "Start revision";
		item.append(text, action);
		host.append(item);
	});
}

function renderRevisionBuckets(root) {
	const groups = getRevisionGroups();
	revisionTopicRows(root.querySelector("#revise-today-list"), groups.dueToday, "Nothing is due today. A short review will appear here when a topic reaches its interval.");
	revisionTopicRows(root.querySelector("#needs-revision-list"), groups.needsRevision, "No overdue topics. Keep your spacing steady.");
	revisionTopicRows(root.querySelector("#mastered-list"), groups.mastered, "Topics move here after reaching box 5 with strong mastery.");
}

function recordRevisionActivity(topic, score, total) {
	const activity = get("activity");
	activity.unshift({ id: crypto.randomUUID?.() || String(Date.now()), type: "revision-completed", label: `Revised ${topic.topic} · ${score}/${total}`, ts: new Date().toISOString() });
	set("activity", activity.slice(0, 100));
}

function startRevision(root, topic) {
	const host = root.querySelector("#revision-session");
	host.hidden = false;
	host.replaceChildren();
	const heading = document.createElement("h2");
	heading.textContent = `Revision · ${topic.topic}`;
	host.append(heading, skeleton(4));
	const questionsSchema = {
		type: "OBJECT",
		properties: { questions: { type: "ARRAY", items: {
			type: "OBJECT",
			properties: { q: { type: "STRING" }, options: { type: "ARRAY", items: { type: "STRING" } }, correctIndex: { type: "INTEGER" }, explanation: { type: "STRING" }, subtopic: { type: "STRING" } },
			required: ["q", "options", "correctIndex", "explanation", "subtopic"]
		} } },
		required: ["questions"]
	};
	askJSON({
		task: "Create exactly five brief revision multiple-choice questions from this student's topic. Each question needs four options, one valid correct index, a short explanation, and a subtopic label.",
		context: `Student profile: ${JSON.stringify(get("profile"))}\nTopic: ${topic.topic}\nSubject: ${topic.subject}\nSaved explanation: ${topic.savedExplanation || "No saved explanation."}\nMastery: ${topic.mastery || 0}%\nLeitner box: ${topic.leitnerBox}`,
		demoType: "revision-questions",
		demoCount: 5,
		demoDifficulty: "review",
		responseSchema: questionsSchema,
		outputFormat: "Return JSON shaped as {questions:[{q:string,options:string[4],correctIndex:integer 0-3,explanation:string,subtopic:string}]}, exactly five questions."
	}, (value) => Array.isArray(value?.questions) && value.questions.length === 5 && value.questions.every((question) => typeof question.q === "string" && Array.isArray(question.options) && question.options.length === 4 && question.options.every((option) => typeof option === "string" && option.trim()) && Number.isInteger(question.correctIndex) && question.correctIndex >= 0 && question.correctIndex < 4 && typeof question.explanation === "string" && question.explanation.trim() && typeof question.subtopic === "string" && question.subtopic.trim()))
		.then((data) => renderRevisionQuestions(host, topic, data.questions))
		.catch(() => {
			host.replaceChildren();
			toast("Revision questions could not be prepared. Please try again.", "error");
		});
}

function renderRevisionQuestions(host, topic, questions) {
	host.replaceChildren();
	const form = document.createElement("form");
	form.className = "revision-question-form";
	questions.forEach((question, index) => {
		const fieldset = document.createElement("fieldset");
		fieldset.className = "revision-question-card";
		const legend = document.createElement("legend");
		legend.textContent = `${index + 1}. ${question.q}`;
		fieldset.append(legend);
		question.options.forEach((option, optionIndex) => {
			const label = document.createElement("label");
			label.className = "revision-option";
			label.innerHTML = `<input type="radio" name="revision-${index}" value="${optionIndex}" required><span></span>`;
			label.querySelector("span").textContent = option;
			fieldset.append(label);
		});
		form.append(fieldset);
	});
	const submit = document.createElement("button");
	submit.type = "submit";
	submit.className = "button button--primary";
	submit.textContent = "Finish revision";
	form.append(submit);
	host.append(form);
	form.addEventListener("submit", (event) => {
		event.preventDefault();
		if (!form.reportValidity()) return;
		const answers = questions.map((_question, index) => Number(new FormData(form).get(`revision-${index}`)));
		const score = questions.filter((question, index) => answers[index] === question.correctIndex).length;
		const result = updateLeitnerTopic(topic.id, score, questions.length);
		if (!result) {
			toast("This topic no longer exists in your study list.", "error");
			return;
		}
		recordRevisionActivity(topic, score, questions.length);
		const award = addXP(Math.max(3, score * 2), `Revised ${topic.topic}`);
		award.badgesUnlocked?.forEach((badge) => toast(`Badge earned: ${badge.name}`, "success"));
		const review = document.createElement("section");
		review.className = "revision-result";
		const title = document.createElement("h3");
		title.textContent = `Revision score: ${score}/${questions.length}`;
		const movement = document.createElement("p");
		movement.textContent = `Leitner box ${topic.leitnerBox} → ${result.nextBox}. Next review in ${result.intervalDays} day${result.intervalDays === 1 ? "" : "s"}.`;
		review.append(title, movement);
		questions.forEach((question, index) => {
			const answer = document.createElement("div");
			answer.className = `revision-answer ${answers[index] === question.correctIndex ? "is-correct" : "is-incorrect"}`;
			const chosen = document.createElement("p");
			chosen.textContent = `Your answer: ${question.options[answers[index]]}`;
			const correct = document.createElement("p");
			correct.textContent = `Correct answer: ${question.options[question.correctIndex]}`;
			answer.append(chosen, correct, renderMarkdown(question.explanation));
			review.append(answer);
		});
		review.append(aiFooter());
		host.replaceChildren(review);
		renderRevisionBuckets(document.querySelector("#page-content"));
	});
}

function renderTopicAnalysis(host, analytics) {
	renderWeakTopics(host, analytics);
	host.addEventListener("click", async (event) => {
		const button = event.target.closest("[data-recommend-topic]");
		if (!button) return;
		const target = button.closest(".weak-analysis-item").querySelector(".topic-recommendation");
		target.hidden = false;
		target.replaceChildren(skeleton(2));
		button.disabled = true;
		const schema = { type: "OBJECT", properties: { recommendation: { type: "STRING" } }, required: ["recommendation"] };
		const data = await askJSON({
			task: "Give one short, practical next study step for this weak topic. Be specific about a small action, and do not overstate what the score proves.",
			context: `Subject: ${button.dataset.recommendSubject}\nTopic: ${button.dataset.recommendTopic}\nRecent performance: ${button.closest(".weak-analysis-item").querySelector(".topic-classification").textContent}`,
			demoType: "insights-next-step",
			responseSchema: schema,
			outputFormat: "Return JSON with recommendation:string, one concise sentence."
		}, (value) => typeof value?.recommendation === "string" && value.recommendation.trim().length > 0);
		const link = document.createElement("a");
		link.className = "text-link";
		link.href = practiceLink(button.dataset.recommendSubject, button.dataset.recommendTopic);
		link.textContent = "Practice this topic →";
		target.replaceChildren(renderMarkdown(data.recommendation), link, aiFooter());
		button.disabled = false;
	});
}

function safeActionLink(link, fallback) {
	if (typeof link !== "string") return fallback;
	if (["#/practice", "#/learn", "#/planner", "#/insights"].some((route) => link.startsWith(route))) return link;
	return fallback;
}

export function render(container) {
	const metrics = getProgressMetrics();
	const analytics = aggregateQuizPerformance();
	const topicList = get("topics");
	const settings = get("settings");
	const masteryAverage = topicList.length ? Math.round(topicList.reduce((sum, topic) => sum + (Number(topic.mastery) || 0), 0) / topicList.length) : 0;
	const dailyGoal = Number(get("profile").dailyMinutes) || 30;
	const goalPercent = dailyGoal ? Math.min(100, metrics.studyMinutes / dailyGoal * 100) : 0;
	const rings = [ringMarkup("Average score", metrics.averageScore, `${metrics.quizAttempts} quiz attempts`), ringMarkup("Topic mastery", masteryAverage, `${metrics.topicsStudied} topics studied`), ringMarkup("Daily study goal", goalPercent, `${metrics.studyMinutes} / ${dailyGoal} min`)];
	const badges = new Set(get("gamification").badges || []);
	const revisionGroups = getRevisionGroups();
	const weakList = analytics.weakSubtopics.slice(0, 8);
	const completedTopics = topicList.filter((topic) => Number(topic.mastery) >= 75).map((topic) => `${topic.subject}: ${topic.topic}`);
	const noAnalytics = !hasData();
	container.innerHTML = `
		<section class="page-heading insights-heading"><span class="eyebrow">YOUR LEARNING SIGNALS</span><h1>Insights & progress</h1><p>See what is sticking, choose a useful review, and keep your study rhythm visible.</p>${settings.usingSampleData ? `<span class="sample-data-inline">SAMPLE DATA</span>` : ""}</section>
		${noAnalytics ? `<section class="surface insights-empty-state"><span class="eyebrow">NOT ENOUGH HISTORY YET</span><h2>Your first signal starts with a quiz.</h2><p>Take a Practice quiz or load the dashboard's sample data to explore Insights.</p><a class="button button--primary" href="#/practice">Start a quiz</a><a class="text-link" href="#/dashboard">Open Dashboard →</a></section>` : ""}
		<section class="insights-stats"><article class="surface insight-stat"><span>Topics studied</span><strong>${metrics.topicsStudied}</strong></article><article class="surface insight-stat"><span>Quiz attempts</span><strong>${metrics.quizAttempts}</strong></article><article class="surface insight-stat"><span>Average score</span><strong>${metrics.averageScore}%</strong></article><article class="surface insight-stat"><span>Study time</span><strong>${metrics.studyMinutes}<small> min</small></strong></article><article class="surface insight-stat"><span>Streak</span><strong>${metrics.streak}<small> days</small></strong></article><article class="surface insight-stat"><span>XP · Level</span><strong>${metrics.xp}<small> · L${metrics.level}</small></strong></article></section>
		<section class="insights-charts-grid"><article class="surface insights-panel score-trend-panel"><div class="insights-panel-heading"><div><span class="eyebrow">QUIZ HISTORY</span><h2>Score trend</h2></div></div>${trendSvg(scoreTrend(8))}</article><article class="surface insights-panel subject-chart-panel"><div class="insights-panel-heading"><div><span class="eyebrow">BY SUBJECT</span><h2>Subject performance</h2></div></div>${renderSubjectBars(analytics.subjects)}</article><article class="surface insights-panel progress-rings-panel"><div class="insights-panel-heading"><div><span class="eyebrow">AT A GLANCE</span><h2>Progress rings</h2></div></div><div class="progress-rings">${rings.join("")}</div></article><article class="surface insights-panel heatmap-panel"><div class="insights-panel-heading"><div><span class="eyebrow">CONSISTENCY</span><h2>Weekly activity</h2></div></div>${heatmapMarkup(activityByDate(28))}</article></section>
		<section class="surface insights-panel weak-analysis-panel"><div class="insights-panel-heading"><div><span class="eyebrow">COMPUTED FROM QUIZ HISTORY · NO AI SCORING</span><h2>Weak Topic Detector</h2><p>Strong ≥75% · Needs Practice 50–74% · Weak &lt;50%</p></div><a class="text-link" href="#/practice">Take a quiz →</a></div><div id="weak-topic-analysis" class="weak-topic-analysis"></div></section>
		<section class="surface insights-panel smart-revision-panel"><div class="insights-panel-heading"><div><span class="eyebrow">SPACED RETRIEVAL</span><h2>Smart Revision</h2><p>Success advances one Leitner box; a difficult review steps back. Intervals: 1 · 2 · 4 · 7 · 14 days.</p></div></div><div class="revision-groups"><section><h3>Revise Today</h3><div id="revise-today-list"></div></section><section><h3>Needs Revision</h3><div id="needs-revision-list"></div></section><section><h3>Mastered</h3><div id="mastered-list"></div></section></div><div id="revision-session" class="revision-session" aria-live="polite" hidden></div></section>
		<section class="surface insights-panel study-next-panel"><div class="insights-panel-heading"><div><span class="eyebrow">PERSONALIZED DIRECTION</span><h2>What should I study next?</h2><p>Uses your profile, weak topics, completed topics, and exam date.</p></div><button id="study-next-button" class="button button--primary" type="button">Recommend a next step <span aria-hidden="true">→</span></button></div><div id="study-next-result" class="study-next-result" aria-live="polite"></div></section>
		<section class="surface insights-panel badges-panel"><div class="insights-panel-heading"><div><span class="eyebrow">MILESTONES</span><h2>Achievements</h2></div><span class="xp-level">LEVEL ${metrics.level} · ${metrics.xp} XP</span></div><div class="insights-badges">${getBadgeDefinitions().map((badge) => `<article class="achievement-item ${badges.has(badge.id) ? "is-unlocked" : "is-locked"}"><span class="achievement-mark" aria-hidden="true">${badges.has(badge.id) ? "✦" : "◇"}</span><span><strong>${escapeHTML(badge.name)}</strong><small>${badges.has(badge.id) ? "Unlocked" : "Locked · keep learning"}</small></span></article>`).join("")}</div></section>`;

	renderTopicAnalysis(container.querySelector("#weak-topic-analysis"), analytics);
	renderRevisionBuckets(container);
	container.querySelector(".revision-groups").addEventListener("click", (event) => {
		const button = event.target.closest("[data-start-revision]");
		if (!button) return;
		const topic = get("topics").find((item) => item.id === button.dataset.startRevision);
		if (topic) startRevision(container, topic);
	});
	container.querySelector("#study-next-button").addEventListener("click", async (event) => {
		const button = event.currentTarget;
		const host = container.querySelector("#study-next-result");
		button.disabled = true;
		host.replaceChildren(skeleton(3));
		const weakest = analytics.topics.slice(0, 5).map((item) => ({ subject: item.subject, topic: item.topic, percentage: item.percentage, classification: item.classification }));
		const schema = { type: "OBJECT", properties: { activity: { type: "STRING" }, reason: { type: "STRING" }, estimatedMinutes: { type: "INTEGER" }, actionLink: { type: "STRING" } }, required: ["activity", "reason", "estimatedMinutes", "actionLink"] };
		const fallbackTopic = analytics.topics[0] || topicList[0];
		const fallbackLink = fallbackTopic ? practiceLink(fallbackTopic.subject, fallbackTopic.topic) : "#/practice";
		const data = await askJSON({
			task: "Recommend one realistic next study activity. Use the student's exam date and weak/completed topics. Keep the reason specific and the time estimate between 5 and 90 minutes. Return only a local in-app action link.",
			context: `Profile: ${JSON.stringify(get("profile"))}\nWeak topics: ${JSON.stringify(weakest)}\nCompleted topics: ${JSON.stringify(completedTopics)}\nExam date: ${get("profile").examDate || "Not set"}`,
			demoType: "insights-study-next",
			responseSchema: schema,
			outputFormat: "Return JSON shaped as {activity:string,reason:string,estimatedMinutes:integer,actionLink:string}."
		}, (value) => typeof value?.activity === "string" && value.activity.trim() && typeof value.reason === "string" && value.reason.trim() && Number.isInteger(value.estimatedMinutes) && value.estimatedMinutes > 0 && typeof value.actionLink === "string");
		const action = document.createElement("a");
		action.className = "button button--primary";
		action.href = safeActionLink(data.actionLink, fallbackLink);
		action.textContent = "Open suggested activity →";
		host.replaceChildren();
		const body = document.createElement("div");
		body.className = "study-next-copy";
		const title = document.createElement("h3");
		title.textContent = data.activity;
		const reason = document.createElement("p");
		reason.textContent = data.reason;
		const duration = document.createElement("span");
		duration.className = "study-estimate";
		duration.textContent = `${Math.min(90, Math.max(5, data.estimatedMinutes))} min`;
		body.append(title, reason, duration);
		host.append(body, action, aiFooter());
		button.disabled = false;
	});
}