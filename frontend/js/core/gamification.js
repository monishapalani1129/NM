import { get, set } from "./storage.js";

const badgeRules = [
  { id: "three-day-learner", name: "3-Day Learner", unlocked: () => get("gamification").streak >= 3 },
  { id: "quiz-master", name: "Quiz Master", unlocked: () => get("quizHistory").some((quiz) => quiz.total > 0 && quiz.score / quiz.total >= 0.8) },
  { id: "topic-explorer", name: "Topic Explorer", unlocked: () => get("topics").length >= 5 },
  { id: "concept-crusher", name: "Concept Crusher", unlocked: () => get("activity").filter((item) => item.type === "concept-map-created").length >= 3 },
  { id: "revision-champion", name: "Revision Champion", unlocked: () => get("activity").filter((item) => item.type === "revision-completed").length >= 5 || get("quizHistory").filter((quiz) => quiz.mode === "mock").length >= 3 }
];

export function getBadgeDefinitions() {
  return badgeRules.map(({ id, name }) => ({ id, name }));
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function recordActivity(type, label) {
  const activity = get("activity");
  const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  activity.unshift({ id, type, label, ts: new Date().toISOString() });
  set("activity", activity.slice(0, 100));
}

export function updateStreak() {
  const gamification = get("gamification");
  const today = new Date();
  const todayKey = dateKey(today);
  if (gamification.lastActiveDate === todayKey) return gamification;
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const streak = gamification.lastActiveDate === dateKey(yesterday) ? gamification.streak + 1 : 1;
  const updated = { ...gamification, streak, lastActiveDate: todayKey };
  set("gamification", updated);
  return updated;
}

export function checkBadges() {
  const gamification = get("gamification");
  const existing = new Set(gamification.badges || []);
  const unlocked = badgeRules.filter((badge) => !existing.has(badge.id) && badge.unlocked());
  if (unlocked.length) {
    set("gamification", { ...get("gamification"), badges: [...existing, ...unlocked.map((badge) => badge.id)] });
    unlocked.forEach((badge) => recordActivity("badge-earned", `Badge earned: ${badge.name}`));
  }
  return unlocked.map(({ id, name }) => ({ id, name }));
}

export function addXP(amount, reason = "Learning progress") {
  const points = Math.max(0, Math.round(Number(amount) || 0));
  const current = updateStreak();
  const xp = current.xp + points;
  const updated = { ...current, xp, level: Math.floor(xp / 100) + 1 };
  set("gamification", updated);
  if (points) recordActivity("xp-earned", `+${points} XP · ${reason}`);
  const badges = checkBadges();
  return { ...get("gamification"), badgesUnlocked: badges };
}