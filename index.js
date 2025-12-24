// potsbox index.js — Realtime Operator + Intercepts + Session Logic
// CommonJS — paste and run

const fs = require("fs");
const path = require("path");
const mic = require("mic");
const WebSocket = require("ws");
const Speaker = require("speaker");
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
// TOGGLES
// =====================================================
const USE_SPEAKER_FOR_TTS = true;   // if false, use afplay for generated wav (we'll wrap PCM into WAV)
const USE_CROSSBAR_COVER = true;
const CROSSBAR_MAX_MS = 7000;

// IMPORTANT: if you're using laptop speakers + laptop mic, you will get echo.
// Best physical fix: headphones or a virtual audio device with echo cancellation.
// Code mitigation: avoid playing extra cover audio during realtime playback and answer some intents locally.

// =====================================================
// VOICES (pick whatever you like here)
// =====================================================
const VOICES = {
  operator: "alloy",
  joke: "alloy"
};

// =====================================================
// CALLER TIMEZONE (change if you want)
// =====================================================
const CALLER_TZ = process.env.CALLER_TZ || "America/New_York";

// =====================================================
// RECORDINGS
// =====================================================
const RECORDINGS_DIR = path.join(__dirname, "recordings");

const RECORDINGS = {
  crossbar: "crossbar_connect_sound.wav"
};

// Your big library grouped into “failure/intercept” buckets.
const INTERCEPT_GROUPS = {
  flood: ["attflood.mp3", "N4E-Due-To-The-Flood-076-230220.mp3"],
  earthquake: ["attearth.mp3", "N4E-Due-To-The-Earthquake-076-230220.mp3"],
  hurricane: ["atthur.mp3", "N4E-Due-To-The-Hurricane-076-230220.mp3"],
  all_circuits_busy: [
    "N4E-All-Circuits-Are-Busy-034-231226.mp3",
    "N4E-All-Circuits-Busy-At-Location-076-230220.mp3"
  ],
  call_failed: [
    "N4E-Call-Cannot-Be-Completed-034-231226.mp3",
    "N4E-Your-Call-Did-Not-Go-Through-male-230220.mp3",
    "N4E-Call-Did-Not-Go-Through-034-231226.mp3"
  ],
  numbering_change: [
    "N4E-Due-To-A-Numbering-Change-076-230220.mp3",
    "N4E-The-Area-Code-Has-Changed-to-239-076-230220.mp3"
  ],
  not_available: [
    "attntav.mp3",
    "N4E-Number-Not-Available-From-Your-Calling-Area-034-231226.mp3"
  ],
  emergency: ["attemerg.mp3", "N4E-Due-To-An-Emergency-076-230220.mp3"]
};

const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];
const resolveRecording = (filename) => {
  const p = path.join(RECORDINGS_DIR, filename);
  return fs.existsSync(p) ? p : null;
};

// =====================================================
// CALL SESSION
// =====================================================
const call = {
  id: crypto.randomUUID(),
  greeted: false,
  turn: 0,
  history: [] // [{ heard, replied }]
};

const MAX_HISTORY = 8;

function addTurn(heard, replied) {
  call.turn++;
  call.history.push({
    heard: (heard || "").trim(),
    replied: (replied || "").trim()
  });
  if (call.history.length > MAX_HISTORY) call.history.shift();
}

function buildContext() {
  if (!call.history.length) return "No prior conversation.";
  return call.history
    .map((t, i) => `Turn ${i + 1}\nCaller: ${t.heard}\nOperator: ${t.replied}`)
    .join("\n\n");
}

