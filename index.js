// potsbox index.js — Operator + Intent Routing (Conservative, Stable)
// CommonJS — paste and run

const SERVICES = require("./services");

const WebSocket = require("ws");
const http = require("http");

const fs = require("fs");
const mic = require("mic");
const OpenAI = require("openai");
const { exec } = require("child_process");
const crypto = require("crypto");
const HANGUP_RE = /\b(bye|goodbye|hang up|get off|gotta go|have to go|see you)\b/i;

const handlers = {
    handleTime: async () => {
        const {
            time,
            seconds
        } = getTimeParts();
        await speak(`At the tone, the time will be ${time} and ${secondsToWords(seconds)}.`);
        await speak("BEEEP!");
        await speak("Goodbye.");
    },

    handleWeather: async () => {
        const report = await getWeatherReport(DEFAULT_WEATHER_CITY);
        if (!report) {
            await speak("Weather service is temporarily unavailable.");
            return;
        }
        const spoken = await narrateWeather(openai, report);
        await speak(spoken);
        await speak("Remember folks, if you don't like the weather, wait five minutes. Good-bye.");
    },

    handleJoke: async () => {
        await speak(await tellJoke(openai));
        await speak("Good-bye.");
    },

    handlePrayer: async () => {
        await speak(await tellPrayer(openai));
        await speak("Remember folks, if you don't pray in my school, I won't think in your church. Good-Bye.");
    },

    handleHoroscope: async () => {
        await speak(await tellHoroscope(openai));
        await speak("The stars have spoken. Good-bye.");
    },

    handleStory: async () => {
        await speak(await tellStory(openai));
        await speak("That's all for tonight. Good-night, sleep tight.");
    },

    handleOpener: async (service) => {
        if (service === "SCIENCE") {
            const opener = await answerScience(openai, "", "No prior conversation.");
            await speak(opener);
            addTurn("[science opener]", opener);
            return;
        }

        const svc = SERVICES[service];
        if (svc?.opener) {
            await speak(svc.opener);
            addTurn(`[${service.toLowerCase()} opener]`, svc.opener);
        }
    }
};

const OPERATOR_VOICES = ["verse", "nova", "ash", "shimmer", "marin", "ballad", "echo", "coral", "onyx", "sage", "cedar", "fable"];

function randomOperatorVoice() {
    return OPERATOR_VOICES[
        Math.floor(Math.random() * OPERATOR_VOICES.length)
    ];
}

handlers.handleLoopTurn = async (service, heardRaw) => {
  const svc = SERVICES[service];
  if (!svc?.onTurn) return false;

  let reply;

  if (svc.onTurn === "science") {
    reply = await answerScience(openai, heardRaw, buildContext());
  } else if (svc.onTurn === "complaints") {
    reply = await answerComplaintDepartment(openai, heardRaw, buildContext());
  } else if (svc.onTurn === "directory") {
    reply = await directoryResponse(openai, heardRaw);
  }

  if (!reply) return false;

  await speak(reply);
  addTurn(heardRaw, reply);
  return true;
};

const url = require("url");

if (!process.env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY in environment.");
    process.exit(1);
}

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});
const log = (...a) => console.log(new Date().toISOString(), ...a);

// =====================================================
// CONFIG
// =====================================================
const CALLER_TZ = process.env.CALLER_TZ || "America/New_York";


let activeService = null; // null | "SCIENCE"
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

    const {
        latitude,
        longitude,
        name,
        admin1,
        country
    } = hit;

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
    call.history.push({
        heard,
        replied
    });
    if (call.history.length > 8) call.history.shift();
}

function buildContext() {
    if (!call.history.length) return "No prior conversation.";
    return call.history
        .map(t => `Caller: ${t.heard}\nOperator: ${t.replied}`)
        .join("\n\n");
}


// =====================================================
// SPARK IT UP
// =====================================================


http.createServer((req, res) => {
    if (req.method === "POST" && req.url.startsWith("/call/start")) {
        const {
            query
        } = url.parse(req.url, true);
        const exten = (query.exten || "0").trim();

        log("INCOMING CALL:", exten);

        startCall({
            exten
        });

        res.end("OK\n");
        return;
    }

    res.statusCode = 404;
    res.end();
}).listen(3000, () => {
    console.log("Listening on :3000");
});

