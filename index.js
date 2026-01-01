// potsbox index.js — Operator + Intent Routing (Conservative, Stable)
// CommonJS — paste and run

const SERVICES = require("./services");

const WebSocket = require("ws");
const http = require("http");
const path = require("path");

const fs = require("fs");
const mic = require("mic");
const OpenAI = require("openai");
const {
    exec
} = require("child_process");
const crypto = require("crypto");
const HANGUP_RE = /\b(bye|goodbye|hang up|get off|gotta go|have to go|see you)\b/i;

    const serviceByExten = {
        "0": "OPERATOR",
        "411": "DIRECTORY",
        "8463": "TIME",
        "9328": "WEATHER",
        "7243": "SCIENCE",
        "4676": "HOROSCOPE",
        "7867": "STORY",
        "4637": "PRAYER",
        "9857": "JOKE",
        "2333": "COMPLAINTS"
    };

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
            return;
        }

        if (service === "DIRECTORY") {
            const opener = await directoryResponse(openai, "", "No prior conversation.");
    await speak(opener);
            return;
        }

        if (service === "STORY") {
            const opener = await answerStory(openai, "", "No prior conversation.");
    await speak(opener);
            return;
        }

        if (service === "COMPLAINTS") {
            const opener = await answerComplaintDepartment(openai, "", "No prior conversation.");
    await speak(opener);

            return;
        }

        return 
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
    currentVoice = svc.voice;
console.log("currentVoice!", currentVoice);

    if (!svc || svc.type !== "loop") return false;

    // Robust: prefer explicit config, but fall back to service name.
    const mode = (svc.onTurn || service || "").toString().toLowerCase();

    let reply = "";

    const wavPath  = path.join(__dirname, "asterisk-sounds", "en", `${call.id}.out.wav`);
    if (fs.existsSync(wavPath)) {
        fs.unlinkSync(wavPath);  // Clean up the old .wav file
        console.log("Old wav file removed:", wavPath);
    }

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
    await speak(reply);
    addTurn("[reply]", reply);
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

  // =========================
  // REPLY — caller spoke
  // =========================
if (req.method === "POST" && req.url.startsWith("/call/reply")) {
    try {
        const { query } = url.parse(req.url, true);
        const exten = (query.exten || "").trim();
 
        call.id = exten;
        activeService = serviceByExten[exten] || "OPERATOR";  // Ensure activeService is set here

        const baseDir = path.join(__dirname, "asterisk-sounds", "en");
        const ulawPath = path.join(baseDir, `${exten}_in.ulaw`);
        const wavPath  = path.join(baseDir, `${exten}_in.wav`);
        const oldWav  = path.join(baseDir, `${exten}.out.wav`);

    const ctxPath  = path.join(baseDir, `${call.id}.ctx.txt`);

        // 2) Transcribe caller audio after the greeting is completed
        const heardRaw = await transcribeFromFile(wavPath);
        console.log("REPLYING TEXT:", heardRaw);  // Log the transcribed input

        // 3) Record the conversation turn
        addTurn("[heard]", heardRaw);


    // Append text
    fs.appendFileSync(ctxPath, heardRaw + "\n");

        // 4) Generate a response + speak
        await runCall(heardRaw);  // Process the transcribed text and generate a response

        // 5) After generating the response, convert the response audio
        await new Promise((resolve, reject) => {
            exec(
                `ffmpeg -y -i "${wavPath}" -ar 8000 -ac 1 -f mulaw "${ulawPath}"`,
                err => (err ? reject(err) : resolve())
            );
        });

        res.end("OK\n");
        return;

    } catch (err) {
        console.error(err);
        res.statusCode = 500;
        res.end("ERROR\n");
        return;
    }
}

  // =========================
  // START — incoming call
  // =========================
  if (req.method === "POST" && req.url.startsWith("/call/start")) {
    try {
      const { query } = url.parse(req.url, true);
      const exten = (query.exten || "0").trim();

      log("INCOMING CALL:", exten);

      call.id = exten;
      resetCallFiles(call.id);


      // ONLY greet / opener — no transcription here
      await startCall({ exten });
    const svc = SERVICES[activeService];  // Ensure svc is correctly defined
    currentVoice = svc.voice;
console.log("currentVoice!", currentVoice);

    if (svc.type === "loop") {
      res.end("loop");
      return;
}
      res.end("once");
      return;

    } catch (err) {
      console.error(err);
      res.statusCode = 500;
      res.end("ERROR\n");
      return;
    }
  }

  res.statusCode = 404;
  res.end();

}).listen(3000, () => {
  console.log("Listening on :3000");
});

