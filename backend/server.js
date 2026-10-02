const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const { rateLimit } = require("express-rate-limit");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const port = Number(process.env.PORT) || 3000;
const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const frontendPath = path.join(__dirname, "..", "frontend");
const maxInputLength = 30000;

app.disable("x-powered-by");
app.use(cors({
  origin(origin, callback) {
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("CORS origin not allowed"));
  }
}));
app.use(express.json({ limit: "1mb" }));
app.use("/api", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler(_request, response) {
    response.status(429).json(friendlyError("RATE_LIMIT", "Too many requests. Please wait a moment and try again."));
  }
}));

function friendlyError(code, message) {
  return { error: { code, message } };
}

function mapError(error) {
  const status = Number(error?.status || error?.statusCode);
  const detail = String(error?.message || "").toLowerCase();
  if (status === 429) return friendlyError("RATE_LIMIT", "The AI service is busy. Please wait a moment and try again.");
  if (status === 401 || status === 403 || /api key|api_key|invalid key|permission denied/.test(detail)) {
    return friendlyError("INVALID_KEY", "The AI service key is missing or invalid. Check the backend configuration.");
  }
  if (/safety|blocked|prohibited content/.test(detail) || error?.finishReason === "SAFETY") {
    return friendlyError("SAFETY_BLOCKED", "This request could not be answered because it was blocked by safety checks. Try rephrasing it.");
  }
  if (/enotfound|econn|network|fetch failed|socket|timed out/.test(detail)) {
    return friendlyError("NETWORK", "Could not reach the AI service. Check your connection and try again.");
  }
  return friendlyError("UNKNOWN", "Something went wrong while generating a response. Please try again.");
}

function getPrompt(request, response) {
  const prompt = request.body?.prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    response.status(400).json(friendlyError("INVALID_INPUT", "Add a prompt before requesting an AI response."));
    return null;
  }
  if (prompt.length > maxInputLength) {
    response.status(413).json(friendlyError("INPUT_TOO_LONG", "Your request is too long. Keep it under 30,000 characters."));
    return null;
  }
  return prompt;
}

function getClient() {
  if (!process.env.GEMINI_API_KEY) {
    const error = new Error("Missing API key");
    error.status = 401;
    throw error;
  }
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

async function generate(prompt, config) {
  const client = getClient();
  const result = await client.models.generateContent({ model, contents: prompt, config });
  const blocked = result?.candidates?.some((candidate) => candidate.finishReason === "SAFETY");
  if (blocked) {
    const error = new Error("Response blocked by safety checks");
    error.finishReason = "SAFETY";
    throw error;
  }
  return result.text || "";
}

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", model, apiKeyConfigured: Boolean(process.env.GEMINI_API_KEY) });
});

app.post("/api/generate", async (request, response) => {
  const prompt = getPrompt(request, response);
  if (!prompt) return;
  try {
    response.json({ text: await generate(prompt) });
  } catch (error) {
    const result = mapError(error);
    response.status(result.error.code === "INVALID_KEY" ? 503 : result.error.code === "RATE_LIMIT" ? 429 : 502).json(result);
  }
});

app.post("/api/generate-json", async (request, response) => {
  const prompt = getPrompt(request, response);
  if (!prompt) return;
  const responseSchema = request.body?.responseSchema;
  if (!responseSchema || typeof responseSchema !== "object") {
    response.status(400).json(friendlyError("INVALID_INPUT", "A JSON response schema is required."));
    return;
  }
  try {
    const text = await generate(prompt, { responseMimeType: "application/json", responseSchema });
    response.json({ text });
  } catch (error) {
    const result = mapError(error);
    response.status(result.error.code === "INVALID_KEY" ? 503 : result.error.code === "RATE_LIMIT" ? 429 : 502).json(result);
  }
});

app.post("/api/stream", async (request, response) => {
  const prompt = getPrompt(request, response);
  if (!prompt) return;
  try {
    const client = getClient();
    const stream = await client.models.generateContentStream({ model, contents: prompt });
    response.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    response.flushHeaders();
    for await (const chunk of stream) {
      if (chunk?.candidates?.some((candidate) => candidate.finishReason === "SAFETY")) {
        const error = new Error("Response blocked by safety checks");
        error.finishReason = "SAFETY";
        throw error;
      }
      const text = chunk.text || "";
      if (text) response.write(`data: ${JSON.stringify({ text })}\n\n`);
    }
    response.write("data: [DONE]\n\n");
    response.end();
  } catch (error) {
    const result = mapError(error);
    if (!response.headersSent) {
      response.status(result.error.code === "INVALID_KEY" ? 503 : result.error.code === "RATE_LIMIT" ? 429 : 502).json(result);
      return;
    }
    response.write(`event: error\ndata: ${JSON.stringify(result)}\n\n`);
    response.end();
  }
});

app.get("/", (_request, response) => response.sendFile(path.join(frontendPath, "index.html")));
app.use(express.static(frontendPath));
app.use((error, _request, response, _next) => {
  if (error.status === 413 || error.type === "entity.too.large") {
    response.status(413).json(friendlyError("INPUT_TOO_LONG", "Your request is too long. Keep it under 30,000 characters."));
    return;
  }
  if (error.message === "CORS origin not allowed") {
    response.status(403).json(friendlyError("CORS_BLOCKED", "This local service only accepts requests from localhost."));
    return;
  }
  if (error instanceof SyntaxError && "body" in error) {
    response.status(400).json(friendlyError("INVALID_INPUT", "The request body must be valid JSON."));
    return;
  }
  response.status(500).json(friendlyError("UNKNOWN", "The server could not complete that request."));
});

app.listen(port, () => console.log(`EduGenie is running at http://localhost:${port}`));