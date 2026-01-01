// services.js — declarative service model ONLY
// No logic. No side effects.

const VOICES = {
  deepAndExpressive: "ballad",   // Corresponds to "Deep and expressive"
  warmAndFriendly: "ash",        // Corresponds to "Warm and friendly"
  lightAndWhimsical: "coral",    // Corresponds to "Light and whimsical"
  crispAndClean: "echo",         // Corresponds to "Crisp and clean"
  storyteller: "fable",          // Corresponds to "Storyteller, soft and inviting"
  boldAndClear: "nova",          // Corresponds to "Bold and clear"
  strongAndSteady: "onyx",       // Corresponds to "Strong and steady"
  calmAndWise: "sage",           // Corresponds to "Calm and wise"
  softAndDelicate: "shimmer",    // Corresponds to "Soft and delicate"
  poeticAndRhythmic: "verse",    // Corresponds to "Poetic, rhythmic"
  brightAndFresh: "marin",       // Corresponds to "Bright and fresh"
  deepAndEarthy: "cedar"         // Corresponds to "Deep and earthy"
};

// Services structure (single source of truth)
const SERVICES = {
  SCIENCE: {
    ext: "7243",
    voice: VOICES.calmAndWise,
    onTurn: "answerScience"
  },

  COMPLAINTS: {
    ext: "2333",
    voice: VOICES.deepAndExpressive,
    onTurn: "answerComplaintDepartment"
  },

  TIME: {
    ext: "8463",
    voice: VOICES.poeticAndRhythmic,
    handler: "handleTime"
  },

  WEATHER: {
    ext: "9328",
    voice: VOICES.brightAndFresh,
    handler: "handleWeather"
  },

  JOKE: {
    ext: "9857",
    voice: VOICES.lightAndWhimsical,
    handler: "handleJoke"
  },

  PRAYER: {
    ext: "4637",
    voice: VOICES.softAndDelicate,
    handler: "handlePrayer"
  },

  HOROSCOPE: {
    ext: "4676",
    voice: VOICES.deepAndExpressive,
    handler: "handleHoroscope"
  },

  STORY: {
    ext: "7867",
    voice: VOICES.storyteller,
    onTurn: "answerStory"
  },

  OPERATOR: {
    ext: "0",
    voice: VOICES.warmAndFriendly,
    onTurn: "operatorChat",
    opener: "Operator. How may I help you?"
  },

  DIRECTORY: {
    ext: "411",
    voice: VOICES.deepAndEarthy,
    onTurn: "directoryResponse",
    opener: "Directory assistance. Whom would you like to reach?"
  }
};

module.exports = SERVICES;
