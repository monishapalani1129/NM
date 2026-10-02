import { get, set } from "../core/storage.js";
import { askJSON } from "../core/gemini.js";
import { addXP, updateStreak } from "../core/gamification.js";
import { localDateKey } from "../core/analytics.js";
import { modal, skeleton, toast } from "../core/ui.js";

let selectedPlanId = null;
let pomodoroInterval = null;
let pomodoro = { seconds: 25 * 60, isBreak: false, running: false };

function makeId() {
	return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function escapeHTML(value) {
	const element = document.createElement("span");
	element.textContent = String(value ?? "");
	return element.innerHTML;
}

function localDate(date) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(dateString, days) {
	const date = new Date(`${dateString}T12:00:00`);
	date.setDate(date.getDate() + days);
	return localDate(date);
}

function parseSubjectTopics(raw, fallbackSubject) {
	return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
		const divider = line.indexOf(":");
		const subject = divider >= 0 ? line.slice(0, divider).trim() : fallbackSubject;
		const topicText = divider >= 0 ? line.slice(divider + 1) : line;
		return { subject: subject || fallbackSubject || "General", topics: topicText.split(/[;,]/).map((topic) => topic.trim()).filter(Boolean) };
	}).filter((item) => item.topics.length);
}

function planIsValid(plan, input) {
	if (typeof plan?.planTitle !== "string" || !plan.planTitle.trim() || !Array.isArray(plan.days) || !plan.days.length) return false;
	const today = localDate(new Date());
	const examDate = input.examDate;
	const expectedDays = Math.round((new Date(`${examDate}T12:00:00`) - new Date(`${today}T12:00:00`)) / 86400000) + 1;
	if (expectedDays < 1 || plan.days.length !== expectedDays) return false;
	const totals = new Map();
	const seenDates = new Set();
	for (const day of plan.days) {
		if (typeof day.date !== "string" || day.date < today || day.date > examDate) return false;
		if (!Number.isFinite(Date.parse(`${day.date}T12:00:00`))) return false;
		if (typeof day.subject !== "string" || !day.subject.trim() || typeof day.topic !== "string" || !day.topic.trim()) return false;
		if (!Number.isInteger(day.minutes) || day.minutes < 1 || day.minutes > input.dailyMinutes) return false;
		if (typeof day.done !== "boolean") return false;
		totals.set(day.date, (totals.get(day.date) || 0) + day.minutes);
		seenDates.add(day.date);
	}
	if (seenDates.size !== expectedDays || [...totals.values()].some((minutes) => minutes > input.dailyMinutes)) return false;
	const endWindow = plan.days.filter((day) => day.date >= addDays(examDate, -2));
	return endWindow.some((day) => /revision/i.test(`${day.subject} ${day.topic}`))
		&& endWindow.some((day) => /quiz|test/i.test(`${day.subject} ${day.topic}`));
}

function persistPlan(plan) {
	const plans = get("plans");
	const index = plans.findIndex((item) => item.id === plan.id);
	if (index < 0) plans.unshift(plan);
	else plans[index] = plan;
	set("plans", plans);
	selectedPlanId = plan.id;
}

function selectedPlan() {
	const plans = get("plans");
	return plans.find((plan) => plan.id === selectedPlanId) || plans[0] || null;
}

function updatePlanSelect(root) {
	const select = root.querySelector("#saved-plan-select");
	const plans = get("plans");
	if (!select) {
		selectedPlanId = null;
		return;
	}
	select.replaceChildren(...plans.map((plan) => new Option(plan.title || "Study plan", plan.id)));
	if (selectedPlanId && plans.some((plan) => plan.id === selectedPlanId)) select.value = selectedPlanId;
	else {
		selectedPlanId = plans[0]?.id || null;
		if (selectedPlanId) select.value = selectedPlanId;
	}
}

function missedDays(plan) {
	const today = localDate(new Date());
	return plan.days.filter((day) => day.date < today && !day.done);
}

function dayKind(day) {
	if (/revision/i.test(`${day.subject} ${day.topic}`)) return "Revision";
	if (/quiz|test/i.test(`${day.subject} ${day.topic}`)) return "Quiz";
	return "Study";
}

