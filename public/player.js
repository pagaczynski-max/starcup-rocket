const socket = io({ transports: ["websocket", "polling"] });

const params = new URLSearchParams(location.search);
const room = (params.get("room") || "").toUpperCase();

// DOM
const joinWrap = document.getElementById("joinWrap");
const roomLabel = document.getElementById("roomLabel");
const pseudoInput = document.getElementById("pseudo");
const joinBtn = document.getElementById("join");
const errDiv = document.getElementById("err");

const screenGame = document.getElementById("screenGame");
const statusDiv = document.getElementById("status");
const scoreDiv = document.getElementById("score");
const centerMsg = document.getElementById("centerMsg");

const controlZone = document.getElementById("controlZone");
const thumb = document.getElementById("thumb");

const spectatorPanel = document.getElementById("spectatorPanel");
const spectatorList = document.getElementById("spectatorList");

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

// Canvas logical size
const W = 640, H = 720;

// Must match server
const CONTROL_H = 160;
const BOUNDARY_Y = H - CONTROL_H;

const HIT_W = 26;
const HIT_H = 42;

// The hitbox sits on the boundary
const PLAYER_Y = BOUNDARY_Y - HIT_H;

// Visual sprite size
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

let assetsReady = false;
Promise.all([
  loadImage("rocket", "/assets/rocket.png"),
  loadImage("asteroid", "/assets/asteroid.png"),
  loadImage("ufo", "/assets/ufo.png"),
  loadImage("satellite", "/assets/satellite.png"),
]).then(() => { assetsReady = true; })
  .catch((e) => { errDiv.textContent = e?.message || String(e); });

// State
let playerId = null;
let gameState = "lobby";
let meAlive = true;
let meScore = 0;
let meX01 = 0.5;

let lastGlobalPlayers = [];
let lastObstacles = [];
let lastWorldSpeed = 0;

let shakeT = 0;
let flashT = 0;
let explosions = [];

// UI
roomLabel.innerHTML = `<b>Room :</b> ${room || "(manquante)"}`;
if (!room) errDiv.textContent = "Room manquante dans l’URL.";

function showJoin(msg) {
  joinWrap.classList.remove("hidden");
  screenGame.classList.add("hidden");
  errDiv.textContent = msg || "";
  joinBtn.disabled = false;
  joinBtn.textContent = "OK";
}

function showGameUI() {
  joinWrap.classList.add("hidden");
  screenGame.classList.remove("hidden");
}

function setThumbAlignedToShip(x01) {
  if (!thumb || !controlZone) return;
  const tzW = controlZone.clientWidth || 1;
  thumb.style.left = `${clamp(x01, 0, 1) * tzW}px`;
}

function renderSpectator(players) {
  if (!spectatorList) return;
  const alive = players.filter(p => p.alive);
  spectatorList.innerHTML = "";
  if (!alive.length) { spectatorList.textContent = "(plus de survivants)"; return; }

  alive.sort((a, b) => (b.score || 0) - (a.score || 0));
  for (const p of alive.slice(0, 10)) {
    const row = document.createElement("div");
    row.className = "sRow";

    const left = document.createElement("div");
    left.textContent = `${p.pseudo} — ${p.score}`;
    left.style.color = p.color;

    const btn = document.createElement("button");
    btn.textContent = "👏";
    btn.onclick = () => socket.emit("player:cheer", { room, targetPlayerId: p.id });

    row.appendChild(left);
    row.appendChild(btn);
    spectatorList.appendChild(row);
  }
}

showJoin("");

// Join
joinBtn.addEventListener("click", (e) => {
  e.preventDefault();
  errDiv.textContent = "";

  if (!assetsReady) { errDiv.textContent = "Assets non chargés (/assets/...)."; return; }
  const pseudo = pseudoInput.value.trim();
  if (!pseudo) { errDiv.textContent = "Pseudo requis."; return; }
  if (!room) { errDiv.textContent = "Room manquante."; return; }

  joinBtn.disabled = true;
  joinBtn.textContent = "Connexion…";
  socket.emit("player:join", { room, pseudo });

  setTimeout(() => {
    if (!playerId && joinBtn.disabled) {
      joinBtn.disabled = false;
      joinBtn.textContent = "OK";
      if (!errDiv.textContent) errDiv.textContent = "Pas de réponse serveur (room ?).";
    }
  }, 1500);
});