// =====================================================
// WAV HELPERS (only for mic input + optional PCM->WAV wrapper)
// =====================================================
function parseWav(buf) {
  if (buf.length < 44) throw new Error("WAV too small");

  const riff = buf.toString("ascii", 0, 4);
  const wave = buf.toString("ascii", 8, 12);
  if (riff !== "RIFF" || wave !== "WAVE") throw new Error("Invalid WAV header");

  let o = 12;
  let fmt, ch, rate, bits, dataOfs, dataLen;

  while (o + 8 <= buf.length) {
    const id = buf.toString("ascii", o, o + 4);
    const size = buf.readUInt32LE(o + 4);
    const dataStart = o + 8;

    if (id === "fmt ") {
      fmt = buf.readUInt16LE(dataStart + 0);
      ch = buf.readUInt16LE(dataStart + 2);
      rate = buf.readUInt32LE(dataStart + 4);
      bits = buf.readUInt16LE(dataStart + 14);
    } else if (id === "data") {
      dataOfs = dataStart;
      dataLen = size;
      break;
    }

    // word aligned
    o = dataStart + size + (size % 2);
  }

  if (fmt !== 1) throw new Error("Unsupported WAV format");
  if (bits !== 16) throw new Error("Unsupported WAV bit depth");
  if (dataOfs == null || dataLen == null) throw new Error("WAV data chunk not found");

  return {
    pcm: buf.slice(dataOfs, dataOfs + dataLen),
    channels: ch || 1,
    rate: rate || 24000
  };
}

function downmixToMono16LE(pcm, ch) {
  if (ch === 1) return pcm;
  const frames = Math.floor(pcm.length / (2 * ch));
  const out = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < ch; c++) sum += pcm.readInt16LE((i * ch + c) * 2);
    const avg = Math.max(-32768, Math.min(32767, Math.round(sum / ch)));
    out.writeInt16LE(avg, i * 2);
  }
  return out;
}

function resampleMono16LE(pcm, inRate, outRate) {
  if (inRate === outRate) return pcm;
  const inSamples = pcm.length / 2;
  const outSamples = Math.max(1, Math.floor(inSamples * (outRate / inRate)));
  const out = Buffer.alloc(outSamples * 2);

  for (let i = 0; i < outSamples; i++) {
    const t = i * (inRate / outRate);
    const a = Math.floor(t);
    const b = Math.min(a + 1, inSamples - 1);
    const f = t - a;
    const s = Math.round(pcm.readInt16LE(a * 2) * (1 - f) + pcm.readInt16LE(b * 2) * f);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, s)), i * 2);
  }
  return out;
}

function playPcmMono16LE(pcm, rate) {
  return new Promise((res, rej) => {
    const sp = new Speaker({ channels: 1, bitDepth: 16, sampleRate: rate });
    sp.once("close", res);
    sp.once("error", rej);
    sp.end(pcm);
  });
}

function pcm16ToWavBuffer(pcm, sampleRate = 24000, channels = 1) {
  const blockAlign = channels * 2;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);

  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // PCM fmt chunk size
  buf.writeUInt16LE(1, 20);  // audio format 1=PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(16, 34); // bits

  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);

  pcm.copy(buf, 44);
  return buf;
}

// =====================================================
// RECORDING PLAYBACK (mp3/wav: just use afplay, fastest)
// =====================================================
async function playAudioFile(filePath) {
  if (!filePath) return;
  await new Promise((r) => exec(`afplay "${filePath}"`, r));
}

async function playIntercept(group) {
  const list = INTERCEPT_GROUPS[group] || [];
  const f = pickRandom(list);
  if (!f) return;
  const p = resolveRecording(f);
  if (!p) {
    log("INTERCEPT missing:", group, f);
    return;
  }
  await playAudioFile(p);
}

// =====================================================
// CROSSBAR COVER (killable loop)
// =====================================================
function startLoopAfplay(filePath) {
  let stopped = false;
  let child = null;

  const playOnce = () => {
    if (stopped) return;
    child = spawn("afplay", [filePath], { stdio: "ignore" });
    child.on("exit", () => {
      child = null;
      if (!stopped) playOnce();
    });
  };

  playOnce();

  return {
    stop() {
      stopped = true;
      if (child) {
        try { child.kill("SIGKILL"); } catch {}
      }
    }
  };
}

