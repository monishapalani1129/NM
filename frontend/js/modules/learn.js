import { get, set } from "../core/storage.js";
import { ask, askJSON, stream } from "../core/gemini.js";
import { addXP, checkBadges } from "../core/gamification.js";
import { listen, speak } from "../core/voice.js";
import { aiFooter, modal, renderMarkdown, skeleton, toast } from "../core/ui.js";

const explanationFields = [
  ["definition", "Definition"], ["simpleExplanation", "Simple explanation"], ["howItWorks", "How it works"],
  ["realWorldExample", "Real-world example"], ["keyPoints", "Key points"], ["commonMistakes", "Common mistakes"],
  ["examPoints", "Exam points"], ["relatedTopics", "Related topics"]
];
const quickPrompts = ["Explain simply", "Give an example", "Give exam points", "Quiz me", "Explain like a beginner", "Explain in Tamil/Tanglish"];
let activeSessionId = null;

function makeId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function escapeHTML(value) {
  const element = document.createElement("span");
  element.textContent = String(value ?? "");
  return element.innerHTML;
}

function selectedSession() {
  return get("chatSessions").find((session) => session.id === activeSessionId);
}

function saveSession(session) {
  const sessions = get("chatSessions").filter((item) => item.id !== session.id);
  sessions.push(session);
  set("chatSessions", sessions.slice(-10));
}

function createSession() {
  const session = { id: makeId(), title: "New conversation", messages: [] };
  saveSession(session);
  activeSessionId = session.id;
  return session;
}

function recordActivity(type, label) {
  const activity = get("activity");
  activity.unshift({ id: makeId(), type, label, ts: new Date().toISOString() });
  set("activity", activity.slice(0, 100));
}

function markTopicStudied(subject, topic, explanation, awardXP = true) {
  const topics = get("topics");
  const normalizedSubject = String(subject || "General").trim() || "General";
  const normalizedTopic = String(topic || "Untitled topic").trim() || "Untitled topic";
  const existing = topics.find((item) => String(item.subject || "").toLowerCase() === normalizedSubject.toLowerCase() && String(item.topic || "").toLowerCase() === normalizedTopic.toLowerCase());
  const studiedAt = new Date().toISOString();
  const savedTopic = existing
    ? { ...existing, savedExplanation: explanation, studiedAt, nextReviewAt: new Date(Date.now() + 86400000).toISOString(), mastery: Math.min(100, (existing.mastery || 0) + 5) }
    : { id: makeId(), subject: normalizedSubject, topic: normalizedTopic, savedExplanation: explanation, studiedAt, mastery: 10, leitnerBox: 1, nextReviewAt: new Date(Date.now() + 86400000).toISOString() };
  set("topics", existing ? topics.map((item) => item.id === existing.id ? savedTopic : item) : [savedTopic, ...topics]);
  recordActivity("topic-studied", `Studied ${normalizedTopic}`);
  if (awardXP) {
    const result = addXP(10, `Studied ${normalizedTopic}`);
    result.badgesUnlocked?.forEach((badge) => toast(`Badge earned: ${badge.name}`, "success"));
  } else checkBadges();
  return savedTopic;
}

function renderChatMessage(message, index) {
  const article = document.createElement("article");
  article.className = `chat-message chat-message--${message.role}`;
  article.dataset.messageIndex = String(index);
  const heading = document.createElement("div");
  heading.className = "chat-message-heading";
  const author = document.createElement("strong");
  author.textContent = message.role === "assistant" ? "EduGenie" : (get("profile").name || "You");
  heading.append(author);
  if (message.role === "assistant") {
    const listenButton = document.createElement("button");
    listenButton.type = "button";
    listenButton.className = "text-icon-button";
    listenButton.textContent = "🔊 Listen";
    listenButton.addEventListener("click", () => speak(message.text, get("profile").language));
    heading.append(listenButton);
  }
  const body = document.createElement("div");
  body.className = "chat-message-body";
  body.append(renderMarkdown(message.text));
  article.append(heading, body);
  if (message.role === "assistant") article.append(aiFooter());
  return article;
}

