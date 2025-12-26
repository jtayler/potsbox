// potsbox index.js — Operator + Intent Routing (Conservative, Stable)
// CommonJS — paste and run

const WebSocket = require("ws");
const http = require("http");

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

const OPERATOR_VOICES = ["echo", "shimmer", "coral", "onyx", "sage", "cedar"];

function randomOperatorVoice() {
  return OPERATOR_VOICES[
    Math.floor(Math.random() * OPERATOR_VOICES.length)
  ];
}

const VOICES = {
  prayer: "marin",
  joke: "ballad",
  time: "verse",
  horoscope: "nova",
  science: "ash",
  story: "fable",
};

let currentVoice = null;
let operatorVoice = randomOperatorVoice();
currentVoice = operatorVoice;

const DEFAULT_WEATHER_CITY = "New York City";
let awaitingWeatherLocation = false;
async function getWeatherReport(city) {
  // 1) geocode city -> lat/lon
  const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  const geo = await fetch(geoUrl).then(r => r.json());
  const hit = geo?.results?.[0];
  if (!hit) return null;

  const { latitude, longitude, name, admin1, country } = hit;

  // 2) current weather
  const wxUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    `&current=temperature_2m,wind_speed_10m,precipitation,weather_code` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph`;
  const wx = await fetch(wxUrl).then(r => r.json());

  const cur = wx?.current;
  if (!cur) return null;

  // Super short “radio” read (no fake precision)
  const place = [name, admin1, country].filter(Boolean).join(", ");
  return `Weather for ${place}: ${Math.round(cur.temperature_2m)} degrees, wind ${Math.round(cur.wind_speed_10m)} miles an hour, precipitation ${cur.precipitation} inches right now.`;
}

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
// SPARK IT UP
// =====================================================

http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/call/start") {
    runCall().catch(console.error);
    res.end("CALL STARTED\n");
    return;
  }
  res.statusCode = 404;
  res.end();
}).listen(3000, () => {
  console.log("Listening on :3000");
});


// =====================================================
// FILES: CLEANUP AT STARTUP
// =====================================================

const TTS_DIR = "asterisk-sounds/tts";
const MAX_AGE_MS = 60 * 1000; // 60 seconds

function cleanupTTS() {
  if (!fs.existsSync(TTS_DIR)) return;

  const now = Date.now();

  for (const f of fs.readdirSync(TTS_DIR)) {
    const p = `${TTS_DIR}/${f}`;
    try {
      const stat = fs.statSync(p);
      if (now - stat.mtimeMs > MAX_AGE_MS) {
        fs.unlinkSync(p);
      }
    } catch {}
  }
}

cleanupTTS();

// =====================================================
// AUDIO: RECORD MIC
// =====================================================
function recordOnce({ outFile = "input.wav", maxMs = 6000 } = {}) {
  return new Promise((resolve) => {
    const micInstance = mic({
      rate: "16000",
      channels: "1",
      exitOnSilence: 1,
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

  const fname = `tts-${call.id}-${Date.now()}.wav`;
  const outPath = `asterisk-sounds/tts/${fname}`;

  log("TTS:", s, "→", fname);

  return enqueueAudio(async () => {
    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: currentVoice,
      input: s,
      format: "wav"
    });

    const buf = Buffer.from(await speech.arrayBuffer());
    fs.writeFileSync(outPath, buf);

    // 🔊 LOCAL SPEAKER (keep this until phone arrives)
    await new Promise(r => exec(`afplay "${outPath}"`, r));

    log("READY FOR ASTERISK PLAYBACK:", `custom/tts/${fname}`);
    setTimeout(() => {
      fs.unlink(outPath, () => {});
    }, 60_000); // 60s is plenty
  });
}

// =====================================================
// INTENT ROUTER (masked)
// =====================================================
async function routeIntentMasked(heardRaw) {
  const stopCrossbar = startCrossbar();

  try {
    const r = await openai.responses.create({
      max_output_tokens: 40,
      temperature: 0,
      model: "gpt-4o-mini",
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
      model: "gpt-4o-mini",
      max_output_tokens: 120,
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
    model: "gpt-4o-mini",
    max_output_tokens: 120,
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

function zodiacSignForDate(date = new Date()) {
  const m = date.getMonth() + 1; // 1–12
  const d = date.getDate();

  if ((m === 3 && d >= 21) || (m === 4 && d <= 19)) return "Aries";
  if ((m === 4 && d >= 20) || (m === 5 && d <= 20)) return "Taurus";
  if ((m === 5 && d >= 21) || (m === 6 && d <= 20)) return "Gemini";
  if ((m === 6 && d >= 21) || (m === 7 && d <= 22)) return "Cancer";
  if ((m === 7 && d >= 23) || (m === 8 && d <= 22)) return "Leo";
  if ((m === 8 && d >= 23) || (m === 9 && d <= 22)) return "Virgo";
  if ((m === 9 && d >= 23) || (m === 10 && d <= 22)) return "Libra";
  if ((m === 10 && d >= 23) || (m === 11 && d <= 21)) return "Scorpio";
  if ((m === 11 && d >= 22) || (m === 12 && d <= 21)) return "Sagittarius";
  if ((m === 12 && d >= 22) || (m === 1 && d <= 19)) return "Capricorn";
  if ((m === 1 && d >= 20) || (m === 2 && d <= 18)) return "Aquarius";
  return "Pisces"; // Feb 19 – Mar 20
}

async function tellHoroscope(openai) {
  const now = new Date();
  const weekday = now.toLocaleString("en-US", { weekday: "long" });
  const month = now.toLocaleString("en-US", { month: "long" });
  const day = now.getDate();
  const sign = zodiacSignForDate(now);

  const r = await openai.responses.create({
    model: "gpt-4o-mini",
    max_output_tokens: 120,
    input: [
      {
        role: "system",
        content:
          `You are Horoscopes-by-Phone, broadcasting live like a late-night AM radio show.\n` +
          `Today is ${weekday}, ${month} ${day}. The stars are parked in ${sign}.\n\n` +
          `Deliver ONE short horoscope for ${sign}.\n` +
          `Richard Pryor raw adult humor and energy. Confident, mischievous, a little dangerous.\n` +
          `Open with the date and sign like a DJ, then hit the prediction.\n` +
          `No birth questions. No disclaimers. End strong.`
      }
    ]
  });

  return (r.output_text || "").trim();
}

async function answerScience(openai, question, context) {
  const r = await openai.responses.create({
    model: "gpt-4o-mini",
    max_output_tokens: 120,
    input: [
      {
        role: "system",
        content:
          "You are the Science Line on a public telephone exchange. " +
          "Ask and chat with short responses. You are like Jim Al Khalili a documentarian and teacher who loves to excite people about science. Ask about one idea regarding rocks, the early earth or the universe and extra points for esoteric or oddly interesting cutting edge things you want to know about at a party why is the sky blue to why do electrons stop being random when you observe them? 2–3 sentences max simple question form. Challenge the listener to respond then talk about it. This question should be something anyone from kids to random people off the street would find amusing and you reveal the answer and talk about it in a fun way."
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
    model: "gpt-4o-mini",
    max_output_tokens: 120,
    input: [
      {
        role: "system",
        content:
          "You are Story Line. Tell ONE short VERY SHORT children's story " +
          "about the Fearless Flying Taylers — Jesse, Paraskevi, Ellison, and Remy — " +
          "a group of siblings aged 6–13 in New York City who are entertainers and detectives. " +
          "Warm, adventurous, playful and quick. Then stop saying they are a happy family"
      }
    ]
  });
  return (r.output_text || "").trim();
}

async function directoryResponse(openai, request) {
  const r = await openai.responses.create({
    model: "gpt-4o-mini",
    max_output_tokens: 120,
    input: [
      {
        role: "system",
        content:
          "You are a 1970s telephone directory operator. " +
          "Politely confirm or deny connections. If food ordering or seamless is requested, " +
          "decline it as 'fattening' in a dry, humorous way."
      },
      { role: "user", content: request }
    ]
  });
  return (r.output_text || "").trim();
}

async function tellJoke(openai) {
  const r = await openai.responses.create({
    max_output_tokens: 120,
    model: "gpt-4o-mini",
    input: [
      {
        role: "system",
        content:
          "You are a Dial-a-Joke line. Tell ONE very short dirty adult entertaining raw and funny joke as Richard Pryor would and stop."
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
    model: "gpt-4o-mini-transcribe"
  });

  return (stt.text || "").trim();
}

// =====================================================
// MAIN CALL
// =====================================================
// =====================================================
// CALL LOOP (DO NOT AUTO-START)
// =====================================================
async function runCall() {
  const stopCrossbar = startCrossbar();
currentVoice = OPERATOR_VOICES[
  Math.floor(Math.random() * OPERATOR_VOICES.length)
];

  try {
    await speak("Operator! How may I help you?"); // ← initial answer
    while (true) {

      const heardRaw = await streamTranscribe();
      log("HEARD:", heardRaw);

// If we asked for a location, treat the next utterance as the location (ignore intent routing)
if (awaitingWeatherLocation) {
  awaitingWeatherLocation = false;
  const city = heardRaw.trim() || DEFAULT_WEATHER_CITY;

  const report = await getWeatherReport(city);
  if (!report) {
    await speak("I couldn't find that location. Try saying the city and state.");
    awaitingWeatherLocation = true;
    continue;
  }

  await speak(report);
  await speak("Goodbye.");
  break;
}

      if (!heardRaw) {
        await speak("Are you still there?");
        continue;
      }

      if (/bye|goodbye|that's all|hang up/i.test(heardRaw)) {
        await speak("Alright. Goodbye.");
        break; // ← END CALL
      }

      const intent = await routeIntentMasked(heardRaw);
      log("INTENT:", intent);

      if (intent.action === "SERVICE_TIME" && intent.confidence > 0.6) {
          currentVoice = VOICES.time;
        await speak(`The time is ${getTime()}.`);
        await speak("Goodbye.");
currentVoice = operatorVoice;
        break;
      }

      if (intent.action === "SERVICE_SCIENCE" && intent.confidence > 0.6) {
        const answer = await answerScience(openai, heardRaw, buildContext());
        if (answer) {
          currentVoice = VOICES.science;
          await speak(answer);
currentVoice = operatorVoice;
          addTurn(heardRaw, answer);
        }
        continue;
      }

      if (intent.action === "SERVICE_PRAYER" && intent.confidence > 0.6) {
        currentVoice = VOICES.prayer;
        await speak(await tellPrayer(openai));
        await speak("Have a nice day.");
currentVoice = operatorVoice;
        break;
      }

      if (intent.action === "SERVICE_HOROSCOPE" && intent.confidence > 0.6) {
        currentVoice = VOICES.horoscope;
        await speak(await tellHoroscope(openai));
        await speak("Catch you later.");
currentVoice = operatorVoice;
        break;
      }

      if (intent.action === "SERVICE_STORY" && intent.confidence > 0.6) {
        currentVoice = VOICES.story;
        await speak(await tellStory(openai));
        await speak("See you soon.");
currentVoice = operatorVoice;
        break;
      }

      if (intent.action === "SERVICE_DIRECTORY" && intent.confidence > 0.6) {
        currentVoice = operatorVoice;
        await speak(await directoryResponse(openai, heardRaw));
        await speak("Goodbye.");
        break;
      }

if (intent.action === "SERVICE_WEATHER" && intent.confidence > 0.6) {
  const report = await getWeatherReport(DEFAULT_WEATHER_CITY);
  if (!report) {
    await speak("Weather service is temporarily unavailable. Goodbye.");
    break;
  }

  await speak(report);
  await speak("Goodbye.");
  break;
}

      if (intent.action === "SERVICE_JOKE" && intent.confidence > 0.6) {
        currentVoice = VOICES.joke;
        await speak(await tellJoke(openai));
        await speak("Catch ya later alligator.");
currentVoice = operatorVoice;
        break;
      }

      // Default
      await operatorChat(heardRaw);
    }
  } finally {
    stopCrossbar();
  }
}
