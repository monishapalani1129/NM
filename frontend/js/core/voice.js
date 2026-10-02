import { toast } from "./ui.js";

function voiceLanguage(language) {
  return language === "ta" ? "ta-IN" : "en-IN";
}

export function listen({ language = "en", onStart, onEnd } = {}) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    toast("Voice input is not supported in this browser. Type your response instead.", "error");
    return Promise.resolve("");
  }
  return new Promise((resolve) => {
    const recognition = new Recognition();
    recognition.lang = voiceLanguage(language);
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => onStart?.();
    recognition.onend = () => onEnd?.();
    recognition.onerror = (event) => {
      if (event.error !== "aborted" && event.error !== "no-speech") {
        toast("Voice input could not start. Type your response instead.", "error");
      }
      resolve("");
    };
    recognition.onresult = (event) => resolve(event.results?.[0]?.[0]?.transcript || "");
    try {
      recognition.start();
    } catch {
      toast("Voice input is unavailable right now. Type your response instead.", "error");
      resolve("");
    }
  });
}

export function speak(text, language = "en") {
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
    toast("Audio playback is not supported in this browser. Read the response above.", "error");
    return false;
  }
  const locale = voiceLanguage(language);
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find((item) => item.lang.toLowerCase() === locale.toLowerCase())
    || voices.find((item) => item.lang.toLowerCase().startsWith(locale.slice(0, 2).toLowerCase()));
  if (language === "ta" && !voice) {
    toast("A Tamil speech voice is not installed in this browser. Read the response above.", "error");
    return false;
  }
  const utterance = new SpeechSynthesisUtterance(String(text));
  utterance.lang = locale;
  if (voice) utterance.voice = voice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  return true;
}