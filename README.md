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
  - 🦝 **Steal:** when time's up, you copy a random rival's top answer. They keep it, and the copy doesn't count as
    a shared answer, so nobody is halved for it. If nobody has an answer, you keep the Steal.

These numbers are constants at the top of [`js/game.js`](js/game.js).

## Characters mode

Flip the switch on the home screen from **Classic** to **Characters** (the whole page sweeps over to a blue theme).
Whoever creates the lobby picks the mode, and everyone who joins gets it too.

- Everyone is dealt a secret character (with a picture) that only they can see.
- The box under the prompt switches between **Ask** and **Guess**. In Ask, you pick a player and send them a
  question; they get Yes and No buttons. Questions are open to everyone, so no call is needed (but asking out
  loud works too). Each player can have 3 unanswered questions waiting, and questions to someone who rerolls or
  gets found are marked Skipped.
- In Guess, a right guess reveals that player's character to everyone.
- The history under the prompt shows every question with its answer, plus every guess and reroll.
- **Reroll** swaps your character for a new one, twice per round, until someone finds it.
- A round ends when every character is found, when the timer runs out (3–15 minutes, or switch it off), or when
  the host presses **End round**.
- No points: at the end, **Top detective** (most characters found) and **Hardest to crack** (most rounds nobody
  guessed you) get crowned.

There are 8 categories, about 900 characters in [`js/characters/`](js/characters): Video Games, TV Series, Movies,
Celebrities, Anime, Mythology, Historical Figures and Internet. Each character is one line:

```js
"Dr. Eggman/Eggman/Robotnik @Doctor Eggman",   // names a guess may use, then the Wikipedia page for the picture
```

Pictures load from Wikipedia in each player's browser, or from a Fandom fan wiki for characters Wikipedia has no
picture of (only the page title is sent). The few with no usable picture anywhere show their category's emoji. The format is explained at the top of [`js/chars.js`](js/chars.js).

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

There are 7 categories: Nature, Food & Drink, Everyday Stuff and Geography with 100 questions each, Science & Tech and
Language with 50 each, plus "You can't be serious?" (50 silly, rude prompts), about 90,000 answers in total.
Categories with `extra: true` in `js/data.js` sit behind the lobby's **More categories** button and start switched off.
Questions live in [`js/questions/`](js/questions), 25 per file. Each question is one
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

Classic plays `assets/music-menu.mp3` on the home screen and lobby, and alternates `music-1.mp3` and `music-2.mp3`
in game. Characters mode has its own home/lobby track, `music-chars-menu.mp3`, and uses the same in-game tracks. Switching screens or modes
crossfades between them. Each player can turn it on or off and set the volume with the
sound button in the bottom-right corner, and their choice is saved in their own browser. Browsers block
audio until you interact with the page, so it starts on your first tap or keypress.
