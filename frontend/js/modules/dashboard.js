import { get, set } from "../core/storage.js";
import { toast } from "../core/ui.js";
import { t } from "../core/i18n.js";
import { addXP, checkBadges, getBadgeDefinitions } from "../core/gamification.js";
import { aggregateQuizPerformance, getProgressMetrics, localDateKey } from "../core/analytics.js";
import { sampleLearningData } from "../core/demoData.js";
import { refreshRoute } from "../core/router.js";

function escapeHTML(value) {
  const element = document.createElement("span");
  element.textContent = String(value ?? "");
  return element.innerHTML;
}

function practiceLink(subject, topic) {
  return `#/practice?subject=${encodeURIComponent(subject)}&topic=${encodeURIComponent(topic)}`;
}

function hasAnyLearningData() {
  return ["topics", "quizHistory", "plans", "notes", "saved", "activity", "chatSessions"].some((key) => get(key).length > 0);
}

function getWeakTopics() {
  const analytics = aggregateQuizPerformance();
  if (analytics.topics.length) return analytics.topics.filter((item) => item.percentage < 75).slice(0, 4);
  return get("topics").filter((topic) => Number(topic.mastery) < 75).map((topic) => ({ ...topic, percentage: Number(topic.mastery) || 0, classification: Number(topic.mastery) < 50 ? "Weak" : "Needs Practice" })).slice(0, 4);
}

function todayPlanItems() {
  const today = localDateKey();
  return get("plans").flatMap((plan) => (plan.days || []).map((day, index) => ({ planId: plan.id, day, index })))
    .filter((item) => item.day.date === today);
}

function badgeCards() {
  const earned = new Set(get("gamification").badges || []);
  return getBadgeDefinitions().map((badge) => `<article class="achievement-item ${earned.has(badge.id) ? "is-unlocked" : "is-locked"}"><span class="achievement-mark" aria-hidden="true">${earned.has(badge.id) ? "✦" : "◇"}</span><span><strong>${escapeHTML(badge.name)}</strong><small>${earned.has(badge.id) ? "Unlocked" : "Keep learning to unlock"}</small></span></article>`).join("");
}

function topicRows(topics) {
  if (!topics.length) return `<div class="dashboard-empty"><p>No weak topics identified yet. Complete a quiz to see where to focus.</p><a class="text-link" href="#/practice">Start a quiz →</a></div>`;
  return topics.map((topic) => `<a class="weak-topic-row" href="${practiceLink(topic.subject, topic.topic)}"><span><strong>${escapeHTML(topic.topic)}</strong><small>${escapeHTML(topic.subject)}</small></span><span class="weak-topic-score"><b>${topic.percentage}%</b><small>${escapeHTML(topic.classification)}</small></span><span class="text-link" aria-hidden="true">→</span></a>`).join("");
}

function planRows(items) {
  if (!items.length) return `<div class="dashboard-empty"><p>Your day is open. Pick one topic and make a small plan.</p><a class="text-link" href="#/planner">Open planner →</a></div>`;
  return items.slice(0, 5).map(({ planId, day, index }) => `<article class="today-plan-row ${day.done ? "is-done" : ""}"><button class="plan-check" type="button" data-plan-toggle="${escapeHTML(planId)}" data-day-index="${index}" aria-pressed="${Boolean(day.done)}" aria-label="${day.done ? "Mark incomplete" : "Mark complete"}: ${escapeHTML(day.topic)}">${day.done ? "✓" : ""}</button><span><strong>${escapeHTML(day.topic)}</strong><small>${escapeHTML(day.subject)} · ${day.minutes} min</small></span><a class="text-link" href="${practiceLink(day.subject, day.topic)}">Study →</a></article>`).join("");
}

function recentQuizRows(quizzes) {
  if (!quizzes.length) return `<div class="dashboard-empty"><p>Your completed quizzes will show here.</p><a class="text-link" href="#/practice">Try Practice →</a></div>`;
  return quizzes.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 4).map((quiz) => `<a class="recent-quiz-row" href="${practiceLink(quiz.subject, quiz.topic)}"><span><strong>${escapeHTML(quiz.topic)}</strong><small>${escapeHTML(quiz.subject)} · ${new Date(quiz.date).toLocaleDateString()}</small></span><b>${quiz.score}/${quiz.total}</b></a>`).join("");
}

