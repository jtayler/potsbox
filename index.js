// potsbox index.js — working baseline + Realtime operator + recordings + CALL SESSION
// CommonJS, paste-and-run

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

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

// =====================================================
// 🔧 TOGGLES
// =====================================================
const USE_SPEAKER_FOR_TTS = true; // set false to force afplay for TTS
const USE_CROSSBAR_COVER = true; // play crossbar while generating TTS/realtime
const CROSSBAR_MAX_MS = 7000; // safety stop if something goes weird

// =====================================================
// 📼 RECORDINGS (put these in ./recordings)
// =====================================================
const RECORDINGS_DIR = path.join(__dirname, "recordings");

const RECORDINGS = {
  crossbar: "crossbar_connect_sound.wav",
  error_call_again_later: "error_call_again_later.wav",
  error_youhavereached: "error-youhavereached.wav"
};

function resolveRecording(filename) {
  const p = path.join(RECORDINGS_DIR, filename);
  return fs.existsSync(p) ? p : null;
}

// =====================================================
// ☎️ CALL SESSION (NEW)
// - keeps a short memory so operator behaves like an operator in a real call
// =====================================================
function newCallSession() {
  return {
    id: crypto.randomUUID(),
    startedAt: Date.now(),
    greeted: false,
    turn: 0,
    history: [] // [{ heard, replied }]
  };
}

const call = newCallSession();
const MAX_HISTORY_TURNS = 8;

function addTurn(heard, replied) {
  call.turn += 1;
  call.history.push({
    heard: (heard || "").trim(),
    replied: (replied || "").trim()
  });
  if (call.history.length > MAX_HISTORY_TURNS) call.history.shift();
}

function buildOperatorContextText() {
  if (!call.history.length) return "No prior conversation yet.";
  return call.history
    .map((t, i) => `Turn ${i + 1}\nCaller: ${t.heard}\nOperator: ${t.replied}`)
    .join("\n\n");
}

// =====================================================
// 🔧 tiny WAV parser (safe enough for PCM16 WAVs)
// Supports: RIFF/WAVE PCM16 mono/stereo. Finds the "data" chunk properly.
// =====================================================
function parseWav(wavBytes) {
  if (wavBytes.length < 44) throw new Error("WAV too small");

  const riff = wavBytes.slice(0, 4).toString("ascii");
  const wave = wavBytes.slice(8, 12).toString("ascii");
  if (riff !== "RIFF" || wave !== "WAVE") throw new Error("Invalid WAV header");

  let offset = 12;
  let audioFormat, numChannels, sampleRate, bitsPerSample;
  let dataOffset = null;
  let dataSize = null;

  while (offset + 8 <= wavBytes.length) {
    const id = wavBytes.slice(offset, offset + 4).toString("ascii");
    const size = wavBytes.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;

    if (id === "fmt ") {
      audioFormat = wavBytes.readUInt16LE(chunkDataStart + 0);
      numChannels = wavBytes.readUInt16LE(chunkDataStart + 2);
      sampleRate = wavBytes.readUInt32LE(chunkDataStart + 4);
      bitsPerSample = wavBytes.readUInt16LE(chunkDataStart + 14);
    } else if (id === "data") {
      dataOffset = chunkDataStart;
      dataSize = size;
      break;
    }

    offset = chunkDataStart + size + (size % 2);
  }

  if (audioFormat !== 1) throw new Error(`Unsupported WAV format (audioFormat=${audioFormat})`);
  if (bitsPerSample !== 16) throw new Error(`Unsupported WAV bit depth (${bitsPerSample})`);
  if (dataOffset == null || dataSize == null) throw new Error("WAV data chunk not found");

  const pcm = wavBytes.slice(dataOffset, dataOffset + dataSize);
  return { pcm, numChannels, sampleRate, bitsPerSample };
}

