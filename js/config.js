/*
  Network relay settings.

  Players connect browser-to-browser. Many networks (mobile carriers, some home
  routers, school/office Wi-Fi) block that, so a relay ("TURN") server passes the
  game data along instead. PeerJS's built-in relay no longer exists, so add your own:

  Option A — Metered (free, capped so it can never charge you):
    1. Sign up at https://www.metered.ca/stun-turn and create a TURN app.
    2. Copy the "credentials API" link. It looks like
       https://YOURAPP.metered.live/api/v1/turn/credentials?apiKey=XXXXXXXX
    3. Paste it below as meteredCredentialsUrl.

  Option B — any other TURN provider with fixed credentials:
    iceServers: [{ urls: "turn:example.com:3478", username: "user", credential: "pass" }]

  Note: this file is public on GitHub, so anyone could use your relay quota.
  On a free, hard-capped plan the worst case is the relay stops until next month.
*/

const NET_CONFIG = {
  meteredCredentialsUrl: "https://baller-knowledge.metered.live/api/v1/turn/credentials?apiKey=68362d51a8ff0357a7c5ea89e5b302e234b7",
  iceServers: [],
};
