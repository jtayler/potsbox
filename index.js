// potsbox index.js — Operator + Intent Routing (Conservative, Stable)
// CommonJS — paste and run

const WebSocket = require("ws");

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
  let child;

  enqueueAudio(async () => {
    child = spawn("afplay", [CROSSBAR_FILE], { stdio: "ignore" });
  });

  return () => {
    enqueueAudio(async () => {
      try { child && child.kill("SIGKILL"); } catch {}
    });
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
      exitOnSilence: 0.2,
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
async function speak(text, voice = VOICES.operator) {
  const s = (text || "").trim();
  if (!s) return;

  log("TTS:", s);

  return enqueueAudio(async () => {
    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice,                 // ← fixed
      input: s,
      format: "wav"
    });

    fs.writeFileSync("out.wav", Buffer.from(await speech.arrayBuffer()));
    await new Promise(r => exec("afplay out.wav", r));
  });
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
"- SERVICE_PRAYER\n" +
"- SERVICE_HOROSCOPE\n" +
"- SERVICE_SCIENCE\n" +
"- SERVICE_STORY\n" +
"- SERVICE_DIRECTORY\n" +
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

let audioQueue = Promise.resolve();

function enqueueAudio(fn) {
  audioQueue = audioQueue.then(fn).catch(() => {});
  return audioQueue;
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

async function tellPrayer(openai) {
  const r = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "You are Dial-a-Prayer. Offer ONE short, sharp and humorous, atheist prayer " +
          "It is part of the Flying Spaghetti Monster, you know the religion. End by ripping religion."
      }
    ]
  });
  return (r.output_text || "").trim();
}

async function tellHoroscope(openai) {
  const r = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "You are Horoscopes-by-Phone. Deliver ONE short, Richard Pryor style horoscope. " +
          "Do not ask for birth details. Keep it shocking funny and short."
      }
    ]
  });
  return (r.output_text || "").trim();
}

async function answerScience(openai, question, context) {
  const r = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "You are the Science Line on a public telephone exchange. " +
          "Answer clearly and calmly. Like Neil Jim Al Khalili One idea about rocks, the early earth or the universe extra points for esoteric or oddly interesting cutting edge things you want to know about at a party why is the sky blue to why do electrons stop being random when you observe them? 2–3 sentences max simple question form. Challenge the listener to respond then talk about it."
      },
      {
        role: "user",
        content:
          `Conversation so far:\n${context}\n\nCaller asks:\n${question}`
      }
    ]
  });
  return (r.output_text || "").trim();
}

async function tellStory(openai) {
  const r = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "You are Story Line. Tell ONE short children's story " +
          "about the Fearless Flying Taylers — Jesse, Paraskevi, Ellison, and Remy — " +
          "a group of siblings aged 6–13 in New York City who are entertainers and detectives. " +
          "Warm, adventurous, playful. 30–45 seconds. Then stop."
      }
    ]
  });
  return (r.output_text || "").trim();
}

async function directoryResponse(openai, request) {
  const r = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "You are a 1970s telephone directory operator. " +
          "Politely confirm or deny connections. If pizza is requested, " +
          "decline it as 'fattening' in a dry, humorous way."
      },
      { role: "user", content: request }
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
          "You are a Dial-a-Joke line. Tell ONE short raw and funny joke like Richard Pryor and stop."
      }
    ]
  });
  return (r.output_text || "").trim();
}

async function streamTranscribe() {
  // Record a short utterance into memory (no files), stop on silence
  const wavBuffer = await new Promise((resolve) => {
    const chunks = [];

    const micInstance = mic({
      rate: "16000",
      channels: "1",
      // IMPORTANT: mic expects integer seconds here; 0 disables silence stop.
      exitOnSilence: 8,
      fileType: "wav"
    });

    const micStream = micInstance.getAudioStream();

    const hardStop = setTimeout(() => {
      try { micInstance.stop(); } catch {}
    }, 6000);

    micStream.on("data", (d) => chunks.push(d));

    // Works on many setups; if it doesn't, the hardStop still ends it.
    micStream.on("silence", () => {
      try { micInstance.stop(); } catch {}
    });

    micStream.on("error", () => {
      clearTimeout(hardStop);
      resolve(Buffer.alloc(0));
    });

    micStream.on("stopComplete", () => {
      clearTimeout(hardStop);
      resolve(Buffer.concat(chunks));
    });

    // Fallback: some installs don't emit stopComplete reliably
    micStream.on("close", () => {
      clearTimeout(hardStop);
      resolve(Buffer.concat(chunks));
    });

    micInstance.start();
  });

  if (!wavBuffer || wavBuffer.length === 0) return "";

  // Node 20 has File built-in; OpenAI SDK accepts File
  const file = new File([wavBuffer], "input.wav", { type: "audio/wav" });

  const stt = await openai.audio.transcriptions.create({
    file,
    model: "gpt-4o-transcribe"
  });

  return (stt.text || "").trim();
}

// =====================================================
// MAIN LOOP
// =====================================================
(async function run() {
  log("CALL START:", call.id);

    const stopCrossbar = startCrossbar();

  while (true) {
    if (!call.greeted) {
      await speak("Operator. How may I help you?");
      call.greeted = true;
    }


const heardRaw = await streamTranscribe();
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
  await speak("Goodbye.");
  process.exit(0);
    }

if (intent.action === "SERVICE_SCIENCE" && intent.confidence > 0.6) {
  const answer = await answerScience(
    openai,
    heardRaw,
    buildContext()
  );

  if (answer) {
    await speak(answer);
    addTurn(heardRaw, answer);
  }

  continue; // ← stay on the line
}
if (intent.action === "SERVICE_PRAYER" && intent.confidence > 0.6) {
  const prayer = await tellPrayer(openai);
  if (prayer) await speak(prayer);
  await speak("Have a nice day.");
  process.exit(0);
}
if (intent.action === "SERVICE_HOROSCOPE" && intent.confidence > 0.6) {
  const horoscope = await tellHoroscope(openai);
  if (horoscope) await speak(horoscope);
  await speak("Catch you later.");
  process.exit(0);
}
if (intent.action === "SERVICE_STORY" && intent.confidence > 0.6) {
  const story = await tellStory(openai);
  if (story) await speak(story);
  await speak("See you soon.");
  process.exit(0);
}
if (intent.action === "SERVICE_WEATHER" && intent.confidence > 0.6) {
  // demo-safe stub for now
  await speak("The weather in New York City is fair and mild today.");
  await speak("Goodbye.");
  process.exit(0);
}

if (intent.action === "SERVICE_DIRECTORY" && intent.confidence > 0.6) {
  const reply = await directoryResponse(openai, heardRaw);
  if (reply) await speak(reply);
  await speak("Goodbye.");
  process.exit(0);
}

if (intent.action === "SERVICE_JOKE" && intent.confidence > 0.6) {
  const joke = await tellJoke(openai);

  if (joke) {
    await speak(joke);
  }

  await speak("Catch ya later alligator.");
  process.exit(0);
}

    // Everything else → operator
    await operatorChat(heardRaw);
  }
})();
