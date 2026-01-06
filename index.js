const { DateTime } = require("luxon");

const AmiClient = require("asterisk-ami-client");
const ami = new AmiClient();
ami.connect("node", "nodepass", {
    host: "asterisk",
    port: 5038,
})
    .then(() => {
        console.log("AMI connected as node");
    })
    .catch((err) => {
        console.error("AMI connection failed", err);
    });
const SERVICES = require("./services");
const http = require("http");
const path = require("path");
const fs = require("fs");
const OpenAI = require("openai");
const { exec, execSync } = require("child_process");
const crypto = require("crypto");
const HANGUP_RE = /\b(bye|goodbye|hang up|get off|gotta go|have to go|see you)\b/i;
const url = require("url");
const handlers = {
    handleTime: async ({ svc }) => {
        const time = call.now.toFormat("h:mm a");
        const seconds = call.now.second;
        await speak(`At the tone, the time will be ${time} and ${secondsToWords(seconds)}.`);
        await speak("BEEEP!");
        if (svc.closer) await speak(svc.closer);
        return "exit";
    },
    handleWeather: async ({ svc }) => {
        const report = await getWeatherReport();
        if (!report)
            return speak(
                "I am sorry but the Weather service is temporarily unavailable, please try your call again later."
            );
        await speak(await narrateWeather(openai, report));
        await speak("And always remember folks, if you don't like the weather, wait five minutes.");
        if (svc.closer) await speak(svc.closer);
        return "exit";
    },
    handleOpener: async (svc) => {
        if (svc.opener) await speak(svc.opener);
    },

    handleNasaLoop: async ({ svc }) => {
        const report = await getNASA();
        if (!report) {
            speak("NASA is temporarily unavailable. Please try again later.");
            return "loop";
        }
        await speak(await narrateReport(openai, report));
        if (svc.closer) await speak(svc.closer);
        return "loop";
    },

    handleOnThisDay: async ({ svc }) => {
        console.log("not his day called");
        const report = await getOnThisDayReport(); // returns a short raw text blob
        if (!report) return speak("I am sorry but On This Day is temporarily unavailable, please try again later.");

        await speak(await narrateOnThisDay(openai, report));
        if (svc.closer) await speak(svc.closer);
        return "exit";
    },

    handleQuake: async ({ svc }) => {
        const report = await getQuakeReport();
        if (!report) return speak("I am sorry, the earthquake service is temporarily unavailable.");

        await speak(await narrateReport(openai, report));
        if (svc.closer) await speak(svc.closer);
        return "exit";
    },

    service: async ({ svc }) => {
        const reply = await handlers.runServiceLoop({ svc });
        if (reply) await speak(reply);
        if (svc.closer) await speak(svc.closer);
        return "exit";
    },
    loopService: async ({ svc, user, context }) => {
        const reply = await handlers.runServiceLoop({ svc, user: user ?? "", context });
        if (reply) await speak(reply);
        return "loop";
    },
    runServiceLoop,
    handleLoopTurn: async (svc, heardRaw) => {
        if (!svc?.handler) return "exit";
        const decision = await handlers[svc.handler]({ svc, user: heardRaw });

        if (decision !== "loop" && decision !== "exit") {
            throw new Error(`Handler ${svc.handler} returned invalid: ${decision}`);
        }
        return decision;
    },
};

async function narrateReport(openai, raw) {
    const svc = call.service;

    const r = await openai.responses.create({
        model: "gpt-4o-mini",
        temperature: 0.9,
        max_output_tokens: 120,
        input: [
            {
                role: "system",
                content: svc.content,
            },
            { role: "user", content: raw },
        ],
    });

    return (r.output_text || "").trim();
}

async function getQuakeReport() {
    const url = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";

    const j = await fetch(url).then((r) => r.json());
    const f = (j.features || []).sort((a, b) => b.properties.mag - a.properties.mag)[0];

    if (!f) return null;

    return `Strongest earthquake today: magnitude ${f.properties.mag} near ${f.properties.place}.`;
}

async function getNASA() {
    try {
        const url = "https://eonet.gsfc.nasa.gov/api/v3/events?limit=1";
        const j = await fetch(url).then((r) => r.json());
        const e = j?.events?.[0];
        if (!e) return null;

        return `NASA reports a ${e.categories[0].title.toLowerCase()} event: ${e.title}.`;
    } catch {
        return null;
    }
}

