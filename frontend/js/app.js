import { get, set } from "./core/storage.js";
import { languageOptions, setLanguage, t } from "./core/i18n.js";
import { modal, renderMarkdown } from "./core/ui.js";
import { refreshRoute, startRouter } from "./core/router.js";

const navItems = ["dashboard", "learn", "notes", "practice", "exam", "insights", "planner", "extras"];

function makeNavLink(route, mobile = false) {
  const link = document.createElement("a");
  link.className = "nav-link";
  link.href = `#/${route}`;
  link.dataset.route = route;
  link.innerHTML = `<span class="nav-mark" aria-hidden="true">${({ dashboard: "D", learn: "L", notes: "N", practice: "P", exam: "E", insights: "I", planner: "T", extras: "+", profile: "U" })[route]}</span><span>${t(route)}</span>`;
  if (mobile) link.classList.add("mobile-more-link");
  return link;
}

function buildNavigation() {
  const sidebar = document.querySelector("#sidebar-nav");
  const bottom = document.querySelector("#bottom-nav");
  sidebar.replaceChildren(...navItems.map((route) => makeNavLink(route)));
  sidebar.append(makeNavLink("profile"));

  const primaryRoutes = ["dashboard", "learn", "practice"];
  bottom.replaceChildren(...primaryRoutes.map((route) => makeNavLink(route, true)));
  const more = document.createElement("button");
  more.className = "nav-link mobile-more-toggle";
  more.type = "button";
  more.setAttribute("aria-expanded", "false");
  more.innerHTML = `<span class="nav-mark" aria-hidden="true">+</span><span>${t("extras")}</span>`;
  more.addEventListener("click", () => {
    const open = more.getAttribute("aria-expanded") === "true";
    more.setAttribute("aria-expanded", String(!open));
    document.querySelector("#mobile-more-menu").hidden = open;
  });
  bottom.append(more);
  const moreMenu = document.querySelector("#mobile-more-menu");
  moreMenu.replaceChildren(...["notes", "exam", "insights", "planner", "profile"].map((route) => makeNavLink(route, true)));
}

