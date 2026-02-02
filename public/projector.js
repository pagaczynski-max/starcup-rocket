const socket = io();

const params = new URLSearchParams(location.search);
const room = (params.get("room") || "").toUpperCase();

const c = document.getElementById("c");
const ctx = c.getContext("2d");
ctx.imageSmoothingEnabled = false;

const overlay = document.getElementById("overlay");

socket.emit("projector:join", { room });

// Canvas coords
const W = 640, H = 720;

// Must match server
const CONTROL_H = 160;
const BOUNDARY_Y = H - CONTROL_H;

const HIT_W = 26;
const HIT_H = 42;
const PLAYER_Y = BOUNDARY_Y - HIT_H;

const ROCKET_DRAW_W = 40;
const ROCKET_DRAW_H = 60;

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

// Assets
const images = {};
function loadImage(name, src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { images[name] = img; resolve(img); };
    img.onerror = () => reject(new Error(`Image load failed: ${src}`));
    img.src = src;
  });
}

Promise.all([
  loadImage("rocket", "/assets/rocket.png"),
  loadImage("asteroid", "/assets/asteroid.png"),
  loadImage("ufo", "/assets/ufo.png"),
  loadImage("satellite", "/assets/satellite.png"),
]).catch((e) => {
  overlay.textContent = e?.message || String(e);
});

// State
let lastState = null;
let explosions = [];
let shakeT = 0;
let flashT = 0;

socket.on("ok", () => { overlay.textContent = `ROOM ${room}`; });
socket.on("err", (m) => { overlay.textContent = m; });
socket.on("state", (s) => { lastState = s; });

socket.on("event:death", (e) => {
  if (String(e.room || "").toUpperCase() !== room) return;
  explosions.push({ x: e.x, y: e.y, t: 0 });
  shakeT = 10;
  flashT = 8;
});

// Stars
const stars = [];
for (let i = 0; i < 220; i++) {
  stars.push({
    x: Math.floor(Math.random() * W),
    y: Math.floor(Math.random() * BOUNDARY_Y),
    sp: 1.0 + Math.random() * 3.6,
    s: Math.random() < 0.75 ? 2 : 3,
    hue: Math.random() < 0.33 ? 190 : (Math.random() < 0.5 ? 285 : 320),
  });
}

function drawStars(worldSpeed) {
  ctx.fillStyle = "#050318";
  ctx.fillRect(0, 0, W, BOUNDARY_Y);

  const extra = Math.min(9, worldSpeed * 0.35);
  for (const st of stars) {
    st.y += st.sp + extra;
    if (st.y > BOUNDARY_Y) {
      st.y = -10;
      st.x = Math.floor(Math.random() * W);
    }
    ctx.fillStyle = `hsla(${st.hue},100%,70%,0.32)`;
    ctx.fillRect(st.x, st.y, st.s, st.s);
  }
}

function drawObstacle(o) {
  if (o.y >= BOUNDARY_Y + 6) return;

  let img = null;
  if (o.type === "asteroid") img = images.asteroid;
  else if (o.type === "ufo") img = images.ufo;
  else if (o.type === "satellite") img = images.satellite;

  if (!img) {
    ctx.fillStyle = "rgba(245,245,255,0.70)";
    ctx.fillRect(o.x, o.y, o.w, o.h);
    return;
  }
  ctx.drawImage(img, o.x, o.y, o.w, o.h);
}

function drawRocket(xCenter, yTop, color, alive) {
  const img = images.rocket;
  if (!img) return;

  // subtle tint for player identity
  ctx.save();
  ctx.globalAlpha = alive ? 0.22 : 0.08;
  ctx.fillStyle = color || "rgba(255,255,255,.2)";
  ctx.fillRect(xCenter - ROCKET_DRAW_W / 2, yTop, ROCKET_DRAW_W, ROCKET_DRAW_H);
  ctx.restore();

  ctx.globalAlpha = alive ? 1.0 : 0.35;
  ctx.drawImage(img, xCenter - ROCKET_DRAW_W / 2, yTop, ROCKET_DRAW_W, ROCKET_DRAW_H);
  ctx.globalAlpha = 1.0;
}

