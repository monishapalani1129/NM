import { get, set } from "../core/storage.js";
import { askJSON } from "../core/gemini.js";
import { listen } from "../core/voice.js";
import { aiFooter, copyToClipboard, renderMarkdown, skeleton, toast } from "../core/ui.js";

function makeId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function saveExtra(title, type, content) {
  try {
    const saved = get("saved");
    saved.unshift({ id: makeId(), type, title, content, createdAt: new Date().toISOString() });
    set("saved", saved.slice(0, 100));
    toast("Saved to your library.", "success");
  } catch {
    toast("This item could not be saved. Check available browser storage.", "error");
  }
}

function attachSaveCopy(host, { title, type, content }) {
  const actions = document.createElement("div");
  actions.className = "extra-output-actions";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "button button--secondary";
  copy.textContent = "Copy";
  copy.addEventListener("click", async () => {
    try { await copyToClipboard(content); } catch { toast("Clipboard access is unavailable in this browser.", "error"); }
  });
  const save = document.createElement("button");
  save.type = "button";
  save.className = "button button--save";
  save.textContent = "Save";
  save.addEventListener("click", () => saveExtra(title, type, content));
  actions.append(copy, save);
  host.append(actions, aiFooter());
}

function showResultError(host, message) {
  host.replaceChildren();
  const state = document.createElement("div");
  state.className = "empty-state";
  const text = document.createElement("p");
  text.textContent = message;
  state.append(text);
  host.append(state);
  host.hidden = false;
}

function renderFields(host, title, fields, saveType) {
  host.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = title;
  const grid = document.createElement("div");
  grid.className = "extras-result-grid";
  const markdown = [];
  fields.forEach(([label, value]) => {
    const section = document.createElement("section");
    section.className = "extras-result-section";
    const sectionTitle = document.createElement("h4");
    sectionTitle.textContent = label;
    const text = Array.isArray(value) ? value.map((item) => `- ${item}`).join("\n") : String(value ?? "Not provided.");
    section.append(sectionTitle, renderMarkdown(text));
    grid.append(section);
    markdown.push(`## ${label}\n${Array.isArray(value) ? value.join("\n- ") : value}`);
  });
  host.append(heading, grid);
  attachSaveCopy(host, { title, type: saveType, content: markdown.join("\n\n") });
  host.hidden = false;
}

function isProject(value) {
  return ["title", "problemStatement", "solution", "difficulty"].every((key) => typeof value?.[key] === "string" && value[key].trim())
    && ["features", "techStack", "futureEnhancements"].every((key) => Array.isArray(value[key]) && value[key].length > 0 && value[key].every((item) => typeof item === "string"));
}

function safeLabValue(value) {
  if (Array.isArray(value)) return value.every(safeLabValue);
  if (value && typeof value === "object") return Object.values(value).every(safeLabValue);
  const text = String(value || "");
  return !/\b(?:drop\s+(?:database|table|schema)|truncate\s+(?:table\s+)?|delete\s+from|rm\s+-rf|format\s+[a-z]:|shutdown|wipe\s+(?:disk|drive)|del\s+\/f|rmdir\s+\/s|mkfs|diskpart|os\.remove|shutil\.rmtree|rmtree|unlink|remove-item)\b/i.test(text);
}

function isLab(value) {
  return ["aim", "question", "expectedConcept", "sampleInput", "sampleOutput"].every((key) => typeof value?.[key] === "string" && value[key].trim())
    && Array.isArray(value?.vivaQuestions) && value.vivaQuestions.length > 0 && value.vivaQuestions.every((item) => typeof item === "string" && item.trim())
    && Object.values(value).every(safeLabValue);
}

function isEnglishEvaluation(value) {
  return Array.isArray(value?.grammarCorrections) && value.grammarCorrections.every((item) => typeof item === "string")
    && Array.isArray(value?.vocabularySuggestions) && value.vocabularySuggestions.every((item) => typeof item === "string")
    && typeof value?.betterSentence === "string" && value.betterSentence.trim()
    && typeof value?.confidenceTip === "string" && value.confidenceTip.trim();
}