async function getOnThisDayReport(date = call.now) {
    console.log("Get on this day report");
    try {
        const m = String(date.month).padStart(2, "0");
        const d = String(date.day).padStart(2, "0");

        const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${m}/${d}`;
        const j = await fetch(url, { headers: { "User-Agent": "PotsBox/1.0 (on-this-day)" } }).then((r) => {
            if (!r.ok) throw new Error(`WIKI_${r.status}`);
            return r.json();
        });

        const events = (j?.events || []).filter((e) => e?.year && e?.text);
        if (!events.length) return null;

        // pick 2, prefer modern
        const pool = events.filter((e) => e.year >= 1900);
        const use = pool.length ? pool : events;

        const pick = () => use[Math.floor(Math.random() * use.length)];
        const clean = (s) =>
            String(s || "")
                .replace(/\s+/g, " ")
                .replace(/\[[^\]]*\]/g, "")
                .trim();

        const a = pick();
        let b = pick();
        for (let i = 0; i < 10 && b === a; i++) b = pick();

        const lines = [a, b]
            .map((e) => `On this day in ${e.year}, ${clean(e.text)}`)
            .map((s) => (s.length > 220 ? s.slice(0, 217) + "…" : s));

        // raw “wire copy” for the model to read like a radio host
        return `City: ${call.city}\nItems:\n- ${lines[0]}\n- ${lines[1]}`;
    } catch {
        return null;
    }
}

async function narrateOnThisDay(openai, rawReport) {
    const r = await openai.responses.create({
        model: "gpt-4o-mini",
        temperature: 0.8,
        max_output_tokens: 140,
        input: [
            {
                role: "system",
                content:
                    "You are a witty radio narrator. Read TWO short 'on this day' items. Keep it punchy, no citations, no links, no lists, no extra facts.",
            },
            { role: "user", content: rawReport },
        ],
    });

    return (r.output_text || "").trim();
}

if (!process.env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY in environment.");
    process.exit(1);
}
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});
const log = (...a) => console.log(call.now.toISO(), ...a);
function serviceForExten(exten) {
    return Object.values(SERVICES).find((svc) => svc.ext === exten) || null;
}
async function getWeatherReport() {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(call.city)}&count=1&language=en&format=json`;
    const geo = await fetch(geoUrl).then((r) => r.json());
    const hit = geo?.results?.[0];
    if (!hit) return null;
    const { latitude, longitude, name, admin1, country } = hit;
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
let channelVars = {};
function appendCtx(role, content) {
    // records each turn
    const ctxPath = path.join(__dirname, "asterisk-sounds", "en", `${call.id}.ctx.jsonl`);
    fs.appendFileSync(ctxPath, JSON.stringify({ role, content }) + "\n");
}
async function initCallState({ req, channelVars = {} }) {
    console.log("starting call state setup");

    const { raw, exten, callId } = parseCallQuery(req);
    console.log("raw is", raw);

    call.id = callId;
    call.greeted = false;
    call._assistantEnded = false;
    call.city = channelVars.CALLER_CITY || "New York City";
    call.timezone = channelVars.CALLER_TZ || "America/New_York";
    call.now = DateTime.now().setZone(call.timezone || "America/New_York");
    return { raw, exten, callId };
}
function parseCallQuery(req) {
    const { query } = url.parse(req.url, true);
    const raw = (query.exten || "").trim();
    const [exten, callId] = raw.split("-", 2);
    return { query, raw, exten, callId };
}
http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url.startsWith("/call/dial")) {
        try {
            const { exten } = await initCallState({ req, channelVars: {} });
            if (!exten) {
                res.statusCode = 400;
                res.end("Missing exten\n");
                return;
            }
            await originateCall({ exten });
            res.end("DIALING\n");
        } catch (err) {
            console.error(err);
            res.statusCode = 500;
            res.end("ERROR\n");
        }
    }
    function waitForStableFile(p, tries = 6, delay = 150) {
        for (let i = 0; i < tries; i++) {
            try {
                execSync(`ffmpeg -v error -i "${p}" -f null -`);
                return true;
            } catch {}
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
        }
        return false;
    }
    if (req.method === "POST" && req.url.startsWith("/call/reply")) {
        try {
            const { exten } = await initCallState({ req, channelVars });
            if (!call.service) call.service = serviceForExten(exten);

            const { wavInPath } = callFiles(call.id);
            if (!waitForStableFile(wavInPath)) {
                res.end("exit"); // Asterisk retry, not logic
                return;
            }

            if (isTooQuiet(wavInPath)) {
                await speak("Sorry, I didn’t catch that.");
                res.end("exit");
                return;
            }

            const heardRaw = await transcribeFromFile(wavInPath);
            appendCtx("user", heardRaw);

            const { wavPath } = callFiles(call.id);
            try {
                if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
            } catch {}

            const decision = await runCall(heardRaw);

            if (decision !== "loop" && decision !== "exit") {
                throw new Error(`Invalid handler return: ${decision}`);
            }

            res.end(decision);
        } catch (err) {
            console.error(err);
            res.statusCode = 500;
            res.end("exit"); // fail closed
        }
    }

    if (req.method === "POST" && req.url.startsWith("/call/start")) {
        try {
            const { raw, exten, callId } = await initCallState({ req, channelVars: channelVars || {} });
            if (!callId) {
                res.end("exit");
                return;
            }
            log("CALL START FROM:", raw);
            const svc = exten === "0" ? SERVICES.OPERATOR : serviceForExten(exten);
            if (!svc) {
                res.end("invalid");
                return;
            }
            call.service = svc;
            resetCallFiles(call.id);
            await startCall({ exten });
            res.end(isLoopService(call.service) ? "loop" : "exit");
        } catch (err) {
            console.error(err);
            res.statusCode = 500;
            res.end("ERROR\n");
        }
    }
    res.statusCode = 404;
    res.end();
}).listen(3000, "0.0.0.0", () => {
    console.log("Listening on :3000");
});
function resetCallFiles(callId) {
    const base = path.join(__dirname, "asterisk-sounds", "en");
    const files = [
        `${callId}.ctx.txt`,
        `${callId}.ctx.jsonl`,
        `${callId}.out.wav`,
        `${callId}.out.ulaw`,
        `${callId}_in.wav`,
        `${callId}_in.ulaw`,
    ];
    for (const f of files) {
        const p = path.join(base, f);
        try {
            if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch {}
    }
    // --- always clean up stale call files (> 1 hour) ---
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const f of fs.readdirSync(base)) {
        if (
            f.endsWith(".ctx.txt") ||
            f.endsWith(".ctx.jsonl") ||
            f.endsWith(".out.wav") ||
            f.endsWith(".out.ulaw") ||
            f.endsWith("_in.wav") ||
            f.endsWith("_in.ulaw")
        ) {
            const p = path.join(base, f);
            try {
                if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
            } catch {}
        }
    }
}
async function startCall({ exten }) {
    call.service = serviceForExten(exten);
    const svc = call.service;
    // Opener is terminal for this turn
    if (svc.opener) {
        await speak(replaceTokens(svc.opener, svc));
        return;
    }
    // No opener → first model turn
    if (isLoopService(svc)) {
        await handlers[svc.handler]({ svc, user: "" });
    } else {
        const fn = handlers[svc.handler];
        if (fn) await fn({ svc });
    }
}
function buildMessages(svc) {
    const ctxPath = path.join(__dirname, "asterisk-sounds", "en", `${call.id}.ctx.jsonl`);
    const messages = [{ role: "system", content: replaceTokens(svc.content, svc) }];
    if (!fs.existsSync(ctxPath)) return messages;
    const lines = fs.readFileSync(ctxPath, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
        messages.push(JSON.parse(line));
    }
    return messages;
}
function isTooQuiet(wavPath) {
    const volume = -30; // try -30, -28, -25
    try {
        const cmd = `ffmpeg -hide_banner -nostats -i "${wavPath}" -af volumedetect -f null /dev/null 2>&1`;
        const out = execSync(cmd).toString();
        const match = out.match(/max_volume:\s*(-?\d+(\.\d+)?) dB/);
        if (!match) {
            console.log("No max_volume found → treating as silence");
            return true;
        }
        const maxDb = parseFloat(match[1]);
        return maxDb < volume;
    } catch (err) {
        console.error("Volume detect failed:", err.message);
        return true;
    }
}
function cleanForSpeech(text) {
    return (text || "").replace(/^\s*operator:\s*/i, "").trim();
}
function assistantEndedCall(text) {
    return /\b(goodbye|good-bye|that’s all|thats all|farewell|hang up)\b/i.test(text);
}
function callFiles(callId) {
    const baseDir = path.join(__dirname, "asterisk-sounds", "en");
    return {
        baseDir,
        ctx: path.join(baseDir, `${callId}.ctx.txt`),
        wavPath: path.join(baseDir, `${callId}.out.wav`),
        ulawPath: path.join(baseDir, `${callId}.out.ulaw`),
        wavInPath: path.join(baseDir, `${callId}_in.wav`),
    };
}
async function speak(text) {
    if (text === "loop" || text === "exit") return;
    const svc = call.service;
    text = replaceTokens(text, svc);
    const voiceName = svc.voice ? svc.voice.charAt(0).toUpperCase() + svc.voice.slice(1) : "Assistant";

    console.log(`[${call.id}] ${voiceName}:`, text);

    const s = cleanForSpeech(text);
    if (!s) {
        console.log("Empty text passed to speak.");
        return;
    }
    const { wavPath, ulawPath } = callFiles(call.id);
    appendCtx("assistant", s);
    try {
        if (!svc?.voice) throw new Error("No voice for current service");
        const voice = svc.voice;
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
        if (!fs.existsSync(wavPath)) {
            fs.writeFileSync(wavPath, wavChunk);
        } else {
            const pcm = wavChunk.subarray(44);
            fs.appendFileSync(wavPath, pcm);
        }
        await new Promise((resolve, reject) => {
            exec(`ffmpeg -y -i "${wavPath}" -ar 8000 -ac 1 -f mulaw "${ulawPath}"`, (err) =>
                err ? reject(err) : resolve()
            );
        });
        if (assistantEndedCall(s)) {
            const voice = svc.voice ? svc.voice.charAt(0).toUpperCase() + svc.voice.slice(1) : "Assistant";

            //console.log(`${voice}:`, "ENDED THE CALL");
            call._assistantEnded = true;
        }
    } catch (err) {
        console.error("Error in speak:", err);
    }
}
function originateCall({ exten }) {
    return ami.send({
        Action: "Originate",
        Channel: "Local/7243@ai-phone",
        CallerID: "Science <7243>",
        Async: true,
    });
}
async function transferCall(exten) {
    return ami.send({
        Action: "Originate",
        Channel: `Local/${exten}@ai-phone`,
        CallerID: `${exten}`,
        Async: true,
    });
}
function serviceFromIntent(action) {
    if (!action?.startsWith("SERVICE_")) return null;
    const key = action.replace("SERVICE_", "");
    return SERVICES[key] || null;
}
async function operatorChat(heardRaw) {
    console.log("Handling Operator Chat for:", heardRaw);
    try {
        const svc = call.service;
        const messages = buildMessages(svc);
        messages.push({ role: "user", content: heardRaw });
        const r = await openai.responses.create({
            model: "gpt-4o-mini",
            temperature: 0.7,
            max_output_tokens: 120,
            input: messages,
        });
        const reply = (r.output_text || "").replace(/^operator:\s*/i, "").trim();
        await speak(reply);
    } catch (err) {
        console.error("Error in operator chat:", err);
    }
}