function drawExplosion(ex) {
  ex.t += 1;
  const r = Math.min(48, ex.t * 3);

  ctx.fillStyle = "rgba(255,79,216,0.78)";
  for (let i = 0; i < 18; i++) {
    const ang = (i / 18) * Math.PI * 2;
    ctx.fillRect(ex.x + Math.cos(ang) * r, ex.y + Math.sin(ang) * r, 4, 4);
  }
  ctx.fillStyle = "rgba(56,232,255,0.70)";
  ctx.fillRect(ex.x - 6, ex.y - 6, 12, 12);
}

function drawControlZone() {
  // black opaque bottom
  ctx.fillStyle = "#000";
  ctx.fillRect(0, BOUNDARY_Y, W, CONTROL_H);

  // boundary line
  ctx.fillStyle = "rgba(245,245,255,0.16)";
  ctx.fillRect(0, BOUNDARY_Y, W, 2);
}

function drawHUD(players, worldSpeed) {
  // top-left
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(245,245,255,0.95)";
  ctx.font = "18px system-ui";

  const st = String(lastState?.state || "").toUpperCase();
  const spd = Math.round((worldSpeed || 0) * 10) / 10;
  ctx.fillText(`ROOM ${room} — ${st} — SPEED ${spd}`, 14, 28);

  // leaderboard
  const top = players.slice(0, 8);
  ctx.font = "14px system-ui";
  let yy = 52;
  for (let i = 0; i < top.length; i++) {
    const p = top[i];
    ctx.fillStyle = p.color;
    ctx.fillText(`${i + 1}. ${p.pseudo} — ${p.score}`, 14, yy);
    yy += 18;
  }

  if (lastState?.state === "ended") {
    const winner = players.find(p => p.id === lastState.winnerId);
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(245,245,255,0.95)";
    ctx.font = "42px system-ui";
    ctx.fillText(winner ? `${winner.pseudo} GAGNE !` : "FIN", W / 2, H / 2);
  }
}

function loop() {
  let dx = 0, dy = 0;
  if (shakeT > 0) {
    shakeT--;
    dx = (Math.random() * 10 - 5);
    dy = (Math.random() * 10 - 5);
  }

  ctx.save();
  ctx.translate(dx, dy);

  const worldSpeed = Number(lastState?.worldSpeed || 0);
  drawStars(worldSpeed);

  if (lastState) {
    for (const o of (lastState.obstacles || [])) drawObstacle(o);

    const players = (lastState.players || []).slice();
    players.sort((a, b) => (b.score || 0) - (a.score || 0));

    for (const p of players) {
      const px = clamp(p.x, 0, 1) * (W - HIT_W);
      const py = PLAYER_Y;

      const xCenter = px + HIT_W / 2;
      const yTop = (BOUNDARY_Y - ROCKET_DRAW_H + 6);

      drawRocket(xCenter, yTop, p.color, !!p.alive);

      // name
      ctx.textAlign = "center";
      ctx.font = "14px system-ui";
      ctx.fillStyle = p.alive ? "rgba(245,245,255,0.95)" : "rgba(245,245,255,0.35)";
      ctx.fillText(p.pseudo, xCenter, py - 10);

      // cheers
      const cheers = p.cheers || 0;
      if (cheers > 0) {
        ctx.font = "12px system-ui";
        ctx.fillStyle = "rgba(245,245,255,0.95)";
        ctx.fillText(`👏 ${cheers}`, xCenter, py - 26);
      }
    }

    drawHUD(players, worldSpeed);
  }

  explosions.forEach(drawExplosion);
  explosions = explosions.filter(e => e.t < 16);

  drawControlZone();

  ctx.restore();

  if (flashT > 0) {
    flashT--;
    ctx.fillStyle = "rgba(255,79,216,0.10)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(56,232,255,0.08)";
    ctx.fillRect(0, 0, W, H);
  }

  requestAnimationFrame(loop);
}

loop();
