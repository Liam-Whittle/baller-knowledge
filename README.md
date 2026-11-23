# 👑 Baller Knowledge

**Play:** https://liam-whittle.github.io/baller-knowledge/

A multiplayer party game: everyone gets the same prompt ("Name something red in nature"),
types as many valid answers as they can before the timer runs out, and **only each player's
rarest answer scores**.

| Tier | Points |
|---|---|
| Common | 10 |
| Uncommon | 25 |
| Rare | 50 |
| Elite Baller | 100 |
| Omniscient | 200 |

Each prompt shows one Common answer as a hint. On top of that:

- **Shared answers:** if two or more players score with the same answer, each gets half.
- **Comeback:** if you're behind the leader, a Rare-or-better answer earns up to +30% extra. The further behind
  you are, the bigger the boost.
- **Bonus rounds:** every 5th round (never the last) is multiple choice. You pick one of 6 answers of mixed
  rarity, and that pick is your score.
- **Final round:** your scoring answer is worth ×1.5.
- **Power-ups** (switch on "Add power-ups" in the lobby): everyone gets three one-time power-ups per game,
  not usable in bonus rounds.
  - ⏱️ **+7 seconds:** extra time just for you. Anyone whose time has run out sees "Waiting for player turns…".
  - 🎁 **Free Rare:** adds a random Rare answer to your list.
  - 🦝 **Steal:** when time's up, you take a random rival's top answer. If nobody has an answer, you keep the Steal.

These numbers are constants at the top of [`js/game.js`](js/game.js).

## How it runs

It's a pure static site, with no server. The host's browser runs the game, and players connect to it
directly with WebRTC via [PeerJS](https://peerjs.com/). PeerJS's free public broker only introduces
the browsers to each other.

- If the host closes their tab, the game ends for everyone.
- If a player refreshes and rejoins with the **same name**, they get their seat and score back.
- A few strict networks (some school/office Wi-Fi) block peer-to-peer connections. Phones on mobile
  data and normal home Wi-Fi are fine.

## Play locally

```
python -m http.server 8080
```
Open http://localhost:8080 and use a second tab or device to join.

## Put it on GitHub Pages

1. Create a GitHub repo and push these files (with `index.html` at the root).
2. Go to the repo's **Settings → Pages**, set **Source: Deploy from a branch**, pick `main` and `/ (root)`.
3. After a minute it's live at `https://<your-username>.github.io/<repo-name>/`.
   Create a lobby there and send friends the invite link.

## Adding categories and questions

There are 6 categories: Nature, Food & Drink, Everyday Stuff and Geography with 100 questions each, plus Science & Tech and Language with 50 each, about
88,000 answers in total. Questions live in [`js/questions/`](js/questions), 25 per file. Each question is one
array: the prompt, then one comma-separated string per tier:

```js
["Name something red in nature",
  "Rose, Apple, Ladybug/Ladybird",     // common      ("/" = aliases, the first one is shown)
  "Lava, Poppy",                       // uncommon
  "Flamingo",                          // rare
  "Scarlet macaw/Macaw",               // elite baller
  "Rafflesia"],                        // omniscient
```

To add a new file, add a `<script>` line for it in `index.html`. To add a new category, add it to the
`CATEGORIES` list in [`js/data.js`](js/data.js), where the tier names, points and colours also live.

Matching ignores capitals, accents, punctuation, a leading "the", and plurals, and forgives small typos,
so you don't need to list those. If an answer appears twice in one question, the browser console warns you.
How much someone must type before autofill suggests an answer is `AUTOFILL_MIN_SHARE` in
[`js/match.js`](js/match.js).

## Music

The background track is `assets/music.mp3`. Each player can turn it on or off and set the volume with the
sound button in the bottom-right corner, and their choice is saved in their own browser. Browsers block
audio until you interact with the page, so it starts on your first tap or keypress.