function secondsToWords(sec) {
    return `${sec} second${sec === 1 ? "" : "s"}`;
}
function seasonForDate(date = call.now) {
    const m = date.month ?? DateTime.fromJSDate(date).month;

    if (m === 12 || m === 1 || m === 2) return "Winter";
    if (m >= 3 && m <= 5) return "Spring";
    if (m >= 6 && m <= 8) return "Summer";
    return "Fall";
}
function zodiacSignForDate(date = call.now) {
    const m = date.month; // 1–12
    const d = date.day;

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
    return "Pisces";
}
async function transcribeFromFile(path) {
    const file = fs.createReadStream(path);
    const stt = await openai.audio.transcriptions.create({
        file,
        model: "gpt-4o-mini-transcribe",
    });
    return (stt.text || "").replace(/[^\w\s,.!?-]/g, "").trim(); // Remove anything not a standard character
}
function moonPhaseForDate(dt = call.now) {
    const utc = dt.toUTC();

    const synodicMonth = 29.530588853; // days
    const knownNewMoon = DateTime.utc(2000, 1, 6, 18, 14);

    const daysSince = (utc.toMillis() - knownNewMoon.toMillis()) / 86400000;

    const phase = ((daysSince % synodicMonth) + synodicMonth) % synodicMonth;

    if (phase < 1.84566) return "new moon";
    if (phase < 5.53699) return "waxing crescent moon";
    if (phase < 9.22831) return "first quarter moon";
    if (phase < 12.91963) return "waxing gibbous moon";
    if (phase < 16.61096) return "full moon";
    if (phase < 20.30228) return "waning gibbous moon";
    if (phase < 23.99361) return "last quarter moon";
    return "waning crescent";
}
function marsPhaseForDate(dt = call.now) {
    const utc = dt.toUTC();

    const synodic = 779.94; // days
    const knownOpposition = DateTime.utc(2022, 12, 8);

    const days = (utc.toMillis() - knownOpposition.toMillis()) / 86400000;

    const phase = ((days % synodic) + synodic) % synodic;

    if (phase < 60) return "near opposition";
    if (phase < 120) return "receding";
    if (phase < 390) return "far side of orbit";
    if (phase < 450) return "approaching opposition";
    return "near opposition";
}
function moonIllumination(dt = call.now) {
    const utc = dt.toUTC();

    const synodic = 29.530588853;
    const ref = DateTime.utc(2000, 1, 6, 18, 14);

    const days = (utc.toMillis() - ref.toMillis()) / 86400000;

    const phase = ((days % synodic) + synodic) % synodic;

    return Math.round(50 * (1 - Math.cos((2 * Math.PI * phase) / synodic)));
}
function planetaryDay(dt = call.now) {
    // Luxon: weekday 1=Mon … 7=Sun
    return ["Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn", "Sun"][dt.weekday - 1];
}

