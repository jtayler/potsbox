// potsbox index.js — Operator + Intent Routing (Conservative, Stable)
// CommonJS — paste and run

const SERVICES = require("./services");

const WebSocket = require("ws");
const http = require("http");
const wantsAstrisk = true;
const path = require("path");

const fs = require("fs");
const mic = require("mic");
const OpenAI = require("openai");
const {
    exec
} = require("child_process");
const crypto = require("crypto");
const HANGUP_RE = /\b(bye|goodbye|hang up|get off|gotta go|have to go|see you)\b/i;

const handlers = {
    handleTime: async () => {
        const {
            time,
            seconds
        } = getTimeParts();
            content: "You are Dial-a-Prayer. Offer ONE short, sharp and humorous, atheist prayer " +

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

        if (service === "STORY") {
            const opener = await answerStory(openai, "", "No prior conversation.");
            await speak(opener);
            addTurn("[story opener]", opener);
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
    if (!svc || svc.type !== "loop") return false;

    // Robust: prefer explicit config, but fall back to service name.
    const mode = (svc.onTurn || service || "").toString().toLowerCase();

    let reply = "";

    if (mode.includes("science")) {
        reply = await answerScience(openai, heardRaw, buildContext());
    } else if (mode.includes("complaints")) {
        reply = await answerComplaintDepartment(openai, heardRaw, buildContext());
    } else if (mode.includes("directory")) {
        reply = await directoryResponse(openai, heardRaw);
    } else if (svc.onTurn === "story") {
        reply = await answerStory(openai, heardRaw, buildContext());
    } else {
        // Unknown loop service: fail safely (don’t black-hole)
        return false;
    }

    reply = (reply || "").trim();
    if (!reply) {
        // Fail safe: avoid “silent loop”
        await speak("Sorry—say that again?");
        return true;
    }

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


async function waitForAudio() {
  await audioQueue;
}

http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url.startsWith("/call/start")) {
        const {
            query
        } = url.parse(req.url, true);
        const exten = (query.exten || "0").trim();

        log("INCOMING CALL:", exten);

await startCall({ exten });

        res.end("OK\n");
        return;
    }

    res.statusCode = 404;
    res.end();
}).listen(3000, () => {
    console.log("Listening on :3000");
});

async function startCall({
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
    console.log("Active Service:", activeService);

    call.history = [];
    call.greeted = false;
await runCall();
await waitForAudio();
}

// =====================================================
// FILES: CLEANUP AT STARTUP
// =====================================================

const TTS_DIR = "asterisk-sounds/en";
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

function cleanForSpeech(text) {
    return (text || "")
        .replace(/^\s*operator:\s*/i, "")
        .trim();
}

function pcm16ToWav(pcm, sampleRate = 24000) {
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);  // PCM chunk
  header.writeUInt16LE(1, 20);   // PCM format
  header.writeUInt16LE(1, 22);   // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

async function writeWavFile(pcmData, id) {
  const wavPath = path.join(__dirname, "asterisk-sounds", "tts", `tts-${id}.wav`);
  const wavData = pcmToWav(pcmData);

  // Writing the correct .wav file
  fs.writeFileSync(wavPath, wavData);
  console.log(`WAV file written to ${wavPath}`);
  return wavPath;
}

async function speak(text) {
  const s = cleanForSpeech(text);
  if (!s) return;

  const id = Date.now();

  // Correct paths for the output sound files
  const wavPath = path.join(__dirname, "asterisk-sounds", "en", `tts-${id}.wav`);
  const ulawPath = path.join(__dirname, "asterisk-sounds", "en", `tts-${id}.ulaw`);

  // Path for the queue file
  const queueFilePath = path.join(__dirname, "asterisk-sounds", "en", "queue.txt");

  //console.log("TTS START →", wavPath);

  // Requesting WAV format from OpenAI
  const speech = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: currentVoice,
    input: s,
    format: "wav",  // Request WAV format from OpenAI
  });

  // Ensure the data is valid
  const wavBuffer = Buffer.from(await speech.arrayBuffer());

  // Check if wavBuffer is valid
  if (!wavBuffer || wavBuffer.length === 0) {
    console.error("Error: Received empty audio data from OpenAI.");
    return;
  }

  // Create the WAV file first
  fs.writeFileSync(wavPath, wavBuffer);  // Save the WAV file
  //console.log("WAV data written to:", wavPath);

  // Convert WAV to ULaw using FFmpeg
  exec(
    `ffmpeg -i ${wavPath} -ar 8000 -ac 1 -f mulaw ${ulawPath}`,
    (err, stdout, stderr) => {
      if (err) {
        console.error("Error converting to ulaw:", stderr);
        return;
      }
      //console.log("Converted to ulaw:", ulawPath);

      // Check if the queue file exists, create it if not
      if (!fs.existsSync(queueFilePath)) {
        fs.writeFileSync(queueFilePath, '');  // Create an empty queue file if it doesn't exist
        //console.log("Created new queue.txt file.");
      }

      // File is now ready for Asterisk to play in the 'en' folder
      //console.log("File ready in the 'en' folder for Asterisk to play:", ulawPath);

      // Add the converted file to the queue
      fs.appendFileSync(queueFilePath, `tts-${id}\n`);
      console.log("Sound queued:", `tts-${id}`);
    }
  );
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
    } finally {}
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
    } finally {}
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