export function render(container) {
  checkBadges();
  const profile = get("profile");
  const settings = get("settings");
  const metrics = getProgressMetrics();
  const weakTopics = getWeakTopics();
  const topics = get("topics").slice().sort((a, b) => new Date(b.studiedAt || 0) - new Date(a.studiedAt || 0));
  const mostRecentTopic = topics[0];
  const todayItems = todayPlanItems();
  const recentQuizzes = get("quizHistory").filter((quiz) => quiz.status !== "in-progress");
  const noData = !hasAnyLearningData();
  const recommended = weakTopics[0] || topics.find((topic) => Number(topic.mastery) < 75);
  const stats = [
    ["Topics Studied", metrics.topicsStudied, "TOPICS"],
    ["Quizzes", metrics.quizAttempts, "ATTEMPTS"],
    ["Avg Score", `${metrics.averageScore}%`, "ACCURACY"],
    ["Study Time", `${metrics.studyMinutes}m`, "TOTAL"],
    ["Streak", `${metrics.streak}d`, "CURRENT"]
  ];
  container.innerHTML = `
    <section class="welcome-row"><div><span class="eyebrow">YOUR LEARNING DESK</span><h1>Hi, ${escapeHTML(profile.name || "Learner")} 👋</h1><p>${t("greeting")}</p></div><a class="button button--primary" href="#/learn">${t("start")} <span aria-hidden="true">→</span></a></section>
    ${noData ? `<section class="sample-data-offer surface"><span class="sample-data-mark">SAMPLE DATA</span><div><h2>Your learning desk is ready.</h2><p>Explore the dashboard and Insights with a clearly labelled sample learning history.</p></div><button id="load-sample-data" class="button button--primary" type="button">Load sample data</button></section>` : ""}
    <section class="dashboard-stats" aria-label="Learning statistics">${stats.map(([label, value, hint]) => `<article class="surface dashboard-stat"><span>${escapeHTML(label)}</span><strong>${value}</strong><small>${escapeHTML(hint)}</small></article>`).join("")}</section>
    <section class="dashboard-main-grid">
      <article class="surface dashboard-section continue-section"><div class="section-header"><div><span class="eyebrow">PICK UP WHERE YOU LEFT OFF</span><h2>Continue Learning</h2></div></div>${mostRecentTopic ? `<div class="continue-topic"><span class="continue-topic-symbol" aria-hidden="true">↗</span><div><strong>${escapeHTML(mostRecentTopic.topic)}</strong><p>${escapeHTML(mostRecentTopic.subject)} · ${mostRecentTopic.mastery || 0}% mastery</p></div><a class="button button--secondary" href="${practiceLink(mostRecentTopic.subject, mostRecentTopic.topic)}">Review topic</a></div>` : `<div class="dashboard-empty"><p>Your first topic is one good question away.</p><a class="text-link" href="#/learn">Open AI Tutor →</a></div>`}</article>
      <article class="surface dashboard-section recommendation-section"><span class="eyebrow">A GOOD NEXT STEP</span><h2>Recommended for You</h2>${recommended ? `<p>Give <strong>${escapeHTML(recommended.topic)}</strong> another focused review.</p><a class="button button--primary" href="${practiceLink(recommended.subject, recommended.topic)}">Practice this topic <span aria-hidden="true">→</span></a>` : `<p>Complete a quiz to get a recommendation based on your results.</p><a class="button button--secondary" href="#/practice">Start a quiz</a>`}</article>
      <article class="surface dashboard-section weak-section"><div class="section-header"><div><span class="eyebrow">BUILT FROM YOUR QUIZ RESULTS</span><h2>Weak Topics</h2></div><a class="text-link" href="#/insights">All insights →</a></div><div class="weak-topic-list">${topicRows(weakTopics)}</div></article>
      <article class="surface dashboard-section plan-section"><div class="section-header"><div><span class="eyebrow">TODAY</span><h2>Today's Study Plan</h2></div><a class="text-link" href="#/planner">Planner →</a></div><div class="today-plan-list">${planRows(todayItems)}</div></article>
      <article class="surface dashboard-section recent-quiz-section"><div class="section-header"><div><span class="eyebrow">YOUR RECENT RESULTS</span><h2>Recent Quiz Results</h2></div><a class="text-link" href="#/insights">View progress →</a></div><div class="recent-quiz-list">${recentQuizRows(recentQuizzes)}</div></article>
      <article class="surface dashboard-section achievement-section"><div class="section-header"><div><span class="eyebrow">KEEP YOUR MOMENTUM</span><h2>Achievements</h2></div><span class="xp-level">LVL ${metrics.level} · ${metrics.xp} XP</span></div><div class="achievement-list">${badgeCards()}</div></article>
    </section>
    <section class="dashboard-links"><a href="#/notes">Capture notes <span>↗</span></a><a href="#/learn">Explore a topic <span>↗</span></a><a href="#/insights">See your progress <span>↗</span></a></section>
    ${settings.usingSampleData ? `<span class="sample-data-inline">SAMPLE DATA · Reset in Profile to clear</span>` : ""}`;
}

export function init() {
  checkBadges();
  document.querySelector("#load-sample-data")?.addEventListener("click", () => {
    const data = sampleLearningData();
    for (const [key, value] of Object.entries(data)) set(key, value);
    const settings = get("settings");
    set("settings", { ...settings, usingSampleData: true });
    checkBadges();
    window.dispatchEvent(new CustomEvent("edugenie:data-changed"));
    toast("Sample learning history loaded.", "success");
    refreshRoute();
  });
  document.querySelector(".today-plan-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-plan-toggle]");
    if (!button) return;
    const plans = get("plans");
    const plan = plans.find((item) => item.id === button.dataset.planToggle);
    const day = plan?.days?.[Number(button.dataset.dayIndex)];
    if (!day) return;
    day.done = !day.done;
    set("plans", plans);
    button.setAttribute("aria-pressed", String(day.done));
    button.setAttribute("aria-label", `${day.done ? "Mark incomplete" : "Mark complete"}: ${day.topic}`);
    button.textContent = day.done ? "✓" : "";
    button.closest(".today-plan-row").classList.toggle("is-done", day.done);
    if (day.done) {
      const activity = get("activity");
      const activityKey = `plan:${plan.id}:${button.dataset.dayIndex}`;
      if (!activity.some((item) => item.type === "study-plan-completed" && item.label.startsWith(activityKey))) {
        activity.unshift({ id: crypto.randomUUID?.() || String(Date.now()), type: "study-plan-completed", label: `${activityKey} Completed ${day.topic}`, ts: new Date().toISOString() });
        set("activity", activity.slice(0, 100));
        const result = addXP(5, `Completed ${day.topic}`);
        result.badgesUnlocked?.forEach((badge) => toast(`Badge earned: ${badge.name}`, "success"));
      }
    }
    toast(day.done ? "Study plan updated." : "Study plan item reopened.", "success");
  });
}
