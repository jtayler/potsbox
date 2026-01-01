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

// Services structure linking the descriptions directly
const SERVICES = {
  SCIENCE: {
    voice: VOICES.calmandWise,   
    onTurn: "answerScience"      
  },

  COMPLAINTS: {
    voice: VOICES.deepAndExpressive,  
    onTurn: "complaints"             
  },

  TIME: {
    voice: VOICES.poeticAndRhythmic, 
    handler: "handleTime"           
  },

  WEATHER: {
    voice: VOICES.brightAndFresh,    
    handler: "handleWeather"         
  },

  JOKE: {
    voice: VOICES.lightAndWhimsical, 
    handler: "handleJoke"            
  },

  PRAYER: {
    voice: VOICES.softAndDelicate,   
    handler: "handlePrayer"          
  },

  HOROSCOPE: {
    voice: VOICES.deepAndExpressive, 
    handler: "handleHoroscope"       
  },

  STORY: {
    voice: VOICES.storyteller,       
    handler: "handleStory",          
    onTurn: "story"                  
  },

  OPERATOR: {
    voice: VOICES.warmAndFriendly,   
    handler: "handleOperator",       
    opener: "Operator. How may I help you?"
  },

  DIRECTORY: {
    voice: VOICES.deepAndEarthy,     
    onTurn: "directoryResponse", // Function to handle initial service
    opener: "Directory assistance. Whom would you like to reach?" // Initial greeting
  }
};

module.exports = SERVICES;
