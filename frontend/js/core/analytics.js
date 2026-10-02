import { get, set } from "./storage.js";

export function completedQuizzes() {
  return get("quizHistory").filter((quiz) => quiz.status !== "in-progress" && Number(quiz.total) > 0);
}

function classification(percentage) {
  if (percentage >= 75) return "Strong";
  if (percentage >= 50) return "Needs Practice";
  return "Weak";
}

export function aggregateQuizPerformance() {
  const topics = new Map();
  const subjects = new Map();
  for (const quiz of completedQuizzes()) {
    const subject = String(quiz.subject || "General");
    const topic = String(quiz.topic || "Untitled topic");
    const key = `${subject.toLowerCase()}\u0000${topic.toLowerCase()}`;
    if (!topics.has(key)) topics.set(key, { subject, topic, correct: 0, total: 0, subtopics: new Map(), lastAttempt: quiz.date });
    const group = topics.get(key);
    const questions = Array.isArray(quiz.questions) ? quiz.questions : [];
    if (questions.length) {
      for (const question of questions) {
        const isCorrect = question.chosenIndex === question.correctIndex;
        group.total += 1;
        group.correct += Number(isCorrect);
        const subtopic = String(question.subtopic || "General review");
        if (!group.subtopics.has(subtopic)) group.subtopics.set(subtopic, { name: subtopic, correct: 0, total: 0 });
        const subtopicGroup = group.subtopics.get(subtopic);
        subtopicGroup.total += 1;
        subtopicGroup.correct += Number(isCorrect);
      }
    } else {
      group.correct += Number(quiz.score) || 0;
      group.total += Number(quiz.total) || 0;
    }
    if (new Date(quiz.date || 0) > new Date(group.lastAttempt || 0)) group.lastAttempt = quiz.date;

    if (!subjects.has(subject)) subjects.set(subject, { subject, correct: 0, total: 0 });
    const subjectGroup = subjects.get(subject);
    subjectGroup.correct += Number(quiz.score) || 0;
    subjectGroup.total += Number(quiz.total) || 0;
  }

  const topicRows = [...topics.values()].map((group) => {
    const percentage = group.total ? Math.round(group.correct / group.total * 100) : 0;
    const subtopics = [...group.subtopics.values()].map((item) => {
      const rate = item.total ? Math.round(item.correct / item.total * 100) : 0;
      return { ...item, percentage: rate, classification: classification(rate) };
    }).sort((a, b) => a.percentage - b.percentage);
    return { ...group, percentage, classification: classification(percentage), subtopics };
  }).sort((a, b) => a.percentage - b.percentage || a.topic.localeCompare(b.topic));
  const subjectRows = [...subjects.values()].map((group) => ({
    ...group,
    percentage: group.total ? Math.round(group.correct / group.total * 100) : 0
  })).sort((a, b) => a.percentage - b.percentage);
  const weakSubtopics = topicRows.flatMap((topic) => topic.subtopics
    .filter((subtopic) => subtopic.percentage < 75)
    .map((subtopic) => ({ subject: topic.subject, topic: topic.topic, ...subtopic })));
  return { topics: topicRows, subjects: subjectRows, weakSubtopics };
}

export function getProgressMetrics() {
  const quizzes = completedQuizzes();
  const totalQuestions = quizzes.reduce((sum, quiz) => sum + (Number(quiz.total) || 0), 0);
  const totalCorrect = quizzes.reduce((sum, quiz) => sum + (Number(quiz.score) || 0), 0);
  const fallbackQuizMinutes = Math.round(quizzes.reduce((sum, quiz) => sum + (Number(quiz.timeSpentSec) || 0), 0) / 60);
  const gamification = get("gamification");
  return {
    topicsStudied: get("topics").length,
    quizAttempts: quizzes.length,
    averageScore: totalQuestions ? Math.round(totalCorrect / totalQuestions * 100) : 0,
    studyMinutes: Number(gamification.studyMinutes) || fallbackQuizMinutes,
    streak: Number(gamification.streak) || 0,
    xp: Number(gamification.xp) || 0,
    level: Number(gamification.level) || 1,
    totalQuestions,
    totalCorrect
  };
}

export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function getRevisionGroups(now = new Date()) {
  const today = localDateKey(now);
  const topics = get("topics");
  const mastered = [];
  const dueToday = [];
  const needsRevision = [];
  const upcoming = [];
  for (const topic of topics) {
    const box = Math.max(1, Math.min(5, Number(topic.leitnerBox) || 1));
    const reviewDate = topic.nextReviewAt ? new Date(topic.nextReviewAt) : null;
    const reviewKey = reviewDate && !Number.isNaN(reviewDate.valueOf()) ? localDateKey(reviewDate) : today;
    const item = { ...topic, leitnerBox: box, nextReviewKey: reviewKey };
    if (box === 5 && Number(topic.mastery) >= 75) mastered.push(item);
    else if (reviewKey < today) needsRevision.push(item);
    else if (reviewKey === today) dueToday.push(item);
    else upcoming.push(item);
  }
  return { dueToday, needsRevision, mastered, upcoming };
}

export function updateLeitnerTopic(topicId, correctCount, total = 5, now = new Date()) {
  const topics = get("topics");
  const topic = topics.find((item) => item.id === topicId);
  if (!topic) return null;
  const box = Math.max(1, Math.min(5, Number(topic.leitnerBox) || 1));
  const percentage = total ? correctCount / total : 0;
  const nextBox = percentage >= 0.8 ? Math.min(5, box + 1) : Math.max(1, box - 1);
  const intervals = [1, 2, 4, 7, 14];
  const nextReview = new Date(now);
  nextReview.setDate(nextReview.getDate() + intervals[nextBox - 1]);
  const updated = {
    ...topic,
    leitnerBox: nextBox,
    mastery: Math.round(Math.max(0, Math.min(100, Number(topic.mastery || 0) * 0.6 + percentage * 100 * 0.4))),
    studiedAt: now.toISOString(),
    nextReviewAt: nextReview.toISOString()
  };
  set("topics", topics.map((item) => item.id === topicId ? updated : item));
  return { topic: updated, correctCount, total, nextBox, intervalDays: intervals[nextBox - 1] };
}

export function activityByDate(days = 7, now = new Date()) {
  const result = new Map();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setDate(date.getDate() - offset);
    result.set(localDateKey(date), 0);
  }
  for (const item of get("activity")) {
    const date = new Date(item.ts);
    if (Number.isNaN(date.valueOf())) continue;
    const key = localDateKey(date);
    if (result.has(key)) result.set(key, result.get(key) + 1);
  }
  return [...result.entries()].map(([date, count]) => ({ date, count }));
}

export function scoreTrend(limit = 7) {
  return completedQuizzes().slice().sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-limit).map((quiz) => ({
    date: quiz.date,
    label: quiz.topic,
    percentage: quiz.total ? Math.round(quiz.score / quiz.total * 100) : 0
  }));
}