pseudoInput.addEventListener("keydown", (e) => { if (e.key === "Enter") joinBtn.click(); });

socket.on("connect_error", (err) => showJoin("Socket error: " + (err?.message || String(err))));
socket.on("err", (msg) => showJoin(msg));

socket.on("ok", (data) => {
  playerId = data.playerId || null;
  showGameUI();

  gameState = "lobby";
  meAlive = true;
  meScore = 0;
  meX01 = 0.5;

  statusDiv.textContent = "Lobby";
  scoreDiv.textContent = "";
  centerMsg.textContent = "Prêt ! Attends que l’animateur lance la manche.";
  spectatorPanel?.classList.add("hidden");

  setThumbAlignedToShip(meX01);
});

socket.on("game:started", () => {
  gameState = "running";
  meAlive = true;
  meScore = 0;
  centerMsg.textContent = "GO !";
  spectatorPanel?.classList.add("hidden");
  setTimeout(() => { if (gameState === "running") centerMsg.textContent = ""; }, 700);
});

socket.on("myState", (s) => {
  if (String(s.room || "").toUpperCase() !== room) return;
  gameState = s.state;

  if (s.me) {
    meAlive = !!s.me.alive;
    meScore = Number(s.me.score || 0);
    meX01 = Number(s.me.x ?? 0.5);
  }

  if (gameState === "lobby") {
    statusDiv.textContent = "Lobby";
    scoreDiv.textContent = "";
    centerMsg.textContent = "Maintiens ton pouce en bas, glisse ← → pour éviter les obstacles.";
    spectatorPanel?.classList.add("hidden");
  } else if (gameState === "running") {
    scoreDiv.textContent = `Score: ${meScore}`;
    if (meAlive) {
      statusDiv.textContent = "En jeu";
      centerMsg.textContent = "";
      spectatorPanel?.classList.add("hidden");
    } else {
      statusDiv.textContent = "KO";
      centerMsg.textContent = "💀 Tu es mort — regarde le projecteur et soutiens les survivants !";
      spectatorPanel?.classList.remove("hidden");
      renderSpectator(lastGlobalPlayers);
    }
  } else if (gameState === "ended") {
    statusDiv.textContent = "Fin";
    scoreDiv.textContent = `Score: ${meScore}`;
    centerMsg.textContent = "🏁 Manche terminée — regarde le gagnant sur le projecteur !";
    spectatorPanel?.classList.add("hidden");
  }

  setThumbAlignedToShip(meX01);
});

socket.on("state", (s) => {
  if (String(s.room || "").toUpperCase() !== room) return;
  lastGlobalPlayers = s.players || [];
  lastObstacles = s.obstacles || [];
  lastWorldSpeed = Number(s.worldSpeed || 0);
  if (gameState === "running" && !meAlive) renderSpectator(lastGlobalPlayers);
});

socket.on("event:death", (e) => {
  if (String(e.room || "").toUpperCase() !== room) return;
  explosions.push({ x: e.x, y: e.y, t: 0 });
  if (playerId && e.playerId === playerId) { shakeT = 14; flashT = 12; }
});

// ✅ Anti-latence: throttle input (max 25/s)
let lastEmitAt = 0;
const EMIT_EVERY_MS = 40;

function emitX(x01) {
  if (gameState !== "running") return;
  if (!meAlive) return;

  const now = performance.now();
  if (now - lastEmitAt < EMIT_EVERY_MS) return;
  lastEmitAt = now;

  socket.emit("player:input", { room, x: x01 });
}

let activePointerId = null;

function pointerToX01(ev) {
  const rect = controlZone.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  return clamp(x / Math.max(1, rect.width), 0, 1);
}

