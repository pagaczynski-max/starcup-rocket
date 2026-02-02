const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const QRCode = require("qrcode");
const { nanoid } = require("nanoid");

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // aide un peu sur mobile (moins de fallback polling)
  transports: ["websocket", "polling"],
});

app.use(express.static("public"));

// Routes
app.get("/", (req, res) => res.redirect("/host"));
app.get("/host", (req, res) => res.redirect("/host.html"));

app.get("/projector", (req, res) => {
  const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  res.redirect("/projector.html" + qs);
});

app.get("/player", (req, res) => {
  const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  res.redirect("/player.html" + qs);
});

const rooms = {};

function makeRoomCode() {
  return nanoid(6).toUpperCase();
}

function randomColor() {
  const palette = ["#38E8FF", "#FF4FD8", "#9B5CFF", "#4DFFB5", "#FFD24D", "#4DA3FF", "#FFFFFF"];
  return palette[Math.floor(Math.random() * palette.length)];
}

function baseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

// API create room + QR
app.get("/api/create-room", async (req, res) => {
  const room = makeRoomCode();
  rooms[room] = {
    createdAt: Date.now(),
    state: "lobby", // lobby | running | ended
    startedAt: null,
    endedAt: null,
    winnerId: null,
    startedPlayerCount: 0,
    seed: Math.floor(Math.random() * 1e9),
    worldSpeed: 0,
    nextSpawnAt: 0,
    playersBySid: {},
    cheersByPlayerId: {},
    obstacles: [],
  };

  const joinUrl = `${baseUrl(req)}/join/${room}`;
  const qrDataUrl = await QRCode.toDataURL(joinUrl);
  res.json({ room, joinUrl, qrDataUrl });
});

app.get("/join/:room", (req, res) => {
  const room = String(req.params.room || "").toUpperCase();
  res.redirect(`/player.html?room=${encodeURIComponent(room)}`);
});

// --- Game constants (must match player/projector canvas logic) ---
const TICK_MS = 50;
const W = 640;
const H = 720;

const CONTROL_H = 160;
const BOUNDARY_Y = H - CONTROL_H;

const PLAYER_W = 26;
const PLAYER_H = 42;
const PLAYER_Y = BOUNDARY_Y - PLAYER_H;

// Difficulty (accélère bien + spawn plus dense)
const START_SPEED = 5.0;
const SPEED_LINEAR = 0.30;
const SPEED_MAX = 28.0;

const SPAWN_START = 820; // ms
const SPAWN_MIN = 220;
const SPAWN_DECAY = 15.0;