async function withCrossbar(fn) {
  if (!USE_CROSSBAR_COVER) return await fn();

  const crossbarPath = resolveRecording(RECORDINGS.crossbar);
  if (!crossbarPath) return await fn();

  const loop = startLoopAfplay(crossbarPath);
  const kill = setTimeout(() => {
    log("CROSSBAR watchdog stop");
    loop.stop();
  }, CROSSBAR_MAX_MS);

  try {
    return await fn();
  } finally {
    clearTimeout(kill);
    loop.stop();
  }
}

// =====================================================
// TTS (use PCM output to avoid invalid WAV header issues)
// =====================================================
async function speak(text, voice = VOICES.operator) {
  const s = (text ?? "").toString().trim();
  if (!s) {
    log("TTS: skipped empty text");
    return;
  }

  log("TTS: generating:", JSON.stringify(s).slice(0, 160));

  // NOTE: Use PCM to avoid WAV header headaches.
  // openai.audio.speech.create returns an ArrayBuffer body
  const speech = await withCrossbar(async () => {
    return await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice,
      input: s,
      format: "pcm" // raw 16-bit little-endian, 24kHz, mono
    });
  });

  const pcm = Buffer.from(await speech.arrayBuffer());

  if (USE_SPEAKER_FOR_TTS) {
    try {
      await playPcmMono16LE(pcm, 24000);
      return;
    } catch (e) {
      log("TTS: Speaker failed → afplay fallback:", e.message);
      // fall through to afplay
    }
  }

  // Wrap PCM into a WAV so afplay can handle it
  try {
    const wav = pcm16ToWavBuffer(pcm, 24000, 1);
    fs.writeFileSync("out.wav", wav);
    await new Promise((res) => exec("afplay out.wav", res));
  } catch (e) {
    log("TTS: afplay fallback failed:", e.message);
  }
}

// =====================================================
// DIAL-A-JOKE (keep it clean; no real-person imitation)
// =====================================================
async function dialAJoke() {
  await speak("One moment, dear. Connecting you to Dial-a-Joke.", VOICES.operator);

  const r = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "You are a comedian on a classic Dial-a-Joke line. " +
          "Tell ONE short joke. Keep it clean. No real-person imitation. End after the joke."
      }
    ]
  });

  await speak((r.output_text || "").trim(), VOICES.joke);
  process.exit(0);
}

// =====================================================
// MIC (record and ensure file is closed)
// =====================================================
function recordOnce({ outFile = "input.wav", maxMs = 6000 } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };

    // (Small improvement) add some silence detection so we stop earlier if caller stops talking.
    // exitOnSilence is in seconds for mic module (depends on underlying sox).
    const micInstance = mic({
      rate: "16000",
      channels: "1",
      debug: false,
      exitOnSilence: 2,
      fileType: "wav"
    });

    const stream = micInstance.getAudioStream();
    const out = fs.createWriteStream(outFile);
    stream.pipe(out);

    const hardStop = setTimeout(() => {
      try { micInstance.stop(); } catch {}
    }, maxMs);

    stream.on("error", (err) => {
      log("MIC ERROR:", err);
      clearTimeout(hardStop);
      try { micInstance.stop(); } catch {}
      try { out.end(); } catch {}
      finish();
    });

    stream.on("stopComplete", () => {
      clearTimeout(hardStop);
      try { out.end(); } catch {}
    });

    out.on("close", () => finish());
    out.on("error", (err) => {
      log("FILE ERROR:", err);
      clearTimeout(hardStop);
      finish();
    });

    micInstance.start();
  });
}

