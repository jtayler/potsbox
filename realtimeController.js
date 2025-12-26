// realtimeController.js
// Legacy Realtime API — pinned model, manual turns, model speaks first

const WebSocket = require("ws");
const mic = require("mic");
const Speaker = require("speaker");

// 🔒 PINNED MODEL (this matters)
const MODEL = "gpt-4o-realtime-preview-2024-12-17";
const URL = `wss://api.openai.com/v1/realtime?model=${MODEL}`;

// End-of-utterance timing (tweak if you want snappier/slower)
const END_OF_UTTERANCE_MS = 650;

let sessionConfigured = false;
let greeted = false;


function startCall({ apiKey, log = () => {} } = {}) {
  if (!apiKey) throw new Error("apiKey required");
let sessionConfigured = false;
let greeted = false;

  let wsOpen = false;
  let sessionReady = false;

  let sentAudioSinceCommit = false;
  let commitTimer = null;

  let responseInFlight = false; // prevents stacking response.create

  const ws = new WebSocket(URL, "realtime", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  const speaker = new Speaker({
    channels: 1,
    bitDepth: 16,
    sampleRate: 24000,
  });

  function safeSend(obj) {
    if (!wsOpen) return;
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(obj));
  }

  function clearCommitTimer() {
    if (commitTimer) {
      clearTimeout(commitTimer);
      commitTimer = null;
    }
  }

  function scheduleCommit() {
    clearCommitTimer();
    commitTimer = setTimeout(() => {
      if (!sessionReady) return;
      if (!sentAudioSinceCommit) return;
      if (responseInFlight) {
        // If the model is still talking, just wait; we’ll commit after next chunk gap
        scheduleCommit();
        return;
      }

      safeSend({ type: "input_audio_buffer.commit" });

      // Always include a response object (some builds are picky)
      safeSend({
        type: "response.create",
        response: { modalities: ["audio", "text"] },
      });

      responseInFlight = true;
      sentAudioSinceCommit = false;
    }, END_OF_UTTERANCE_MS);
  }


  ws.on("open", () => {
    wsOpen = true;
    log("WS OPEN", URL);
  });

  ws.on("error", (e) => log("WS ERROR", e?.message || e));
  ws.on("close", (c) => log("WS CLOSE", c));

  ws.on("message", (msg) => {
  let event;
  try { event = JSON.parse(msg.toString()); } catch { return; }

  if (event.type === "error") {
    log("REALTIME ERROR", event.error);
    return;
  }

  if (event.type === "session.created") {
    log("SESSION CREATED");

    safeSend({
      type: "session.update",
      session: {
        modalities: ["audio", "text"],
        voice: "alloy",
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        turn_detection: null,
      },
    });
    return;
  }

  if (event.type === "session.updated" && !sessionConfigured) {
    log("SESSION READY");
    sessionConfigured = true;
    sessionReady = true;

    // 🔑 OPERATOR SPEAKS ONLY NOW
    safeSend({
      type: "response.create",
      response: {
        modalities: ["audio", "text"],
        instructions: "Operator. How may I help you?",
      },
    });
    greeted = true;
    return;
  }

  if (event.type === "response.output_audio.delta" && event.delta) {
    speaker.write(Buffer.from(event.delta, "base64"));
    return;
  }
});


  // ---- mic ----
  const micInstance = mic({
    rate: "24000",
    channels: "1",
    bitwidth: "16",
    encoding: "signed-integer",
    endian: "little",
    fileType: "raw",
    exitOnSilence: 0, // DO NOT rely on mic "silence" events
  });

  const micStream = micInstance.getAudioStream();

  micStream.on("data", (chunk) => {
    if (!sessionReady) return;

    safeSend({
      type: "input_audio_buffer.append",
      audio: chunk.toString("base64"),
    });

    sentAudioSinceCommit = true;
    scheduleCommit();
  });

  micStream.on("error", (e) => log("MIC ERROR", e?.message || e));

  log("MIC START");
  micInstance.start();

  function stopCall() {
    clearCommitTimer();
    try { micInstance.stop(); } catch {}
    try { speaker.end(); } catch {}
    try { ws.close(); } catch {}
  }

  return { stopCall };
}

module.exports = { startCall };
