import { get } from "./storage.js";
import { normalizePrompt } from "./prompts.js";
import { sampleResponse, sampleStructuredResponse, sampleTextResponse } from "./demoData.js";

function friendlyMessage(payload, status) {
  if (payload?.error?.message) return payload.error.message;
  if (status === 429) return "The service is busy. Please wait a moment and try again.";
  return "We could not reach the learning service. A demo response is shown instead.";
}

async function post(endpoint, body) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(friendlyMessage(payload, response.status));
    error.code = payload?.error?.code || "NETWORK";
    throw error;
  }
  return payload;
}

function demoEnabled() {
  return get("settings").demoMode;
}

export async function ask(promptObj) {
  const fallback = () => sampleTextResponse(promptObj?.demoType, promptObj?.context, { marks: promptObj?.demoMarks });
  if (demoEnabled()) return fallback();
  try {
    const { text } = await post("/api/generate", { prompt: normalizePrompt(promptObj) });
    return text || fallback();
  } catch {
    return fallback();
  }
}

export async function askJSON(promptObj, validatorFn) {
  const validate = (data) => {
    if (typeof validatorFn === "function" && validatorFn(data) === false) throw new Error("The response did not match the expected shape.");
    return data;
  };
  const fallback = () => validate(sampleStructuredResponse(promptObj?.demoType, promptObj?.context, { count: promptObj?.demoCount, difficulty: promptObj?.demoDifficulty, index: promptObj?.demoIndex, marks: promptObj?.demoMarks, hours: promptObj?.demoHours }));
  if (demoEnabled()) return fallback();
  const responseSchema = promptObj?.responseSchema || {
    type: "OBJECT",
    properties: { title: { type: "STRING" }, summary: { type: "STRING" }, nextStep: { type: "STRING" } },
    required: ["title", "summary", "nextStep"]
  };
  const basePrompt = normalizePrompt(promptObj);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { text } = await post("/api/generate-json", {
        prompt: attempt ? `${basePrompt}\n\nReturn valid JSON only. Do not include markdown fences or extra text.` : basePrompt,
        responseSchema
      });
      const parsed = JSON.parse(text);
      return validate(parsed);
    } catch (error) {
      if (attempt === 1 && !demoEnabled()) return fallback();
      if (error.code) return fallback();
    }
  }
  return fallback();
}

export async function stream(promptObj, onChunk) {
  if (demoEnabled()) {
    const text = sampleResponse();
    onChunk?.(text);
    return text;
  }
  let fullText = "";
  try {
    const response = await fetch("/api/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: normalizePrompt(promptObj) })
    });
    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(friendlyMessage(payload, response.status));
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const event of events) {
        if (event.startsWith("event: error")) throw new Error("The AI stream stopped unexpectedly.");
        const line = event.split("\n").find((part) => part.startsWith("data: "));
        if (!line || line === "data: [DONE]") continue;
        const chunk = JSON.parse(line.slice(6)).text || "";
        fullText += chunk;
        onChunk?.(chunk);
      }
    }
    return fullText;
  } catch {
    if (fullText) return fullText;
    const fallback = sampleResponse();
    onChunk?.(fallback);
    return fallback;
  }
}