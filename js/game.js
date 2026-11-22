/* Baller Knowledge — game engine (host) + UI (everyone). */

(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const app = $("#app");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  const LIMITS = { rounds: [1, 30], timer: [5, 120] };
  const DEFAULT_SETTINGS = () => ({ rounds: 10, timer: 20, categories: CATEGORIES.map((c) => c.id) });
  const COUNTDOWN_MS = 3000;
  const GRACE_MS = 1000;

  const questionOf = (ref) => {
    const c = ref && CATEGORIES.find((c) => c.id === ref.catId);
    return c ? c.questions[ref.qi] : null;
  };
  const clamp = (n, [lo, hi]) => Math.min(hi, Math.max(lo, Math.round(Number(n) || lo)));
  const cleanName = (n) => String(n || "").replace(/\s+/g, " ").trim().slice(0, 16) || "Player";

  // Profile pictures: "p1".."p20" for the presets, or a small uploaded image as a data URL.
  const PRESET_COUNT = 20;
  const MAX_AVATAR_CHARS = 60000;
  const cleanAvatar = (v) => {
    v = String(v || "");
    if (/^p([1-9]|1\d|20)$/.test(v)) return v;
    if (v.length < MAX_AVATAR_CHARS && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) return v;
    return "";
  };

  // ======================================================================
  //  HOST ENGINE — runs only in the host's browser; it is the source of truth.
  // ======================================================================
  function createHost(name, avatarValue) {
    const hs = {
      code: null,
      phase: "lobby",
      settings: DEFAULT_SETTINGS(),
      players: new Map(), // id -> { id, name, score, connected, answers: [{display, tier}] }
      round: 0,
      totalRounds: 10,
      ref: null,
      startAt: 0,
      endAt: 0,
      used: new Set(),
      reveal: null,
      timer: null,
    };
    hs.players.set("host", { id: "host", name: cleanName(name), avatar: cleanAvatar(avatarValue), score: 0, connected: true, answers: [] });

    // Uploaded photos are big-ish, so they travel in their own message only when one
    // changes or someone joins, instead of inside every state update.
    function pushAvatars() {
      const map = {};
      for (const p of hs.players.values()) if (p.avatar && p.avatar.startsWith("data:")) map[p.id] = p.avatar;
      net.broadcast({ t: "avatars", map });
      view.avatars = map;
    }

    const net = Net.host({
      onOpen(code) { hs.code = code; publish(); },
      onData: (id, msg) => handle(id, msg),
      onLeave(id) {
        const p = hs.players.get(id);
        if (!p) return;
        if (hs.phase === "lobby") hs.players.delete(id);
        else p.connected = false;
        if (!checkAllDone()) publish();
      },
      onError(m) { toast(m, "error"); if (!hs.code) leave(); },
    });

    function uniqueName(n) {
      const taken = new Set([...hs.players.values()].filter((p) => p.connected).map((p) => p.name.toLowerCase()));
      if (!taken.has(n.toLowerCase())) return n;
      for (let i = 2; ; i++) if (!taken.has(`${n} ${i}`.toLowerCase())) return `${n} ${i}`;
    }

    function handle(id, msg) {
      const isHost = id === "host";
      switch (msg.t) {
        case "hello": {
          const n = cleanName(msg.name);
          // Same name as someone who dropped out? Give them their seat (and score) back.
          const old = [...hs.players.values()].find((p) => !p.connected && p.name.toLowerCase() === n.toLowerCase());
          let p;
          if (old) {
            hs.players.delete(old.id);
            p = { ...old, id, connected: true, avatar: cleanAvatar(msg.avatar) || old.avatar };
          } else {
            p = { id, name: uniqueName(n), avatar: cleanAvatar(msg.avatar), score: 0, connected: true, answers: [] };
          }
          hs.players.set(id, p);
          net.send(id, { t: "welcome", you: id, roundId: hs.phase === "round" ? hs.startAt : null, answers: p.answers });
          pushAvatars();
          publish();
          break;
        }
        case "avatar": {
          const p = hs.players.get(id);
          if (!p) return;
          const was = p.avatar || "";
          p.avatar = cleanAvatar(msg.avatar);
          if (was.startsWith("data:") || p.avatar.startsWith("data:")) pushAvatars();
          publish();
          break;
        }
        case "answer": {
          const p = hs.players.get(id);
          const now = Date.now();
          if (!p || hs.phase !== "round" || now < hs.startAt - 250 || now > hs.endAt + GRACE_MS) return;
          const e = Match.exact(questionOf(hs.ref), msg.text);
          if (!e || p.answers.some((a) => a.display === e.display)) return;
          p.answers.push({ display: e.display, tier: e.tier });
          publish();
          break;
        }
        case "settings": {
          if (!isHost || hs.phase !== "lobby") return;
          const s = msg.settings;
          const cats = (s.categories || []).filter((c) => CATEGORIES.some((x) => x.id === c));
          hs.settings = {
            rounds: clamp(s.rounds, LIMITS.rounds),
            timer: clamp(s.timer, LIMITS.timer),
            categories: cats.length ? cats : hs.settings.categories,
          };
          publish();
          break;
        }
        case "start":
          if (!isHost || hs.phase !== "lobby") return;
          for (const p of hs.players.values()) p.score = 0;
          hs.round = 0;
          hs.totalRounds = hs.settings.rounds;
          nextRound();
          break;
        case "done": {
          // A player says they're finished; once everyone still here is done, end the round early.
          const p = hs.players.get(id);
          if (!p || hs.phase !== "round" || Date.now() < hs.startAt) return;
          p.done = true;
          if (!checkAllDone()) publish();
          break;
        }
        case "next":
          if (!isHost || hs.phase !== "reveal") return;
          if (hs.round >= hs.totalRounds) { hs.phase = "final"; publish(); }
          else nextRound();
          break;
        case "lobby":
          if (!isHost || hs.phase !== "final") return;
          hs.phase = "lobby";
          hs.ref = null;
          hs.reveal = null;
          for (const [pid, p] of hs.players) {
            if (!p.connected) hs.players.delete(pid);
            p.score = 0;
            p.answers = [];
          }
          publish();
          break;
      }
    }

    // Ends the round if every connected player has pressed "I'm done". Returns true if it did.
    function checkAllDone() {
      if (hs.phase !== "round") return false;
      const here = [...hs.players.values()].filter((p) => p.connected);
      if (here.length && here.every((p) => p.done)) { endRound(); return true; }
      return false;
    }

    function nextRound() {
      const pool = [];
      for (const c of CATEGORIES) {
        if (!hs.settings.categories.includes(c.id)) continue;
        c.questions.forEach((_, qi) => pool.push({ catId: c.id, qi }));
      }
      let fresh = pool.filter((r) => !hs.used.has(`${r.catId}:${r.qi}`));
      if (!fresh.length) {
        pool.forEach((r) => hs.used.delete(`${r.catId}:${r.qi}`));
        fresh = pool.filter((r) => !(hs.ref && r.catId === hs.ref.catId && r.qi === hs.ref.qi));
        if (!fresh.length) fresh = pool;
      }
      hs.ref = fresh[Math.floor(Math.random() * fresh.length)];
      hs.used.add(`${hs.ref.catId}:${hs.ref.qi}`);
      hs.round++;
      for (const p of hs.players.values()) { p.answers = []; p.done = false; }
      hs.startAt = Date.now() + COUNTDOWN_MS;
      hs.endAt = hs.startAt + hs.settings.timer * 1000;
      hs.phase = "round";
      hs.reveal = null;
      clearTimeout(hs.timer);
      hs.timer = setTimeout(endRound, hs.endAt - Date.now() + GRACE_MS);
      publish();
    }

    function endRound() {
      clearTimeout(hs.timer);
      if (hs.phase !== "round") return;
      const q = questionOf(hs.ref);
      const results = [];
      const said = new Set();
      for (const p of hs.players.values()) {
        const answers = [...p.answers].sort((a, b) => Match.rank(b.tier) - Match.rank(a.tier));
        answers.forEach((a) => said.add(a.display));
        const best = answers[0] || null;
        const points = best ? Match.tier(best.tier).points : 0;
        p.score += points;
        results.push({ id: p.id, name: p.name, answers, best, points });
      }
      results.sort((a, b) => b.points - a.points || b.answers.length - a.answers.length);

      // Unfound answers are deliberately never shown, so nobody can memorise them for next time.
      hs.reveal = { results, totalAnswers: Match.index(q).entries.length, foundCount: said.size };
      hs.phase = "reveal";
      publish();
    }

    function publicState() {
      const now = Date.now();
      const q = questionOf(hs.ref);
      const cat = hs.ref && CATEGORIES.find((c) => c.id === hs.ref.catId);
      return {
        code: hs.code,
        phase: hs.phase,
        settings: hs.settings,
        round: hs.round,
        // Unique per round (its start time), so a new game's "Round 1" never reuses old state.
        roundId: hs.startAt,
        totalRounds: hs.phase === "lobby" ? hs.settings.rounds : hs.totalRounds,
        players: [...hs.players.values()].map((p) => ({
          id: p.id, name: p.name, avatar: p.avatar && p.avatar.startsWith("data:") ? "custom" : p.avatar || "", score: p.score, connected: p.connected, count: p.answers.length, done: !!p.done,
        })),
        question: q ? { ...hs.ref, prompt: q.prompt, catName: cat.name, emoji: cat.emoji } : null,
        startsInMs: Math.max(0, hs.startAt - now),
        remainingMs: Math.max(0, hs.endAt - now),
        reveal: hs.reveal,
      };
    }

    function publish() {
      if (!hs.code) return;
      const st = publicState();
      net.broadcast({ t: "state", state: st });
      onState(st);
    }

    return {
      role: "host",
      me: "host",
      send: (msg) => handle("host", msg),
      close() { clearTimeout(hs.timer); net.close(); },
    };
  }

  // ======================================================================
  //  GUEST — connects to a host and mirrors its state.
  // ======================================================================
  function createGuest(name, code, avatarValue) {
    const s = { role: "guest", me: null, send: (m) => net.send(m), close: () => net.close() };
    const net = Net.join(code, {
      onOpen() { net.send({ t: "hello", name, avatar: avatarValue }); },
      onData(msg) {
        if (msg.t === "welcome") {
          s.me = msg.you;
          view.answersRound = msg.roundId;
          view.myAnswers = msg.answers || [];
        } else if (msg.t === "avatars") {
          view.avatars = msg.map || {};
        } else if (msg.t === "state") {
          onState(msg.state);
        }
      },
      onClose() { if (session === s) showEnded("The host left the game."); },
      onError(m) { if (session === s) { toast(m, "error"); leave(); } },
    });
    return s;
  }

  // ======================================================================
  //  UI
  // ======================================================================
  let session = null;
  let state = null;
  const view = { key: null, myAnswers: [], answersRound: null, startLocal: 0, endLocal: 0, tick: null, iAmDone: false, seen: new Set(), lastCd: null, lastSec: null, avatars: {} };

  // This player's own picture, saved in their browser. New players get a random preset.
  function myAvatar() {
    let v = cleanAvatar(store.get("bk-avatar", ""));
    if (!v) {
      v = `p${1 + Math.floor(Math.random() * PRESET_COUNT)}`;
      store.set("bk-avatar", v);
    }
    return v;
  }
  const avatarSrc = (v) => (v.startsWith("p") ? `assets/avatars/${v.slice(1)}.webp` : v.startsWith("data:") ? v : "");

  function onState(st) {
    state = st;
    if (st.phase === "round" && st.roundId !== view.answersRound) {
      view.answersRound = st.roundId;
      view.myAnswers = [];
    }
    const key = st.phase === "lobby" ? "lobby" : `${st.phase}:${st.roundId}`;
    if (key !== view.key) {
      view.key = key;
      clearInterval(view.tick);
      if (st.phase === "round") {
        view.startLocal = Date.now() + st.startsInMs;
        view.endLocal = Date.now() + st.remainingMs;
      }
      ({ lobby: mountLobby, round: mountRound, reveal: mountReveal, final: mountFinal })[st.phase]();
    } else {
      ({ lobby: updateLobby, round: updateRound, reveal: () => {}, final: () => {} })[st.phase]();
    }
  }

  const isHost = () => session && session.role === "host";
  const me = () => state && state.players.find((p) => p.id === session.me);
  const tierBadge = (t, extra = "") => {
    const tier = Match.tier(t);
    return `<span class="tier" data-t="${t}" style="--c:${tier.color}">${esc(tier.name)}${extra}</span>`;
  };
  const chip = (a, cls = "") => `<span class="chip ${cls}" data-t="${a.tier}" style="--c:${Match.tier(a.tier).color}">${esc(a.display)}</span>`;
  const words = (text) => esc(text).split(" ").map((w, i) => `<span class="w" style="--i:${i}">${w}</span>`).join(" ");

  // Draws a player's picture: their preset or upload, falling back to a coloured initial.
  function avatar(p) {
    const info = (state && state.players.find((x) => x.id === p.id)) || p;
    const v = info.avatar || "";
    const src = v === "custom" ? view.avatars[p.id] || "" : avatarSrc(v);
    if (src) return `<span class="avatar pic"><img src="${esc(src)}" alt="" draggable="false"></span>`;
    let h = 0;
    for (const ch of p.name) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `<span class="avatar" style="--h:${h}">${esc(p.name[0].toUpperCase())}</span>`;
  }

  function topbar(left) {
    return `<div class="topbar">${left}<span class="spacer"></span>
      ${state.code ? `<span class="pill ghost">Room ${esc(state.code)}</span>` : ""}
      <button class="btn small ghost" data-act="leave">Leave</button></div>`;
  }

  // ---------- Home ----------
  function mountHome() {
    view.key = null;
    clearInterval(view.tick);
    const params = new URLSearchParams(location.search);
    const room = (params.get("room") || "").toUpperCase().slice(0, 5);
    app.innerHTML = `
      <main class="home">
        <div class="logo">
          <img class="crown" src="assets/crown.png" alt="" width="640" height="454">
          <h1><span class="l1">Baller</span> <span class="l2">Knowledge</span></h1>
        </div>
        <p class="tagline">Name as many as you can. Only your <b>rarest</b> answer counts.</p>

        <form class="card stack" id="home-form">
          <div class="identity">
            <button type="button" class="av-btn" data-act="pick-avatar" aria-label="Change your picture">
              <img id="my-av" src="${esc(avatarSrc(myAvatar()))}" alt="">
              <span class="av-edit" aria-hidden="true">✎</span>
            </button>
            <label class="field"><span>Your name</span>
              <input id="name" maxlength="16" autocomplete="nickname" placeholder="e.g. Jordan" value="${esc(store.get("bk-name", ""))}">
            </label>
          </div>
          ${room ? `
            <button class="btn primary big" type="submit" data-act="join">Join room ${esc(room)}</button>
            <input id="code" type="hidden" value="${esc(room)}">
            <button class="btn ghost" type="button" data-act="create">Create my own lobby instead</button>
          ` : `
            <button class="btn primary big" type="button" data-act="create">Create lobby</button>
            <div class="divider"><span>or join a friend</span></div>
            <div class="row">
              <input id="code" class="code-input" maxlength="5" placeholder="CODE" autocomplete="off" autocapitalize="characters" spellcheck="false">
              <button class="btn" type="submit" data-act="join">Join</button>
            </div>
          `}
        </form>

        <section class="card how">
          <h2>How it works</h2>
          <ol class="steps">
            <li><span class="n">1</span><span>Everyone gets the same prompt.</span></li>
            <li><span class="n">2</span><span>Name as many answers as you can before time runs out.</span></li>
            <li><span class="n">3</span><span>Only your <b class="gold">rarest answer</b> scores.</span></li>
          </ol>
          <div class="scale">${TIERS.map((t) => `<div style="--c:${t.color}"><i></i><span>${esc(t.name)}</span><b>${t.points}</b></div>`).join("")}</div>
        </section>
      </main>`;
    const nameEl = $("#name");
    (room ? nameEl : nameEl.value ? $("#code") : nameEl)?.focus();
    $("#home-form").addEventListener("submit", (e) => {
      e.preventDefault();
      if (room || $("#code").value.trim()) startJoin();
      else startCreate();
    });
  }

  function readName() {
    const n = $("#name").value.trim();
    if (!n) { toast("Pick a name first", "error"); $("#name").focus(); return null; }
    store.set("bk-name", cleanName(n));
    return cleanName(n);
  }

  function startCreate() {
    const n = readName();
    if (!n) return;
    showLoading("Opening a room…");
    session = createHost(n, myAvatar());
  }

  function startJoin() {
    const n = readName();
    if (!n) return;
    const code = ($("#code").value || "").trim().toUpperCase();
    if (!/^[A-Z]{5}$/.test(code)) { toast("Room codes are 5 letters", "error"); $("#code").focus(); return; }
    showLoading(`Joining room ${code}…`);
    session = createGuest(n, code, myAvatar());
  }

  function showLoading(msg) {
    app.innerHTML = `<main class="center"><div class="spinner"></div><p>${esc(msg)}</p>
      <button class="btn ghost small" data-act="leave">Cancel</button></main>`;
  }

  function showEnded(msg) {
    if (session) { session.close(); session = null; }
    state = null;
    view.key = null;
    clearInterval(view.tick);
    app.innerHTML = `<main class="center"><div class="big-emoji">👋</div><h2>${esc(msg)}</h2>
      <button class="btn primary" data-act="home">Back to start</button></main>`;
  }

  function leave() {
    if (session) { session.close(); session = null; }
    state = null;
    view.seen.clear();
    view.myAnswers = [];
    view.answersRound = null;
    history.replaceState(null, "", location.pathname);
    mountHome();
  }

  // ---------- Lobby ----------
  function mountLobby() {
    const host = isHost();
    app.innerHTML = `
      <main class="lobby">
        ${topbar(`<span class="brand"><img src="assets/crown.png" alt="">Baller Knowledge</span>`)}
        <section class="card room-card">
          <div>
            <div class="label">Room code</div>
            <div class="room-code">${[...state.code].map((c, i) => `<span style="--i:${i}">${esc(c)}</span>`).join("")}</div>
          </div>
          <button class="btn" data-act="copy">Copy invite link</button>
        </section>
        <div class="lobby-grid">
          <section class="card">
            <h2>Players <span class="count" id="pcount"></span></h2>
            <ul class="players" id="players"></ul>
          </section>
          <section class="card" id="settings"></section>
        </div>
        <div class="actions" id="lobby-actions"></div>
      </main>`;
    renderSettings();
    updateLobby();
  }

  function updateLobby() {
    $("#pcount").textContent = state.players.length;
    // Only players who just joined get the pop-in animation.
    $("#players").innerHTML = state.players.map((p) => `
      <li class="${p.id === session.me ? "me" : ""} ${view.seen.has(p.id) ? "" : "new"}">${p.id === session.me
        ? `<button class="av-mini" data-act="pick-avatar" aria-label="Change your picture">${avatar(p)}<span class="av-edit" aria-hidden="true">✎</span></button>`
        : avatar(p)}<span class="pname">${esc(p.name)}</span>
        ${p.id === "host" ? `<span class="tag host">👑 host</span>` : ""}${p.id === session.me ? `<span class="tag you">you</span>` : ""}</li>`).join("");
    state.players.forEach((p) => view.seen.add(p.id));
    // Don't yank a number box out from under the host while they're typing in it.
    const typing = document.activeElement && document.activeElement.matches("#settings input");
    if (!typing) renderSettings();
    $("#lobby-actions").innerHTML = isHost()
      ? `<button class="btn primary big" data-act="start">Start game</button>
         ${state.players.length < 2 ? `<p class="hint">You can start solo to try it out, but it's better with friends.</p>` : ""}`
      : `<p class="hint pulse">Waiting for the host to start…</p>`;
  }

  function renderSettings() {
    const s = state.settings;
    const host = isHost();
    const dis = host ? "" : "disabled";
    const qCount = CATEGORIES.filter((c) => s.categories.includes(c.id)).reduce((n, c) => n + c.questions.length, 0);
    $("#settings").innerHTML = `
      <h2>Settings ${host ? "" : `<span class="count">host picks</span>`}</h2>
      <div class="settings-row">
        <label class="field"><span>Rounds</span>
          <div class="stepper"><button class="btn small" data-step="rounds:-1" ${dis}>−</button>
          <input type="number" id="set-rounds" min="${LIMITS.rounds[0]}" max="${LIMITS.rounds[1]}" value="${s.rounds}" ${dis}>
          <button class="btn small" data-step="rounds:1" ${dis}>+</button></div></label>
        <label class="field"><span>Seconds per round</span>
          <div class="stepper"><button class="btn small" data-step="timer:-5" ${dis}>−</button>
          <input type="number" id="set-timer" min="${LIMITS.timer[0]}" max="${LIMITS.timer[1]}" value="${s.timer}" ${dis}>
          <button class="btn small" data-step="timer:5" ${dis}>+</button></div></label>
      </div>
      <div class="field"><span>Categories</span>
        <div class="cats">${CATEGORIES.map((c) => `
          <button class="cat ${s.categories.includes(c.id) ? "on" : ""}" data-cat="${c.id}" ${dis} aria-pressed="${s.categories.includes(c.id)}">
            <span class="emo">${c.emoji}</span>
            <span class="cname">${esc(c.name)}<small>${c.questions.length} questions</small></span>
            <span class="tick">✓</span></button>`).join("")}</div>
      </div>
      ${qCount < s.rounds ? `<p class="hint">Only ${qCount} questions picked, so some will repeat.</p>` : ""}`;
  }

  function pushSettings(patch) {
    const s = { ...state.settings, ...patch };
    session.send({ t: "settings", settings: s });
  }

  // ---------- Round ----------
  function mountRound() {
    const q = state.question;
    app.innerHTML = `
      <main class="round">
        ${topbar(`<span class="pill">Round ${state.round}/${state.totalRounds}</span>
                  <span class="pill cat-pill">${q.emoji} ${esc(q.catName)}</span>`)}
        <div class="timer"><div class="timer-fill" id="tfill"></div><span id="tnum"></span></div>
        <div class="round-grid">
          <section class="play">
            <h2 class="prompt" id="prompt">${words(q.prompt)}</h2>
            <form id="ans-form" class="ans-form" autocomplete="off">
              <div class="ans-wrap">
                <input id="ans" placeholder="Type an answer…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="send" disabled>
              </div>
              <button class="btn primary" type="submit" id="ans-btn" disabled>Add</button>
            </form>
            <div class="feedback" id="feedback"></div>
            <div class="best" id="best"></div>
            <ul class="my-answers" id="mine"></ul>
          </section>
          <aside class="card side">
            <h3>Answers so far</h3>
            <ul class="players compact" id="counts"></ul>
            <button class="btn wide" id="done-btn" data-act="done" disabled>I'm done</button>
            <p class="hint small-hint" id="done-hint">The round ends when the timer runs out or everyone is done.</p>
          </aside>
        </div>
      </main>
      <div class="countdown" id="countdown">
          <div class="cd-round">Round ${state.round} of ${state.totalRounds}</div>
          <div class="cd-cat">${q.emoji} ${esc(q.catName)}</div>
          <div class="cd-num" id="cdnum"></div>
      </div>`;

    const input = $("#ans");
    input.addEventListener("keydown", (e) => { if (e.key === "Escape") input.value = ""; });
    $("#ans-form").addEventListener("submit", (e) => { e.preventDefault(); submitAnswer(); });

    view.iAmDone = false;
    view.started = false;
    view.lastCd = null;
    view.lastSec = null;
    renderMine();
    updateRound();
    tickRound();
    view.tick = setInterval(tickRound, 100);
  }

  let fbTimer;
  function feedback(html, kind, ms = 1600) {
    const el = $("#feedback");
    if (!el) return;
    el.innerHTML = html;
    el.className = `feedback show ${kind}`;
    clearTimeout(fbTimer);
    if (ms) fbTimer = setTimeout(() => (el.className = "feedback"), ms);
  }

  const alreadyHave = (entry) => view.myAnswers.some((a) => a.display === entry.display);

  function submitAnswer() {
    const input = $("#ans");
    if (input.disabled) return;
    const text = input.value.trim();
    if (!text) return;
    const q = questionOf(state.question);
    const entry = Match.exact(q, text);

    if (!entry) {
      // Close but not exact? Put the guess in the box and let them confirm with Enter.
      const guess = Match.closest(q, text);
      if (guess && !alreadyHave(guess)) {
        input.value = guess.display;
        input.setSelectionRange(guess.display.length, guess.display.length);
        feedback(`Did you mean <b>${esc(guess.display)}</b>? Press Enter to add it.`, "ask", 0);
        return;
      }
      if (guess) {
        feedback(`Already got ${esc(guess.display)}`, "meh");
        input.value = "";
        return;
      }
      feedback(`“${esc(text)}” isn't on the list`, "bad");
      Sfx.play("wrong");
      input.classList.remove("shake"); void input.offsetWidth; input.classList.add("shake");
      input.select();
      return;
    }
    if (alreadyHave(entry)) {
      feedback(`Already got ${esc(entry.display)}`, "meh");
      input.value = "";
      return;
    }
    const prevBest = Math.max(-1, ...view.myAnswers.map((x) => Match.rank(x.tier)));
    const a = { display: entry.display, tier: entry.tier };
    view.myAnswers.push(a);
    session.send({ t: "answer", text: entry.display });
    const t = Match.tier(a.tier);
    const rank = Match.rank(a.tier);
    feedback(`${esc(a.display)} ${tierBadge(a.tier, ` · ${t.points}`)}`, "good");
    input.value = "";
    renderMine(a.display, rank > prevBest);
    Sfx.correct(rank);

    // Celebrate: sparkles from the box, floating points, and a banner for the big finds.
    const r = input.getBoundingClientRect();
    Fx.burst(r.left + Math.min(r.width - 40, 60 + a.display.length * 9), r.top + r.height / 2, t.color, 10 + rank * 9, 4 + rank * 1.6);
    Fx.floatText(r.right - 70, r.top - 6, `+${t.points}`, t.color);
    if (rank >= 3) {
      Fx.banner(t.name.toUpperCase() + "!", t.color, esc(a.display));
      Fx.shake($("main"));
    }
  }

  function renderMine(fresh, newBest) {
    const sorted = [...view.myAnswers].sort((a, b) => Match.rank(b.tier) - Match.rank(a.tier));
    const best = sorted[0];
    const bestEl = $("#best");
    bestEl.style.setProperty("--c", best ? Match.tier(best.tier).color : "var(--line)");
    if (newBest) { bestEl.classList.remove("bump"); void bestEl.offsetWidth; bestEl.classList.add("bump"); }
    bestEl.innerHTML = best
      ? `<span class="label">Your scoring answer</span> <b>${esc(best.display)}</b> ${tierBadge(best.tier, ` · ${Match.tier(best.tier).points} pts`)}`
      : `<span class="label">No answers yet. Go for the rare ones!</span>`;
    $("#mine").innerHTML = sorted.map((a) => `<li class="${a.display === fresh ? "pop" : ""}">${chip(a, a === best ? "best" : "")}</li>`).join("");
  }

  function updateRound() {
    const el = $("#counts");
    if (!el) return;
    el.innerHTML = [...state.players].sort((a, b) => b.count - a.count).map((p) => `
      <li class="${p.connected ? "" : "gone"} ${p.id === session.me ? "me" : ""} ${p.done ? "is-done" : ""}">${avatar(p)}<span class="pname">${esc(p.name)}</span>
      ${p.done ? `<span class="done-tag">done</span>` : ""}<span class="num">${p.count}</span></li>`).join("");
    const here = state.players.filter((p) => p.connected);
    const waiting = here.filter((p) => !p.done).length;
    if (view.iAmDone && $("#done-hint")) {
      $("#done-hint").textContent = waiting ? `Waiting for ${waiting} more player${waiting === 1 ? "" : "s"}…` : "Ending round…";
    }
  }

  function markDone() {
    if (view.iAmDone) return;
    view.iAmDone = true;
    session.send({ t: "done" });
    const input = $("#ans");
    input.disabled = true;
    input.value = "";
    input.placeholder = "You're done. Waiting for the others…";
    $("#ans-btn").disabled = true;
    const btn = $("#done-btn");
    btn.disabled = true;
    btn.textContent = "Done ✓";
    feedback("", "", 1);
    updateRound();
  }

  function tickRound() {
    const now = Date.now();
    const total = state.settings.timer * 1000;
    const cd = $("#countdown");
    const input = $("#ans");
    if (!cd) return clearInterval(view.tick);
    if (now < view.startLocal) {
      cd.classList.add("show");
      const n = Math.ceil((view.startLocal - now) / 1000);
      if (n !== view.lastCd) {
        view.lastCd = n;
        // Fresh element each second so the zoom animation replays.
        $("#cdnum").innerHTML = `<span class="cd-n">${n}</span>`;
        Sfx.play("tick");
      }
      $("#tfill").style.width = "100%";
      $("#tnum").textContent = state.settings.timer;
      return;
    }
    // Runs once when the round starts (also for players who join mid-round).
    if (!view.started) {
      view.started = true;
      if (cd.classList.contains("show")) {
        $("#cdnum").innerHTML = `<span class="cd-n go">GO!</span>`;
        Sfx.play("go");
        cd.classList.add("leaving");
        setTimeout(() => cd.classList.remove("show", "leaving"), 650);
      }
      $("#prompt").classList.add("go");
      if (!view.iAmDone && now < view.endLocal) {
        input.disabled = false;
        $("#ans-btn").disabled = false;
        $("#done-btn").disabled = false;
        input.focus();
      }
    }
    const left = Math.max(0, view.endLocal - now);
    const sec = Math.ceil(left / 1000);
    const low = left < 5000 && left > 0;
    $("#tfill").style.width = `${(left / total) * 100}%`;
    $("#tfill").classList.toggle("low", low);
    $(".timer").classList.toggle("low", low);
    if (sec !== view.lastSec) {
      view.lastSec = sec;
      const tn = $("#tnum");
      tn.textContent = sec;
      if (low) {
        tn.classList.remove("tick"); void tn.offsetWidth; tn.classList.add("tick");
        if (!view.iAmDone) Sfx.play("clock");
      }
    }
    if (left <= 0 && !input.placeholder.startsWith("Time")) {
      input.disabled = true;
      $("#ans-btn").disabled = true;
      $("#done-btn").disabled = true;
      input.placeholder = "Time's up! Tallying…";
      input.value = "";
    }
  }

  // ---------- Reveal ----------
  function mountReveal() {
    const r = state.reveal;
    const q = state.question;
    const last = state.round >= state.totalRounds;
    const standings = [...state.players].sort((a, b) => b.score - a.score);
    const top = Math.max(1, ...standings.map((p) => p.score));
    app.innerHTML = `
      <main class="reveal">
        ${topbar(`<span class="pill">Round ${state.round} of ${state.totalRounds}</span>`)}
        <header class="reveal-head">
          <span class="eyebrow">${q.emoji} ${esc(q.catName)}</span>
          <h2 class="prompt small">${esc(q.prompt)}</h2>
          <p class="hint">The room found <b>${r.foundCount}</b> of ${r.totalAnswers} answers</p>
        </header>
        <section class="card">
          <ol class="results">
            ${r.results.map((p, i) => `
              <li class="result ${p.id === session.me ? "me" : ""}" style="--d:${i * 140}ms">
                ${avatar(p)}
                <div class="rmain">
                  <div class="rname">${esc(p.name)}${p.id === session.me ? `<span class="you">you</span>` : ""}</div>
                  ${p.best
                    ? `<div class="rpick"><b>${esc(p.best.display)}</b>${tierBadge(p.best.tier)}</div>`
                    : `<div class="rpick none">No answers</div>`}
                  ${p.answers.length > 1 ? `<div class="ralso">Also: ${p.answers.slice(1).map((a) => esc(a.display)).join(", ")}</div>` : ""}
                </div>
                <span class="gain" data-to="${p.points}" style="--d:${i * 140 + 350}ms">+0</span>
              </li>`).join("")}
          </ol>
        </section>
        ${standings.length > 1 ? `
          <section class="card">
            <h3>Standings</h3>
            <ol class="standings">${standings.map((p, i) => `
              <li class="${p.id === session.me ? "me" : ""}" style="--w:${(p.score / top) * 100}%;--d:${500 + i * 90}ms">
                ${avatar(p)}<span class="pname">${esc(p.name)}</span><span class="num">${p.score}</span>
                <span class="bar"><i></i></span>
              </li>`).join("")}</ol>
          </section>` : ""}
        <div class="actions">
          ${isHost()
            ? `<button class="btn primary big" data-act="next">${last ? "See final results 🏆" : "Next round →"}</button>`
            : `<p class="hint pulse">Waiting for the host…</p>`}
        </div>
      </main>`;

    Sfx.play("reveal");
    // Count each player's points up as their card lands, with sparkles for the rare picks.
    app.querySelectorAll(".gain").forEach((el) => {
      const delay = parseInt(el.style.getPropertyValue("--d"), 10) || 0;
      setTimeout(() => Fx.countUp(el, Number(el.dataset.to), 700, "+"), delay);
    });
    r.results.forEach((p, i) => {
      if (!p.best || Match.rank(p.best.tier) < 2) return;
      setTimeout(() => {
        const el = app.querySelectorAll(".result")[i]?.querySelector(".rpick b");
        if (!el) return;
        const b = el.getBoundingClientRect();
        Fx.burst(b.left + b.width / 2, b.top + b.height / 2, Match.tier(p.best.tier).color, 6 + Match.rank(p.best.tier) * 5, 4);
      }, i * 160 + 500);
    });
  }

  // ---------- Final ----------
  function mountFinal() {
    const ranked = [...state.players].sort((a, b) => b.score - a.score);
    const podium = ranked.slice(0, 3);
    const order = [podium[1], podium[0], podium[2]].filter(Boolean);
    const medal = ["🥇", "🥈", "🥉"];
    app.innerHTML = `
      <main class="final">
        ${topbar(`<span class="pill">Final results</span>`)}
        <h1 class="winner">${ranked[1] && ranked[1].score === ranked[0].score ? "It's a tie!" : `${esc(ranked[0]?.name || "Nobody")} wins!`}</h1>
        <div class="podium">
          ${order.map((p) => {
            const place = ranked.indexOf(p);
            return `<div class="step place-${place + 1} ${p.id === session.me ? "me" : ""}">
              ${place === 0 ? `<img class="winner-crown" src="assets/crown.png" alt="">` : ""}
              ${avatar(p)}<div class="pname">${esc(p.name)}</div><div class="num" data-to="${p.score}">0</div>
              <div class="block"><span>${medal[place]}</span></div></div>`;
          }).join("")}
        </div>
        ${ranked.length > 3 ? `<section class="card"><ol class="standings" start="4">${ranked.slice(3).map((p) => `
          <li class="${p.id === session.me ? "me" : ""}">${avatar(p)}<span class="pname">${esc(p.name)}</span><span class="num">${p.score}</span></li>`).join("")}</ol></section>` : ""}
        <div class="actions">
          ${isHost() ? `<button class="btn primary big" data-act="lobby">Play again</button>` : `<p class="hint pulse">Waiting for the host to start another game…</p>`}
        </div>
      </main>`;
    app.querySelectorAll(".podium .num").forEach((el) => setTimeout(() => Fx.countUp(el, Number(el.dataset.to), 1200), 500));
    setTimeout(() => { Fx.confetti(4000); Sfx.play("win"); }, 900);
  }

  // ---------- Confirm dialog (the browser's confirm() can be blocked, so we draw our own) ----------
  function askConfirm(title, body, okLabel) {
    return new Promise((resolve) => {
      const wrap = document.createElement("div");
      wrap.className = "modal";
      wrap.innerHTML = `
        <div class="modal-box card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <h3 id="modal-title">${esc(title)}</h3>
          <p>${esc(body)}</p>
          <div class="modal-actions">
            <button class="btn ghost" data-modal="no">Stay</button>
            <button class="btn danger" data-modal="yes">${esc(okLabel)}</button>
          </div>
        </div>`;
      const close = (ok) => {
        wrap.classList.add("out");
        document.removeEventListener("keydown", onKey);
        setTimeout(() => wrap.remove(), 180);
        resolve(ok);
      };
      const onKey = (e) => { if (e.key === "Escape") close(false); };
      wrap.addEventListener("click", (e) => {
        if (e.target === wrap) return close(false);
        const b = e.target.closest("[data-modal]");
        if (b) close(b.dataset.modal === "yes");
      });
      document.addEventListener("keydown", onKey);
      document.body.appendChild(wrap);
      wrap.querySelector("[data-modal=no]").focus();
    });
  }

  // ---------- Profile picture picker ----------
  function setMyAvatar(v) {
    v = cleanAvatar(v);
    if (!v) return;
    store.set("bk-avatar", v);
    const img = $("#my-av");
    if (img) img.src = avatarSrc(v);
    if (session) session.send({ t: "avatar", avatar: v });
  }

  // Centre-crops an uploaded image to a small square JPEG so it's cheap to send to everyone.
  function imageToAvatar(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith("image/")) return reject(new Error("That file isn't an image."));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const s = Math.min(img.width, img.height);
        const c = document.createElement("canvas");
        c.width = c.height = 128;
        c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 128, 128);
        URL.revokeObjectURL(url);
        let q = 0.85;
        let data = c.toDataURL("image/jpeg", q);
        while (data.length > MAX_AVATAR_CHARS - 1000 && q > 0.4) { q -= 0.15; data = c.toDataURL("image/jpeg", q); }
        resolve(data);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that image. Try a JPG or PNG.")); };
      img.src = url;
    });
  }

  function openAvatarPicker() {
    const current = myAvatar();
    const wrap = document.createElement("div");
    wrap.className = "modal";
    const option = (v) => `<button type="button" class="av-opt ${v === current ? "on" : ""}" data-av="${esc(v)}" aria-label="Choose this picture"><img src="${esc(avatarSrc(v))}" alt=""></button>`;
    wrap.innerHTML = `
      <div class="modal-box card picker" role="dialog" aria-modal="true" aria-labelledby="pick-title">
        <h3 id="pick-title">Choose your picture</h3>
        <div class="mine-row">
          <span class="mine-slot">${current.startsWith("data:") ? option(current) : `<span class="av-empty" aria-hidden="true">+</span>`}</span>
          <div class="mine-text">
            <b>Your own photo</b>
            <span>Square photos work best.</span>
          </div>
          <label class="btn small upload">Upload<input type="file" accept="image/*" hidden></label>
        </div>
        <div class="av-grid">
          ${Array.from({ length: PRESET_COUNT }, (_, i) => option(`p${i + 1}`)).join("")}
        </div>
        <div class="picker-actions">
          <button type="button" class="btn primary" data-close>Done</button>
        </div>
      </div>`;
    const close = () => {
      wrap.classList.add("out");
      document.removeEventListener("keydown", onKey);
      setTimeout(() => wrap.remove(), 180);
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    const select = (v) => {
      setMyAvatar(v);
      wrap.querySelectorAll(".av-opt").forEach((b) => b.classList.toggle("on", b.dataset.av === v));
    };
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap || e.target.closest("[data-close]")) return close();
      const opt = e.target.closest(".av-opt");
      if (opt) select(opt.dataset.av);
    });
    wrap.querySelector("input[type=file]").addEventListener("change", async (e) => {
      try {
        const data = await imageToAvatar(e.target.files[0]);
        wrap.querySelector(".mine-slot").innerHTML = option(data);
        select(data);
      } catch (err) {
        toast(err.message, "error");
      }
      e.target.value = "";
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(wrap);
  }

  // ---------- Toasts ----------
  function toast(msg, kind = "") {
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.textContent = msg;
    $("#toasts").appendChild(el);
    setTimeout(() => el.classList.add("out"), 3500);
    setTimeout(() => el.remove(), 4000);
  }

  // ---------- Global click handling ----------
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act],[data-step],[data-cat]");
    if (!btn || btn.disabled) return;
    if (btn.dataset.cat) {
      const id = btn.dataset.cat;
      const cur = state.settings.categories;
      const next = cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id];
      if (!next.length) return toast("Keep at least one category", "error");
      return pushSettings({ categories: next });
    }
    if (btn.dataset.step) {
      e.preventDefault();
      const [k, d] = btn.dataset.step.split(":");
      return pushSettings({ [k]: clamp(state.settings[k] + Number(d), LIMITS[k]) });
    }
    switch (btn.dataset.act) {
      case "create": e.preventDefault(); startCreate(); break;
      case "join": break; // handled by form submit
      case "leave":
        if (session && state && state.phase !== "lobby") {
          askConfirm(
            isHost() ? "End the game for everyone?" : "Leave the game?",
            isHost() ? "You're the host, so leaving ends the game for all players." : "Your score is kept if you rejoin with the same name.",
            isHost() ? "End game" : "Leave"
          ).then((ok) => { if (ok) leave(); });
        } else {
          leave();
        }
        break;
      case "home": leave(); break;
      case "copy": {
        const url = `${location.origin}${location.pathname}?room=${state.code}`;
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
          .then(() => toast("Invite link copied!"), () => prompt("Copy this link:", url));
        break;
      }
      case "start": session.send({ t: "start" }); break;
      case "done": markDone(); break;
      case "pick-avatar": e.preventDefault(); openAvatarPicker(); break;
      case "next": session.send({ t: "next" }); break;
      case "lobby": session.send({ t: "lobby" }); break;
    }
  });

  document.addEventListener("change", (e) => {
    if (!isHost()) return;
    if (e.target.id === "set-rounds") pushSettings({ rounds: clamp(e.target.value, LIMITS.rounds) });
    if (e.target.id === "set-timer") pushSettings({ timer: clamp(e.target.value, LIMITS.timer) });
  });

  window.addEventListener("beforeunload", (e) => {
    if (isHost() && state && state.phase !== "lobby") { e.preventDefault(); e.returnValue = ""; }
  });

  // ---------- Background music (a per-player setting, saved in this browser) ----------
  (function setupMusic() {
    const audio = $("#music");
    const btn = $("#sound-btn");
    const panel = $("#sound-panel");
    const onEl = $("#music-on");
    const volEl = $("#music-vol");
    let enabled = store.get("bk-music", "1") === "1";
    let volume = Number(store.get("bk-volume", "40"));
    if (!Number.isFinite(volume)) volume = 40;
    onEl.checked = enabled;
    volEl.value = volume;

    const play = () => { if (enabled && volume > 0) audio.play().catch(() => {}); };

    // Two tracks that alternate: when one ends, the other starts.
    const TRACKS = ["assets/music-1.mp3", "assets/music-2.mp3"];
    let track = 0;
    audio.addEventListener("ended", () => {
      track = (track + 1) % TRACKS.length;
      audio.src = TRACKS[track];
      play();
    });
    // The music sits well under the sound effects: 100% on the slider is 35% real volume.
    const MUSIC_LEVEL = 0.35;
    const sfxOn = $("#sfx-on");
    const sfxVol = $("#sfx-vol");
    sfxOn.checked = Sfx.enabled;
    sfxVol.value = Sfx.volume;

    function sync() {
      audio.volume = (volume / 100) * MUSIC_LEVEL;
      volEl.style.setProperty("--pct", `${volume}%`);
      sfxVol.style.setProperty("--pct", `${Sfx.volume}%`);
      const musicOff = !enabled || volume === 0;
      const sfxOff = !Sfx.enabled || Sfx.volume === 0;
      btn.classList.toggle("muted", musicOff && sfxOff);
      if (!musicOff) play(); else audio.pause();
    }

    sfxOn.addEventListener("change", () => {
      Sfx.setEnabled(sfxOn.checked);
      if (sfxOn.checked) { Sfx.unlock(); Sfx.play("tick"); }
      sync();
    });
    sfxVol.addEventListener("input", () => {
      Sfx.setVolume(sfxVol.value);
      if (Sfx.volume > 0 && !Sfx.enabled) { Sfx.setEnabled(true); sfxOn.checked = true; }
      sync();
    });
    sfxVol.addEventListener("change", () => Sfx.play("tick")); // preview the new level

    onEl.addEventListener("change", () => {
      enabled = onEl.checked;
      store.set("bk-music", enabled ? "1" : "0");
      sync();
    });
    volEl.addEventListener("input", () => {
      volume = Number(volEl.value);
      store.set("bk-volume", String(volume));
      if (volume > 0 && !enabled) { enabled = true; onEl.checked = true; store.set("bk-music", "1"); }
      sync();
    });
    btn.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      btn.setAttribute("aria-expanded", String(!panel.hidden));
    });
    document.addEventListener("click", (e) => {
      if (!panel.hidden && !e.target.closest("#sound")) { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); }
    });

    // Browsers block audio until the player interacts, so start on the first tap or keypress.
    const kick = () => {
      play();
      Sfx.unlock();
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("keydown", kick);
    };
    window.addEventListener("pointerdown", kick);
    window.addEventListener("keydown", kick);
    sync();
  })();

  if (typeof Peer === "undefined") {
    app.innerHTML = `<main class="center"><h2>Couldn't load the networking library.</h2><p>Check your connection and refresh.</p></main>`;
  } else {
    mountHome();
  }
})();
