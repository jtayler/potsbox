// Light polish only — keep it analog-feeling
document.addEventListener("DOMContentLoaded", () => {
  console.log("POTS Box online. Dial tone ready.");
});


const sounds = [
  "attearth.wav",
  "attflood.wav",
  "atthur.wav",
  "attlct.wav",
  "attngt.wav",
  "attnoans.wav",
  "attnvc.wav",
  "atttor.wav",
  "attemerg.wav",
  "attsw.wav"
];

let currentAudio = null;

const hoverClick = new Audio("./sounds/phone-pick-up-1.wav");
hoverClick.volume = 0.4;

function playHoverClick() {
  hoverClick.currentTime = 0;
  hoverClick.play().catch(() => {});
}

function playRandomSound() {
  const btn = document.getElementById("emergencyBtn");

  // If something is already playing → STOP
  if (currentAudio && !currentAudio.paused) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    btn.classList.remove("btn-playing");
    return;
  }

  // Start a new random sound
  const file = sounds[Math.floor(Math.random() * sounds.length)];
  currentAudio = new Audio(`./sounds/${file}`);

  btn.classList.add("btn-playing");

  currentAudio.onended = () => {
    btn.classList.remove("btn-playing");
    currentAudio = null;
  };

  currentAudio.play().catch(() => {});
}


