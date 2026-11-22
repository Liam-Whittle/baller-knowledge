/*
  BALLER KNOWLEDGE — tiers, categories, and the helper the question files use.
  The questions themselves live in js/questions/*.js.

  Question format (one array per question):

    ["Name something red in nature",
      "Rose, Apple, Ladybug/Ladybird",     // common
      "Lava, Poppy",                       // uncommon
      "Flamingo",                          // rare
      "Scarlet macaw/Macaw",               // elite baller
      "Rafflesia"],                        // omniscient

  - Answers are separated by commas, so an answer itself can't contain a comma.
  - "/" separates aliases; the first one is what's shown on screen.
  - Matching ignores case, accents, punctuation, a leading "the", plurals and
    small typos, so you don't need to list those variations.
*/

const TIERS = [
  { id: "common",     name: "Common",       points: 10,  color: "#a9a3bd" },
  { id: "uncommon",   name: "Uncommon",     points: 25,  color: "#3ecf6e" },
  { id: "rare",       name: "Rare",         points: 50,  color: "#3b9dff" },
  { id: "elite",      name: "Elite Baller", points: 100, color: "#b45cff" },
  { id: "omniscient", name: "Omniscient",   points: 200, color: "#ffc42e" },
];

const CATEGORIES = [
  { id: "nature",    name: "Nature",         emoji: "🌿", questions: [] },
  { id: "food",      name: "Food & Drink",   emoji: "🍔", questions: [] },
  { id: "everyday",  name: "Everyday Stuff", emoji: "🏠", questions: [] },
  { id: "geography", name: "Geography",      emoji: "🌍", questions: [] },
];

function addQuestions(categoryId, list) {
  const cat = CATEGORIES.find((c) => c.id === categoryId);
  if (!cat) throw new Error(`Unknown category "${categoryId}"`);
  for (const [prompt, ...tiers] of list) {
    const answers = {};
    TIERS.forEach((t, i) => {
      answers[t.id] = String(tiers[i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    });
    cat.questions.push({ prompt, answers });
  }
}
