// stable.js — audio + queue + crossbar + intercepts (STREAMING, NO out.wav)
const fs = require("fs");
const path = require("path");
const mic = require("mic");
const Speaker = require("speaker");
const { spawn, exec } = require("child_process");

const RECORDINGS_DIR = path.join(__dirname, "recordings");

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

// ---------------------------
// AudioQueue (one thing plays at a time)
// ---------------------------
class AudioQueue {
  constructor() {
    this._chain = Promise.resolve();
    this._pending = 0;
  }

  enqueue(fn) {
    this._pending++;
    const run = async () => {
      try {
        await fn();
      } finally {
        this._pending--;
      }
    };
    this._chain = this._chain.then(run, run);
    return this._chain;
  }

  async idle() {
    await this._chain;
  }

  get pending() {
    return this._pending;
  }
}

// ---------------------------
// WAV parsing (for streaming play via Speaker)
// ---------------------------
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
  return new Promise((resolve, reject) => {
    const sp = new Speaker({ channels: 1, bitDepth: 16, sampleRate: rate });
    sp.once("close", resolve);
    sp.once("error", reject);
    sp.end(pcm);
  });
}

// ---------------------------
// Crossbar (runs in parallel, killable, never awaited)
// ---------------------------
function startCrossbarLoop(file = "crossbar_connect_sound.wav") {
  const filePath = path.join(RECORDINGS_DIR, file);
  if (!fs.existsSync(filePath)) return () => {};

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

  return () => {
    stopped = true;
    if (child) {
      try { child.kill("SIGKILL"); } catch {}
    }
  };
}

// Run a function while crossbar is playing (mask latency)
async function withCrossbar(fn, { file = "crossbar_connect_sound.wav", maxMs = 9000 } = {}) {
  const stop = startCrossbarLoop(file);
  const watchdog = setTimeout(() => stop(), maxMs);
  try {
    return await fn();
  } finally {
    clearTimeout(watchdog);
    stop();
  }
}

// ---------------------------
// Streaming TTS (no out.wav, no afplay blocking)
// ---------------------------
async function speakStreaming(openai, text, { voice = "alloy" } = {}) {
  const s = (text ?? "").trim();
  if (!s) return;

  const speech = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice,
    input: s,
    format: "wav"
  });

  const wav = Buffer.from(await speech.arrayBuffer());
  fs.writeFileSync("tts.wav", wav);

  // 🔑 DO NOT AWAIT — fire and forget
  spawn("afplay", ["tts.wav"], { stdio: "ignore" });
}

// ---------------------------
// Play an intercept/recording (mp3/wav) via afplay (queued)
// ---------------------------
async function playRecording(filename) {
  const filePath = path.join(RECORDINGS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    log("RECORDING MISSING:", filename);
    return;
  }
  await new Promise((r) => exec(`afplay "${filePath}"`, r));
}

// ---------------------------
// Intercepts (stateful per call, no-repeat, cooldown)
// ---------------------------
const INTERCEPTS = {
  flood: ["attflood.mp3", "N4E-Due-To-The-Flood-076-230220.mp3"],
  earthquake: ["attearth.mp3", "N4E-Due-To-The-Earthquake-076-230220.mp3"],
  hurricane: ["atthur.mp3", "N4E-Due-To-The-Hurricane-076-230220.mp3"],
  all_circuits_busy: ["N4E-All-Circuits-Are-Busy-034-231226.mp3", "N4E-All-Circuits-Busy-At-Location-076-230220.mp3"],
  call_failed: ["N4E-Call-Cannot-Be-Completed-034-231226.mp3", "N4E-Call-Did-Not-Go-Through-034-231226.mp3"]
};

const TERMINAL_GROUPS = new Set(["all_circuits_busy", "call_failed"]);

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function createInterceptController({ probability = 0.1, cooldownMs = 15000 } = {}) {
  let lastAt = 0;
  let lastGroup = null;

  return async function maybeIntercept() {
    const now = Date.now();
    if (now - lastAt < cooldownMs) return { intercepted: false };

    if (Math.random() > probability) return { intercepted: false };

    const groups = Object.keys(INTERCEPTS).filter(g => g !== lastGroup);
    const group = pick(groups);
    const file = pick(INTERCEPTS[group]);
    const terminal = TERMINAL_GROUPS.has(group);

    lastAt = now;
    lastGroup = group;

    return { intercepted: true, group, file, terminal };
  };
}

// ---------------------------
// Mic record (only when queue is idle; index.js enforces that)
// ---------------------------
function recordOnce({ outFile = "input.wav", maxMs = 6000 } = {}) {
  return new Promise((resolve) => {
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

    const kill = setTimeout(() => {
      try { micInstance.stop(); } catch {}
    }, maxMs);

    out.on("close", () => {
      clearTimeout(kill);
      resolve();
    });

    micInstance.start();
  });
}

module.exports = {
  AudioQueue,
  withCrossbar,
  speakStreaming,
  playRecording,
  createInterceptController,
  recordOnce
};