function renderChatSession(container, messages) {
  container.replaceChildren();
  if (!messages.length) {
    const empty = document.createElement("div");
    empty.className = "chat-empty-state";
    empty.innerHTML = "<span class=\"chat-empty-mark\" aria-hidden=\"true\">✳</span><h3>What are you learning today?</h3><p>Ask a question, share a tricky concept, or choose a prompt below.</p>";
    container.append(empty);
    return;
  }
  messages.forEach((message, index) => container.append(renderChatMessage(message, index)));
  container.scrollTop = container.scrollHeight;
}

function refreshSessionSelect(select) {
  const sessions = get("chatSessions").slice().reverse();
  select.replaceChildren(...sessions.map((session) => new Option(session.title || "New conversation", session.id)));
  select.value = activeSessionId;
}

function renderExplanation(host, data) {
  host.replaceChildren();
  explanationFields.forEach(([key, label]) => {
    const section = document.createElement("section");
    section.className = "explanation-section";
    const heading = document.createElement("h3");
    heading.textContent = label;
    const value = data[key];
    const text = Array.isArray(value) ? value.map((item) => `- ${item}`).join("\n") : String(value || "Not provided.");
    section.append(heading, renderMarkdown(text));
    host.append(section);
  });
  host.append(aiFooter());
  host.hidden = false;
}

function makeConceptButton(name, depth) {
  const button = document.createElement("button");
  button.className = `concept-node concept-node--${depth}`;
  button.type = "button";
  button.dataset.concept = name;
  button.textContent = name;
  button.title = `Quick explanation: ${name}`;
  return button;
}

function renderConceptTree(host, data) {
  host.replaceChildren();
  const tree = document.createElement("div");
  tree.className = "concept-tree";
  const root = document.createElement("div");
  root.className = "concept-root";
  root.append(makeConceptButton(data.main, "main"));
  tree.append(root);
  const branches = document.createElement("ul");
  branches.className = "concept-branches";
  data.concepts.forEach((concept) => {
    const branch = document.createElement("li");
    branch.className = "concept-branch";
    branch.append(makeConceptButton(concept.name, "concept"));
    if (concept.children.length) {
      const children = document.createElement("ul");
      children.className = "concept-children";
      concept.children.forEach((name) => {
        const item = document.createElement("li");
        item.append(makeConceptButton(name, "child"));
        children.append(item);
      });
      branch.append(children);
    }
    branches.append(branch);
  });
  tree.append(branches);
  if (data.advanced.length) {
    const advanced = document.createElement("section");
    advanced.className = "advanced-concepts";
    const label = document.createElement("span");
    label.className = "eyebrow";
    label.textContent = "ADVANCED CONCEPTS";
    const list = document.createElement("div");
    list.className = "advanced-concept-list";
    data.advanced.forEach((name) => list.append(makeConceptButton(name, "advanced")));
    advanced.append(label, list);
    tree.append(advanced);
  }
  host.append(tree, aiFooter());
}

function renderTeachback(host, data) {
  host.replaceChildren();
  const score = Math.max(0, Math.min(100, Math.round(data.clarityScore)));
  const heading = document.createElement("div");
  heading.className = "teachback-result-heading";
  const title = document.createElement("div");
  title.innerHTML = "<span class=\"eyebrow\">YOUR REFLECTION</span><h2>Understanding, made visible.</h2>";
  const estimate = document.createElement("div");
  estimate.className = "learning-estimate";
  estimate.innerHTML = `<strong>${score}</strong><span><b>Learning estimate</b><small>Approximate, not a grade</small></span>`;
  heading.append(title, estimate);
  const grid = document.createElement("div");
  grid.className = "feedback-grid";
  [["correct", "What you got right"], ["missing", "What to add next"], ["misconceptions", "Possible misconceptions"]].forEach(([key, label]) => {
    const section = document.createElement("section");
    section.className = "feedback-section surface";
    const h3 = document.createElement("h3");
    h3.textContent = label;
    const list = document.createElement("ul");
    const items = data[key].length ? data[key] : [key === "misconceptions" ? "No clear misconception stood out." : "Add another sentence for more specific feedback."];
    items.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      list.append(li);
    });
    section.append(h3, list);
    grid.append(section);
  });
  const simpler = document.createElement("section");
  simpler.className = "surface simpler-model";
  const simplerTitle = document.createElement("h3");
  simplerTitle.textContent = "A simpler model explanation";
  simpler.append(simplerTitle, renderMarkdown(data.simplerModelExplanation), aiFooter());
  host.append(heading, grid, simpler);
  host.hidden = false;
}

