/* Answer matching: normalisation, typo tolerance, and autofill suggestions. */

const Match = (() => {
  const TIER_INDEX = Object.fromEntries(TIERS.map((t, i) => [t.id, i]));

  function stemWord(w) {
    if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
    if (w.length > 4 && /(ches|shes|sses|xes|oes)$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is")) return w.slice(0, -1);
    return w;
  }

  // "The Strawberries!" -> "strawberry";  "Ping-Pong" -> "pingpong"
  function key(text) {
    let s = String(text)
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/['’`]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/^(the|a|an) /, "");
    return s.split(" ").filter(Boolean).map(stemWord).join("");
  }

  function levenshtein(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        cur.push(v);
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  function allowedTypos(len) {
    if (len <= 3) return 0;
    if (len <= 5) return 1;
    if (len <= 9) return 2;
    return 3;
  }

  const cache = new Map();

  // Build (and cache) the lookup index for one question.
  function index(question) {
    if (cache.has(question)) return cache.get(question);
    const entries = [];
    const byKey = new Map();
    for (const tier of TIERS) {
      for (const raw of question.answers[tier.id] || []) {
        const names = raw.split("/").map((n) => n.trim()).filter(Boolean);
        const entry = { display: names[0], tier: tier.id, keys: [] };
        for (const n of names) {
          const k = key(n);
          if (!k) continue;
          if (byKey.has(k)) {
            if (byKey.get(k) !== entry) console.warn(`[data] "${n}" appears twice in "${question.prompt}" — keeping the first one.`);
            continue;
          }
          byKey.set(k, entry);
          entry.keys.push(k);
        }
        if (entry.keys.length) entries.push(entry);
      }
    }
    const idx = { entries, byKey };
    cache.set(question, idx);
    return idx;
  }

  // Exact match only (after normalising case, accents, plurals, "the"...).
  function exact(question, text) {
    const k = key(text);
    return k ? index(question).byKey.get(k) || null : null;
  }

  // Exact match, or the closest answer within a small typo distance.
  function find(question, text) {
    const idx = index(question);
    const k = key(text);
    if (!k) return null;
    if (idx.byKey.has(k)) return idx.byKey.get(k);
    let best = null, bestDist = Infinity;
    for (const [ak, entry] of idx.byKey) {
      const max = allowedTypos(ak.length);
      if (!max) continue;
      const d = levenshtein(k, ak, max);
      if (d <= max && d < bestDist) { best = entry; bestDist = d; }
    }
    return best;
  }

  // A "Did you mean…?" for a partial word only counts once you've typed this share
  // of the answer, so mashing three letters can't fish out an Omniscient one.
  const AUTOFILL_MIN_SHARE = 0.5;

  // "Did you mean": a typo match, otherwise the shortest answer the input is the start of.
  function closest(question, text) {
    const k = key(text);
    if (!k) return null;
    const hit = find(question, text);
    if (hit || k.length < 3) return hit;
    let best = null, bestLen = Infinity;
    for (const [ak, entry] of index(question).byKey) {
      if (ak.startsWith(k) && k.length >= Math.ceil(ak.length * AUTOFILL_MIN_SHARE) && ak.length < bestLen) {
        best = entry; bestLen = ak.length;
      }
    }
    return best;
  }

  function tier(id) { return TIERS[TIER_INDEX[id]]; }
  function rank(id) { return TIER_INDEX[id]; }

  return { key, exact, find, closest, index, tier, rank };
})();