function eclipseSeason(dt = call.now) {
    const utc = dt.toUTC();

    const cycle = 173.31;
    const ref = DateTime.utc(2000, 1, 21);

    const days = (utc.toMillis() - ref.toMillis()) / 86400000;

    const phase = ((days % cycle) + cycle) % cycle;

    return phase < 20 || phase > cycle - 20 ? "eclipse season" : "quiet skies";
}
function mercuryTone(dt = call.now) {
    const utc = dt.toUTC();

    const synodic = 115.88;
    const ref = DateTime.utc(2019, 11, 11); // Nov 11 2019

    const days = (utc.toMillis() - ref.toMillis()) / 86400000;

    const phase = ((days % synodic) + synodic) % synodic;

    return phase < 24 ? "mercury-sensitive window" : "mercury steady";
}
function zodiacYearForDate(dt = call.now) {
    const animals = [
        "Rat",
        "Ox",
        "Tiger",
        "Rabbit",
        "Dragon",
        "Snake",
        "Horse",
        "Goat",
        "Monkey",
        "Rooster",
        "Dog",
        "Pig",
    ];

    let y = dt.year;

    // Lunar New Year cutoff (simple, stable rule)
    if (dt.month === 1 || (dt.month === 2 && dt.day < 4)) {
        y -= 1;
    }

    return animals[(y - 4 + 12) % 12];
}