// =====================================================
// OPERATOR PROMPT
// =====================================================
function operatorPrompt(heardRaw) {
  return (
    "You are a warm, lively 1970s telephone operator.\n" +
    "Sound human. You may use gentle phrases like 'okay love' or 'hang on dear' naturally.\n" +
    "Be helpful: answer simple questions directly. If they want to be connected, ask what city/number/service.\n" +
    "Keep replies to 1–2 sentences.\n" +
    "English only.\n\n" +
    `Call id: ${call.id}\nTurn: ${call.turn + 1}\n\n` +
    "Conversation so far:\n" + buildContext() + "\n\n" +
    "Caller just said:\n" + (heardRaw || "").trim() + "\n\n" +
    "Reply as the operator (no narration)."
  );
}

function wavFileToPcm16kMono(wavPath) {
  const wav = fs.readFileSync(wavPath);
  const parsed = parseWav(wav);
  let mono = downmixToMono16LE(parsed.pcm, parsed.channels);
  mono = resampleMono16LE(mono, parsed.rate, 16000);
  return mono;
}

// =====================================================
// REALTIME OPERATOR (plays audio live; returns transcript)
// =====================================================
async function operatorReplyRealtime(wavPath, heardRaw) {
  const pcm = wavFileToPcm16kMono(wavPath);
  const instructions = operatorPrompt(heardRaw);

  const ws = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview",
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1"
      }
    }
  );

  const speaker = new Speaker({ channels: 1, bitDepth: 16, sampleRate: 24000 });

  // We try to capture BOTH:
  // - audio transcript stream (if provided)
  // - text output stream (if provided)
  let transcript = "";
  let textOut = "";

  const CHUNK = 3200; // ~100ms @16kHz mono pcm16

  // KEY CHANGE:
  // Do NOT play crossbar cover while realtime is outputting audio.
  // It will absolutely get re-recorded by your mic if you’re on laptop speakers.
  // We'll still allow crossbar for TTS and API calls elsewhere.
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { ws.close(); } catch {}
      try { speaker.end(); } catch {}
      reject(new Error("Realtime timeout"));
    }, 15000);

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "session.update",
          session: {
            modalities: ["audio", "text"],
            instructions,
            voice: VOICES.operator,
            input_audio_format: "pcm16",
            output_audio_format: "pcm16",
            turn_detection: null
          }
        })
      );

      for (let i = 0; i < pcm.length; i += CHUNK) {
        ws.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: pcm.slice(i, i + CHUNK).toString("base64")
          })
        );
      }

      ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      ws.send(JSON.stringify({ type: "response.create", response: { modalities: ["audio", "text"] } }));
    });

    ws.on("message", (m) => {
      let e;
      try { e = JSON.parse(m.toString()); } catch { return; }

      if (e.type === "response.output_audio.delta" && e.delta) {
        speaker.write(Buffer.from(e.delta, "base64"));
      }

      // Some models/events emit this
      if (e.type === "response.output_audio_transcript.delta" && e.delta) {
        transcript += e.delta;
      }

      // Some emit text deltas instead/also
      if ((e.type === "response.output_text.delta" || e.type === "response.text.delta") && e.delta) {
        textOut += e.delta;
      }

      if (e.type === "response.done") {
        clearTimeout(timeout);
        try { speaker.end(); } catch {}
        try { ws.close(); } catch {}

        const out = (transcript || textOut || "").trim();
        resolve(out);
      }

      if (e.type === "error") {
        clearTimeout(timeout);
        try { speaker.end(); } catch {}
        try { ws.close(); } catch {}
        reject(new Error(e.error?.message || "Realtime error"));
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      try { speaker.end(); } catch {}
      reject(err);
    });

    ws.on("close", () => {
      // ensure speaker ends
      try { speaker.end(); } catch {}
    });
  });
}

// =====================================================
// SIMPLE INTENTS (avoid realtime for these; prevents echo-loop)
// =====================================================
function looksLikeTimeIntent(heardLower) {
  return (
    heardLower.includes("what time") ||
    heardLower.includes("tell me the time") ||
    heardLower.includes("time is it") ||
    heardLower.trim() === "time" ||
    heardLower.includes("current time") ||
    heardLower.includes("time please")
  );
}