function renderPlanDetails(root, plan) {
	const host = root.querySelector("#plan-details");
	host.replaceChildren();
	if (!plan) {
		host.innerHTML = `<div class="planner-empty surface"><span class="eyebrow">YOUR STUDY PLAN</span><h2>No saved plan yet.</h2><p>Add your subjects and exam date to build a day-by-day schedule.</p><button class="button button--primary" type="button" data-focus-plan-form>Build my plan</button></div>`;
		host.querySelector("[data-focus-plan-form]").addEventListener("click", () => root.querySelector("#plan-subjects").focus());
		return;
	}
	const complete = plan.days.filter((day) => day.done).length;
	const percentage = plan.days.length ? Math.round(complete / plan.days.length * 100) : 0;
	const missed = missedDays(plan);
	const header = document.createElement("section");
	header.className = "surface plan-summary";
	header.innerHTML = `<div class="plan-summary-main"><span class="eyebrow">SAVED STUDY PLAN</span><h2></h2><p class="plan-summary-meta"></p></div><div class="plan-summary-actions"><button id="reset-plan" class="button button--secondary" type="button">Reset progress</button><button id="delete-plan" class="button button--danger" type="button">Delete plan</button></div><div class="plan-progress-row"><div class="plan-progress-track" role="progressbar" aria-label="Plan completion" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percentage}"><span style="width:${percentage}%"></span></div><strong>${complete}/${plan.days.length} days · ${percentage}%</strong></div>`;
	header.querySelector("h2").textContent = plan.title;
	header.querySelector(".plan-summary-meta").textContent = `Exam date ${new Date(`${plan.examDate}T12:00:00`).toLocaleDateString()} · ${plan.dailyMinutes} min per day`;
	host.append(header);
	header.querySelector("#reset-plan").addEventListener("click", () => {
		if (!plan.days.some((day) => day.done)) return toast("This plan has no completed days to reset.", "info");
		if (!window.confirm("Reset completed days in this plan?")) return;
		plan.days = plan.days.map((day) => ({ ...day, done: false }));
		persistPlan(plan);
		renderPlanDetails(root, plan);
		toast("Plan progress reset.", "success");
	});
	header.querySelector("#delete-plan").addEventListener("click", () => {
		if (!window.confirm(`Delete “${plan.title}”?`)) return;
		set("plans", get("plans").filter((item) => item.id !== plan.id));
		selectedPlanId = null;
		renderPlanLibrary(root);
		renderPlanDetails(root, selectedPlan());
		toast("Plan deleted.", "success");
	});
	if (missed.length) {
		const reschedule = document.createElement("button");
		reschedule.id = "redistribute-missed";
		reschedule.type = "button";
		reschedule.className = "button button--violet redistribute-button";
		reschedule.textContent = `Redistribute ${missed.length} missed day${missed.length === 1 ? "" : "s"}`;
		reschedule.addEventListener("click", () => redistributeMissed(root, plan));
		host.append(reschedule);
	}
	const list = document.createElement("div");
	list.className = "planner-day-list";
	plan.days.forEach((day, index) => {
		const row = document.createElement("article");
		row.className = `planner-day-row surface ${day.done ? "is-complete" : ""}${day.date < localDate(new Date()) && !day.done ? " is-missed" : ""}`;
		row.dataset.planDay = String(index);
		row.innerHTML = `<div class="planner-day-date"><span class="day-kind"></span><strong></strong><small></small></div><div class="planner-day-content"><strong class="planner-day-topic"></strong><small class="planner-day-subject"></small></div><span class="planner-day-minutes"></span><div class="planner-day-actions"><button class="day-complete-toggle" type="button" data-plan-day-action="complete" aria-pressed="${Boolean(day.done)}" aria-label="${day.done ? "Mark incomplete" : "Mark complete"}">${day.done ? "✓" : "○"}</button><button class="quiet-button" type="button" data-plan-day-action="edit">Edit</button><button class="quiet-button" type="button" data-plan-day-action="move" ${day.date >= plan.examDate ? "disabled title=\"Already on the exam date\"" : ""}>Move to tomorrow</button></div>`;
		row.querySelector(".day-kind").textContent = dayKind(day);
		row.querySelector(".planner-day-date strong").textContent = new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
		row.querySelector(".planner-day-date small").textContent = day.date === localDate(new Date()) ? "Today" : day.date < localDate(new Date()) ? "Missed" : "Scheduled";
		row.querySelector(".planner-day-topic").textContent = day.topic;
		row.querySelector(".planner-day-subject").textContent = day.subject;
		row.querySelector(".planner-day-minutes").textContent = `${day.minutes} min`;
		row.querySelectorAll("[data-plan-day-action]").forEach((button) => button.addEventListener("click", () => {
			const action = button.dataset.planDayAction;
			if (action === "complete") togglePlanDay(root, plan, index);
			if (action === "edit") editPlanDay(root, plan, index);
			if (action === "move") movePlanDay(root, plan, index);
		}));
		list.append(row);
	});
	host.append(list);
}

