/*
  Networking over PeerJS (WebRTC). No server of our own: the host's browser
  runs the game, and PeerJS's free public broker just introduces the peers.
*/

const Net = (() => {
  const PREFIX = "baller-knowledge-v1-";
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const PING_MS = 2500;
  const DEAD_MS = 9000;

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

  function host(h) {
    const conns = new Map();
    let peer, code;

    function open() {
      code = makeCode();
      peer = new Peer(PREFIX + code);
      peer.on("open", () => h.onOpen(code));
      peer.on("error", (err) => {
        if (err.type === "unavailable-id") { peer.destroy(); open(); return; }
        if (err.type === "peer-unavailable") return; // a player left mid-handshake
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
      close() { peer && peer.destroy(); },
    };
  }

  function join(code, h) {
    const peer = new Peer();
    let conn, opened = false;
    const timeout = setTimeout(() => {
      if (!opened) { h.onError("Couldn't reach that room. Check the code and try again."); peer.destroy(); }
    }, 15000);

    peer.on("open", () => {
      conn = peer.connect(PREFIX + code.toUpperCase(), { reliable: true });
      conn.on("open", () => {
        opened = true;
        clearTimeout(timeout);
        watch(conn, h.onData, () => h.onClose());
        h.onOpen();
      });
    });
    peer.on("error", (err) => {
      clearTimeout(timeout);
      if (err.type === "peer-unavailable") h.onError(`Room ${code.toUpperCase()} doesn't exist (or the host left).`);
      else h.onError(friendlyError(err));
    });
    peer.on("disconnected", () => { if (!peer.destroyed) peer.reconnect(); });

    return {
      send(msg) { if (conn && conn.open) conn.send(msg); },
      close() { peer.destroy(); },
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

  return { host, join };
})();
