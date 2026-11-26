/*
  CHARACTERS MODE — categories, the helper the character lists use, guess
  matching and pictures. The characters themselves live in js/characters/*.js.

  Character format (one string per character):

    "Dr. Eggman/Eggman/Robotnik @Doctor Eggman"

  - "/" separates names a guess may use; the first one is what's shown on screen.
  - The part after " @" says where the picture comes from:
      " @Page title"              an English Wikipedia page's main picture (leave it out when the
                                  page has the same title as the first name)
      " @fandom:wiki/Page title"  a Fandom wiki page's main picture, e.g. @fandom:rickandmorty/Morty Smith
                                  for rickandmorty.fandom.com (for characters Wikipedia has no picture of)
      " @file:File name.jpg"      one specific picture on Wikipedia, when the page's main one is wrong
      " @-"                       no picture: the category's emoji shows instead
  - Guesses forgive capitals, accents, punctuation, a leading "the" and small typos,
    so only list genuinely different names (nicknames, real names, surnames).
*/

const CHAR_CATEGORIES = [
  { id: "games",    name: "Video Games",        emoji: "🎮", list: [] },
  { id: "tv",       name: "TV Series",          emoji: "📺", list: [] },
  { id: "movies",   name: "Movies",             emoji: "🎬", list: [] },
  { id: "celebs",   name: "Celebrities",        emoji: "⭐", list: [] },
  { id: "anime",    name: "Anime",              emoji: "🍥", list: [] },
  { id: "myth",     name: "Mythology",          emoji: "🏛️", list: [] },
  { id: "history",  name: "Historical Figures", emoji: "📜", list: [] },
  { id: "internet", name: "Internet",           emoji: "🌐", list: [], desc: "YouTubers, creepypastas, memes" },
];

function addCharacters(categoryId, list) {
  const cat = CHAR_CATEGORIES.find((c) => c.id === categoryId);
  if (!cat) throw new Error(`Unknown character category "${categoryId}"`);
  for (const raw of list) {
    const [names, wiki] = raw.split(" @");
    const aliases = names.split("/").map((s) => s.trim()).filter(Boolean);
    if (!aliases.length) continue;
    const page = (wiki || aliases[0]).trim();
    cat.list.push({ name: aliases[0], aliases, wiki: page === "-" ? null : page });
  }
}

const Chars = (() => {
  const cat = (id) => CHAR_CATEGORIES.find((c) => c.id === id) || null;
  // A character reference is { catId, i } so it can travel between players.
  const of = (ref) => { const c = ref && cat(ref.catId); return c ? c.list[ref.i] || null : null; };

  // Reuses the answer matcher: each character is a one-answer "question" made of its names.
  const asQ = new Map();
  function question(ch) {
    if (!asQ.has(ch)) asQ.set(ch, { prompt: ch.name, answers: { common: [ch.aliases.join("/")] } });
    return asQ.get(ch);
  }
  const matches = (ch, text) => !!(ch && Match.find(question(ch), text));
  // True if two characters could be confused by a guess (e.g. Thor the god and Thor from Marvel).
  const clash = (a, b) => a.aliases.some((n) => matches(b, n)) || b.aliases.some((n) => matches(a, n));

  // Pictures come from Wikipedia (or a Fandom wiki), fetched once per character and cached.
  // Only the page or file title is sent, nothing about the player.
  function lookup(src, size) {
    const q = "action=query&format=json&origin=*&redirects=1";
    if (src.startsWith("fandom:")) {
      const [wiki, ...title] = src.slice(7).split("/");
      return { url: `https://${wiki}.fandom.com/api.php?${q}&prop=pageimages&piprop=thumbnail&pithumbsize=${size}&titles=${encodeURIComponent(title.join("/"))}`,
        pick: (page) => page.thumbnail && page.thumbnail.source };
    }
    if (src.startsWith("file:")) {
      return { url: `https://en.wikipedia.org/w/api.php?${q}&prop=imageinfo&iiprop=url&iiurlwidth=${size}&titles=${encodeURIComponent("File:" + src.slice(5))}`,
        pick: (page) => page.imageinfo && page.imageinfo[0] && (page.imageinfo[0].thumburl || page.imageinfo[0].url) };
    }
    return { url: `https://en.wikipedia.org/w/api.php?${q}&prop=pageimages&piprop=thumbnail&pithumbsize=${size}&pilicense=any&titles=${encodeURIComponent(src)}`,
      pick: (page) => page.thumbnail && page.thumbnail.source };
  }
  // A few requests at a time: the wikis throttle bursts (the results screen can ask for many at once).
  const MAX_AT_ONCE = 4;
  let active = 0;
  const waiting = [];
  function limited(job) {
    return new Promise((resolve, reject) => {
      const run = () => { active++; job().then(resolve, reject).finally(() => { active--; if (waiting.length) waiting.shift()(); }); };
      active < MAX_AT_ONCE ? run() : waiting.push(run);
    });
  }

  const pics = new Map();
  const known = new Map(); // pictures already fetched, so redraws show them at once without a flicker
  // `size` is the width in pixels: 320 for the cards, bigger for the close-up view.
  function picture(wiki, size = 320) {
    if (!wiki) return Promise.resolve(null);
    const k = `${wiki}|${size}`;
    if (!pics.has(k)) {
      const { url, pick } = lookup(wiki, size);
      pics.set(k, limited(() => fetch(url))
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then((d) => {
          if (!d || !d.query) throw new Error("No answer");
          const page = d.query.pages && Object.values(d.query.pages)[0];
          const src = (page && pick(page)) || null;
          if (size === 320) known.set(wiki, src);
          return src;
        })
        // A failed or throttled request isn't remembered, so the next draw tries again.
        .catch(() => { pics.delete(k); return null; }));
    }
    return pics.get(k);
  }

  function addImg(el, src, fade) {
    const img = new Image();
    img.alt = "";
    img.draggable = false;
    img.referrerPolicy = "no-referrer";
    if (!fade) img.className = "instant";
    img.onload = () => {
      el.classList.add("has-pic");
      // Pictures open bigger when clicked (see openPicture in game.js).
      el.tabIndex = 0;
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", `See ${el.dataset.name || "this picture"} bigger`);
    };
    // If the image server is briefly busy, try once more a moment later before giving up on it.
    let retried = false;
    img.onerror = () => {
      if (retried || !el.isConnected) return img.remove();
      retried = true;
      setTimeout(() => { if (el.isConnected) img.src = src + (src.includes("?") ? "&" : "?") + "retry=1"; }, 2500);
    };
    img.src = src;
    el.appendChild(img);
  }

  // Fills in every <span data-wiki> placeholder under `root` with its picture.
  function hydrate(root = document) {
    root.querySelectorAll("[data-wiki]:not([data-done])").forEach((el) => {
      el.dataset.done = "1";
      const wiki = el.dataset.wiki;
      if (known.has(wiki)) { if (known.get(wiki)) addImg(el, known.get(wiki), false); return; }
      picture(wiki).then((src) => { if (src && el.isConnected) addImg(el, src, true); });
    });
  }

  return { cat, of, matches, clash, picture, hydrate };
})();
