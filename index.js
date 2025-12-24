// potsbox index.js — Operator + Intent Routing (Conservative, Stable)
// CommonJS — paste and run

const fs = require("fs");
const mic = require("mic");
const OpenAI = require("openai");
const { exec, spawn } = require("child_process");
const crypto = require("crypto");

if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY in environment.");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const log = (...a) => console.log(new Date().toISOString(), ...a);

// =====================================================
// CONFIG
// =====================================================
const CALLER_TZ = process.env.CALLER_TZ || "America/New_York";
const CROSSBAR_FILE = "recordings/crossbar_connect_sound.wav";

const VOICES = { operator: "alloy" };

// =====================================================
// CALL SESSION
// =====================================================
const call = {
  id: crypto.randomUUID(),
  greeted: false,
  history: []
};

function addTurn(heard, replied) {
  call.history.push({ heard, replied });
  if (call.history.length > 8) call.history.shift();
}

function buildContext() {
  if (!call.history.length) return "No prior conversation.";
  return call.history
    .map(t => `Caller: ${t.heard}\nOperator: ${t.replied}`)
    .join("\n\n");
}

// =====================================================
// CROSSBAR (latency masking)
// =====================================================
function startCrossbar() {
  const child = spawn("afplay", [CROSSBAR_FILE], { stdio: "ignore" });
  return () => {
    try { child.kill("SIGKILL"); } catch {}
  };
}

// =====================================================
// AUDIO: RECORD MIC
// =====================================================
function recordOnce({ outFile = "input.wav", maxMs = 6000 } = {}) {
  return new Promise((resolve) => {
    const micInstance = mic({
      rate: "16000",
      channels: "1",
      exitOnSilence: 2,
      fileType: "wav"
    });

    const stream = micInstance.getAudioStream();
    const out = fs.createWriteStream(outFile);
    stream.pipe(out);

    setTimeout(() => {
      try { micInstance.stop(); } catch {}
    }, maxMs);

    out.on("close", resolve);
    micInstance.start();
  });
}

// =====================================================
// AUDIO: TTS (WAV only)
// =====================================================
async function speak(text) {
  const s = (text || "").trim();
  if (!s) return;

  log("TTS:", s);

  const speech = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: VOICES.operator,
    input: s,
    format: "wav"
  });

  fs.writeFileSync("out.wav", Buffer.from(await speech.arrayBuffer()));
  await new Promise(r => exec("afplay out.wav", r));
}

// =====================================================
// INTENT ROUTER (masked)
// =====================================================
async function routeIntentMasked(heardRaw) {
  const stopCrossbar = startCrossbar();

  try {
    const r = await openai.responses.create({
      model: "gpt-4.1-mini",
      text: { format: { type: "json_object" } },
      input: [
        {
          role: "system",
          content:
            "You are a telephone exchange controller.\n" +
            "Decide the caller's intent.\n\n" +
            "Actions:\n" +
            "- SERVICE_TIME\n" +
            "- SERVICE_WEATHER\n" +
            "- SERVICE_JOKE\n" +
            "- OPERATOR_CHAT\n\n" +
            "Return JSON only:\n" +
            "{ \"action\": string, \"confidence\": number }"
        },
        { role: "user", content: heardRaw }
      ]
    });

    return JSON.parse(r.output_text || "{}");
  } finally {
    stopCrossbar();
  }
}

// =====================================================
// OPERATOR RESPONSE (non-flirty, era-neutral)
// =====================================================
async function operatorChat(heardRaw) {
  const stopCrossbar = startCrossbar();

  try {
    const r = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You are a 1970s telephone operator. " +
            "Calm, efficient, polite. Slight warmth, no slang, no flirtation. " +
            "1–2 sentences."
        },
        {
          role: "user",
          content:
            `Conversation so far:\n${buildContext()}\n\nCaller: ${heardRaw}\nOperator:`
        }
      ]
    });

    const reply = (r.output_text || "").trim();
    await speak(reply);
    addTurn(heardRaw, reply);
  } finally {
    stopCrossbar();
  }
}

// =====================================================
// SERVICES
// =====================================================
function getTime() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CALLER_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(new Date());
}

// =====================================================
// MAIN LOOP
// =====================================================
(async function run() {
  log("CALL START:", call.id);

  while (true) {
    if (!call.greeted) {
      await speak("Operator. How may I help you?");
      call.greeted = true;
    }

    await recordOnce();

    const stt = await openai.audio.transcriptions.create({
      file: fs.createReadStream("input.wav"),
      model: "gpt-4o-transcribe"
    });

    const heardRaw = (stt.text || "").trim();
    log("HEARD:", heardRaw);

    if (!heardRaw) {
      await speak("Are you still there?");
      continue;
    }

    // Immediate hang-up
    if (/bye|goodbye|that's all|hang up/i.test(heardRaw)) {
      await speak("Alright. Goodbye.");
      process.exit(0);
    }

    const intent = await routeIntentMasked(heardRaw);
    log("INTENT:", intent);

    if (intent.action === "SERVICE_TIME" && intent.confidence > 0.6) {
      const t = getTime();
      await speak(`The time is ${t}.`);
      addTurn(heardRaw, `Time given: ${t}`);
      continue;
    }

    // Everything else → operator
    await operatorChat(heardRaw);
  }
})();
