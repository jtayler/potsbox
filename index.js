const AmiClient = require("asterisk-ami-client");

const ami = new AmiClient();

ami.connect("node", "nodepass", {
  host: "127.0.0.1",
  port: 5038,
})
.then(() => {
  console.log("AMI connected as node");
})
.catch(err => {
  console.error("AMI connection failed", err);
});

const SERVICES = require("./services");

const WebSocket = require("ws");
const http = require("http");
const path = require("path");

const fs = require("fs");
const mic = require("mic");
const OpenAI = require("openai");
const { exec } = require("child_process");
const crypto = require("crypto");
const HANGUP_RE = /\b(bye|goodbye|hang up|get off|gotta go|have to go|see you)\b/i;

const handlers = {
    handleTime: async ({ svc }) => {
        const { time, seconds } = getTimeParts();
        await speak(`At the tone, the time will be ${time} and ${secondsToWords(seconds)}.`);
        await speak("BEEEP!");
        await speak("Goodbye.");
    },

    handleWeather: async ({ svc }) => {
        const report = await getWeatherReport(DEFAULT_WEATHER_CITY);
        if (!report) return speak("Weather service is temporarily unavailable.");
        await speak(await narrateWeather(openai, report));
        await speak("Remember folks, if you don't like the weather, wait five minutes. Good-bye.");
    },

    handleOpener: async (svc) => {
        if (svc.opener) {
            await speak(svc.opener);
        }
    },
};

handlers.loopService = async ({ svc, user, context }) => {
  const reply = await runServiceLoop({ svc, user: user ?? "", context });
  if (reply) await speak(reply);
  return "loop";
};

handlers.handleRiddle = async ({ svc, user }) => {
    if (!user) {
        const riddle = await runServiceLoop({ svc, user: "", context: "" });
        if (riddle) await speak(riddle);
        return "loop";
    }

    if (guessCount() < 3) {
        await speak("Interesting. Want to guess again?");
        return "loop";
    }

    const revealSvc = {
        ...svc,
        content: "Reveal the answer briefly. Thank the caller and say goodbye. Never use emojis.",
    };

    const answer = await runServiceLoop({ svc: revealSvc, user, context: "" });
    if (answer) await speak(answer);
    return "exit";
};

handlers.handleMystery = async ({ svc, user }) => {
    // first turn
    if (!user) {
        const mystery = await runServiceLoop({
            svc,
            user: "",
            context: "",
        });
        if (mystery) await speak(mystery);
        return "loop"; // ← REQUIRED
    }

    // second turn
    const revealSvc = {
        ...svc,
        content:
            "Reveal the solution to the mystery in one short paragraph.\n" +
            "Then say goodbye.\n" +
            "Never use emojis.",
    };

    const reveal = await runServiceLoop({
        svc: revealSvc,
        user,
        context: "",
    });

    if (reveal) await speak(reveal);
    await speak("Goodbye.");

    return "exit"; // ← REQUIRED
};

handlers.handleJoke = async ({ svc }) => {
    const uuid = crypto.randomUUID();

    const tempSvc = {
        ...svc,
        content: svc.content.replace("{{uuid}}", uuid),
    };

    const joke = await runServiceLoop({
        svc: tempSvc,
        user: "",
        context: "",
    });

    if (joke) await speak(joke);
    return "exit";
};

handlers.runServiceLoop = runServiceLoop; // ← RIGHT HERE

handlers.runService = async ({ svc, user, context }) => {
    await runServiceLoop({ svc, user, context }); // no speak
    return "loop";
};

handlers.operatorChat = async ({ user }) => {
    await operatorChat(user);
};

handlers.handleLoopTurn = async (svc, heardRaw) => {
    if (!svc.onTurn) return false;

    const result = await handlers[svc.onTurn]({ svc, user: heardRaw });
    if (result === "exit") return "exit";

    return true; // loop continues
};

const url = require("url");

if (!process.env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY in environment.");
    process.exit(1);
}

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});
const log = (...a) => console.log(new Date().toISOString(), ...a);

function serviceForExten(exten) {
    return Object.values(SERVICES).find((svc) => svc.ext === exten) || SERVICES.OPERATOR;
}

const CALLER_TZ = process.env.CALLER_TZ || "America/New_York";

const DEFAULT_WEATHER_CITY = "New York City";
async function getWeatherReport(city) {
    // 1) geocode city -> lat/lon
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
    const geo = await fetch(geoUrl).then((r) => r.json());
    const hit = geo?.results?.[0];
    if (!hit) return null;

    const { latitude, longitude, name, admin1, country } = hit;

    // 2) current weather
    const wxUrl =
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
        `&current=temperature_2m,wind_speed_10m,precipitation,weather_code` +
        `&temperature_unit=fahrenheit&wind_speed_unit=mph`;
    const wx = await fetch(wxUrl).then((r) => r.json());

    const cur = wx?.current;
    if (!cur) return null;

    // Super short “radio” read (no fake precision)
    const place = [name, admin1, country].filter(Boolean).join(", ");
    return `Weather for ${place}: ${Math.round(cur.temperature_2m)} degrees, wind ${Math.round(cur.wind_speed_10m)} miles an hour, precipitation ${cur.precipitation} inches right now.`;
}

