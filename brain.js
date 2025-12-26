// brain.js — GPT intent + operator + service stubs (NO audio primitives here)

function buildContext(history) {
  if (!history?.length) return "No prior conversation.";
  return history
    .slice(-8)
    .map((t, i) => `Turn ${i + 1}\nCaller: ${t.heard}\nOperator: ${t.replied}`)
    .join("\n\n");
}

async function routeIntent(openai, heardRaw, history) {
  const r = await openai.responses.create({
    model: "gpt-4.1-mini",
    text: { format: { type: "json_object" } },
    input: [
      {
        role: "system",
        content:
          "Classify the caller's intent for a playful telephone operator system.\n" +
          "Return JSON only: { action, confidence, target }\n\n" +
          "action must be one of:\n" +
          "- JOKE\n" +
          "- TIME\n" +
          "- WEATHER\n" +
          "- DIAL (caller wants a person/place/number)\n" +
          "- HANGUP\n" +
          "- CHAT\n\n" +
          "confidence is 0..1. target is string or null.\n" +
          "Do NOT include extra keys."
      },
      {
        role: "user",
        content:
          `Conversation:\n${buildContext(history)}\n\nCaller: ${heardRaw}`
      }
    ]
  });

  let obj;
  try {
    obj = JSON.parse(r.output_text || "{}");
  } catch {
    obj = { action: "CHAT", confidence: 0.0, target: null };
  }

  // normalize
  obj.action = (obj.action || "CHAT").toString().toUpperCase();
  obj.confidence = Number(obj.confidence ?? 0);
  if (!Number.isFinite(obj.confidence)) obj.confidence = 0;
  if (obj.confidence < 0) obj.confidence = 0;
  if (obj.confidence > 1) obj.confidence = 1;
  obj.target = obj.target == null ? null : String(obj.target);

  return obj;
}

async function operatorReply(openai, heardRaw, history) {
  const r = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "You are a classic telephone operator. Warm, slightly old-fashioned, but not flirty. " +
          "Speak in one short sentence. English only."
      },
      {
        role: "user",
        content:
          `Conversation:\n${buildContext(history)}\n\nCaller: ${heardRaw}\nOperator:`
      }
    ]
  });

  return (r.output_text || "").trim();
}

async function tellJoke(openai) {
  const r = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "You are a Dial-a-Joke line. Tell ONE short clean joke and stop."
      }
    ]
  });
  return (r.output_text || "").trim();
}

function getTimeString(tz = "America/New_York") {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(new Date());
}

module.exports = {
  routeIntent,
  operatorReply,
  tellJoke,
  getTimeString
};