function togglePlanDay(root, plan, index) {
	const day = plan.days[index];
	day.done = !day.done;
	persistPlan(plan);
	if (day.done) {
		const activity = get("activity");
		const activityId = `plan-day:${plan.id}:${index}`;
		if (!activity.some((item) => item.id === activityId)) {
			activity.unshift({ id: activityId, type: "study-plan-completed", label: `Completed ${day.topic}`, ts: new Date().toISOString() });
			set("activity", activity.slice(0, 100));
			const result = addXP(10, `Completed ${day.topic}`);
			result.badgesUnlocked?.forEach((badge) => toast(`Badge earned: ${badge.name}`, "success"));
		}
	}
	renderPlanDetails(root, plan);
	toast(day.done ? "Study day complete. XP and streak updated." : "Study day marked incomplete.", "success");
}

function editPlanDay(root, plan, index) {
	const day = plan.days[index];
	const form = document.createElement("form");
	form.className = "edit-plan-day-form form-grid";
	form.innerHTML = `<label class="field"><span>Date</span><input name="date" type="date" required min="${localDate(new Date())}" max="${plan.examDate}"></label><label class="field"><span>Minutes</span><input name="minutes" type="number" min="1" max="${plan.dailyMinutes}" step="1" required></label><label class="field field--wide"><span>Subject</span><input name="subject" maxlength="100" required></label><label class="field field--wide"><span>Topic</span><input name="topic" maxlength="160" required></label><button class="button button--primary field--wide" type="submit">Save day</button>`;
	for (const key of ["date", "minutes", "subject"]) form.elements[key].value = day[key];
	form.elements.topic.value = day.topic;
	const dialog = modal({ title: "Edit study day", content: form });
	form.addEventListener("submit", (event) => {
		event.preventDefault();
		if (!form.reportValidity()) return;
		const values = Object.fromEntries(new FormData(form));
		const totalForDate = plan.days.reduce((sum, item, itemIndex) => sum + (item.date === values.date && itemIndex !== index ? item.minutes : 0), 0);
		if (totalForDate + Number(values.minutes) > plan.dailyMinutes) return toast("That change would exceed your daily time limit.", "error");
		Object.assign(day, { date: values.date, minutes: Number(values.minutes), subject: values.subject.trim(), topic: values.topic.trim() });
		persistPlan(plan);
		dialog.close();
		renderPlanDetails(root, plan);
		toast("Study day updated.", "success");
	});
}

function movePlanDay(root, plan, index) {
	const day = plan.days[index];
	const tomorrow = addDays(day.date, 1);
	if (tomorrow > plan.examDate) return toast("This day cannot move past the exam date.", "error");
	const scheduledMinutes = plan.days.reduce((sum, item, itemIndex) => sum + (item.date === tomorrow && itemIndex !== index ? item.minutes : 0), 0);
	if (scheduledMinutes + day.minutes > plan.dailyMinutes) return toast("Tomorrow is already at your daily time limit. Edit a day or redistribute missed topics.", "error");
	day.date = tomorrow;
	persistPlan(plan);
	renderPlanDetails(root, plan);
	toast("Study day moved to tomorrow.", "success");
}

function redistributeMissed(root, plan) {
	const today = localDate(new Date());
	const completed = plan.days.filter((day) => day.done);
	const tasks = plan.days.filter((day) => !day.done).map((day) => ({ ...day, done: false }));
	const usage = new Map();
	completed.forEach((day) => usage.set(day.date, (usage.get(day.date) || 0) + day.minutes));
	const dates = [];
	for (let date = today; date <= plan.examDate; date = addDays(date, 1)) dates.push(date);
	const redistributed = [];
	for (const task of tasks) {
		const date = dates.find((candidate) => (usage.get(candidate) || 0) + task.minutes <= plan.dailyMinutes);
		if (!date) return toast("There is not enough time before the exam to fit every remaining topic within your daily limit.", "error");
		usage.set(date, (usage.get(date) || 0) + task.minutes);
		redistributed.push({ ...task, date });
	}
	plan.days = [...completed, ...redistributed].sort((a, b) => a.date.localeCompare(b.date));
	persistPlan(plan);
	renderPlanDetails(root, plan);
	toast("Missed topics redistributed across the remaining days.", "success");
}

