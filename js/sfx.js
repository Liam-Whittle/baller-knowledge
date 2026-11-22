/*
  Sound effects, synthesised with the Web Audio API — soft marimba/bell tones,
  warm chords and muted thuds with a little reverb. No files to download.
  Kept to a small set: countdown, GO, correct (by tier), wrong, final-seconds
  clock, round results and the winner fanfare.
*/

const Sfx = (() => {
  const get = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  let enabled = get("bk-sfx", "1") === "1";
  let volume = Number(get("bk-sfx-vol", "60"));
  if (!Number.isFinite(volume)) volume = 60;

  let ctx = null, master = null, verb = null;

  function init() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = (volume / 100) * 0.8;
    master.connect(ctx.destination);
    // Small synthetic room so tones bloom instead of beeping.
    verb = ctx.createConvolver();
    verb.buffer = impulse(1.8, 3.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.28;
    verb.connect(wet).connect(master);
    return true;
  }

  function impulse(sec, decay) {
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  // Mallet/bell tone: a few sine partials, higher ones fading faster.
  function tone(freq, { t = 0, dur = 0.9, gain = 0.25, partials = [[1, 1], [2, 0.35], [3, 0.12]], attack = 0.004, wet = true, glideTo = null } = {}) {
    const start = ctx.currentTime + t;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, start);
    out.gain.exponentialRampToValueAtTime(gain, start + attack);
    out.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    out.connect(master);
    if (wet) out.connect(verb);
    for (const [mult, g] of partials) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(freq * mult, start);
      if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo * mult, start + dur * 0.6);
      const pg = ctx.createGain();
      pg.gain.setValueAtTime(g, start);
      pg.gain.exponentialRampToValueAtTime(0.0001, start + dur / Math.sqrt(mult));
      o.connect(pg).connect(out);
      o.start(start);
      o.stop(start + dur + 0.05);
    }
  }

  // Filtered noise burst (clicks, thumps, airy swooshes).
  function noise({ t = 0, dur = 0.08, gain = 0.15, freq = 2000, q = 1.2, type = "bandpass", sweepTo = null, wet = false } = {}) {
    const start = ctx.currentTime + t;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, start);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, start + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f).connect(g).connect(master);
    if (wet) g.connect(verb);
    src.start(start);
  }

  const MARIMBA = [[1, 1], [4, 0.22], [9.2, 0.05]];
  const BELL = [[1, 1], [2.0, 0.45], [3.01, 0.22], [4.2, 0.1], [5.4, 0.05]];

  const sounds = {
    // Countdown 3-2-1: soft woodblock knock.
    tick() {
      tone(740, { dur: 0.18, gain: 0.22, partials: [[1, 1], [2.76, 0.3]], wet: false });
      noise({ dur: 0.025, gain: 0.08, freq: 2400 });
    },
    // GO: warm major chord that blooms.
    go() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, { t: i * 0.025, dur: 1.4, gain: 0.12, partials: BELL }));
      noise({ dur: 0.35, gain: 0.05, freq: 600, sweepTo: 4000, wet: true });
    },
    // Last five seconds: a quiet clock tick.
    clock() {
      noise({ dur: 0.03, gain: 0.1, freq: 3200, q: 4 });
      tone(1600, { dur: 0.06, gain: 0.04, partials: [[1, 1]], wet: false });
    },
    // Not on the list: low muted thud, never a buzzer.
    wrong() {
      tone(196, { dur: 0.32, gain: 0.26, partials: [[1, 1], [2, 0.15]], glideTo: 140, wet: false });
      noise({ dur: 0.09, gain: 0.07, freq: 300, type: "lowpass" });
    },
    // Round results: two-note chime.
    reveal() {
      tone(783.99, { dur: 1.1, gain: 0.14, partials: BELL });
      tone(1174.66, { t: 0.13, dur: 1.4, gain: 0.12, partials: BELL });
    },
    // Winner: rising arpeggio into a held chord.
    win() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, { t: i * 0.11, dur: 0.9, gain: 0.13, partials: MARIMBA }));
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f) => tone(f, { t: 0.5, dur: 2.4, gain: 0.08, partials: BELL }));
      noise({ t: 0.45, dur: 0.6, gain: 0.04, freq: 1500, sweepTo: 8000, wet: true });
    },
  };

  // Correct answer: marimba note, brighter and fuller the rarer the tier.
  const CORRECT = [
    [659.25],                          // common
    [783.99],                          // uncommon
    [783.99, 1174.66],                 // rare
    [783.99, 987.77, 1318.5],          // elite baller
    [783.99, 987.77, 1174.66, 1567.98] // omniscient
  ];

  function correct(rank) {
    if (!ready()) return;
    const notes = CORRECT[Math.max(0, Math.min(4, rank))];
    notes.forEach((f, i) => tone(f, { t: i * 0.07, dur: 0.7 + rank * 0.15, gain: 0.2 - i * 0.02, partials: rank >= 3 ? BELL : MARIMBA }));
    if (rank >= 3) noise({ t: 0.05, dur: 0.5, gain: 0.035, freq: 5000, sweepTo: 9000, wet: true });
  }

  function ready() {
    if (!enabled || volume <= 0) return false;
    if (!init()) return false;
    if (ctx.state === "suspended") ctx.resume();
    return true;
  }

  function play(name) {
    if (ready() && sounds[name]) sounds[name]();
  }

  // Browsers only allow audio after the player interacts; call this on the first tap.
  function unlock() {
    if (!enabled) return;
    if (init() && ctx.state === "suspended") ctx.resume();
  }

  function setEnabled(v) { enabled = !!v; set("bk-sfx", enabled ? "1" : "0"); }
  function setVolume(v) {
    volume = Math.max(0, Math.min(100, Number(v) || 0));
    set("bk-sfx-vol", String(volume));
    if (master) master.gain.value = (volume / 100) * 0.8;
  }

  return { play, correct, unlock, setEnabled, setVolume, get enabled() { return enabled; }, get volume() { return volume; } };
})();