export function render(container) {
  const profile = get("profile");
  container.innerHTML = `
    <section class="page-heading learn-heading"><span class="eyebrow">YOUR PERSONAL LEARNING SPACE</span><h1>Learn something deeply.</h1><p>Explore, question, connect ideas, and make them your own.</p></section>
    <div class="learn-tabs" role="tablist" aria-label="Learn tools">
      <button class="learn-tab is-active" id="tab-chat" type="button" role="tab" aria-selected="true" aria-controls="panel-chat" data-learn-tab="chat">AI Tutor Chat</button>
      <button class="learn-tab" id="tab-explainer" type="button" role="tab" aria-selected="false" aria-controls="panel-explainer" data-learn-tab="explainer" tabindex="-1">Smart Topic Explainer</button>
      <button class="learn-tab" id="tab-map" type="button" role="tab" aria-selected="false" aria-controls="panel-map" data-learn-tab="map" tabindex="-1">Concept Map</button>
      <button class="learn-tab" id="tab-teachback" type="button" role="tab" aria-selected="false" aria-controls="panel-teachback" data-learn-tab="teachback" tabindex="-1">Teach-Back</button>
    </div>
    <section class="learn-panel is-active" id="panel-chat" role="tabpanel" aria-labelledby="tab-chat" data-learn-panel="chat">
      <div class="tutor-layout surface"><div class="tutor-main">
        <div class="tutor-toolbar"><div><span class="eyebrow">YOUR TUTOR</span><h2>Ask, explore, understand.</h2></div><div class="session-controls"><label class="visually-hidden" for="chat-session-select">Recent chat sessions</label><select id="chat-session-select" class="session-select"></select><button id="new-chat" class="quiet-button" type="button">New chat</button><button id="clear-chat" class="quiet-button quiet-button--danger" type="button">Clear</button></div></div>
        <div id="chat-messages" class="chat-messages" aria-live="polite" aria-label="Tutor conversation"></div>
        <div class="quick-prompt-area"><span class="quick-prompt-label">QUICK PROMPTS</span><div class="quick-prompts">${quickPrompts.map((prompt) => `<button class="quick-prompt" type="button" data-prompt="${escapeHTML(prompt)}">${escapeHTML(prompt)}</button>`).join("")}</div></div>
        <form id="chat-form" class="chat-composer"><label class="visually-hidden" for="chat-input">Message EduGenie</label><textarea id="chat-input" name="message" rows="2" maxlength="8000" placeholder="Ask about a topic, idea, or problem..." required></textarea><div class="composer-actions"><button id="speak-input" class="voice-button" type="button" aria-label="Speak your question">🎤 <span>Speak</span></button><span class="composer-hint">Adapts to ${escapeHTML(profile.level)} level</span><button class="button button--primary chat-send" type="submit">Send <span aria-hidden="true">↗</span></button></div></form>
      </div><aside class="tutor-aside"><div class="tutor-aside-mark" aria-hidden="true">✳</div><span class="eyebrow">LEARNING COMPANION</span><h3>Curiosity is a good place to start.</h3><p>Ask for another example, a simpler explanation, or a fresh way to remember an idea.</p><div class="aside-language"><span>RESPONDING IN</span><strong>${escapeHTML(profile.language === "ta" ? "தமிழ்" : profile.language === "tanglish" ? "Tanglish" : "English")}</strong></div></aside></div>
    </section>
    <section class="learn-panel" id="panel-explainer" role="tabpanel" aria-labelledby="tab-explainer" data-learn-panel="explainer" hidden>
      <div class="surface learn-tool-surface"><div class="tool-intro"><span class="eyebrow">MAKE THE COMPLEX CLEAR</span><h2>Smart Topic Explainer</h2><p>Get a course-aware breakdown, then reshape it around the example you need.</p></div>
        <form id="explain-form" class="learn-form"><label class="field"><span>Subject</span><input name="subject" required maxlength="100" placeholder="e.g. Biology"></label><label class="field"><span>Topic</span><input name="topic" required maxlength="140" placeholder="e.g. Cellular respiration"></label><label class="field"><span>Level</span><select name="level"><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label><button class="button button--primary explain-submit" type="submit">Explain this topic <span aria-hidden="true">→</span></button></form>
        <div class="explain-actions"><button class="button button--secondary" type="button" data-explain-mode="again" disabled>Explain Again</button><button class="button button--secondary" type="button" data-explain-mode="simpler" disabled>Make Simpler</button><button class="button button--secondary" type="button" data-explain-mode="example" disabled>Give Example</button><label class="field real-life-select"><span>Example setting</span><select id="example-setting"><option value="college">College</option><option value="technology">Technology</option><option value="daily life">Daily life</option><option value="industry">Industry</option></select></label><button class="button button--secondary" type="button" data-explain-mode="real-life" disabled>Real-Life Example</button><button id="create-quiz" class="button button--violet" type="button" disabled>Create Quiz <span aria-hidden="true">↗</span></button><button id="save-topic" class="button button--save" type="button" disabled>Save Topic <span aria-hidden="true">＋</span></button></div>
        <div id="explanation-result" class="explanation-result" aria-live="polite" hidden></div>
      </div>
    </section>
    <section class="learn-panel" id="panel-map" role="tabpanel" aria-labelledby="tab-map" data-learn-panel="map" hidden>
      <div class="surface learn-tool-surface"><div class="tool-intro"><span class="eyebrow">SEE HOW IDEAS CONNECT</span><h2>Concept Map</h2><p>Build a map from the main topic to core and advanced ideas. Select any node for a quick explanation.</p></div>
        <form id="map-form" class="learn-form learn-form--map"><label class="field"><span>Subject</span><input name="subject" required maxlength="100" placeholder="e.g. Computer Science"></label><label class="field"><span>Topic</span><input name="topic" required maxlength="140" placeholder="e.g. Neural networks"></label><button class="button button--primary" type="submit">Build concept map <span aria-hidden="true">✳</span></button></form>
        <div id="concept-map-result" class="concept-map-result" aria-live="polite"></div>
      </div>
    </section>
    <section class="learn-panel" id="panel-teachback" role="tabpanel" aria-labelledby="tab-teachback" data-learn-panel="teachback" hidden>
      <div class="teachback-layout"><section class="surface teachback-input"><span class="eyebrow">THE FEYNMAN TECHNIQUE</span><h2>Teach it back.</h2><p>Explain the idea in your own words. Gaps are clues for what to learn next.</p><form id="teachback-form" class="teachback-form"><label class="field"><span>Subject</span><input name="subject" maxlength="100" placeholder="e.g. Physics"></label><label class="field"><span>Topic</span><input name="topic" required maxlength="140" placeholder="What concept are you explaining?"></label><label class="field"><span>Your explanation</span><textarea name="explanation" id="teachback-text" rows="7" maxlength="6000" required placeholder="Explain it as if you were teaching a friend..."></textarea></label><div class="teachback-actions"><button id="speak-teachback" class="button button--secondary" type="button">🎤 Speak your explanation</button><button class="button button--primary" type="submit">Check my understanding <span aria-hidden="true">→</span></button></div></form></section><section class="surface teachback-side"><div class="teachback-orbit" aria-hidden="true">✳</div><span class="eyebrow">A USEFUL SELF-CHECK</span><h3>Can you explain it without the jargon?</h3><p>Start with the simplest version. If a step feels fuzzy, that is your next learning target.</p><div class="teachback-steps"><span>01 &nbsp; Explain from memory</span><span>02 &nbsp; Find the missing link</span><span>03 &nbsp; Try again, more simply</span></div></section></div>
      <div id="teachback-result" class="teachback-result" aria-live="polite" hidden></div>
    </section>`;
}