async function answerStory(openai, question, context) {
    const r = await openai.responses.create({
        model: "gpt-4o-mini",
        temperature: 0.7,
        max_output_tokens: 140,
        input: [{
                role: "system",
                content: `You are Story Line on a public telephone.

You tell a short children's adventure story about 3–5 sentences.

After each story segment:
- Ask ONE simple choice question. Ask What Happens Next??
- Choices must be concrete and short, an example might be:
  - We Follow Ellison or - We Stop and Search for hidden secrets

Rules:
- The caller may reply with whatever they like. If it makes no sense, you ignore it.
- You MUST continue the story based on their reply.
- Never explain rules.
- Never list more than 3 choices.
- Keep everything playful, safe, and fast.
- Always emphasize their smarts, loyalty, love and the Tayler family spirit.

Characters are friends and siblings a loyal family:
- Jesse (boy) thinks.
- Paraskevi (girl) sings.
- Ellison (boy) solves puzzles.
- Remy (boy) jokes and rhymes.
`
            },
            {
                role: "user",
                content: `Conversation so far:
${context}

Caller says:
${question}`
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
                "You start the very short story and then ask for a choice or idea or a question about what should happen next: follow Ellison? Find the map? So then each reply creates a continuation of the story based on whatever the caller says. \n" +
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

async function transcribeFromFile(path) {
    const file = fs.createReadStream(path);
    const stt = await openai.audio.transcriptions.create({
        file,
        model: "gpt-4o-mini-transcribe"
    });
    return (stt.text || "").trim();
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
                content: "You are a Jill a WRKO news-radio weather announcer. You have a New York accent, and, for example, if it will rain say schlep an umbrella if there is rain. you use yiddish anywhere you can. New York Jokes or neighborhoods and always a few local things, streets places, restaurants assume your audience knows the city well. You introduce yourself. Keep all replies to just 2-3 sentences and short.\n" +
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



        let heardRaw = ""; // await transcribeFromFile("./asterisk-sounds/en/input.wav");

        log("HEARD:", heardRaw);

        // 1. Hard hangup
        if (HANGUP_RE.test(heardRaw)) {
            await speak("Alright. Goodbye.");
            activeService = null;
            return;
        }

        // 2. Weather follow-up special case
        if (awaitingWeatherLocation) {
            awaitingWeatherLocation = false;
            const city = heardRaw.trim() || DEFAULT_WEATHER_CITY;

            const report = await getWeatherReport(city);
            if (!report) {
                await speak("I couldn't find that location. Try saying the city and state.");
                awaitingWeatherLocation = true;
                return;
            }

            await speak(report);
            await speak("Enjoy your day! Thanks for calling.");
            return;
        }

        // 3. Silence
        if (!heardRaw) {
            await speak("Are you still there?");
            return;
        }

        // 4. ACTIVE LOOP SERVICE ALWAYS GETS FIRST SHOT
        if (await handlers.handleLoopTurn(activeService, heardRaw)) {
            return;
        }

        // 5. Very short utterances → operator nudge
        if (heardRaw.length < 2) {
            await operatorChat(heardRaw);
            return;
        }

        // 6. Intent routing (ONLY for switching services)
        const intent = await routeIntentMasked(heardRaw);
        log("INTENT:", intent);

        // Generic intent → service dispatch
        if (intent.action?.startsWith("SERVICE_") && intent.confidence > 0.6) {
            const nextService = intent.action.replace("SERVICE_", "");
            const svc = SERVICES[nextService];

            if (svc) {
                // If intent says the SAME loop service we're already in,
                // do NOT restart/open it—just handle the turn inside the loop service.
                if (nextService === activeService && svc.type === "loop") {
                    await handlers.handleLoopTurn(activeService, heardRaw);
                    return;
                }

                // If we're in a loop service, don't let OPERATOR steal the call
                if (SERVICES[activeService]?.type === "loop" && nextService === "OPERATOR") {
                    // ignore OPERATOR switch while in a loop service
                } else {
                    activeService = nextService;

                    currentVoice = (svc.voice === "operator") ? operatorVoice : svc.voice;

                    if (svc.type === "oneshot") {
                        await handlers[svc.handler]();
                        return;
                    }

                    if (svc.type === "loop") {
                        await handlers.handleOpener(nextService);
                        return;
                    }
                }
            }


            // 7. Final fallback: operator chat

            if (SERVICES[activeService]?.type === "loop") {
                // Stay silent or let the loop service handle next turn
                return;
            }

            await operatorChat(heardRaw);
        }
    } finally {}
}