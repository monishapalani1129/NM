import { exportAll, get, importAll, set, update } from "../core/storage.js";
import { languageOptions } from "../core/i18n.js";
import { toast } from "../core/ui.js";

export function render(container) {
  const profile = get("profile");
  const settings = get("settings");
  container.innerHTML = `<section class="page-heading"><span class="eyebrow">YOUR ACCOUNT</span><h1>Profile & preferences</h1><p>Keep your learning plan aligned with where you are now.</p></section><section class="surface profile-surface"><form id="profile-form" class="form-grid">
    <label class="field"><span>Name</span><input name="name" required maxlength="80"></label><label class="field"><span>Course</span><input name="course" required maxlength="100"></label>
    <label class="field"><span>Year of study</span><select name="year"><option value="1">Year 1</option><option value="2">Year 2</option><option value="3">Year 3</option><option value="4">Year 4</option><option value="5">Year 5</option></select></label>
    <label class="field"><span>Language</span><select name="language"></select></label><label class="field"><span>Learning level</span><select name="level"><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label>
    <label class="field"><span>Daily study time</span><select name="dailyMinutes"><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option><option value="90">90 minutes</option></select></label>
    <label class="field"><span>Next exam date <small>(optional)</small></span><input name="examDate" type="date"></label><div class="form-actions field--wide"><button class="button button--primary" type="submit">Save profile</button></div>
  </form></section><section class="page-heading backup-heading"><span class="eyebrow">PREFERENCES</span><h2>Demo Mode</h2><p>Use sample learning responses without a live Gemini connection.</p></section><section class="surface backup-surface setting-surface"><label class="setting-toggle" for="demo-mode"><span><strong>Use demo responses</strong><small>EduGenie will show sample AI answers.</small></span><input id="demo-mode" type="checkbox" ${settings.demoMode ? "checked" : ""}></label></section><section class="page-heading backup-heading"><span class="eyebrow">YOUR DATA</span><h2>Backup & restore</h2><p>Export your EduGenie data or restore it from a JSON backup.</p></section><section class="surface backup-surface"><button id="export-backup" class="button button--secondary" type="button">Export backup</button><label class="button button--secondary file-button" for="import-backup">Import backup</label><input id="import-backup" class="visually-hidden" type="file" accept="application/json,.json"></section><section class="page-heading backup-heading"><span class="eyebrow">CLEAR YOUR LEARNING HISTORY</span><h2>Reset data</h2><p>Remove notes, plans, topics, quizzes, activity, and progress while keeping your profile.</p></section><section class="surface backup-surface"><button id="reset-learning-data" class="button button--danger" type="button">Reset learning data</button></section>`;
  const form = container.querySelector("#profile-form");
  for (const [key, value] of Object.entries(profile)) {
    if (form.elements[key]) form.elements[key].value = value ?? "";
  }
  const language = form.elements.language;
  language.replaceChildren(...languageOptions.map(({ value, label }) => new Option(label, value)));
  language.value = profile.language;
}

export function init() {
  document.querySelector("#reset-learning-data").addEventListener("click", () => {
    if (!window.confirm("Reset all learning data? Your profile and preferences will be kept.")) return;
    for (const key of ["topics", "quizHistory", "plans", "notes", "saved", "activity", "chatSessions"]) set(key, []);
    set("gamification", { xp: 0, level: 1, streak: 0, lastActiveDate: null, badges: [], studyMinutes: 0 });
    const currentSettings = get("settings");
    set("settings", { ...currentSettings, usingSampleData: false });
    window.dispatchEvent(new CustomEvent("edugenie:data-changed"));
    toast("Learning data has been reset.", "success");
    window.location.reload();
  });
  document.querySelector("#demo-mode").addEventListener("change", (event) => {
    update("settings", { demoMode: event.currentTarget.checked });
    toast(event.currentTarget.checked ? "Demo responses are now enabled." : "Live Gemini responses are enabled.", "success");
  });
  document.querySelector("#profile-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    set("profile", { ...get("profile"), ...values, dailyMinutes: Number(values.dailyMinutes), examDate: values.examDate || null });
    toast("Your profile has been updated.", "success");
  });
  document.querySelector("#export-backup").addEventListener("click", () => {
    const file = new Blob([JSON.stringify(exportAll(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `edugenie-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast("Your backup has been exported.", "success");
  });
  document.querySelector("#import-backup").addEventListener("change", async (event) => {
    const [file] = event.target.files || [];
    if (!file) return;
    try {
      await importAll(file);
      document.documentElement.dataset.theme = get("settings").theme;
      toast("Backup restored successfully.", "success");
      window.location.reload();
    } catch (error) {
      toast(error.message || "That backup could not be imported.", "error");
    } finally {
      event.target.value = "";
    }
  });
}