// services.js — declarative service model ONLY
// No logic. No side effects.


const VOICES = {
  weather:   "marin",
  time:      "verse",
  horoscope: "nova",
  science:   "ash",
  story:     "fable",
  joke:      "ballad",
  complaints:"ballad",
  prayer:    "shimmer"
};

module.exports = {
SCIENCE: {
  type: "loop",
  voice: "ash",
  opener: "science",
  onTurn: "science"
},

COMPLAINTS: {
  type: "loop",
  voice: "ballad",
  opener: "Complaints department. What seems to be the problem?",
  onTurn: "complaints"
},

DIRECTORY: {
  type: "loop",
  voice: "operator",
  opener: "Directory assistance. Whom would you like to reach?",
  onTurn: "directory"
},
  TIME: {
    type: "oneshot",
    voice: VOICES.time,
    handler: "handleTime"
  },

  WEATHER: {
    type: "oneshot",
    voice: VOICES.weather,
    handler: "handleWeather"
  },

  JOKE: {
    type: "oneshot",
    voice: VOICES.joke,
    handler: "handleJoke"
  },

  PRAYER: {
    type: "oneshot",
    voice: VOICES.prayer,
    handler: "handlePrayer"
  },

  HOROSCOPE: {
    type: "oneshot",
    voice: VOICES.horoscope,
    handler: "handleHoroscope"
  },

STORY: {
  type: "loop",
  voice: VOICES.story,
  onTurn: "story"
},

  OPERATOR: {
    type: "loop",
    voice: "operator",
    opener: "Operator. How may I help you?"
  },

  SCIENCE: {
    type: "loop",
    voice: VOICES.science,
    opener: "science" // symbolic — opener is dynamic
  },

  COMPLAINTS: {
    type: "loop",
    voice: VOICES.complaints,
    opener: "Complaints department. What seems to be the problem?"
  },

  DIRECTORY: {
    type: "loop",
    voice: "operator",
    opener: "Directory assistance. Whom would you like to reach?"
  }
};