function downmixToMono16LE(pcm, channels) {
  if (channels === 1) return pcm;

  const frames = Math.floor(pcm.length / (2 * channels));
  const out = Buffer.alloc(frames * 2);

  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const idx = (i * channels + c) * 2;
      sum += pcm.readInt16LE(idx);
    }
    const avg = Math.max(-32768, Math.min(32767, Math.round(sum / channels)));
    out.writeInt16LE(avg, i * 2);
  }
  return out;
}

// Minimal linear resampler for 16-bit mono PCM
function resampleMono16LE(pcm, inRate, outRate) {
  if (inRate === outRate) return pcm;

  const inSamples = pcm.length / 2;
  const outSamples = Math.max(1, Math.floor(inSamples * (outRate / inRate)));
  const out = Buffer.alloc(outSamples * 2);

  for (let i = 0; i < outSamples; i++) {
    const t = i * (inRate / outRate);
    const i0 = Math.floor(t);
    const i1 = Math.min(inSamples - 1, i0 + 1);
    const frac = t - i0;

    const s0 = pcm.readInt16LE(i0 * 2);
    const s1 = pcm.readInt16LE(i1 * 2);
    const s = Math.round(s0 + (s1 - s0) * frac);

    out.writeInt16LE(Math.max(-32768, Math.min(32767, s)), i * 2);
  }
  return out;
}

function playPcmMono16LE(pcm, sampleRate) {
  return new Promise((resolve, reject) => {
    const speaker = new Speaker({ channels: 1, bitDepth: 16, sampleRate });

    const cleanup = () => speaker.removeAllListeners();

    speaker.once("close", () => {
      cleanup();
      resolve();
    });

    speaker.once("error", (err) => {
      cleanup();
      reject(err);
    });

    speaker.end(pcm);
  });
}

// =====================================================
// 🎛 Recordings playback
// =====================================================
async function playRecordingOnce(name, { sampleRateOut = 24000 } = {}) {
  const p = resolveRecording(RECORDINGS[name]);
  if (!p) {
    log("REC: missing recording:", name, "(expected in ./recordings)");
    return;
  }

  try {
    const wav = fs.readFileSync(p);
    const parsed = parseWav(wav);
    let pcm = downmixToMono16LE(parsed.pcm, parsed.numChannels);
    pcm = resampleMono16LE(pcm, parsed.sampleRate, sampleRateOut);
    await playPcmMono16LE(pcm, sampleRateOut);
  } catch (e) {
    log("REC: Speaker play failed, using afplay:", e.message);
    await new Promise((res) => exec(`afplay "${p}"`, res));
  }
}

// Killable loop using afplay
function startRecordingLoopAfplay(name) {
  const p = resolveRecording(RECORDINGS[name]);
  if (!p) {
    log("REC: missing recording:", name, "(expected in ./recordings)");
    return { stop() {} };
  }

  let stopped = false;
  let child = null;

  const startOnce = () => {
    if (stopped) return;
    child = spawn("afplay", [p], { stdio: "ignore" });
    child.on("exit", () => {
      child = null;
      if (!stopped) startOnce();
    });
  };

  startOnce();

  return {
    stop() {
      stopped = true;
      if (child) {
        try {
          child.kill("SIGKILL");
        } catch {}
      }
    }
  };
}

// Helper: run async work while crossbar audio covers the wait
async function withCrossbarCover(fn) {
  if (!USE_CROSSBAR_COVER) return await fn();

  const loop = startRecordingLoopAfplay("crossbar");
  const watchdog = setTimeout(() => {
    log("CROSSBAR: watchdog stop");
    loop.stop();
  }, CROSSBAR_MAX_MS);

  try {
    return await fn();
  } finally {
    clearTimeout(watchdog);
    loop.stop();
  }
}