const MAX_OBS_ON_SCREEN = 10;

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function bboxCollide(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// 3 types maximum, lisibles
function obstacleSpec(type) {
  if (type === "asteroid") return { w: 52, h: 52 };
  if (type === "ufo") return { w: 64, h: 36 };
  if (type === "satellite") return { w: 78, h: 28 };
  return { w: 52, h: 52 };
}

function pickObstacleType() {
  const r = Math.random();
  if (r < 0.55) return "asteroid";
  if (r < 0.78) return "satellite";
  return "ufo";
}

function spawnObstacle(R, worldSpeed) {
  const type = pickObstacleType();
  const spec = obstacleSpec(type);

  const x = Math.floor(Math.random() * (W - spec.w));
  const y = -spec.h - 6;

  const vy = worldSpeed * (0.95 + Math.random() * 0.12);

  R.obstacles.push({
    id: nanoid(8),
    type,
    x,
    y,
    w: spec.w,
    h: spec.h,
    vy,
  });
}

// --- Game loop ---
setInterval(() => {
  const now = Date.now();

  for (const room of Object.keys(rooms)) {
    const R = rooms[room];
    if (R.state !== "running") continue;

    const players = Object.values(R.playersBySid);
    const elapsedSec = (now - R.startedAt) / 1000;

    const worldSpeed = Math.min(SPEED_MAX, START_SPEED + SPEED_LINEAR * elapsedSec);
    R.worldSpeed = worldSpeed;

    const spawnEvery = Math.max(SPAWN_MIN, SPAWN_START - Math.floor(elapsedSec * SPAWN_DECAY));

    if ((!R.nextSpawnAt || now >= R.nextSpawnAt) && R.obstacles.length < MAX_OBS_ON_SCREEN) {
      R.nextSpawnAt = now + spawnEvery;
      spawnObstacle(R, worldSpeed);

      if (elapsedSec > 18 && Math.random() < 0.22 && R.obstacles.length < MAX_OBS_ON_SCREEN) {
        spawnObstacle(R, worldSpeed);
      }
    }

    for (const o of R.obstacles) o.y += o.vy;

    // “évité” => dès que ça passe la ligne, on enlève
    R.obstacles = R.obstacles.filter(o => o.y < BOUNDARY_Y + 30);

    // score + collisions
    for (const p of players) {
      if (!p.alive) continue;

      p.score = Math.floor((now - R.startedAt) / 100);

      const px = clamp(p.x, 0, 1) * (W - PLAYER_W);
      const py = PLAYER_Y;

      for (const o of R.obstacles) {
        if (bboxCollide(px, py, PLAYER_W, PLAYER_H, o.x, o.y, o.w, o.h)) {
          p.alive = false;
          p.lastDeathAt = now;

          io.to(room).emit("event:death", {
            room,
            playerId: p.id,
            x: px + PLAYER_W / 2,
            y: py + PLAYER_H / 2,
            at: now,
          });
          break;
        }
      }
    }

    // end
    const aliveNow = players.filter(p => p.alive);
    if (R.startedPlayerCount <= 1) {
      if (aliveNow.length === 0) {
        R.state = "ended";
        R.endedAt = now;
        R.winnerId = null;
      }
    } else {
      if (aliveNow.length <= 1) {
        R.state = "ended";
        R.endedAt = now;
        R.winnerId = aliveNow[0]?.id || null;
      }
    }

    const payload = {
      room,
      state: R.state,
      startedAt: R.startedAt,
      endedAt: R.endedAt,
      winnerId: R.winnerId,
      seed: R.seed,
      worldSpeed: R.worldSpeed,
      boundaryY: BOUNDARY_Y,
      controlH: CONTROL_H,
      players: players.map(p => ({
        id: p.id,
        pseudo: p.pseudo,
        color: p.color,
        x: p.x,
        alive: p.alive,
        score: p.score,
        cheers: R.cheersByPlayerId[p.id] || 0,
      })),
      obstacles: R.obstacles.map(o => ({
        id: o.id,
        type: o.type,
        x: o.x,
        y: o.y,
        w: o.w,
        h: o.h,
      })),
    };

    io.to(room).emit("state", payload);

    for (const sid of Object.keys(R.playersBySid)) {
      const p = R.playersBySid[sid];
      io.to(sid).emit("myState", {
        room,
        state: R.state,
        winnerId: R.winnerId,
        me: { id: p.id, pseudo: p.pseudo, alive: p.alive, score: p.score, x: p.x },
      });
    }
  }
}, TICK_MS);

// --- Socket.io ---
io.on("connection", (socket) => {
  socket.on("host:join", ({ room }) => {
    const code = String(room || "").toUpperCase();
    const R = rooms[code];
    if (!R) return socket.emit("err", "Room introuvable.");
    socket.join(code);
    socket.emit("ok", { room: code });
    socket.emit("lobby", {
      room: code,
      state: R.state,
      players: Object.values(R.playersBySid).map(p => ({ id: p.id, pseudo: p.pseudo, color: p.color })),
    });
  });

  socket.on("projector:join", ({ room }) => {
    const code = String(room || "").toUpperCase();
    const R = rooms[code];
    if (!R) return socket.emit("err", "Room introuvable.");
    socket.join(code);
    socket.emit("ok", { room: code });
  });

  // ✅ IMPORTANT: autoriser join tant que ce n'est PAS "running"
  socket.on("player:join", ({ room, pseudo }) => {
    const code = String(room || "").toUpperCase();
    const R = rooms[code];
    if (!R) return socket.emit("err", "Room introuvable.");
    if (R.state === "running") return socket.emit("err", "Partie en cours. Attends la prochaine.");

    const cleanPseudo = String(pseudo || "").trim().slice(0, 16);
    if (!cleanPseudo) return socket.emit("err", "Pseudo requis.");

    socket.join(code);

    const player = {
      id: nanoid(10),
      pseudo: cleanPseudo,
      color: randomColor(),
      x: 0.5,
      alive: true,
      score: 0,
      lastDeathAt: null,
    };

    R.playersBySid[socket.id] = player;
    R.cheersByPlayerId[player.id] = 0;

    socket.emit("ok", { room: code, playerId: player.id, pseudo: player.pseudo });

    io.to(code).emit("lobby", {
      room: code,
      state: R.state,
      players: Object.values(R.playersBySid).map(p => ({ id: p.id, pseudo: p.pseudo, color: p.color })),
    });
  });

  // ✅ START = "nouvelle manche" (rejouable à l'infini)
  socket.on("host:start", ({ room }) => {
    const code = String(room || "").toUpperCase();
    const R = rooms[code];
    if (!R) return socket.emit("err", "Room introuvable.");

    // si déjà running, on ignore
    if (R.state === "running") return;

    R.state = "running";
    R.startedAt = Date.now();
    R.endedAt = null;
    R.winnerId = null;
    R.obstacles = [];
    R.nextSpawnAt = 0;
    R.worldSpeed = 0;

    R.startedPlayerCount = Object.keys(R.playersBySid).length;

    for (const sid of Object.keys(R.playersBySid)) {
      const p = R.playersBySid[sid];
      p.alive = true;
      p.score = 0;
      p.x = 0.5;
      p.lastDeathAt = null;
      R.cheersByPlayerId[p.id] = 0;
    }

    io.to(code).emit("game:started", { room: code, startedAt: R.startedAt, seed: R.seed });
  });

  // (Optionnel) reset lobby garde utile pour forcer retour lobby si tu veux,
  // mais tu peux retirer le bouton côté host si tu trouves inutile.
  socket.on("host:reset", ({ room }) => {
    const code = String(room || "").toUpperCase();
    const R = rooms[code];
    if (!R) return socket.emit("err", "Room introuvable.");

    R.state = "lobby";
    R.startedAt = null;
    R.endedAt = null;
    R.winnerId = null;
    R.startedPlayerCount = 0;
    R.obstacles = [];
    R.nextSpawnAt = 0;
    R.worldSpeed = 0;

    for (const sid of Object.keys(R.playersBySid)) {
      const p = R.playersBySid[sid];
      p.alive = true;
      p.score = 0;
      p.x = 0.5;
      p.lastDeathAt = null;
      R.cheersByPlayerId[p.id] = 0;
    }

    io.to(code).emit("lobby", {
      room: code,
      state: R.state,
      players: Object.values(R.playersBySid).map(p => ({ id: p.id, pseudo: p.pseudo, color: p.color })),
    });
  });

  socket.on("player:input", ({ room, x }) => {
    const code = String(room || "").toUpperCase();
    const R = rooms[code];
    if (!R) return;
    const p = R.playersBySid[socket.id];
    if (!p) return;
    if (R.state !== "running") return;
    if (!p.alive) return;
    p.x = clamp(Number(x), 0, 1);
  });

  socket.on("player:cheer", ({ room, targetPlayerId }) => {
    const code = String(room || "").toUpperCase();
    const R = rooms[code];
    if (!R) return;
    if (R.state !== "running") return;

    const from = R.playersBySid[socket.id];
    if (!from) return;
    if (from.alive) return; // only spectators

    const tid = String(targetPlayerId || "");
    if (!tid) return;

    R.cheersByPlayerId[tid] = (R.cheersByPlayerId[tid] || 0) + 1;
  });

  socket.on("disconnect", () => {
    for (const code of Object.keys(rooms)) {
      const R = rooms[code];
      if (R.playersBySid[socket.id]) {
        const p = R.playersBySid[socket.id];
        delete R.playersBySid[socket.id];
        delete R.cheersByPlayerId[p.id];

        io.to(code).emit("lobby", {
          room: code,
          state: R.state,
          players: Object.values(R.playersBySid).map(pp => ({ id: pp.id, pseudo: pp.pseudo, color: pp.color })),
        });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
