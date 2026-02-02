const socket = io();

const params = new URLSearchParams(location.search);
const room = (params.get("room") || "").toUpperCase();

const c = document.getElementById("c");
const ctx = c.getContext("2d");
const overlay = document.getElementById("overlay");
ctx.imageSmoothingEnabled = false;

socket.emit("projector:join", { room });

// --- Constants (must match server) ---
const W = 640, H = 720;
const PLAYER_Y = 600;

const HIT_W = 26;
const HIT_H = 42;

const ROCKET_DRAW_W = 40;
const ROCKET_DRAW_H = 60;

let lastState = null;
let explosions = [];
let shakeT = 0;
let flashT = 0;

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

// --- Assets ---
const images = {};
function loadImage(name, src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { images[name] = img; resolve(img); };
    img.onerror = () => reject(new Error(`Image load failed: ${src}`));
    img.src = src;
  });
}
let assetsReady = false;
Promise.all([
  loadImage("rocket", "/assets/rocket.png"),
  loadImage("asteroid", "/assets/asteroid.png"),
  loadImage("ufo", "/assets/ufo.png"),
  loadImage("satellite", "/assets/satellite.png"),
]).then(() => { assetsReady = true; })
  .catch((e) => { overlay.textContent = e?.message || String(e); });

// --- Socket ---
socket.on("state", (s) => { lastState = s; });
socket.on("ok", () => { overlay.textContent = `ROOM ${room}`; });
socket.on("err", (m) => { overlay.textContent = m; });

socket.on("event:death", (e) => {
  if (String(e.room || "").toUpperCase() !== room) return;
  explosions.push({ x: e.x, y: e.y, t: 0 });
  shakeT = 8;
  flashT = 6;
});

// --- Background stars ---
const stars = [];
for (let i = 0; i < 200; i++) {
  stars.push({
    x: Math.floor(Math.random() * W),
    y: Math.floor(Math.random() * H),
    sp: 1.0 + Math.random() * 3.4,
    s: Math.random() < 0.75 ? 2 : 3,
    hue: Math.random() < 0.33 ? 190 : (Math.random() < 0.5 ? 285 : 320)
  });
}
function drawStars(worldSpeed) {
  ctx.fillStyle = "#050318";
  ctx.fillRect(0, 0, W, H);
  for (const st of stars) {
    st.y += st.sp + Math.min(7, worldSpeed * 0.28);
    if (st.y > H) { st.y = -10; st.x = Math.floor(Math.random() * W); }
    ctx.fillStyle = `hsla(${st.hue},100%,70%,0.32)`;
    ctx.fillRect(st.x, st.y, st.s, st.s);
  }
}

// --- Kenney draw helpers ---
function drawRocketColored(xCenter, yTop, color, alive) {
  const img = images.rocket;
  if (!img) return;

  // Light tint overlay (very subtle)
  ctx.save();
  ctx.globalAlpha = alive ? 0.22 : 0.08;
  ctx.fillStyle = color || "rgba(255,255,255,0.3)";
  ctx.fillRect(xCenter - ROCKET_DRAW_W / 2, yTop, ROCKET_DRAW_W, ROCKET_DRAW_H);
  ctx.restore();

  // actual ship
  ctx.globalAlpha = alive ? 1 : 0.35;
  ctx.drawImage(img, xCenter - ROCKET_DRAW_W / 2, yTop, ROCKET_DRAW_W, ROCKET_DRAW_H);
  ctx.globalAlpha = 1;
}

function drawObstacle(o) {
  let img = null;
  if (o.type === "asteroid") img = images.asteroid;
  else if (o.type === "ufo") img = images.ufo;
  else if (o.type === "satellite") img = images.satellite;

  if (!img) {
    ctx.fillStyle = "rgba(245,245,255,0.7)";
    ctx.fillRect(o.x, o.y, o.w, o.h);
    return;
  }
  ctx.drawImage(img, o.x, o.y, o.w, o.h);
}

function drawExplosion(ex) {
  ex.t += 1;
  const r = Math.min(44, ex.t * 3);

  ctx.fillStyle = "rgba(255,79,216,0.75)";
  for (let i = 0; i < 18; i++) {
    const ang = (i / 18) * Math.PI * 2;
    ctx.fillRect(ex.x + Math.cos(ang) * r, ex.y + Math.sin(ang) * r, 4, 4);
  }
  ctx.fillStyle = "rgba(56,232,255,0.70)";
  ctx.fillRect(ex.x - 6, ex.y - 6, 12, 12);
}

// --- Main loop ---
function draw() {
  let dx = 0, dy = 0;
  if (shakeT > 0) { shakeT--; dx = (Math.random() * 10 - 5); dy = (Math.random() * 10 - 5); }

  ctx.save();
  ctx.translate(dx, dy);

  const worldSpeed = Number(lastState?.worldSpeed || 0);
  drawStars(worldSpeed);

  if (lastState) {
    for (const o of lastState.obstacles || []) drawObstacle(o);

    const players = (lastState.players || []).slice();
    players.sort((a, b) => (b.score || 0) - (a.score || 0));

    for (const p of players) {
      const px = clamp(p.x, 0, 1) * (W - HIT_W);
      const py = PLAYER_Y;

      const xCenter = px + HIT_W / 2;
      const yTop = py - (ROCKET_DRAW_H - HIT_H) / 2;

      drawRocketColored(xCenter, yTop, p.color, !!p.alive);

      ctx.fillStyle = p.alive ? "rgba(245,245,255,0.95)" : "rgba(245,245,255,0.35)";
      ctx.font = "14px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(p.pseudo, xCenter, py - 10);

      const cheers = p.cheers || 0;
      if (cheers > 0) {
        ctx.fillStyle = "rgba(245,245,255,0.95)";
        ctx.font = "12px system-ui";
        ctx.fillText(`👏 ${cheers}`, xCenter, py - 26);
      }
    }

    // HUD
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(245,245,255,0.95)";
    ctx.font = "18px system-ui";
    const spd = Math.round(worldSpeed * 10) / 10;
    ctx.fillText(`ROOM ${room} — ${String(lastState.state).toUpperCase()} — SPEED ${spd}`, 14, 28);

    // Leaderboard small
    ctx.font = "14px system-ui";
    const top = players.slice(0, 8);
    let yy = 52;
    for (let i = 0; i < top.length; i++) {
      const p = top[i];
      ctx.fillStyle = p.color;
      ctx.fillText(`${i + 1}. ${p.pseudo} — ${p.score}`, 14, yy);
      yy += 18;
    }

    if (lastState.state === "ended") {
      const winner = players.find(p => p.id === lastState.winnerId);
      ctx.textAlign = "center";
      ctx.font = "42px system-ui";
      ctx.fillStyle = "rgba(245,245,255,0.95)";
      ctx.fillText(winner ? `${winner.pseudo} GAGNE !` : "FIN", W / 2, H / 2);
    }
  }

  explosions.forEach(drawExplosion);
  explosions = explosions.filter(e => e.t < 16);

  ctx.restore();

  if (flashT > 0) {
    flashT--;
    ctx.fillStyle = "rgba(255,79,216,0.10)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(56,232,255,0.08)";
    ctx.fillRect(0, 0, W, H);
  }

  requestAnimationFrame(draw);
}
draw();
