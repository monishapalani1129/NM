import { get, update } from "./storage.js";

export const languageOptions = [
  { value: "en", label: "English" },
  { value: "ta", label: "தமிழ்" },
  { value: "tanglish", label: "Tanglish" }
];

const labels = {
  en: {
    dashboard: "Dashboard", learn: "Learn", notes: "Notes Studio", practice: "Practice", exam: "Exam Zone", insights: "Insights", planner: "Planner", extras: "More", profile: "Profile",
    save: "Save changes", cancel: "Cancel", close: "Close", start: "Start Learning", welcome: "Good to see you", greeting: "Your next learning session starts here.",
    aiTest: "Try an AI learning check", aiPrompt: "Explain why spaced practice helps memory, in two short sentences.", loading: "Thinking through it...", coming: "Coming in next phase", theme: "Toggle theme", language: "Language", dailyGoal: "Daily study goal", minutes: "min / day"
  },
  ta: {
    dashboard: "முகப்பு", learn: "கற்க", notes: "குறிப்புகள்", practice: "பயிற்சி", exam: "தேர்வு பகுதி", insights: "முன்னேற்றம்", planner: "திட்டம்", extras: "மேலும்", profile: "சுயவிவரம்",
    save: "மாற்றங்களைச் சேமி", cancel: "ரத்து செய்", close: "மூடு", start: "கற்கத் தொடங்கு", welcome: "மீண்டும் வரவேற்கிறோம்", greeting: "உங்கள் அடுத்த கற்றல் அமர்வு இங்கே தொடங்குகிறது.",
    aiTest: "AI கற்றல் சோதனை", aiPrompt: "இடைவெளி விட்டு பயிற்சி செய்வது நினைவாற்றலுக்கு ஏன் உதவுகிறது என்பதை இரண்டு வாக்கியங்களில் விளக்கவும்.", loading: "சிந்திக்கிறது...", coming: "அடுத்த கட்டத்தில் வரும்", theme: "தோற்றத்தை மாற்று", language: "மொழி", dailyGoal: "தினசரி படிப்பு இலக்கு", minutes: "நிமி / நாள்"
  },
  tanglish: {
    dashboard: "Home", learn: "Karka", notes: "Notes Studio", practice: "Practice", exam: "Exam Zone", insights: "Progress", planner: "Plan", extras: "More", profile: "Profile",
    save: "Changes save pannunga", cancel: "Cancel", close: "Close", start: "Learning start pannunga", welcome: "Ungalai meendum paarkiradhu santhosham", greeting: "Unga next learning session inga start aagum.",
    aiTest: "AI learning check", aiPrompt: "Spaced practice memory-ku eppadi help pannum nu rendu short sentences-la explain pannunga.", loading: "Think pannitu irukku...", coming: "Next phase-la varum", theme: "Theme maathunga", language: "Language", dailyGoal: "Daily study goal", minutes: "min / day"
  }
};

export function t(key) {
  return labels[get("profile").language]?.[key] || labels.en[key] || key;
}

export function setLanguage(language) {
  if (!languageOptions.some((option) => option.value === language)) throw new Error("Unsupported language.");
  update("profile", { language });
}