export function init() {
  const root = document.querySelector("#page-content");
  const profile = get("profile");
  const tabs = [...root.querySelectorAll("[data-learn-tab]")];
  const panels = [...root.querySelectorAll("[data-learn-panel]")];
  const selectTab = (name) => {
    tabs.forEach((tab) => {
      const active = tab.dataset.learnTab === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    panels.forEach((panel) => {
      const active = panel.dataset.learnPanel === name;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab.dataset.learnTab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].focus();
      selectTab(tabs[next].dataset.learnTab);
    });
  });

  const chatMessages = root.querySelector("#chat-messages");
  const chatInput = root.querySelector("#chat-input");
  const sessionSelect = root.querySelector("#chat-session-select");
  activeSessionId = get("chatSessions").at(-1)?.id || createSession().id;
  refreshSessionSelect(sessionSelect);
  renderChatSession(chatMessages, selectedSession()?.messages || []);
  sessionSelect.addEventListener("change", () => {
    activeSessionId = sessionSelect.value;
    renderChatSession(chatMessages, selectedSession()?.messages || []);
  });
  root.querySelector("#new-chat").addEventListener("click", () => {
    createSession();
    refreshSessionSelect(sessionSelect);
    renderChatSession(chatMessages, []);
    chatInput.focus();
  });
  root.querySelector("#clear-chat").addEventListener("click", () => {
    const session = selectedSession() || createSession();
    session.title = "New conversation";
    session.messages = [];
    saveSession(session);
    refreshSessionSelect(sessionSelect);
    renderChatSession(chatMessages, []);
    toast("This conversation has been cleared.", "success");
  });

  async function sendChatMessage(rawText, languageOverride = "") {
    const text = rawText.trim();
    if (!text) return;
    const session = selectedSession() || createSession();
    const userMessage = { role: "user", text, ts: new Date().toISOString() };
    session.messages.push(userMessage);
    if (session.title === "New conversation") session.title = text.slice(0, 42);
    saveSession(session);
    refreshSessionSelect(sessionSelect);
    chatMessages.querySelector(".chat-empty-state")?.remove();
    chatMessages.append(renderChatMessage(userMessage, session.messages.length - 1));
    chatInput.value = "";
    const article = document.createElement("article");
    article.className = "chat-message chat-message--assistant chat-message--streaming";
    const heading = document.createElement("div");
    heading.className = "chat-message-heading";
    const author = document.createElement("strong");
    author.textContent = "EduGenie is thinking";
    const dots = document.createElement("span");
    dots.className = "thinking-dots";
    dots.setAttribute("aria-label", "Generating response");
    dots.innerHTML = "<i></i><i></i><i></i>";
    heading.append(author, dots);
    const body = document.createElement("div");
    body.className = "chat-message-body";
    body.setAttribute("aria-live", "polite");
    body.append(skeleton(3));
    article.append(heading, body);
    chatMessages.append(article);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    root.querySelector("#chat-form button[type=submit]").disabled = true;
    const history = session.messages.slice(-9).map((item) => `${item.role === "assistant" ? "Tutor" : "Student"}: ${item.text}`).join("\n");
    let answer = "";
    try {
      answer = await stream({
        task: "Continue this tutor conversation. Answer in a supportive, course-aware way at the student's level. End with a useful follow-up question when appropriate.",
        context: history,
        outputFormat: "A clear answer in markdown. Use short sections or bullets when they improve understanding.",
        language: languageOverride
      }, (chunk) => {
        answer += chunk;
        body.replaceChildren(renderMarkdown(answer));
        chatMessages.scrollTop = chatMessages.scrollHeight;
      });
      if (!answer.trim()) answer = "I could not form a response just now. Try asking in a different way.";
      const assistantMessage = { role: "assistant", text: answer, ts: new Date().toISOString() };
      session.messages.push(assistantMessage);
      session.messages = session.messages.slice(-40);
      saveSession(session);
      article.replaceWith(renderChatMessage(assistantMessage, session.messages.length - 1));
      chatMessages.scrollTop = chatMessages.scrollHeight;
      markTopicStudied(profile.course || "Tutor chat", text.slice(0, 80), answer);
    } catch {
      article.remove();
      toast("The tutor could not complete that response. Please try again.", "error");
    } finally {
      root.querySelector("#chat-form button[type=submit]").disabled = false;
      chatInput.focus();
    }
  }

  root.querySelector("#chat-form").addEventListener("submit", (event) => {
    event.preventDefault();
    sendChatMessage(chatInput.value);
  });
  root.querySelector("#speak-input").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.classList.add("is-listening");
    const transcript = await listen({ language: profile.language });
    if (transcript) {
      chatInput.value = [chatInput.value, transcript].filter(Boolean).join(" ");
      chatInput.focus();
    }
    button.disabled = false;
    button.classList.remove("is-listening");
  });
  root.querySelectorAll(".quick-prompt").forEach((button) => button.addEventListener("click", () => {
    const previousQuestion = selectedSession()?.messages.filter((item) => item.role === "user").at(-1)?.text;
    if (previousQuestion) sendChatMessage(`${button.dataset.prompt}: Continue from my previous question.`, button.dataset.prompt === "Explain in Tamil/Tanglish" ? "ta" : "");
    else {
      chatInput.value = `${button.dataset.prompt}: `;
      chatInput.focus();
    }
  }));

  const explainForm = root.querySelector("#explain-form");
  const explanationResult = root.querySelector("#explanation-result");
  const explainButtons = [...root.querySelectorAll("[data-explain-mode]")];
  const saveTopicButton = root.querySelector("#save-topic");
  const createQuizButton = root.querySelector("#create-quiz");
  let lastExplanation = null;
  async function explain(mode = "again") {
    if (!explainForm.reportValidity()) return;
    const values = Object.fromEntries(new FormData(explainForm));
    const setting = root.querySelector("#example-setting").value;
    const tasks = {
      again: "Explain this topic accurately and thoroughly for the selected level.",
      simpler: "Explain this topic in simpler language, using short sentences and defining technical terms.",
      example: "Explain this topic and focus on one concrete, easy-to-follow example.",
      "real-life": `Explain this topic through one relevant real-life example from ${setting}.`
    };
    const context = `Subject: ${values.subject}\nTopic: ${values.topic}\nRequested level: ${values.level}${mode === "real-life" ? `\nExample setting: ${setting}` : ""}`;
    const submit = explainForm.querySelector("button[type=submit]");
    submit.disabled = true;
    explanationResult.hidden = false;
    explanationResult.replaceChildren(skeleton(6));
    try {
      const data = await askJSON({
        task: tasks[mode] || tasks.again,
        context,
        demoType: "explanation",
        responseSchema: {
          type: "OBJECT",
          properties: Object.fromEntries(explanationFields.map(([key]) => [key, ["keyPoints", "commonMistakes", "examPoints", "relatedTopics"].includes(key) ? { type: "ARRAY", items: { type: "STRING" } } : { type: "STRING" }])),
          required: explanationFields.map(([key]) => key)
        },
        outputFormat: "Return JSON with definition, simpleExplanation, howItWorks, realWorldExample as strings; keyPoints, commonMistakes, examPoints, relatedTopics as string arrays."
      }, (data) => explanationFields.every(([key]) => Array.isArray(data?.[key]) || typeof data?.[key] === "string"));
      lastExplanation = { subject: values.subject, topic: values.topic, level: values.level, data };
      renderExplanation(explanationResult, data);
      markTopicStudied(values.subject, values.topic, explanationText(data));
      explainButtons.forEach((button) => { button.disabled = false; });
      saveTopicButton.disabled = false;
      createQuizButton.disabled = false;
    } catch {
      explanationResult.replaceChildren();
      toast("The explanation could not be generated. Try again or check Demo Mode.", "error");
    } finally {
      submit.disabled = false;
    }
  }
  explainForm.addEventListener("submit", (event) => { event.preventDefault(); explain("again"); });
  explainButtons.forEach((button) => button.addEventListener("click", () => explain(button.dataset.explainMode)));
  saveTopicButton.addEventListener("click", () => {
    if (!lastExplanation) return;
    const saved = get("saved");
    const title = `${lastExplanation.subject}: ${lastExplanation.topic}`;
    const existing = saved.find((item) => item.type === "explanation" && item.title === title);
    const entry = { id: existing?.id || makeId(), type: "explanation", title, content: explanationText(lastExplanation.data), createdAt: new Date().toISOString() };
    set("saved", [entry, ...saved.filter((item) => item.id !== entry.id)].slice(0, 100));
    recordActivity("topic-saved", `Saved ${lastExplanation.topic}`);
    toast("Topic saved to your learning library.", "success");
  });
  createQuizButton.addEventListener("click", () => {
    if (!lastExplanation) return;
    const params = new URLSearchParams({ subject: lastExplanation.subject, topic: lastExplanation.topic });
    window.location.hash = `#/practice?${params}`;
  });

  const mapForm = root.querySelector("#map-form");
  const mapResult = root.querySelector("#concept-map-result");
  mapForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!mapForm.reportValidity()) return;
    const values = Object.fromEntries(new FormData(mapForm));
    const button = mapForm.querySelector("button[type=submit]");
    button.disabled = true;
    mapResult.replaceChildren(skeleton(4));
    try {
      const data = await askJSON({
        task: "Map this topic from its main idea to core concepts, child ideas, and a few advanced concepts.",
        context: `Subject: ${values.subject}\nTopic: ${values.topic}`,
        demoType: "concept-map",
        responseSchema: {
          type: "OBJECT",
          properties: {
            main: { type: "STRING" },
            concepts: { type: "ARRAY", items: { type: "OBJECT", properties: { name: { type: "STRING" }, children: { type: "ARRAY", items: { type: "STRING" } } }, required: ["name", "children"] } },
            advanced: { type: "ARRAY", items: { type: "STRING" } }
          },
          required: ["main", "concepts", "advanced"]
        },
        outputFormat: "Return JSON exactly shaped as {main:string, concepts:[{name:string, children:string[]}], advanced:string[]}."
      }, (data) => typeof data?.main === "string" && Array.isArray(data.concepts) && data.concepts.every((item) => typeof item.name === "string" && Array.isArray(item.children)) && Array.isArray(data.advanced));
      renderConceptTree(mapResult, data);
      recordActivity("concept-map-created", `Mapped ${values.topic}`);
      const result = addXP(8, `Mapped ${values.topic}`);
      result.badgesUnlocked?.forEach((badge) => toast(`Badge earned: ${badge.name}`, "success"));
    } catch {
      mapResult.replaceChildren();
      toast("The concept map could not be created. Please try again.", "error");
    } finally {
      button.disabled = false;
    }
  });
  mapResult.addEventListener("click", (event) => {
    const node = event.target.closest("[data-concept]");
    if (!node) return;
    const values = Object.fromEntries(new FormData(mapForm));
    showQuickExplanation(node.dataset.concept, values.subject, values.topic);
  });

  const teachbackForm = root.querySelector("#teachback-form");
  const teachbackResult = root.querySelector("#teachback-result");
  root.querySelector("#speak-teachback").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    const transcript = await listen({ language: profile.language });
    if (transcript) {
      const field = root.querySelector("#teachback-text");
      field.value = [field.value, transcript].filter(Boolean).join(" ");
      field.focus();
    }
    button.disabled = false;
  });
  teachbackForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!teachbackForm.reportValidity()) return;
    const values = Object.fromEntries(new FormData(teachbackForm));
    const button = teachbackForm.querySelector("button[type=submit]");
    button.disabled = true;
    teachbackResult.hidden = false;
    teachbackResult.replaceChildren(skeleton(5));
    try {
      const data = await askJSON({
        task: "Evaluate the student's teach-back explanation using the Feynman technique. Be encouraging and specific. A clarity score is only an approximate learning estimate, not a grade.",
        context: `Subject: ${values.subject || profile.course || "General"}\nTopic: ${values.topic}\nStudent explanation: ${values.explanation}`,
        demoType: "teach-back",
        responseSchema: {
          type: "OBJECT",
          properties: {
            correct: { type: "ARRAY", items: { type: "STRING" } },
            missing: { type: "ARRAY", items: { type: "STRING" } },
            misconceptions: { type: "ARRAY", items: { type: "STRING" } },
            clarityScore: { type: "NUMBER" },
            simplerModelExplanation: { type: "STRING" }
          },
          required: ["correct", "missing", "misconceptions", "clarityScore", "simplerModelExplanation"]
        },
        outputFormat: "Return JSON with correct, missing, misconceptions as string arrays, clarityScore as an integer from 0 to 100, and simplerModelExplanation as a string."
      }, (data) => ["correct", "missing", "misconceptions"].every((key) => Array.isArray(data?.[key])) && Number.isFinite(data?.clarityScore) && typeof data?.simplerModelExplanation === "string");
      renderTeachback(teachbackResult, data);
      const summary = `Correct: ${data.correct.join("; ")}\nMissing: ${data.missing.join("; ")}\nMisconceptions: ${data.misconceptions.join("; ")}\n${data.simplerModelExplanation}`;
      markTopicStudied(values.subject || profile.course || "General", values.topic, summary, false);
      const result = addXP(15, `Taught back ${values.topic}`);
      result.badgesUnlocked?.forEach((badge) => toast(`Badge earned: ${badge.name}`, "success"));
    } catch {
      teachbackResult.replaceChildren();
      toast("Your teach-back could not be evaluated. Please try again.", "error");
    } finally {
      button.disabled = false;
    }
  });
}

function explanationText(data) {
  return explanationFields.map(([key, label]) => {
    const value = Array.isArray(data[key]) ? data[key].join("\n- ") : data[key];
    return `## ${label}\n${value}`;
  }).join("\n\n");
}

function showQuickExplanation(concept, subject, topic) {
  const content = document.createElement("div");
  content.className = "quick-explanation-content";
  content.append(skeleton(3));
  const dialog = modal({ title: concept, content });
  ask({ task: "Give a concise, student-friendly explanation of this concept and connect it to the main topic.", context: `Subject: ${subject}\nMain topic: ${topic}\nConcept to explain: ${concept}`, outputFormat: "One short explanation with one useful example." }).then((text) => {
    if (!dialog.element.isConnected) return;
    content.replaceChildren(renderMarkdown(text), aiFooter());
    markTopicStudied(subject, concept, text);
  }).catch(() => {
    if (!dialog.element.isConnected) return;
    content.replaceChildren();
    const message = document.createElement("p");
    message.className = "empty-state";
    message.textContent = "That explanation could not be loaded. Please close this window and try again.";
    content.append(message);
    toast("The explanation could not be loaded. Please try again.", "error");
  });
}