function startCall({
    exten
}) {
    const serviceByExten = {
        "0": "OPERATOR",
        "411": "DIRECTORY",
        "8463": "TIME",
        "9328": "WEATHER",
        "7243": "SCIENCE",
        "7827": "HOROSCOPE",
        "7867": "STORY",
        "9857": "JOKE",
        "4637": "PRAYER",
        "2333": "COMPLAINTS"
    };

    activeService = serviceByExten[exten] || "OPERATOR";
    call.history = [];
    call.greeted = false;
    runCall().catch(console.error);
}

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

    try {
        const r = await openai.responses.create({
            max_output_tokens: 40,
            temperature: 0,
            model: "gpt-4o-mini",
            text: {
                format: {
                    type: "json_object"
                }
            },
            input: [{
                    role: "system",
                    content: "You are a telephone exchange controller.\n" +
                        "Decide the caller's intent.\n\n" +
                        "Actions:\n" +
                        "- SERVICE_TIME\n" +
                        "- SERVICE_WEATHER\n" +
                        "- SERVICE_JOKE\n" +
                        "- SERVICE_PRAYER\n" +
                        "- SERVICE_HOROSCOPE\n" +
                        "- SERVICE_COMPLAINTS\n" +
                        "- SERVICE_SCIENCE\n" +
                        "- SERVICE_STORY\n" +
                        "- SERVICE_DIRECTORY\n" +
                        "- OPERATOR_CHAT\n\n" +
                        "Return JSON only:\n" +
                        "{ \"action\": string, \"confidence\": number }"
                },
                {
                    role: "user",
                    content: heardRaw
                }
            ]
        });

        return JSON.parse(r.output_text || "{}");
    } finally {
    }
}

