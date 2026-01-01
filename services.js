// services.js — declarative service model ONLY
// No logic. No side effects.


const VOICE_NAMES = [
  "alloy",    // Neutral, clear, modern
  "ash",      // Warm and friendly
  "ballad",   // Deep and expressive
  "coral",    // Light and whimsical
  "echo",     // Crisp and clean
  "fable",    // Storyteller, soft and inviting
  "nova",     // Bold and clear
  "onyx",     // Strong and steady
  "sage",     // Calm and wise
  "shimmer",  // Soft and delicate
  "verse",    // Poetic, rhythmic
  "marin",    // Bright and fresh
  "cedar"     // Deep and earthy
];

const VOICES = {
  operator:   { voice: "ash",        description: "Warm and friendly" },
  directory:  { voice: "cedar",      description: "Deep and earthy" },
  weather:    { voice: "marin",      description: "Bright and fresh" },
  time:       { voice: "verse",      description: "Poetic, rhythmic" },
  horoscope:  { voice: "nova",       description: "Bold and clear" },
  science:    { voice: "sage",       description: "Calm and wise" },
  story:      { voice: "fable",      description: "Storyteller, soft and inviting" },
  joke:       { voice: "coral",      description: "Light and whimsical" },
  complaints: { voice: "ballad",     description: "Deep and expressive" },
  prayer:     { voice: "shimmer",    description: "Soft and delicate" }
};

module.exports = {
  SCIENCE: {
    voice: VOICES.science.voice, // Using the voice name
    onTurn: "answerScience" // Function to handle continued turns (loop service)
  },

  COMPLAINTS: {
    voice: VOICES.complaints.voice, // Using the voice name
    handler: "handleComplaintDepartment", // Function to handle initial service
    onTurn: "complaints" // Function to handle continued turns
  },

  TIME: {
    voice: VOICES.time.voice, // Using the voice name
    handler: "handleTime" // Function to handle service
  },

  WEATHER: {
    voice: VOICES.weather.voice, // Using the voice name
    handler: "handleWeather" // Function to handle service
  },

  JOKE: {
    voice: VOICES.joke.voice, // Using the voice name
    handler: "handleJoke" // Function to handle service
  },

  PRAYER: {
    voice: VOICES.prayer.voice, // Using the voice name
    handler: "handlePrayer" // Function to handle service
  },

  HOROSCOPE: {
    voice: VOICES.horoscope.voice, // Using the voice name
    handler: "handleHoroscope" // Function to handle service
  },

  STORY: {
    voice: VOICES.story.voice, // Using the voice name
    handler: "handleStory", // Function to handle initial service
    onTurn: "story" // Function to handle continued turns (loop service)
  },

  OPERATOR: {
    voice: VOICES.operator.voice, // Using the voice name
    onTurn: "handleOperator", // Function to handle initial service
    opener: "Operator. How may I help you?" // Initial greeting
  },

  DIRECTORY: {
    voice: VOICES.directory.voice, // Using the voice name
    onTurn: "directoryResponse", // Function to handle initial service
    opener: "Directory assistance. Whom would you like to reach?" // Initial greeting
  }
};