controlZone?.addEventListener("pointerdown", (ev) => {
  activePointerId = ev.pointerId;
  controlZone.setPointerCapture(activePointerId);
  const x01 = pointerToX01(ev);
  meX01 = x01;
  setThumbAlignedToShip(x01);
  emitX(x01);
});

controlZone?.addEventListener("pointermove", (ev) => {
  if (ev.pointerId !== activePointerId) return;
  const x01 = pointerToX01(ev);
  meX01 = x01;
  setThumbAlignedToShip(x01);
  emitX(x01);
});

controlZone?.addEventListener("pointerup", (ev) => {
  if (ev.pointerId === activePointerId) activePointerId = null;
});
controlZone?.addEventListener("pointercancel", () => (activePointerId = null));

// PC test
window.addEventListener("mousemove", (ev) => {
  if (gameState !== "running") return;
  if (!meAlive) return;
  const x01 = clamp(ev.clientX / Math.max(1, window.innerWidth), 0, 1);
  meX01 = x01;
  setThumbAlignedToShip(x01);
  emitX(x01);
});

// Render
const stars = [];
for (let i = 0; i < 170; i++) {
  stars.push({
    x: Math.floor(Math.random() * W),
    y: Math.floor(Math.random() * (BOUNDARY_Y)),
    sp: 1.0 + Math.random() * 3.0,
    s: Math.random() < 0.75 ? 2 : 3,
    hue: Math.random() < 0.33 ? 190 : (Math.random() < 0.5 ? 285 : 320),
  });
}

function drawStars() {
  ctx.fillStyle = "#050318";
  ctx.fillRect(0, 0, W, BOUNDARY_Y);

  const extra = Math.min(9, lastWorldSpeed * 0.35);
  for (const st of stars) {
    st.y += st.sp + extra;
    if (st.y > BOUNDARY_Y) { st.y = -10; st.x = Math.floor(Math.random() * W); }
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

function drawRocketVisual(xCenter) {
  const img = images.rocket;
  if (!img) return;

  // ✅ fusée entièrement visible et légèrement au-dessus de la ligne
  const yTop = (BOUNDARY_Y - ROCKET_DRAW_H - 8);

  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = "rgba(56,232,255,1)";
  ctx.fillRect(xCenter - ROCKET_DRAW_W/2 - 10, yTop - 10, ROCKET_DRAW_W + 20, ROCKET_DRAW_H + 20);
  ctx.restore();

  ctx.drawImage(img, xCenter - ROCKET_DRAW_W / 2, yTop, ROCKET_DRAW_W, ROCKET_DRAW_H);
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

function drawControlZoneOverlay() {
  // black bottom area (only below boundary)
  ctx.fillStyle = "#000";
  ctx.fillRect(0, BOUNDARY_Y, W, CONTROL_H);

  ctx.fillStyle = "rgba(245,245,255,0.15)";
  ctx.fillRect(0, BOUNDARY_Y, W, 2);
}

function render() {
  let dx = 0, dy = 0;
  if (shakeT > 0) { shakeT--; dx = (Math.random() * 10 - 5); dy = (Math.random() * 10 - 5); }

  ctx.save();
  ctx.translate(dx, dy);

  drawStars();

  for (const o of lastObstacles) drawObstacle(o);

  if (gameState === "running" && meAlive) {
    const px = clamp(meX01, 0, 1) * (W - HIT_W);
    const xCenter = px + HIT_W / 2;
    drawRocketVisual(xCenter);
  }

  explosions.forEach(drawExplosion);
  explosions = explosions.filter(e => e.t < 16);

  // draw control zone last (does NOT cover rocket now because rocket is above)
  drawControlZoneOverlay();

  ctx.restore();

  if (flashT > 0) {
    flashT--;
    ctx.fillStyle = "rgba(255,79,216,0.10)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(56,232,255,0.08)";
    ctx.fillRect(0, 0, W, H);
  }

  requestAnimationFrame(render);
}
render();

setThumbAlignedToShip(0.5);