// =====================================================
// 🔊 TTS (keeps out.wav for debug; Speaker path awaited)
// =====================================================
async function speak(text) {
  log("TTS: generating");

  const speech = await withCrossbarCover(async () => {
    return await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: text,
      format: "wav"
    });
  });

  const wav = Buffer.from(await speech.arrayBuffer());

  // keep file (optional), but we DO NOT rely on it
  try {
    fs.writeFileSync("out.wav", wav);
  } catch {}

  if (!USE_SPEAKER_FOR_TTS) {
    log("TTS: playing via afplay");
    return new Promise((res) => exec("afplay out.wav", res));
  }

  log("TTS: playing via Speaker (awaiting completion)");
  try {
    const parsed = parseWav(wav);
    let pcm = downmixToMono16LE(parsed.pcm, parsed.numChannels);
    pcm = resampleMono16LE(pcm, parsed.sampleRate, 24000);
    await playPcmMono16LE(pcm, 24000);
  } catch (e) {
    log("TTS: speaker failed → afplay fallback:", e.message);
    await new Promise((res) => exec("afplay out.wav", res));
  }
}

// =====================================================
// 😂 Dial-a-Joke (unchanged behavior; improved prompt)
// =====================================================
async function dialAJoke() {
  log("DIAL-A-JOKE: connecting");
  await speak("Connecting you to Dial-a-Joke.");

  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "You are a stand-up comedian on a classic Dial-a-Joke service. " +
          "Tell ONE short, clean joke. Make it different each time. " +
          "Classic 1970s stand-up vibe, but do not imitate any specific person. " +
          "Do not explain. End after the joke."
      }
    ]
  });

  const joke = (response.output_text || "").trim();
  log("JOKE TEXT:", joke);

  await speak(joke || "Sorry, the joke line is busy. Please try again.");

  log("CALL: joke finished → hang up");
  process.exit(0);
}

// =====================================================
// 🎙 MIC recordOnce (unchanged)
// =====================================================
function recordOnce() {
  return new Promise((resolve) => {
    const micInstance = mic({
      rate: "16000",
      channels: "1",
      debug: false,
      exitOnSilence: 10,
      fileType: "wav"
    });

    const stream = micInstance.getAudioStream();
    const out = fs.createWriteStream("input.wav");
    stream.pipe(out);

    stream.on("error", (err) => {
      log("MIC ERROR:", err);
      try {
        micInstance.stop();
      } catch {}
      resolve();
    });

    stream.on("silence", () => micInstance.stop());
    stream.on("stopComplete", () => resolve());

    micInstance.start();
  });
}

// =====================================================
// 🛰 Realtime operator reply (NOW SESSION-AWARE)
// =====================================================
function wavToPcm16LE(wavBytes) {
  const parsed = parseWav(wavBytes);
  const mono = downmixToMono16LE(parsed.pcm, parsed.numChannels);
  return resampleMono16LE(mono, parsed.sampleRate, 16000);
}

function buildOperatorInstructions(heardRaw) {
  const ctx = buildOperatorContextText();
  const heard = (heardRaw || "").trim();

  return (
    "You are a 1970 telephone operator at a local exchange.\n" +
    "Behavior rules:\n" +
    "- Be responsive, practical, and a little brisk, like a real operator.\n" +
    "- Ask one short clarifying question when needed.\n" +
    "- Prefer directing calls: 'Dial-a-Joke', 'Time', 'Weather', 'Directory assistance'.\n" +
    "- If the caller says something vague, ask what number/service they want.\n" +
    "- Keep replies to 1–2 sentences.\n" +
    "- English only.\n\n" +
    `Call session id: ${call.id}\n` +
    `Turn number (next): ${call.turn + 1}\n\n` +
    "Conversation so far:\n" +
    ctx +
    "\n\n" +
    "Caller just said:\n" +
    heard +
    "\n\n" +
    "Now respond as the operator (no narration, no stage directions)."
  );
}

