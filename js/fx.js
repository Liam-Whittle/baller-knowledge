/* Visual effects: particle bursts, confetti, floating text, banners, count-ups, ambient sparkles. */

const Fx = (() => {
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canvas = document.getElementById("fx");
  const ctx = canvas.getContext("2d");
  let particles = [];
  let running = false;
  let dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  addEventListener("resize", resize);

  function loop() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    particles = particles.filter((p) => p.life > 0);
    for (const p of particles) {
      p.vy += p.gravity;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life -= 1;
      const a = Math.min(1, p.life / 25);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === "star") {
        star(p.size);
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10;
        ctx.fill();
      } else if (p.shape === "rect") {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    if (particles.length) requestAnimationFrame(loop);
    else running = false;
  }

  function star(r) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const rad = i % 2 ? r * 0.38 : r;
      const ang = (i * Math.PI) / 4;
      ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
    }
    ctx.closePath();
  }

  function add(list) {
    particles.push(...list);
    if (!running) { running = true; requestAnimationFrame(loop); }
  }

  // Sparkle burst from a point, in the tier's colour.
  function burst(x, y, color, count = 18, power = 6) {
    if (reduced) return;
    const colors = [color, color, "#fff4c2", "#ffd23f"];
    add(Array.from({ length: count }, () => {
      const ang = Math.random() * Math.PI * 2;
      const sp = power * (0.4 + Math.random());
      return {
        x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 1.5,
        gravity: 0.12, drag: 0.96, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
        size: 5 + Math.random() * 7, life: 45 + Math.random() * 30,
        color: colors[Math.floor(Math.random() * colors.length)],
        shape: Math.random() < 0.55 ? "star" : "dot",
      };
    }));
  }

  // Gold and purple confetti raining from the top (and two side cannons).
  function confetti(ms = 3500) {
    if (reduced) return;
    const colors = ["#ffd23f", "#f5a20c", "#8f3dff", "#b45cff", "#ffffff", "#ff7ad9"];
    const end = Date.now() + ms;
    const cannon = (fromLeft) => add(Array.from({ length: 60 }, () => {
      const ang = fromLeft ? -Math.PI / 3 - Math.random() * 0.5 : -Math.PI * 2 / 3 + Math.random() * 0.5;
      const sp = 9 + Math.random() * 9;
      return {
        x: fromLeft ? 0 : innerWidth, y: innerHeight * 0.85,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        gravity: 0.18, drag: 0.985, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
        size: 8 + Math.random() * 8, life: 150 + Math.random() * 60,
        color: colors[Math.floor(Math.random() * colors.length)], shape: "rect",
      };
    }));
    cannon(true);
    cannon(false);
    (function rain() {
      add(Array.from({ length: 6 }, () => ({
        x: Math.random() * innerWidth, y: -20,
        vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3,
        gravity: 0.05, drag: 0.995, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
        size: 7 + Math.random() * 7, life: 220,
        color: colors[Math.floor(Math.random() * colors.length)], shape: Math.random() < 0.8 ? "rect" : "star",
      })));
      if (Date.now() < end) setTimeout(rain, 60);
    })();
  }

  // "+50" floating up from a point.
  function floatText(x, y, text, color) {
    const el = document.createElement("div");
    el.className = "float-text";
    el.textContent = text;
    el.style.cssText = `left:${x}px;top:${y}px;--c:${color}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  // Big sweeping banner for rare finds.
  function banner(text, color, sub = "") {
    document.querySelectorAll(".fx-banner").forEach((b) => b.remove());
    const el = document.createElement("div");
    el.className = "fx-banner";
    el.style.setProperty("--c", color);
    el.innerHTML = `<div class="fx-banner-text">${text}</div>${sub ? `<div class="fx-banner-sub">${sub}</div>` : ""}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1700);
  }

  function countUp(el, to, ms = 900, prefix = "") {
    if (reduced || !to) { el.textContent = prefix + to; return; }
    const start = performance.now();
    (function step(t) {
      const k = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = prefix + Math.round(to * eased);
      if (k < 1) requestAnimationFrame(step);
    })(start);
  }

  function shake(el) {
    if (!el) return;
    el.classList.remove("fx-shake");
    void el.offsetWidth;
    el.classList.add("fx-shake");
  }

  // Slow twinkling specks behind everything.
  function ambient() {
    const box = document.getElementById("sparkles");
    if (!box || reduced) return;
    box.innerHTML = Array.from({ length: 28 }, () => {
      const s = 2 + Math.random() * 3;
      return `<i style="left:${Math.random() * 100}%;top:${Math.random() * 100}%;width:${s}px;height:${s}px;animation-delay:${(Math.random() * 6).toFixed(2)}s;animation-duration:${(4 + Math.random() * 5).toFixed(2)}s"></i>`;
    }).join("");
  }
  ambient();

  return { burst, confetti, floatText, banner, countUp, shake, reduced };
})();