function renderPlanLibrary(root) {
	const host = root.querySelector("#planner-saved-plans");
	const plans = get("plans");
	host.replaceChildren();
	if (!plans.length) {
		host.innerHTML = `<span class="planner-library-empty">Plans you save will appear here.</span>`;
	} else {
		const select = document.createElement("select");
		select.id = "saved-plan-select";
		select.setAttribute("aria-label", "Saved plans");
		select.replaceChildren(...plans.map((plan) => new Option(`${plan.title} · ${plan.days.filter((day) => day.done).length}/${plan.days.length}`, plan.id)));
		select.value = selectedPlanId || plans[0].id;
		selectedPlanId = select.value;
		select.addEventListener("change", () => {
			selectedPlanId = select.value;
			renderPlanDetails(root, selectedPlan());
		});
		host.append(select);
	}
	updatePlanSelect(root);
}

function renderPomodoro(root) {
	const minutes = Math.floor(pomodoro.seconds / 60).toString().padStart(2, "0");
	const seconds = (pomodoro.seconds % 60).toString().padStart(2, "0");
	root.querySelector("#pomodoro-time").textContent = `${minutes}:${seconds}`;
	root.querySelector("#pomodoro-phase").textContent = pomodoro.isBreak ? "SHORT BREAK · 5 MIN" : "FOCUS SESSION · 25 MIN";
	root.querySelector("#pomodoro-toggle").textContent = pomodoro.running ? "Pause" : pomodoro.seconds === (pomodoro.isBreak ? 300 : 1500) ? "Start focus" : "Resume";
}

function startPomodoro(root) {
	if (pomodoro.running) {
		clearInterval(pomodoroInterval);
		pomodoroInterval = null;
		pomodoro.running = false;
		renderPomodoro(root);
		return;
	}
	pomodoro.running = true;
	renderPomodoro(root);
	pomodoroInterval = window.setInterval(() => {
		pomodoro.seconds -= 1;
		if (pomodoro.seconds <= 0) {
			clearInterval(pomodoroInterval);
			pomodoroInterval = null;
			pomodoro.running = false;
			if (!pomodoro.isBreak) {
				const gamification = get("gamification");
				set("gamification", { ...gamification, studyMinutes: gamification.studyMinutes + 25 });
				updateStreak();
				const activity = get("activity");
				activity.unshift({ id: makeId(), type: "pomodoro-completed", label: "Completed a 25-minute focus session", ts: new Date().toISOString() });
				set("activity", activity.slice(0, 100));
				toast("Focus session complete. 25 study minutes added.", "success");
				pomodoro.isBreak = true;
				pomodoro.seconds = 5 * 60;
			} else {
				pomodoro.isBreak = false;
				pomodoro.seconds = 25 * 60;
				toast("Break complete. Ready for another focus session?", "success");
			}
		}
		renderPomodoro(root);
	}, 1000);
}

function createPlanPrompt(input) {
	const schema = {
		type: "OBJECT",
		properties: {
			planTitle: { type: "STRING" },
			days: { type: "ARRAY", items: { type: "OBJECT", properties: { date: { type: "STRING" }, subject: { type: "STRING" }, topic: { type: "STRING" }, minutes: { type: "INTEGER" }, done: { type: "BOOLEAN" } }, required: ["date", "subject", "topic", "minutes", "done"] } }
		},
		required: ["planTitle", "days"]
	};
	return { schema };
}

export function render(container) {
	const requestedPlanId = new URLSearchParams(window.location.hash.split("?")[1] || "").get("plan");
	const savedPlans = get("plans");
	selectedPlanId = savedPlans.find((plan) => plan.id === requestedPlanId)?.id || savedPlans[0]?.id || null;
	const today = localDate(new Date());
	const profile = get("profile");
	container.innerHTML = `<section class="page-heading planner-heading"><span class="eyebrow">YOUR STUDY RHYTHM</span><h1>Planner</h1><p>Turn your subjects and exam date into a practical day-by-day plan.</p></section><div class="planner-layout"><section class="surface planner-builder"><div class="planner-section-heading"><span class="eyebrow">PLAN AHEAD</span><h2>Build an exam plan</h2><p>Add one subject per line. Separate its topics with commas.</p></div><form id="planner-form" class="planner-form"><label class="field field--wide"><span>Subjects and topics</span><textarea id="plan-subjects" name="subjects" rows="5" required placeholder="Biology: Cell structure, Genetics&#10;Computer Science: Recursion, Graphs"></textarea></label><label class="field"><span>Exam date</span><input name="examDate" type="date" min="${today}" value="${profile.examDate && profile.examDate >= today ? profile.examDate : ""}" required></label><label class="field"><span>Daily study hours</span><input name="dailyHours" type="number" min="0.5" max="16" step="0.5" value="${Math.max(0.5, (Number(profile.dailyMinutes) || 60) / 60)}" required></label><label class="field"><span>Plan difficulty</span><select name="difficulty"><option value="light">Light</option><option value="balanced" selected>Balanced</option><option value="intensive">Intensive</option></select></label><label class="field"><span>Current level</span><select name="level"><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label><button class="button button--primary field--wide" type="submit">Generate study plan <span aria-hidden="true">→</span></button><p class="planner-form-status field--wide" aria-live="polite"></p></form></section><section class="surface pomodoro-panel"><span class="eyebrow">FOCUS TIMER</span><h2>Pomodoro</h2><p>25 minutes focus · 5 minutes break</p><strong id="pomodoro-time" class="pomodoro-time" role="timer" aria-live="off">25:00</strong><span id="pomodoro-phase" class="pomodoro-phase">FOCUS SESSION · 25 MIN</span><div class="pomodoro-actions"><button id="pomodoro-toggle" class="button button--primary" type="button">Start focus</button><button id="pomodoro-reset" class="button button--secondary" type="button">Reset</button></div></section></div><section class="planner-saved-section"><div class="planner-saved-heading"><div><span class="eyebrow">YOUR PLANS</span><h2>Saved plans</h2></div><div id="planner-saved-plans" class="planner-plan-picker"></div></div><div id="plan-details" class="plan-details"></div></section>`;
	container.querySelector("#planner-form").elements.level.value = profile.level || "beginner";
}