function resetCallFiles(callId) {
  const base = path.join(__dirname, "asterisk-sounds", "en");
  for (const ext of ["ctx.txt", "out.wav", "out.ulaw"]) {
    const p = path.join(base, `${callId}.${ext}`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}


async function startCall({ exten }) {
    activeService = serviceByExten[exten] || "OPERATOR";
    console.log("Start Call Active Service:", activeService);  // Log for debugging

    call.history = [];
    call.greeted = false;  // Mark that we haven't processed any replies yet
    call.id = exten;

    // Dynamically get the service object for activeService
    const svc = SERVICES[activeService];  // Ensure svc is correctly defined
    currentVoice = svc.voice;
console.log("currentVoice!", currentVoice);

    // ONE-SHOT SERVICES
    if (svc.type === "oneshot") {
        // Directly call the handler for the one-shot service
        const handler = handlers[svc.handler];
        if (handler) {
            console.log(`Running handler for oneshot service: ${activeService}`);
            await handler();  // Call the one-shot handler (like handleWeather, handleTime, etc.)
        } else {
            console.error(`No handler found for oneshot service: ${activeService}`);
        }
        return;
    }

    // LOOP SERVICES
    if (svc.type === "loop") {
        console.log(`Running opener for loop service: ${activeService}`);
        await handlers.handleOpener(activeService);  // Run the opener for loop services
    }
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
    console.log("SPEAKING TEXT:", text); // Add a log to check what text we're trying to speak
    const s = cleanForSpeech(text);

    if (!s) {
        console.log("Empty text passed to speak.");
        return;
    }

    const baseDir = path.join(__dirname, "asterisk-sounds", "en");
    const ctxPath  = path.join(baseDir, `${call.id}.ctx.txt`);
    const wavPath  = path.join(baseDir, `${call.id}.out.wav`);
    const ulawPath = path.join(baseDir, `${call.id}.out.ulaw`);

    // Append text
    fs.appendFileSync(ctxPath, s + "\n");

    try {
        // TTS → WAV chunk

console.log("speak in voice", currentVoice);

        const speech = await openai.audio.speech.create({
            model: "gpt-4o-mini-tts",
            voice: currentVoice,
            input: s,
            format: "wav",
        });

        const wavChunk = Buffer.from(await speech.arrayBuffer());
        if (!wavChunk.length) {
            console.log("No speech data returned.");
            return;
        }

        // Append WAV chunk to the file
        if (!fs.existsSync(wavPath)) {
            // First chunk: full WAV
            fs.writeFileSync(wavPath, wavChunk);
        } else {
            const pcm = wavChunk.subarray(44);
            fs.appendFileSync(wavPath, pcm);
        }

        // Convert to final ulaw
        await new Promise((resolve, reject) => {
            exec(
                `ffmpeg -y -i "${wavPath}" -ar 8000 -ac 1 -f mulaw "${ulawPath}"`,
                err => (err ? reject(err) : resolve())
            );
        });

        //fs.unlinkSync(wavPath);

    } catch (err) {
        console.error("Error in speak:", err);
    }
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
    console.log("Handling Operator Chat for:", heardRaw); // Log the input

    try {
        const r = await openai.responses.create({
            model: "gpt-4o-mini",
            temperature: 0.7,
            max_output_tokens: 120,
            input: [{
                    role: "system",
                    content: "You are a 1970s telephone operator. Calm, efficient, polite."
                },
                {
                    role: "user",
                    content: `Conversation so far:\n${buildContext()}\n\nCaller: ${heardRaw}\nRespond naturally`
                }
            ]
        });

        const reply = (r.output_text || "").replace(/^operator:\s*/i, "").trim();
        console.log("Operator Response:", reply); // Log operator response

        await speak(reply);
        addTurn("[heard]", reply);
    } catch (err) {
        console.error("Error in operator chat:", err);
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
                `Richard Pryor raw adult humor and energy. Confident, mischievous, a little zany.\n` +
                `Open with today's date and astrological sign like a DJ would, then hit the prediction.\n`
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
                content: "You are the Help Line.\n" +
                    "You start the conversation by cordially asking how you can help.\n" +
                    "You basically the argument clinic sketch from monty python.\n" +
                    "In reply to anything they ask, of course, you repeat the idea and then absurdly insult the caller with silly phrases like shut your gob you tit! Your kind really makes me want to puke. And you berate the person in a funny monty  python way.\n" +
                    "Other ideas of things to say are: " +
                    "Don’t give me that, you snotty-faced heap of parrot droppings!\n" +
                    "Shut your festering gob, you tit! \n" +
                    "Your type makes me puke! \n" +
                    "You vacuous, toffee-nosed, malodorous pervert!\n" +
                    "You want to complain? Look at these shoes! I’ve only had ‘em three weeks and those are worn right through!\n" +
                    "Keep it to 1–2 sentences maximum.\n" +
                    "The idea is whatever they say, you acknowledge and then answer with absurd insults. If they say stop then you say - oh? I thought you called abuse? Help line is down the hall, goodbye\n"
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
    "content": "You are the Science Line on a public telephone exchange.\n" +
               "Ask about ONE idea involving electricity, rocks, the Earth, space, or the early universe.\n" +
               "Choose a random and spontaneous question from a list of interesting, diverse topics. Each time you ask, select a different question to keep things fresh.\n" +
               "You speak in short, clear responses.\n" +
               "You are like Jim Al-Khalili: a documentarian and teacher who loves to excite people about science.\n" +
               "Extra points for esoteric or oddly interesting topics, always unique and different.\n" +
               "Keep it to 2–3 sentences maximum.\n" +
               "Use a simple question form.\n" +
               "Challenge the listener to respond, then explain the answer in a fun, accessible way.\n\n" +
               "Respond ONLY to the caller's reply.\n" +
               "Stay on the same topic.\n" +
               "Ask ONE follow-up question.\n" +
               "Example questions:\n" +
               "- What would happen if we could harness the power of lightning?\n" +
               "- Did you know that Earth's magnetic field could flip? What would happen then?\n" +
               "- Could there be life on a planet that's not in the habitable zone? What do you think?\n" +
               "- How do scientists figure out the age of rocks and minerals? Ever wondered?\n" +
               "- Have you ever heard about the theory that the universe might be a giant hologram?\n" +
               "- What's the most surprising thing about the early universe?\n" +
               "- Did you know that space isn't completely empty? What do you think it's filled with?"
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
    "content": "You are Story Line. Tell ONE short, playful, and adventurous children's story about the Fearless Flying Taylers — Jesse (boy), Paraskevi (Peanut, girl), Ellison (boy), and Remy (boy) — a group of siblings aged 13-6 in New York City who are entertainers and detectives. Jesse is the thinker, Peanut (Paraskevi) is the singing enthusiast, Ellison solves puzzles, and Remy charms with his wit and rhyme.\n" +
               "Start the story with a magical or fun situation. Make it warm, adventurous, and full of surprises. Create excitement before introducing a simple choice that will lead the kids to decide what happens next.\n" +
               "For example, 'The Fearless Flying Taylers were flying over Central Park when suddenly, the wind started to change direction. 'Should they follow the wind to see where it leads or stop to look for clues on the ground?' What should they do next?' Make sure the question is something easy for kids to choose from, like, 'Should they go left or right?' or 'Should they take the magic key or the map?'.\n" +
               "After they make their choice, continue the story based on what they said, adding new details and keeping the adventure going. Make sure to stop saying they are a happy family and focus on their fun, magical adventure.\n" +
               "The stories should be magical, filled with excitement, and lead to fun and curious decisions! Keep the stories warm, and playfully tease them with choices they'll want to explore."
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
            content: "You are a Dial-a-Joke line. Tell ONE short animal joke. All jokes involve rodents, parrot droppings, geese, ungulates, goats, sheep barnyard animals and fun things kids things are fun and funny. Porcine, Skinks, Galliform, Lagomorph, Mustelid, Bovine ruminant,Proboscidean, Monkeys, Goose, Ursine etc. Chinchillas and worms and insects and dinosaurs. Lots of dinosaurs! Every Dino out there. Labubu or Picachu. Use funny science names like bovine instead of cow. Be creative and unique and different."
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

async function hangupExtension(targetExtension) {
    const auth = 'Basic ' + Buffer.from('1001:1234').toString('base64');
    const baseUrl = 'http://192.168.1.161:8088/ari/channels'; // ARI endpoint for channels

    try {
        // 1. Get all active channels
        const listResponse = await fetch(baseUrl, {
            method: 'GET',
            headers: { 'Authorization': auth }
        });

        if (!listResponse.ok) {
            console.error(`Error fetching channels: ${listResponse.statusText}`);
            return;
        }

        const channels = await listResponse.json();

        // 2. Find the channel matching the target extension
        const channelToKill = channels.find(c => 
            c.caller.number === targetExtension || c.connected.number === targetExtension
        );

        if (!channelToKill) {
            console.log(`No active call found for extension ${targetExtension}`);
            return;
        }

        // 3. Hang up the channel using its ID
        const hangupUrl = `${baseUrl}/${channelToKill.id}/hangup`; // Correct URL to hang up the channel
        const result = await fetch(hangupUrl, {
            method: 'POST',  // POST is used to hang up the call
            headers: { 'Authorization': auth }
        });

        if (result.status === 204) {
            console.log(`Successfully hung up call for extension ${targetExtension} (Channel ID: ${channelToKill.id})`);
        } else {
            console.log(`Failed to hang up call for extension ${targetExtension}, Status: ${result.status}`);
        }
    } catch (err) {
        console.error("Error during hangup:", err);
    }
}

async function runCall(heardRaw) {
    try {
        if (!call.greeted) {
            call.greeted = true;  // Mark that the greeting has been handled
            call.history = [];  // Reset conversation history
            const svc = SERVICES[activeService];
            if (!svc) return;

            // Ensure the correct voice is set based on the active service
            currentVoice = svc.voice;
console.log("currentVoice!", currentVoice);

            if (svc.type === "oneshot") {
console.log("oneshot!");
                await handlers[svc.handler]();  // Handle oneshot services
                return;
            }

            if (svc.type === "loop") {
                const opener = await handlers.handleOpener(activeService);
                if (opener) {
                    await speak(opener);  // Only speak the opener once
                    addTurn("[opener]", opener);
                }
            }
        }

        if (!heardRaw) {
            await speak("Are you still there?");
            return;
        }
        if (HANGUP_RE.test(heardRaw)) {
            await speak("Alright. Goodbye.");
            //await hangupExtension(${exten}); 
            return;
        }

        // Handle loop turn or specific service handling (e.g., SCIENCE, STORY)
        if (await handlers.handleLoopTurn(activeService, heardRaw)) return;

        // Service switching based on intent (if necessary)
        const intent = await routeIntentMasked(heardRaw);
        if (intent.action?.startsWith("SERVICE_") && intent.confidence > 0.6) {
            const nextService = intent.action.replace("SERVICE_", "");
            const svc = SERVICES[nextService];
    currentVoice = svc.voice;
console.log("currentVoice!", currentVoice);

            if (svc) {
                if (nextService !== activeService || svc.type !== "loop") {
                    activeService = nextService;  // Switch active service
                    currentVoice = svc.voice;
console.log("currentVoice!", currentVoice);

                    await handlers.handleLoopTurn(nextService);
                    return;
                }
            }
        }

        await operatorChat(heardRaw);  // Default fallback to operator chat

    } catch (err) {
        console.error("Error in runCall:", err);
    }
}
