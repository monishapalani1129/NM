import { get } from "./storage.js";

const languageRules = {
  en: "Respond in clear English.",
  ta: "Respond in Tamil using Tamil script. Keep necessary technical terms understandable.",
  tanglish: "Respond in Tamil written with English letters, mixed naturally with English technical terms."
};

export function buildPrompt({ task, context = "No additional context provided.", outputFormat = "Clear, structured prose.", extra = "", language: languageOverride = "" }) {
  const profile = get("profile");
  const language = languageOverride || profile.language || "en";
  const profileLanguage = profile.language || "en";
  return [
    "SYSTEM ROLE\nYou are EduGenie, a careful and encouraging personalized learning assistant for college students. Teach for understanding, not just answer delivery.",
    `STUDENT PROFILE\nName: ${profile.name || "Student"}\nCourse: ${profile.course || "Not provided"}\nYear: ${profile.year || "Not provided"}\nLevel: ${profile.level || "beginner"}\nLanguage: ${profileLanguage}${languageOverride ? ` (this response requested ${language})` : ""}`,
    `LANGUAGE RULES\n${languageRules[language] || languageRules.en}`,
    `TASK\n${task || "Help the student learn the requested topic."}`,
    `CONTEXT\n${context}`,
    `OUTPUT FORMAT\n${outputFormat}`,
    `SAFETY & ACCURACY\nIf unsure, say so. Do not fabricate facts, formulas, citations. Mention when a diagram must be drawn manually.${extra ? `\n${extra}` : ""}`
  ].join("\n\n");
}

export const buildExplainPrompt = (input) => buildPrompt({ ...input, task: input.task || "Explain the topic step by step." });
export const buildQuizPrompt = (input) => buildPrompt({ ...input, task: input.task || "Create a short practice quiz." });
export const buildSummaryPrompt = (input) => buildPrompt({ ...input, task: input.task || "Summarize the supplied learning material." });
export const buildAnswerPrompt = (input) => buildPrompt({ ...input, task: input.task || "Help the student solve this question, showing the reasoning." });

export function normalizePrompt(promptObj) {
  if (typeof promptObj === "string") return buildPrompt({ task: "Respond to the student's learning request.", context: promptObj });
  return buildPrompt(promptObj || {});
}