function renderLanguageOptions(select) {
  select.replaceChildren(...languageOptions.map(({ value, label }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
  select.value = get("profile").language;
}

function applyTheme() {
  document.documentElement.dataset.theme = get("settings").theme;
}

function updateSampleDataBadge() {
  const badge = document.querySelector("#sample-data-badge");
  if (badge) badge.hidden = !get("settings").usingSampleData;
}

function getSearchResults(query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches = (value) => String(value || "").toLowerCase().includes(needle);
  return [
    { group: "Topics", items: get("topics").filter((item) => matches(`${item.subject} ${item.topic} ${item.savedExplanation}`)).map((item) => ({ type: "topic", id: item.id, title: item.topic, detail: item.subject, subject: item.subject, topic: item.topic })) },
    { group: "Saved items", items: get("saved").filter((item) => matches(`${item.title} ${item.type} ${item.content}`)).map((item) => ({ type: "saved", id: item.id, title: item.title, detail: item.type, content: item.content })) },
    { group: "Notes", items: get("notes").filter((item) => matches(`${item.title} ${item.content}`)).map((item) => ({ type: "note", id: item.id, title: item.title, detail: `${(item.flashcards || []).length} flashcards` })) },
    { group: "Quiz history", items: get("quizHistory").filter((item) => item.status !== "in-progress" && matches(`${item.subject} ${item.topic} ${item.mode}`)).map((item) => ({ type: "quiz", id: item.id, title: item.topic, detail: `${item.subject} · ${item.score}/${item.total}`, subject: item.subject, topic: item.topic })) },
    { group: "Study plans", items: get("plans").filter((item) => matches(`${item.title} ${item.days?.map((day) => `${day.subject} ${day.topic}`).join(" ")}`)).map((item) => ({ type: "plan", id: item.id, title: item.title, detail: `${item.days?.length || 0} days` })) }
  ].filter((group) => group.items.length);
}

function openSavedPreview(item) {
  const content = document.createElement("div");
  content.className = "search-saved-preview";
  const metadata = document.createElement("span");
  metadata.className = "eyebrow";
  metadata.textContent = item.type;
  content.append(metadata, renderMarkdown(item.content || "No saved content."));
  modal({ title: item.title || "Saved item", content });
}

function navigateSearchResult(item, searchDialog) {
  searchDialog.close();
  if (item.type === "saved") {
    openSavedPreview(item);
    return;
  }
  if (item.type === "note") {
    window.location.hash = `#/notes?note=${encodeURIComponent(item.id)}`;
    return;
  }
  if (item.type === "plan") {
    window.location.hash = `#/planner?plan=${encodeURIComponent(item.id)}`;
    return;
  }
  if (item.type === "quiz") {
    window.location.hash = `#/practice?review=${encodeURIComponent(item.id)}`;
    return;
  }
  window.location.hash = `#/practice?subject=${encodeURIComponent(item.subject)}&topic=${encodeURIComponent(item.topic)}`;
}

function openGlobalSearch() {
  if (document.querySelector(".search-dialog")) return;
  const content = document.createElement("div");
  content.className = "global-search-content";
  content.innerHTML = `<label class="field" for="global-search-input"><span>Search your learning space</span><input id="global-search-input" type="search" maxlength="160" autocomplete="off" placeholder="Topics, notes, quizzes, plans..."></label><div id="global-search-results" class="global-search-results" aria-live="polite"><div class="search-empty-state"><span aria-hidden="true">⌕</span><p>Search topics, saved answers, notes, quiz history, and plans.</p></div></div>`;
  const dialog = modal({ title: "Search", content });
  dialog.element.classList.add("search-dialog");
  const input = content.querySelector("#global-search-input");
  input.focus();
  const resultsHost = content.querySelector("#global-search-results");
  function renderResults() {
    const groups = getSearchResults(input.value);
    resultsHost.replaceChildren();
    if (!input.value.trim()) {
      resultsHost.innerHTML = `<div class="search-empty-state"><span aria-hidden="true">⌕</span><p>Search topics, saved answers, notes, quiz history, and plans.</p></div>`;
      return;
    }
    if (!groups.length) {
      resultsHost.innerHTML = `<div class="search-empty-state"><span aria-hidden="true">○</span><p>No matching items. Try a topic, subject, or keyword.</p></div>`;
      return;
    }
    groups.forEach((group) => {
      const section = document.createElement("section");
      section.className = "search-result-group";
      const heading = document.createElement("h3");
      heading.textContent = group.group;
      section.append(heading);
      group.items.forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "search-result-item";
        const copy = document.createElement("span");
        copy.innerHTML = "<strong></strong><small></small>";
        copy.querySelector("strong").textContent = item.title || "Untitled";
        copy.querySelector("small").textContent = item.detail || "";
        const icon = document.createElement("span");
        icon.className = "search-result-arrow";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = "↗";
        button.append(copy, icon);
        button.addEventListener("click", () => navigateSearchResult(item, dialog));
        section.append(button);
      });
      resultsHost.append(section);
    });
  }
  input.addEventListener("input", renderResults);
  renderResults();
}

function setupTopbar() {
  const language = document.querySelector("#language-select");
  renderLanguageOptions(language);
  language.setAttribute("aria-label", t("language"));
  language.addEventListener("change", () => {
    setLanguage(language.value);
    buildNavigation();
    language.setAttribute("aria-label", t("language"));
    refreshRoute();
  });
  document.querySelector("#theme-toggle").addEventListener("click", () => {
    const settings = get("settings");
    set("settings", { ...settings, theme: settings.theme === "dark" ? "light" : "dark" });
    applyTheme();
    document.querySelector("#theme-toggle").setAttribute("aria-label", t("theme"));
  });
  document.querySelector("#profile-link").addEventListener("click", () => { window.location.hash = "#/profile"; });
  document.querySelector("#search-open").addEventListener("click", openGlobalSearch);
  window.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
    event.preventDefault();
    openGlobalSearch();
  });
}

function openOnboarding() {
  const form = document.createElement("form");
  form.className = "form-grid onboarding-form";
  form.innerHTML = `
    <label class="field"><span>Your name</span><input name="name" autocomplete="name" required maxlength="80" placeholder="e.g. Asha"></label>
    <label class="field"><span>Course</span><input name="course" required maxlength="100" placeholder="e.g. Computer Science"></label>
    <label class="field"><span>Year of study</span><select name="year" required><option value="">Choose year</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label>
    <label class="field"><span>Preferred language</span><select name="language"><option value="en">English</option><option value="ta">தமிழ்</option><option value="tanglish">Tanglish</option></select></label>
    <label class="field"><span>Learning level</span><select name="level"><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label>
    <label class="field"><span>Daily study time</span><select name="dailyMinutes"><option value="15">15 minutes</option><option value="30" selected>30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option><option value="90">90 minutes</option></select></label>
    <label class="field field--wide"><span>Next exam date <small>(optional)</small></span><input name="examDate" type="date"></label>
    <button class="button button--primary field--wide" type="submit">Create my learning profile <span aria-hidden="true">→</span></button>`;
  const dialog = modal({ title: "Let's make learning yours", content: form });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    set("profile", { ...get("profile"), ...values, dailyMinutes: Number(values.dailyMinutes), examDate: values.examDate || null, createdAt: get("profile").createdAt || new Date().toISOString() });
    dialog.close();
    buildNavigation();
    renderLanguageOptions(document.querySelector("#language-select"));
    refreshRoute();
  });
}

function initialize() {
  applyTheme();
  updateSampleDataBadge();
  window.addEventListener("edugenie:data-changed", updateSampleDataBadge);
  buildNavigation();
  setupTopbar();
  startRouter();
  if (!get("profile").name) openOnboarding();
}

initialize();