export function init() {
	const root = document.querySelector("#page-content");
	const form = root.querySelector("#planner-form");
	const status = root.querySelector(".planner-form-status");
	const topicPlanSchema = createPlanPrompt({}).schema;
	renderPlanLibrary(root);
	renderPlanDetails(root, selectedPlan());
	renderPomodoro(root);
	root.querySelector("#pomodoro-toggle").addEventListener("click", () => startPomodoro(root));
	root.querySelector("#pomodoro-reset").addEventListener("click", () => {
		if (pomodoroInterval) clearInterval(pomodoroInterval);
		pomodoroInterval = null;
		pomodoro = { seconds: 25 * 60, isBreak: false, running: false };
		renderPomodoro(root);
	});
	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		if (!form.reportValidity()) return;
		const values = Object.fromEntries(new FormData(form));
		const dailyMinutes = Math.round(Number(values.dailyHours) * 60);
		const today = localDate(new Date());
		if (values.examDate < today) {
			toast("Choose an exam date that is today or later.", "error");
			return;
		}
		const subjects = parseSubjectTopics(values.subjects, get("profile").course);
		if (!subjects.length) {
			toast("Add at least one subject and topic.", "error");
			return;
		}
		const input = { ...values, dailyMinutes, subjects, startDate: today, profile: get("profile") };
		const { schema } = createPlanPrompt(input);
		const submit = form.querySelector("button[type=submit]");
		submit.disabled = true;
		status.replaceChildren(skeleton(3));
		const planData = await askJSON({
			task: "Create a practical day-by-day study plan from today through the exam date. Cover the supplied subjects/topics, respect the daily minute cap, adapt to the student's current level and difficulty preference, and reserve revision plus quiz/test days near the end.",
			context: JSON.stringify(input),
			demoType: "planner-plan",
			responseSchema: schema,
			outputFormat: "Return JSON with planTitle:string and days:[{date:YYYY-MM-DD,subject:string,topic:string,minutes:integer,done:boolean}]. Include exactly one or more scheduled study tasks for every calendar date from today through the exam date. The final three days must include a revision task and a quiz/test task."
		}, (plan) => planIsValid(plan, input));
		if (!planIsValid(planData, input)) {
			status.textContent = "The returned plan did not fit the date or daily time limits. Try a shorter date range or a lighter difficulty.";
			submit.disabled = false;
			return;
		}
		const plan = { id: makeId(), title: planData.planTitle.trim(), examDate: values.examDate, createdAt: new Date().toISOString(), dailyMinutes, difficulty: values.difficulty, level: values.level, days: planData.days.map((day) => ({ ...day, done: false })) };
		persistPlan(plan);
		renderPlanLibrary(root);
		renderPlanDetails(root, plan);
		status.textContent = "Plan generated and saved.";
		toast("Your study plan is ready.", "success");
		submit.disabled = false;
	});
	if (!window.__edugeniePlannerRouteHandler) {
		window.addEventListener("hashchange", () => {
			if (window.location.hash.replace(/^#\/?/, "").split(/[/?]/)[0] !== "planner" && pomodoroInterval) {
				clearInterval(pomodoroInterval);
				pomodoroInterval = null;
				pomodoro.running = false;
			}
		});
		window.__edugeniePlannerRouteHandler = true;
	}
}