/*
  Networking over PeerJS (WebRTC). No server of our own: the host's browser
  runs the game, and PeerJS's free public broker just introduces the peers.
  When a direct connection is blocked, a relay (TURN) server from js/config.js
  passes the data along instead.
*/

const Net = (() => {
  const PREFIX = "baller-knowledge-v1-";
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const PING_MS = 2500;
  const DEAD_MS = 9000;
  const JOIN_TIMEOUT_MS = 20000;

  // STUN only helps peers discover their public address; it doesn't relay anything.
  const STUN = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
  ];

  let icePromise = null;
  let relayCount = 0;

  // Builds the ICE server list once: STUN, plus any relay servers from config.js.
  function iceServers() {
    if (icePromise) return icePromise;
    icePromise = (async () => {
      const cfg = typeof NET_CONFIG === "object" ? NET_CONFIG : {};
      let relays = Array.isArray(cfg.iceServers) ? cfg.iceServers.slice() : [];
      if (cfg.meteredCredentialsUrl) {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 5000);
          const res = await fetch(cfg.meteredCredentialsUrl, { signal: ctrl.signal });
          clearTimeout(t);
          if (res.ok) {
            const list = await res.json();
            if (Array.isArray(list)) relays = relays.concat(list);
          } else {
            console.warn("[net] Relay credentials request failed:", res.status);
          }
        } catch (e) {
          console.warn("[net] Couldn't fetch relay credentials:", e.message);
        }
      }
      relays = relays.filter((s) => s && s.urls && [].concat(s.urls).some((u) => /^turns?:/.test(u)));
      relayCount = relays.length;
      return [...STUN, ...relays];
    })();
    return icePromise;
  }

  // Add ?relayonly to the page address to force every connection through the relay (for testing).
  const RELAY_ONLY = new URLSearchParams(location.search).has("relayonly");
  const peerOptions = async () => ({
    config: { iceServers: await iceServers(), ...(RELAY_ONLY ? { iceTransportPolicy: "relay" } : {}) },
  });

  function makeCode() {
    let c = "";
    for (let i = 0; i < 5; i++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return c;
  }

  // Keeps a connection alive and notices when the other side silently vanishes.
  function watch(conn, onMessage, onDead) {
    let last = Date.now();
    let dead = false;
    const die = () => {
      if (dead) return;
      dead = true;
      clearInterval(timer);
      try { conn.close(); } catch {}
      onDead();
    };
    const timer = setInterval(() => {
      if (Date.now() - last > DEAD_MS) return die();
      try { conn.send({ t: "ping" }); } catch {}
    }, PING_MS);
    conn.on("data", (msg) => {
      last = Date.now();
      if (msg && msg.t !== "ping") onMessage(msg);
    });
    conn.on("close", die);
    conn.on("error", die);
  }

  // Errors about one player's connection failing shouldn't take the host down.
  const isLinkError = (err) => ["webrtc", "negotiation-failed", "connection-closed", "peer-unavailable"].includes(err.type);

  function host(h) {
    const conns = new Map();
    let peer = null, code, closed = false;

    async function open() {
      const opts = await peerOptions();
      if (closed) return;
      code = makeCode();
      peer = new Peer(PREFIX + code, opts);
      peer.on("open", () => h.onOpen(code));
      peer.on("error", (err) => {
        if (err.type === "unavailable-id") { peer.destroy(); open(); return; }
        if (isLinkError(err)) { console.warn("[net] A player's connection failed:", err.type); return; }
        h.onError(friendlyError(err));
      });
      peer.on("disconnected", () => { if (!peer.destroyed) peer.reconnect(); });
      peer.on("connection", (conn) => {
        conn.on("open", () => {
          conns.set(conn.peer, conn);
          watch(conn, (msg) => h.onData(conn.peer, msg), () => {
            if (conns.get(conn.peer) === conn) conns.delete(conn.peer);
            h.onLeave(conn.peer);
          });
        });
      });
    }
    open();

    return {
      send(id, msg) { const c = conns.get(id); if (c && c.open) c.send(msg); },
      broadcast(msg) { for (const c of conns.values()) if (c.open) c.send(msg); },
      close() { closed = true; peer && peer.destroy(); },
    };
  }

  function join(code, h) {
    let peer = null, conn = null, opened = false, finished = false, closed = false;
    const room = code.toUpperCase();

    const fail = (msg) => {
      if (finished || opened) return;
      finished = true;
      clearTimeout(timeout);
      h.onError(msg);
      peer && peer.destroy();
    };
    const blockedMsg = () => relayCount
      ? "Couldn't connect to the host, even through the relay. Try switching between Wi-Fi and mobile data."
      : "Couldn't connect to the host. One of your networks blocks direct connections, and no relay server is set up yet.";
    const timeout = setTimeout(() => fail(blockedMsg()), JOIN_TIMEOUT_MS);

    (async () => {
      const opts = await peerOptions();
      if (closed) return;
      peer = new Peer(opts);
      peer.on("open", () => {
        conn = peer.connect(PREFIX + room, { reliable: true });
        conn.on("open", () => {
          if (finished) return;
          opened = true;
          clearTimeout(timeout);
          watch(conn, h.onData, () => h.onClose());
          h.onOpen();
        });
        // Spot a blocked connection as soon as the browser gives up, instead of waiting for the timeout.
        const watchIce = () => {
          const pc = conn.peerConnection;
          if (!pc) return setTimeout(watchIce, 200);
          pc.addEventListener("iceconnectionstatechange", () => {
            if (pc.iceConnectionState === "failed") fail(blockedMsg());
          });
        };
        watchIce();
      });
      peer.on("error", (err) => {
        if (err.type === "peer-unavailable") fail(`Room ${room} doesn't exist (or the host left).`);
        else if (err.type === "webrtc" || err.type === "negotiation-failed") fail(blockedMsg());
        else if (opened) console.warn("[net]", err.type);
        else fail(friendlyError(err));
      });
      peer.on("disconnected", () => { if (!peer.destroyed) peer.reconnect(); });
    })();

    return {
      send(msg) { if (conn && conn.open) conn.send(msg); },
      close() { closed = true; finished = true; clearTimeout(timeout); peer && peer.destroy(); },
    };
  }

  function friendlyError(err) {
    const map = {
      "browser-incompatible": "Your browser doesn't support WebRTC. Try Chrome, Firefox, Edge or Safari.",
      network: "Lost connection to the matchmaking server. Check your internet.",
      "server-error": "The matchmaking server is having trouble. Try again in a minute.",
      "socket-error": "Lost connection to the matchmaking server.",
    };
    return map[err.type] || `Connection problem (${err.type || err.message || "unknown"}).`;
  }

  // For checking the setup from the console: how many relay servers are configured and reachable.
  async function relayInfo() {
    const servers = await iceServers();
    return { relayServers: relayCount, iceServers: servers.map((s) => [].concat(s.urls).join(", ")) };
  }

  return { host, join, relayInfo };
})();
