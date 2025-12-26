// gptController.js
const OpenAI = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function classifyIntent(text, context) {
  const r = await openai.responses.create({
    model: "gpt-4.1-mini",
    text: { format: { type: "json_object" } },
    input: [
      {
        role: "system",
        content:
          "Decide intent. Return JSON: { action, confidence }"
      },
      { role: "user", content: text }
    ]
  });
  return JSON.parse(r.output_text || "{}");
}

async function generateReply(text, context) {
  const r = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "You are a telephone operator. Calm, polite, 1–2 sentences."
      },
      { role: "user", content: `${context}\nCaller: ${text}\nOperator:` }
    ]
  });
  return (r.output_text || "").trim();
}

async function generateJoke() {
  const r = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "Tell ONE short joke, end after the joke. Be like Richard Pryor, not clean that is boring and not funny."
      }
    ]
  });
  return (r.output_text || "").trim();
}

module.exports = {
  classifyIntent,
  generateReply,
  generateJoke
};
