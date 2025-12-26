const fs = require("fs");
const { spawn, exec } = require("child_process");
const OpenAI = require("openai");

const CROSSBAR_FILE = "recordings/crossbar_connect_sound.wav"; // Path to your crossbar sound file
const VOICES = { operator: "alloy" }; // Set your voice here

let audioQueue = Promise.resolve();  // Queue to manage audio playback sequentially

// Function to enqueue audio tasks to ensure they are played sequentially
function enqueueAudio(fn) {
  audioQueue = audioQueue.then(fn).catch(() => {});  // Ensure previous audio finishes before next starts
  return audioQueue;
}

// Function to play crossbar sound (for latency masking)
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

// Function to handle text-to-speech (TTS) and play audio using afplay
async function speak(text, openai, voice = VOICES.operator) {
  const s = (text || "").trim();
  if (!s) return;

  console.log("TTS:", s);

  return enqueueAudio(async () => {
    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice,  // Specify the voice for TTS
      input: s,
      format: "wav"
    });

    fs.writeFileSync("out.wav", Buffer.from(await speech.arrayBuffer()));
    await new Promise(r => exec("afplay out.wav", r)); // Play the TTS output audio
  });
}

module.exports = {
  startCrossbar,
  speak,
  enqueueAudio
};