function replaceTokens(content, svc = {}) {
    if (!content) return content;
    const now = call.now; // Luxon DateTime

    const hour24 = now.hour;
    const hour12 = now.toFormat("h");
    const minute = now.toFormat("mm");
    const ampm = now.toFormat("a");

    const tokens = {
        "{{uuid}}": crypto.randomUUID(),

        "{{weekday}}": now.toFormat("cccc"),
        "{{month}}": now.toFormat("LLLL"),
        "{{day}}": now.day,

        "{{hour}}": hour24,
        "{{hour12}}": hour12,
        "{{hour24}}": hour24,
        "{{minute}}": minute,
        "{{ampm}}": ampm,

        "{{time}}": now.toFormat("h:mm a"),
        "{{timezone}}": now.zoneName,

        "{{greeting}}": hour24 < 12 ? "Good morning" : hour24 < 17 ? "Good afternoon" : "Good evening",

        "{{timeofday}}":
            hour24 < 6
                ? "twilight"
                : hour24 < 12
                  ? "morning"
                  : hour24 < 17
                    ? "afternoon"
                    : hour24 < 21
                      ? "evening"
                      : "night",

        "{{daytype}}": now.weekday >= 6 ? "weekend" : "weekday",

        "{{exten}}": svc.ext,
        "{{service}}": svc.name || svc.key,
        "{{callid}}": call.id,
    };
    let out = content;
    for (const [k, v] of Object.entries(tokens)) {
        out = out.replaceAll(k, String(v));
    }
    return out;
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
async function runServiceLoop({ svc }) {
    const messages = buildMessages(svc);
    const r = await openai.responses.create({
        model: "gpt-4o-mini",
        temperature: svc.temperature ?? 0.8,
        max_output_tokens: svc.maxTokens ?? 120,
        input: messages,
    });
    return (r.output_text || "").trim();
}
function isLoopService(svc) {
    return typeof svc.handler === "string" && svc.handler.includes("loop");
}
async function runCall(heardRaw) {
    const svc = call.service;
    if (!svc) return "exit";

    if (HANGUP_RE.test(heardRaw)) {
        await speak("Alright. Goodbye.");
        return "exit";
    }

    // Let the handler speak and return "loop" or "exit"
    const decision = await handlers.handleLoopTurn(svc, heardRaw);

    // 🔒 HARD RULE: one-shot services can NEVER loop
    if (!isLoopService(svc)) {
        return "exit";
    }

    return decision; // loop services only
}
