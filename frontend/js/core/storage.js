const prefix = "edugenie:";

const defaults = {
  profile: { name: "", course: "", year: "", language: "en", level: "beginner", dailyMinutes: 30, examDate: null, createdAt: null },
  settings: { theme: "light", demoMode: false, usingSampleData: false },
  topics: [],
  quizHistory: [],
  plans: [],
  notes: [],
  saved: [],
  activity: [],
  gamification: { xp: 0, level: 1, streak: 0, lastActiveDate: null, badges: [], studyMinutes: 0 },
  chatSessions: []
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readRaw(key) {
  try {
    const value = localStorage.getItem(`${prefix}${key}`);
    return value === null ? undefined : JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function get(key) {
  if (!Object.hasOwn(defaults, key)) throw new Error(`Unknown EduGenie storage key: ${key}`);
  const stored = readRaw(key);
  if (stored === undefined) return clone(defaults[key]);
  if (Array.isArray(defaults[key])) return Array.isArray(stored) ? stored : clone(defaults[key]);
  if (defaults[key] && typeof defaults[key] === "object") {
    return stored && typeof stored === "object" && !Array.isArray(stored)
      ? { ...clone(defaults[key]), ...stored }
      : clone(defaults[key]);
  }
  return stored;
}

export function set(key, value) {
  if (!Object.hasOwn(defaults, key)) throw new Error(`Unknown EduGenie storage key: ${key}`);
  localStorage.setItem(`${prefix}${key}`, JSON.stringify(value));
  return value;
}

export function update(key, patch) {
  const current = get(key);
  const next = typeof patch === "function" ? patch(current) : { ...current, ...patch };
  return set(key, next);
}

export function remove(key) {
  if (!Object.hasOwn(defaults, key)) throw new Error(`Unknown EduGenie storage key: ${key}`);
  localStorage.removeItem(`${prefix}${key}`);
}

export function exportAll() {
  const data = Object.fromEntries(Object.keys(defaults).map((key) => [key, get(key)]));
  return { format: "edugenie-backup", version: 1, exportedAt: new Date().toISOString(), data };
}

export async function importAll(file) {
  let parsed;
  if (typeof file === "string") parsed = JSON.parse(file);
  else if (file && typeof file.text === "function") parsed = JSON.parse(await file.text());
  else if (file && typeof file === "object") parsed = file;
  else throw new Error("Choose a valid EduGenie backup file.");

  const data = parsed?.format === "edugenie-backup" ? parsed.data : parsed?.data || parsed;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("This backup file has an invalid format.");
  for (const [key, value] of Object.entries(data)) {
    if (!Object.hasOwn(defaults, key)) continue;
    const expectsArray = Array.isArray(defaults[key]);
    if (expectsArray !== Array.isArray(value) || (!expectsArray && (!value || typeof value !== "object"))) {
      throw new Error(`The backup contains invalid ${key} data.`);
    }
  }
  for (const key of Object.keys(defaults)) {
    if (Object.hasOwn(data, key)) set(key, data[key]);
  }
  return true;
}