function formatTimeForCaller(tz) {
  // Example: "9:31 PM, Wednesday, December 24"
  const d = new Date();
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(d);

  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(d);

  return { time, date };
}

// =====================================================
// MAIN LOOP
// =====================================================
(async function run() {
  log("CALL START:", call.id);

  // quick recordings sanity
  const crossbarPath = resolveRecording(RECORDINGS.crossbar);
  log("REC crossbar:", crossbarPath ? "OK" : "MISSING", crossbarPath || RECORDINGS.crossbar);

  while (true) {
    if (!call.greeted) {
      await speak("Operator here, how may I help you?", VOICES.operator);
      call.greeted = true;
    }

    await recordOnce();

    // debug: confirm you actually recorded something
    try {
      const st = fs.statSync("input.wav");
      log("REC: input.wav bytes:", st.size);
      if (st.size < 2000) {
        await speak("I didn't quite catch that, love. Could you say it again?", VOICES.operator);
        continue;
      }
    } catch {}

    const stt = await openai.audio.transcriptions.create({
      file: fs.createReadStream("input.wav"),
      model: "gpt-4o-transcribe"
    });

    const heardRaw = (stt.text || "").trim();
    const heard = heardRaw.toLowerCase();
    log("HEARD:", JSON.stringify(heardRaw));

    if (!heardRaw) {
      await speak("Hello love, are you there?", VOICES.operator);
      continue;
    }

    // 10% random telco failure (fun)
    if (Math.random() < 0.1) {
      const groups = Object.keys(INTERCEPT_GROUPS);
      await playIntercept(pickRandom(groups));
      continue;
    }

    // --- INTENTS FIRST (avoid realtime audio output for these) ---

    if (heard.includes("joke")) {
      await dialAJoke();
      return;
    }

    if (heard.includes("bye") || heard.includes("goodbye") || heard.includes("hang up")) {
      await speak("Alright love. Goodbye now.", VOICES.operator);
      process.exit(0);
    }

    // TIME INTENT (fixes your loop case)
    if (looksLikeTimeIntent(heard)) {
      const { time, date } = formatTimeForCaller(CALLER_TZ);
      const reply = `It's ${time}, ${date}, dear. Anything else I can do for you?`;
      await speak(reply, VOICES.operator);
      addTurn(heardRaw, reply);
      continue;
    }

    // --- Otherwise: Realtime operator (plays audio live) ---
    try {
      const transcript = await operatorReplyRealtime("input.wav", heardRaw);

      // If realtime produced no transcript, speak a short fallback so the caller hears *something*
      // and so we don't store an empty operator turn (which makes future prompts worse).
      const finalReply = (transcript || "").trim() || "Sorry love, I missed that—could you say it once more?";

      log("OPERATOR SAID:", JSON.stringify(finalReply));

      // IMPORTANT: realtime already played audio; do NOT re-speak it.
      // We only speak if the model gave us nothing.
      if (!transcript || !transcript.trim()) {
        await speak(finalReply, VOICES.operator);
      }

      addTurn(heardRaw, finalReply);
    } catch (e) {
      log("REALTIME FAIL → fallback TTS:", e.message);

      const r = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content:
              "You are a warm, lively 1970s telephone operator. " +
              "Be human and helpful. Keep replies to 1–2 sentences. English only."
          },
          {
            role: "user",
            content:
              `Conversation so far:\n${buildContext()}\n\n` +
              `Caller: ${heardRaw}\nOperator:`
          }
        ]
      });

      const reply = (r.output_text || "").trim() || "Sorry love, could you repeat that?";
      await speak(reply, VOICES.operator);
      addTurn(heardRaw, reply);
    }
  }
})();