export function render(container) {
  container.innerHTML = `<section class="page-heading extras-heading"><span class="eyebrow">MORE WAYS TO LEARN</span><h1>Make something. Explain something.</h1><p>Explore an idea, prepare a safe lab exercise, or build confidence speaking English.</p></section><div class="extras-tabs" role="tablist" aria-label="Extras tools"><button class="extras-tab is-active" id="tab-project" type="button" role="tab" aria-selected="true" aria-controls="panel-project" data-extra-tab="project">Project Ideas</button><button class="extras-tab" id="tab-lab" type="button" role="tab" aria-selected="false" aria-controls="panel-lab" data-extra-tab="lab" tabindex="-1">Lab Questions</button><button class="extras-tab" id="tab-english" type="button" role="tab" aria-selected="false" aria-controls="panel-english" data-extra-tab="english" tabindex="-1">English Practice</button></div><section class="extras-panel is-active" id="panel-project" role="tabpanel" aria-labelledby="tab-project" data-extra-panel="project"><div class="surface extras-workspace"><div class="extras-intro"><span class="eyebrow">PROJECT IDEA GENERATOR</span><h2>Find a project worth building.</h2><p>Match an idea to a subject, an interest, and the skills you want to use.</p></div><form id="project-form" class="extras-form"><label class="field"><span>Subject</span><input name="subject" maxlength="100" required placeholder="e.g. Computer Science"></label><label class="field"><span>Interest</span><input name="interest" maxlength="160" required placeholder="e.g. campus sustainability"></label><label class="field"><span>Skill level</span><select name="level"><option value="beginner">Beginner</option><option value="intermediate" selected>Intermediate</option><option value="advanced">Advanced</option></select></label><button class="button button--primary" type="submit">Generate idea <span aria-hidden="true">→</span></button></form><div id="project-result" class="extras-result" aria-live="polite" hidden></div></div></section><section class="extras-panel" id="panel-lab" role="tabpanel" aria-labelledby="tab-lab" data-extra-panel="lab" hidden><div class="surface extras-workspace"><div class="extras-intro"><span class="eyebrow">LAB QUESTION GENERATOR</span><h2>Set up a safe, focused exercise.</h2><p>Get an aim, a practical question, expected concepts, sample I/O, and viva prompts. Destructive operations are excluded.</p></div><form id="lab-form" class="extras-form"><label class="field"><span>Lab subject</span><select name="subject"><option>DBMS</option><option>Python</option><option>Java</option><option>AI/ML</option><option>Web Dev</option><option>Data Structures</option></select></label><label class="field"><span>Topic or lab unit</span><input name="topic" maxlength="140" required placeholder="e.g. joins, lists, classification"></label><label class="field"><span>Skill level</span><select name="level"><option value="beginner">Beginner</option><option value="intermediate" selected>Intermediate</option><option value="advanced">Advanced</option></select></label><button class="button button--primary" type="submit">Generate lab question <span aria-hidden="true">→</span></button></form><div id="lab-result" class="extras-result" aria-live="polite" hidden></div></div></section><section class="extras-panel" id="panel-english" role="tabpanel" aria-labelledby="tab-english" data-extra-panel="english" hidden><div class="english-practice-surface"><div class="extras-intro"><span class="eyebrow">ENGLISH SPEAKING PRACTICE</span><h2>Say it your way. Grow it from there.</h2><p>Answer by typing or speaking. Feedback focuses on one useful improvement at a time.</p></div><form id="english-setup-form" class="extras-form"><label class="field"><span>Practice topic</span><input name="topic" maxlength="140" required placeholder="e.g. introduce your project"></label><label class="field"><span>Speaking level</span><select name="level"><option value="beginner">Beginner</option><option value="intermediate" selected>Intermediate</option><option value="advanced">Advanced</option></select></label><button class="button button--lime" type="submit">Ask me a question <span aria-hidden="true">→</span></button></form><div id="english-session" class="english-session" aria-live="polite"></div></div></section>`;
}