async function realtimeOperatorReplyFromWav(wavPath, heardRaw) {
  const model = "gpt-4o-realtime-preview";
  const voice = "alloy";

  const instructions = buildOperatorInstructions(heardRaw);

  const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
  const wavBytes = fs.readFileSync(wavPath);
  const pcm = wavToPcm16LE(wavBytes);

  log("REALTIME: connect");

  const ws = new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1"
    }
  });

  const speaker = new Speaker({
    channels: 1,
    bitDepth: 16,
    sampleRate: 24000
  });

  const CHUNK = 3200; // ~100ms at 16kHz * 2 bytes
  let transcript = "";

  function send(obj) {
    ws.send(JSON.stringify(obj));
  }

  return await withCrossbarCover(() => {
    return new Promise((resolve, reject) => {
      ws.on("open", () => {
        send({
          type: "session.update",
          session: {
            modalities: ["audio", "text"],
            instructions,
            voice,
            input_audio_format: "pcm16",
            output_audio_format: "pcm16",
            turn_detection: null
          }
        });

        for (let i = 0; i < pcm.length; i += CHUNK) {
          send({
            type: "input_audio_buffer.append",
            audio: pcm.slice(i, i + CHUNK).toString("base64")
          });
        }

        send({ type: "input_audio_buffer.commit" });
        send({ type: "response.create", response: { modalities: ["audio", "text"] } });
      });

      ws.on("message", (raw) => {
        let evt;
        try {
          evt = JSON.parse(raw.toString());
        } catch {
          return;
        }

        if (evt.type === "response.output_audio.delta" && evt.delta) {
          speaker.write(Buffer.from(evt.delta, "base64"));
        }

        if (evt.type === "response.output_audio_transcript.delta" && evt.delta) {
          transcript += evt.delta;
        }

        if (evt.type === "response.done") {
          speaker.end();
          try {
            ws.close();
          } catch {}
          resolve({ transcript: transcript.trim() });
        }

        if (evt.type === "error") {
          reject(new Error(evt.error?.message || "Realtime error"));
        }
      });

      ws.on("error", reject);
    });
  });
}

// =====================================================
// ☎️ MAIN LOOP (session-aware greeting)
// =====================================================
async function run() {
  log("CALL: session id:", call.id);

  log("REC: recordings dir:", RECORDINGS_DIR);
  for (const k of Object.keys(RECORDINGS)) {
    const p = resolveRecording(RECORDINGS[k]);
    log("REC:", k, "->", p ? "OK" : "MISSING", p || RECORDINGS[k]);
  }

  while (true) {
    // Greet once per call session (NEW)
    if (!call.greeted) {
      log("OPERATOR: greeting (session start)");
      await speak("Operator, how may I direct your call?");
      call.greeted = true;
    }

    log("MIC: listening");
    await recordOnce();

    log("STT: routing transcription");
    const t = await openai.audio.transcriptions.create({
      file: fs.createReadStream("input.wav"),
      model: "gpt-4o-transcribe"
    });

    const heardRaw = (t.text || "").trim();
    const heard = heardRaw.toLowerCase();
    log("HEARD:", heard);

    if (!heard) {
      // stay on the line; do not re-greet
      continue;
    }

    // ---- Hang up phrases
    if (heard.includes("hang up") || heard.includes("goodbye") || heard === "bye") {
      await speak("Thank you for calling.");
      process.exit(0);
    }

    // ---- ROUTING
    if (heard.includes("joke")) {
      await dialAJoke();
      return;
    }

    // quick test commands for your recordings
    if (heard.includes("call again later")) {
      await playRecordingOnce("error_call_again_later");
      continue;
    }
    if (heard.includes("you have reached")) {
      await playRecordingOnce("error_youhavereached");
      continue;
    }

    // ---- OPERATOR (Realtime, session-aware)
    log("OPERATOR (REALTIME): replying");
    try {
      const { transcript } = await realtimeOperatorReplyFromWav("input.wav", heardRaw);
      log("OPERATOR SAID:", transcript);
      addTurn(heardRaw, transcript);
    } catch (e) {
      log("REALTIME ERROR → fallback:", e.message);

      const r = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content:
              "You are a 1970 telephone operator. Be responsive and practical. " +
              "Keep replies to 1–2 sentences. English only."
          },
          // include session context in fallback too
          { role: "user", content: `Conversation so far:\n${buildOperatorContextText()}\n\nCaller: ${heardRaw}` }
        ]
      });

      const reply = (r.output_text || "").trim();
      await speak(reply);
      addTurn(heardRaw, reply);
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