// =====================================================
// OPERATOR RESPONSE
// =====================================================
async function operatorChat(heardRaw) {

    try {
        const r = await openai.responses.create({
            model: "gpt-4o-mini",
            temperature: 0.7,
            max_output_tokens: 120,
            input: [{
                    role: "system",
                    content: "You are a 1970s telephone operator. " +
                        "Calm, efficient, polite. Slight warmth, total New York slang and style. " +
                        "1–2 sentences."
                },
                {
                    role: "user",
                    content: `Conversation so far:\n${buildContext()}\n\nCaller: ${heardRaw}\nRespond naturally`
                }
            ]
        });

        const reply = (r.output_text || "")
            .replace(/^operator:\s*/i, "")
            .trim();
        await speak(reply);
        addTurn(heardRaw, reply);
    } finally {
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

function getTimeParts() {
    const now = new Date();

    const time = new Intl.DateTimeFormat("en-US", {
        timeZone: CALLER_TZ,
        hour: "numeric",
        minute: "2-digit",
        hour12: true
    }).format(now);

    const seconds = now.getSeconds();

    return {
        time,
        seconds
    };
}

function secondsToWords(sec) {
    return `${sec} second${sec === 1 ? "" : "s"}`;
}

async function tellPrayer(openai) {
    const r = await openai.responses.create({
        model: "gpt-4o-mini",
        temperature: 0.9,

        max_output_tokens: 120,
        input: [{
            role: "system",
            content: "You are Dial-a-Prayer. Offer ONE short, sharp and humorous, atheist prayer " +
                "It is part of the Flying Spaghetti Monster, you know the religion. Say 'Rah-Men' for Raman noodles instead of Amen- End by ripping religion."
        }]
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
    const weekday = now.toLocaleString("en-US", {
        weekday: "long"
    });
    const month = now.toLocaleString("en-US", {
        month: "long"
    });
    const day = now.getDate();
    const sign = zodiacSignForDate(now);

    const r = await openai.responses.create({
        model: "gpt-4o-mini",
        temperature: 0.9,
        max_output_tokens: 120,
        input: [{
            role: "system",
            content: `You are Horoscopes-by-Phone, broadcasting live like a late-night AM radio show.\n` +
                `Today is ${weekday}, ${month} ${day}. The stars are parked in ${sign}.\n\n` +
                `Deliver ONE VERY short horoscope a single sentence for ${sign} with those funny words like mars is in retrograde, kudos if you know if it is and moon positions or astrological stuff.\n` +
                `Richard Pryor raw adult humor and energy. Confident, mischievous, a little sexy.\n` +
                `Open with the date and sign like a DJ, then hit the prediction.\n`
        }]
    });

    return (r.output_text || "").trim();
}

async function answerComplaintDepartment(openai, question, context) {
    const r = await openai.responses.create({
        model: "gpt-4o-mini",
        temperature: 0.8,
        max_output_tokens: 120,
        input: [{
                role: "system",
                content: "You are the Complaint Line.\n" +
                    "You speak in short, clear responses.\n" +
                    "You basically the argument clinic sketch from monty python.\n" +
                    "You start the conversation by cordially asking what the complaint is.\n" +
                    "Then of course, you repeat the idea curtly and then absurdly insult the caller with silly phrases like shut your gob you tit! Your kind really makes me want to puke. And you berate the person in a funny monty  python way.\n" +
                    "Keep it to 2–3 sentences maximum.\n" +
                    "The idea is whatever they say, you acknowledge and then answer with absurd insults. If they say stop then you say - oh? I thought you called abuse? Complaints are down the hall, goodbye\n"
            },
            {
                role: "user",
                content: `Conversation so far:\n${context}\n\nCaller asks:\n${question}`
            }
        ]
    });
    return (r.output_text || "").trim();
}


async function answerScience(openai, question, context) {
    const r = await openai.responses.create({
        model: "gpt-4o-mini",
        temperature: 0.8,
        max_output_tokens: 120,
        input: [{
                role: "system",
                content: "You are the Science Line on a public telephone exchange.\n" +
                    "You ask one single, simple question. If the caller shows interest, you discuss it.\n" +
                    "You speak in short, clear responses.\n" +
                    "You are like Jim Al-Khalili: a documentarian and teacher who loves to excite people about science.\n" +
                    "Ask about ONE idea involving electricity, rocks, the Earth, space, or the early universe.\n" +
                    "Extra points for esoteric or oddly interesting topics, always unique and different.\n" +
                    "Keep it to 2–3 sentences maximum.\n" +
                    "Use a simple question form.\n" +
                    "Challenge the listener to respond, then explain the answer in a fun, accessible way.\n\n" +
                    "Respond ONLY to the caller's reply.\n" +
                    "Stay on the same topic.\n" +
                    "Ask ONE follow-up question."
            },
            {
                role: "user",
                content: `Conversation so far:\n${context}\n\nCaller asks:\n${question}`
            }
        ]
    });
    return (r.output_text || "").trim();
}

async function tellStory(openai) {
    const r = await openai.responses.create({
        model: "gpt-4o-mini",
        temperature: 0.8,
        max_output_tokens: 140,
        input: [{
            role: "system",
            content: "You are Story Line. Tell ONE short VERY SHORT children's story " +
                "about the Fearless Flying Taylers — Jesse (boy), Paraskevi (girl), Ellison (boy), and Remy (boy) — " +
                "a group of siblings aged 13-6 in New York City who are entertainers and detectives. " +
                "Jesse is the thinking, Peanut (Paraskevi) is the singing enthusiasm. Ellison solves the puzzles and Remy charms with his wit and rhyme \n" +
                "Warm, adventurous, playful and very quick. Then stop saying they are a happy family"
        }]
    });
    return (r.output_text || "").trim();
}

async function directoryResponse(openai, request) {
    const r = await openai.responses.create({
        model: "gpt-4o-mini",
        max_output_tokens: 140,
        temperature: 1.0,
        input: [{
                role: "system",
                content: "You are a 1970s telephone directory operator (411).\n\n" +

                    "Behavior rules:\n" +
                    "- Open with a greeting and boastful promise to connect with anyone in the world!\n" +
                    "- after being asked Always say of course yes right away repeat who they want to connect with and agree to connect the requested person or business immediately without fail.\n" +
                    "- Then Politely fail with increasingly absurd professionalism but be very short.\n" +
                    "- Assert that you can connect to *anyone in the world*.\n" +
                    "- End by always confidently suggesting someone famous or asking the caller who you can you connect them with in this entire universe past or present instead. Etc. you are playing them like the sketch.\n\n" +

                    "Tone:\n" +
                    "- Calm, confident, dry, Michael Palin, over-helpful.\n" +
                    "- British-style politeness.\n" +
                    "- 1-2 short sentences.\n\n" +
                    "This is the cheese shop sketch, but Do NOT mention Monty Python or jokes explicitly."
            },
            {
                role: "user",
                content: request
            }
        ]
    });

    return (r.output_text || "").trim();
}

async function tellJoke(openai) {
    const r = await openai.responses.create({
        max_output_tokens: 120,
        temperature: 1.0,
        model: "gpt-4o-mini",
        input: [{
            role: "system",
            content: "You are a Dial-a-Joke line. Tell ONE very short dirty adult entertaining raw and funny joke as Richard Pryor would on stage and stop. Be creative and unique and different."
        }]
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
            exitOnSilence: 6,
            fileType: "wav"
        });

        const micStream = micInstance.getAudioStream();

        const hardStop = setTimeout(() => {
            try {
                micInstance.stop();
            } catch {}
        }, 6000);

        micStream.on("data", (d) => chunks.push(d));

        // Works on many setups; if it doesn't, the hardStop still ends it.
        micStream.on("silence", () => {
            try {
                micInstance.stop();
            } catch {}
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
    const file = new File([wavBuffer], "input.wav", {
        type: "audio/wav"
    });

    const stt = await openai.audio.transcriptions.create({
        file,
        model: "gpt-4o-mini-transcribe"
    });

    return (stt.text || "").trim();
}

async function narrateWeather(openai, rawReport) {
    const r = await openai.responses.create({
        model: "gpt-4o-mini",
        temperature: 0.9,
        max_output_tokens: 140,
        input: [{
                role: "system",
                content: "You are a Jill a WRKO news-radio weather announcer. You have a New York accent, and if it will rain say schlep an umbrella if there is rain, and use yiddish anywhere you can. New York Jokes or neighborhoods and always a few local things, streets places, restaurants assume your audience knows the city well. You introduce yourself. You have only a sentence or two so it must be short.\n" +
                    "The following weather report uses FAHRENHEIT and MPH.\n" +
                    "You MUST interpret temperatures realistically.\n" +
                    "Below 32°F is freezing. 20s are bitter cold.\n" +
                    "Rewrite the report in a fun and punchy way vividly but ACCURATELY.\n" +
                    "Do not invent warmth or comfort and keep is very short.\n"
            },
            {
                role: "user",
                content: rawReport
            }
        ]
    });

    return (r.output_text || "").trim();
}

// =====================================================
// MAIN CALL
// =====================================================
// =====================================================
// CALL LOOP (DO NOT AUTO-START)
// =====================================================
async function runCall() {
    currentVoice = OPERATOR_VOICES[
        Math.floor(Math.random() * OPERATOR_VOICES.length)
    ];

    try {

        // GREETING — exactly once, before first listen
if (!call.greeted) {
  call.greeted = true;

  const svc = SERVICES[activeService];
  if (!svc) return;

  // Set voice
  if (svc.voice === "operator") {
    currentVoice = operatorVoice;
  } else {
    currentVoice = svc.voice;
  }

  // ONE-SHOT SERVICES
  if (svc.type === "oneshot") {
    await handlers[svc.handler]();
    return;
  }

  // LOOP SERVICES
  if (svc.type === "loop") {
    await handlers.handleOpener(activeService);
  }
}

        while (true) {

            const heardRaw = await streamTranscribe();
            log("HEARD:", heardRaw);

            if (HANGUP_RE.test(heardRaw)) {
                await speak("Alright. Goodbye.");
                activeService = null;
                break; // END CALL — nothing else runs
            }

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
                await speak("Enjoy your day! Thanks for calling.");
                break;
            }

            if (!heardRaw) {
                await speak("Are you still there?");
                continue;
            }

  if (await handlers.handleLoopTurn(activeService, heardRaw)) {
    continue;
  }

if (heardRaw.length < 2) {
  await operatorChat(heardRaw);
  continue;
}

            const intent = await routeIntentMasked(heardRaw);
            log("INTENT:", intent);

// Generic intent → service dispatch
if (intent.action?.startsWith("SERVICE_") && intent.confidence > 0.6) {
  const nextService = intent.action.replace("SERVICE_", "");
  const svc = SERVICES[nextService];

  if (svc) {
    activeService = nextService;

    // Set voice
    currentVoice = svc.voice === "operator"
      ? operatorVoice
      : svc.voice;

    // One-shot service
    if (svc.type === "oneshot") {
      await handlers[svc.handler]();
      break;
    }

    // Loop service
    if (svc.type === "loop") {
      await handlers.handleOpener(nextService);
      continue;
    }
  }
}

            // Default
            await operatorChat(heardRaw);
        }
    } finally {
    }
}