export function init() {
  const root = document.querySelector("#page-content");
  const tabs = [...root.querySelectorAll("[data-extra-tab]")];
  const panels = [...root.querySelectorAll("[data-extra-panel]")];
  const selectTab = (name) => {
    tabs.forEach((tab) => {
      const active = tab.dataset.extraTab === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    panels.forEach((panel) => { panel.hidden = panel.dataset.extraPanel !== name; });
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab.dataset.extraTab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].focus();
      selectTab(tabs[next].dataset.extraTab);
    });
  });

  root.querySelector("#project-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const button = event.currentTarget.querySelector("button[type=submit]");
    const host = root.querySelector("#project-result");
    button.disabled = true;
    host.hidden = false;
    host.replaceChildren(skeleton(5));
    const schema = { type: "OBJECT", properties: { title: { type: "STRING" }, problemStatement: { type: "STRING" }, solution: { type: "STRING" }, features: { type: "ARRAY", items: { type: "STRING" } }, techStack: { type: "ARRAY", items: { type: "STRING" } }, difficulty: { type: "STRING" }, futureEnhancements: { type: "ARRAY", items: { type: "STRING" } } }, required: ["title", "problemStatement", "solution", "features", "techStack", "difficulty", "futureEnhancements"] };
    try {
      const data = await askJSON({ task: "Generate one achievable and original college project idea with a clear problem and practical scope. Tailor it to the provided interest and skill level.", context: `Subject: ${values.subject}\nInterest: ${values.interest}\nSkill level: ${values.level}`, demoType: "extras-project", responseSchema: schema, outputFormat: "Return JSON with title, problemStatement, solution, features:string[], techStack:string[], difficulty, futureEnhancements:string[]." }, isProject);
      renderFields(host, data.title, [["Problem statement", data.problemStatement], ["Solution", data.solution], ["Features", data.features], ["Tech stack", data.techStack], ["Difficulty", data.difficulty], ["Future enhancements", data.futureEnhancements]], "project");
    } catch {
      showResultError(host, "We couldn't create a project idea. Check your connection or Demo Mode and try again.");
      toast("A project idea could not be generated. Please try again.", "error");
    } finally {
      button.disabled = false;
    }
  });

  root.querySelector("#lab-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const button = event.currentTarget.querySelector("button[type=submit]");
    const host = root.querySelector("#lab-result");
    button.disabled = true;
    host.hidden = false;
    host.replaceChildren(skeleton(5));
    const schema = { type: "OBJECT", properties: { aim: { type: "STRING" }, question: { type: "STRING" }, expectedConcept: { type: "STRING" }, sampleInput: { type: "STRING" }, sampleOutput: { type: "STRING" }, vivaQuestions: { type: "ARRAY", items: { type: "STRING" } } }, required: ["aim", "question", "expectedConcept", "sampleInput", "sampleOutput", "vivaQuestions"] };
    try {
      const data = await askJSON({ task: "Generate one safe, non-destructive college lab question. Never include database deletion, destructive file operations, machine shutdown, or irreversible commands. Use a small temporary or in-memory sample.", context: `Lab subject: ${values.subject}\nTopic: ${values.topic}\nSkill level: ${values.level}`, demoType: "extras-lab", responseSchema: schema, outputFormat: "Return JSON with aim, question, expectedConcept, sampleInput, sampleOutput, vivaQuestions:string[]. Never provide destructive commands or code." }, isLab);
      renderFields(host, `${values.subject} · ${values.topic}`, [["Aim", data.aim], ["Lab question", data.question], ["Expected concept", data.expectedConcept], ["Sample input", data.sampleInput], ["Sample output", data.sampleOutput], ["Viva questions", data.vivaQuestions]], "lab");
    } catch {
      showResultError(host, "We couldn't prepare a safe lab question. Please try again.");
      toast("A safe lab question could not be generated. Please try again.", "error");
    } finally {
      button.disabled = false;
    }
  });

  const sessionHost = root.querySelector("#english-session");
  async function requestEnglishQuestion(topic, level, previous = "") {
    const schema = { type: "OBJECT", properties: { question: { type: "STRING" } }, required: ["question"] };
    return askJSON({ task: "Ask one encouraging English speaking-practice question in English. Keep it appropriate to the learner's level. If there is a previous answer, ask a natural follow-up.", context: `Practice topic: ${topic}\nLevel: ${level}\nPrevious answer: ${previous || "None"}`, language: "en", demoType: "extras-english-question", responseSchema: schema, outputFormat: "Return JSON with question:string." }, (value) => typeof value?.question === "string" && value.question.trim().length > 0);
  }

  async function startEnglishSession(topic, level, previousAnswer = "") {
    sessionHost.replaceChildren(skeleton(2));
    const data = await requestEnglishQuestion(topic, level, previousAnswer);
    sessionHost.replaceChildren();
    const card = document.createElement("section");
    card.className = "surface english-question-card";
    const questionLabel = document.createElement("span");
    questionLabel.className = "eyebrow";
    questionLabel.textContent = "YOUR SPEAKING PROMPT";
    const question = document.createElement("h3");
    question.textContent = data.question;
    const form = document.createElement("form");
    form.className = "english-answer-form";
    form.innerHTML = `<label class="field"><span>Your answer</span><textarea name="answer" rows="4" maxlength="1500" required placeholder="Write a few sentences, or use Speak answer..."></textarea></label><div class="english-answer-actions"><button class="button button--secondary" id="english-speak" type="button">🎤 Speak answer</button><button class="button button--primary" type="submit">Get feedback <span aria-hidden="true">→</span></button></div>`;
    card.append(questionLabel, question, form, aiFooter());
    sessionHost.append(card);
    form.querySelector("#english-speak").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const transcript = await listen({ language: "en" });
        if (transcript) {
          const answer = form.elements.answer;
          answer.value = [answer.value, transcript].filter(Boolean).join(" ").slice(0, 1500);
          answer.focus();
        } else toast("No speech was detected. You can type your answer instead.", "info");
      } catch {
        toast("Voice input is unavailable. You can type your answer instead.", "error");
      } finally {
        button.disabled = false;
      }
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const answer = form.elements.answer.value.trim();
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      const result = document.createElement("div");
      result.className = "english-feedback";
      result.append(skeleton(3));
      card.append(result);
      const schema = { type: "OBJECT", properties: { grammarCorrections: { type: "ARRAY", items: { type: "STRING" } }, vocabularySuggestions: { type: "ARRAY", items: { type: "STRING" } }, betterSentence: { type: "STRING" }, confidenceTip: { type: "STRING" } }, required: ["grammarCorrections", "vocabularySuggestions", "betterSentence", "confidenceTip"] };
      let feedback;
      try {
        feedback = await askJSON({ task: "Give kind, encouraging English-speaking feedback in English. Identify useful grammar corrections without shaming the learner, suggest a few natural vocabulary choices, provide one improved sentence, and offer one practical confidence tip.", context: `Practice topic: ${topic}\nLevel: ${level}\nSpeaking prompt: ${data.question}\nStudent answer: ${answer}`, language: "en", demoType: "extras-english-evaluation", responseSchema: schema, outputFormat: "Return JSON with grammarCorrections:string[], vocabularySuggestions:string[], betterSentence:string, confidenceTip:string." }, isEnglishEvaluation);
      } catch {
        result.replaceChildren();
        toast("Feedback could not be generated. Please try again.", "error");
        submit.disabled = false;
        return;
      }
      renderFields(result, `English practice: ${topic}`, [["Grammar corrections", feedback.grammarCorrections], ["Vocabulary suggestions", feedback.vocabularySuggestions], ["A clearer sentence", feedback.betterSentence], ["Confidence tip", feedback.confidenceTip]], "answer");
      const next = document.createElement("button");
      next.type = "button";
      next.className = "button button--primary english-next-button";
      next.textContent = "Next speaking prompt →";
      next.addEventListener("click", () => startEnglishSession(topic, level, answer).catch(() => {
        showResultError(sessionHost, "The next question could not be loaded. Please try again.");
        toast("English practice could not be started. Please try again.", "error");
      }));
      result.append(next);
      submit.disabled = false;
    });
  }

  root.querySelector("#english-setup-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await startEnglishSession(values.topic, values.level);
    } catch {
      sessionHost.replaceChildren();
      const error = document.createElement("div");
      error.className = "empty-state";
      error.innerHTML = "<h3>We couldn't start that practice round.</h3><p>Please try again. Your topic and level are still available above.</p>";
      sessionHost.append(error);
      toast("English practice could not be started. Please try again.", "error");
    } finally {
      button.disabled = false;
    }
  });
}