const call = {
    id: crypto.randomUUID(),
    greeted: false,
    service: null,
};

function buildContext() {
    const ctxPath = path.join(__dirname, "asterisk-sounds", "en", `${call.id}.ctx.txt`);

    if (!fs.existsSync(ctxPath)) return "No prior conversation.";

    const text = fs.readFileSync(ctxPath, "utf8").trim();
    return text || "No prior conversation.";
}

http.createServer(async (req, res) => {

if (req.method === "POST" && req.url.startsWith("/call/dial")) {
  try {
    const { query } = url.parse(req.url, true);
    const exten = (query.exten || "").trim();
    if (!exten) {
      res.statusCode = 400;
      res.end("Missing exten\n");
      return;
    }

    await originateCall({
      exten,
      channel: "PJSIP/1001",
    });

    res.end("DIALING\n");
    return;
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.end("ERROR\n");
    return;
  }
}

    if (req.method === "POST" && req.url.startsWith("/call/reply")) {
        try {
            const { query } = url.parse(req.url, true);
            const exten = (query.exten || "").trim();

console.log("start call logic");

            call.id = exten;

            const baseDir = path.join(__dirname, "asterisk-sounds", "en");
            const ulawPath = path.join(baseDir, `${exten}_in.ulaw`);
            const wavPath = path.join(baseDir, `${exten}_in.wav`);
            const outWav = path.join(baseDir, `${exten}.out.wav`);
            const outUlaw = path.join(baseDir, `${exten}.out.ulaw`);

try {
  if (fs.existsSync(outWav))  fs.unlinkSync(outWav);
console.log(outWav);
} catch {}

            const ctxPath = path.join(baseDir, `${call.id}.ctx.txt`);

            const heardRaw = await transcribeFromFile(wavPath);
            console.log("RECORDED TEXT:", heardRaw); // Log the transcribed input

            fs.appendFileSync(ctxPath, heardRaw + "\n");
            const result = await runCall(heardRaw);
            res.end(result === "exit" ? "exit" : "loop");

            return;
        } catch (err) {
            console.error(err);
            res.statusCode = 500;
            res.end("ERROR\n");
            return;
        }
    }

    if (req.method === "POST" && req.url.startsWith("/call/start")) {
        try {
            const { query } = url.parse(req.url, true);
            const exten = (query.exten || "0").trim();

            log("INCOMING CALL:", exten);

            call.id = exten;
            resetCallFiles(call.id);

            // ONLY greet / opener — no transcription here
            await startCall({ exten });
            if (isLoopService(call.service)) {
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
  for (const ext of ["ctx.txt", "out.wav", "out.ulaw", "_in.wav", "_in.ulaw"]) {
    const p = path.join(base, `${callId}${ext.startsWith("_") ? ext : "." + ext}`);
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
  }
}

async function startCall({ exten }) {
    call.id = exten;
    call.greeted = false;

    call.service = serviceForExten(exten);
    const svc = call.service;

    if (!isLoopService(svc)) {
        const fn = handlers[svc.handler];
        if (fn) await fn({ svc, user: "", context: buildContext() });
        if (svc.goodbye) await speak(svc.goodbye);
        return;
    }

    await handlers.handleOpener(svc);

  const first = await handlers[svc.onTurn]({
    svc,
    user: "",          // empty user = “first turn”
    context: buildContext(),
  });

}

function cleanForSpeech(text) {
    return (text || "").replace(/^\s*operator:\s*/i, "").trim();
}

async function speak(text) {
    if (text === "loop" || text === "exit") return;

    console.log("SPOKEN TEXT:", text); // Add a log to check what text we're trying to speak
    const s = cleanForSpeech(text);

    if (!s) {
        console.log("Empty text passed to speak.");
        return;
    }

    const baseDir = path.join(__dirname, "asterisk-sounds", "en");
    const ctxPath = path.join(baseDir, `${call.id}.ctx.txt`);
    const wavPath = path.join(baseDir, `${call.id}.out.wav`);
    const ulawPath = path.join(baseDir, `${call.id}.out.ulaw`);

    // Append text
    fs.appendFileSync(ctxPath, s + "\n");

    try {
        // TTS → WAV chunk

        const svc = call.service;
        if (!svc?.voice) throw new Error("No voice for current service");

        const voice = svc.voice;

        console.log("speak in voice", voice);

        const speech = await openai.audio.speech.create({
            model: "gpt-4o-mini-tts",
            voice: voice,
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
            exec(`ffmpeg -y -i "${wavPath}" -ar 8000 -ac 1 -f mulaw "${ulawPath}"`, (err) =>
                err ? reject(err) : resolve()
            );
        });

    } catch (err) {
        console.error("Error in speak:", err);
    }
}

function originateCall({ exten }) {
  return ami.send({
Action: "Originate",
Channel: "Local/7243@ai-phone",
CallerID: "Science <7243>",
Async: true
  });
}


async function routeIntentMasked(heardRaw) {
    try {
        const r = await openai.responses.create({
            max_output_tokens: 40,
            temperature: 0,
            model: "gpt-4o-mini",
            text: {
                format: {
                    type: "json_object",
                },
            },
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
                        "- SERVICE_COMPLAINTS\n" +
                        "- SERVICE_SCIENCE\n" +
                        "- SERVICE_STORY\n" +
                        "- SERVICE_DIRECTORY\n" +
                        "- OPERATOR_CHAT\n\n" +
                        "Return JSON only:\n" +
                        '{ "action": string, "confidence": number }',
                },
                {
                    role: "user",
                    content: heardRaw,
                },
            ],
        });

        return JSON.parse(r.output_text || "{}");
    } finally {
    }
}

async function operatorChat(heardRaw) {
    console.log("Handling Operator Chat for:", heardRaw); // Log the input

    try {
        const r = await openai.responses.create({
            model: "gpt-4o-mini",
            temperature: 0.7,
            max_output_tokens: 120,
            input: [
                {
                    role: "system",
                    content: "You are a 1970s telephone operator. Calm, efficient, polite.",
                },
                {
                    role: "user",
                    content: `Conversation so far:\n${buildContext()}\n\nCaller: ${heardRaw}\nRespond naturally`,
                },
            ],
        });

        const reply = (r.output_text || "").replace(/^operator:\s*/i, "").trim();

        await speak(reply);
    } catch (err) {
        console.error("Error in operator chat:", err);
    }
}

function getTimeParts() {
    const now = new Date();

    const time = new Intl.DateTimeFormat("en-US", {
        timeZone: CALLER_TZ,
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    }).format(now);

    const seconds = now.getSeconds();

    return {
        time,
        seconds,
    };
}

function secondsToWords(sec) {
    return `${sec} second${sec === 1 ? "" : "s"}`;
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

async function transcribeFromFile(path) {
    const file = fs.createReadStream(path);
    const stt = await openai.audio.transcriptions.create({
        file,
        model: "gpt-4o-mini-transcribe",
    });
    return (stt.text || "").replace(/[^\w\s,.!?-]/g, "").trim(); // Remove anything not a standard character
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
            fileType: "wav",
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
        type: "audio/wav",
    });

    const stt = await openai.audio.transcriptions.create({
        file,
        model: "gpt-4o-mini-transcribe",
    });

    return (stt.text || "").trim();
}

async function narrateWeather(openai, rawReport) {
    const svc = SERVICES.WEATHER;
    const r = await openai.responses.create({
        model: "gpt-4o-mini",
        temperature: 0.9,
        max_output_tokens: 140,
        input: [
            {
                role: "system",
                content: svc.content,
            },
            {
                role: "user",
                content: rawReport,
            },
        ],
    });

    return (r.output_text || "").trim();
}

async function runServiceLoop({ svc, user, context }) {
    const input = [{ role: "system", content: svc.content }];

    if (user !== undefined) {
        input.push({
            role: "user",
            content: context ? `Conversation so far:\n${context}\n\nCaller:\n${user}` : user,
        });
    }

    const r = await openai.responses.create({
        model: "gpt-4o-mini",
        temperature: svc.temperature ?? 0.8,
        max_output_tokens: svc.maxTokens ?? 120,
        input,
    });

    return (r.output_text || "").trim();
}

function isLoopService(svc) {
    return typeof svc.onTurn === "string";
}

async function runCall(heardRaw) {
    const svc = call.service;
    if (!svc) return "exit";

    if (HANGUP_RE.test(heardRaw)) {
        await speak("Alright. Goodbye.");
        return "exit";
    }

    // loop services (riddle, mystery, etc)
    const loopResult = await handlers.handleLoopTurn(svc, heardRaw);
    if (loopResult === "exit") return "exit";
    if (loopResult === true) return "loop";

    const intent = await routeIntentMasked(heardRaw);
    if (intent.action?.startsWith("SERVICE_") && intent.confidence > 0.6) {
        const next = SERVICES[intent.action.replace("SERVICE_", "")];
if (next && next !== svc) {
    call.service = next;

    if (isLoopService(next)) {
        await handlers.handleOpener(next);
        await handlers[next.onTurn]({
            svc: next,
            user: "",
            context: buildContext(),
        });
        return "loop";
    }

    // one-shot service
    const fn = handlers[next.handler];
    if (fn) await fn({ svc: next, user: "", context: buildContext() });
    return "exit";
}
    }

    await operatorChat(heardRaw);
    return "loop";
}
