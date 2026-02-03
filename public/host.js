const socket = io({ transports: ["websocket", "polling"] });

const $ = (id) => document.getElementById(id);

const createRoomBtn = $("createRoomBtn");
const roomInput = $("roomInput");
const joinHostBtn = $("joinHostBtn");

const roomLabel = $("roomLabel");
const stateLabel = $("stateLabel");
const countLabel = $("countLabel");

const qrImg = $("qrImg");
const playerLink = $("playerLink");
const projectorLink = $("projectorLink");

const copyPlayerBtn = $("copyPlayerBtn");
const openProjectorBtn = $("openProjectorBtn");

const startBtn = $("startBtn");
const resetBtn = $("resetBtn");

const playersDiv = $("players");
const msgOk = $("msgOk");
const msgErr = $("msgErr");

let currentRoom = null;

function setMsg(okText = "", errText = "") {
  msgOk.textContent = okText;
  msgErr.textContent = errText;
}

function setRoomUI(room, state, playerCount) {
  currentRoom = room || null;
  roomLabel.textContent = room || "—";
  stateLabel.textContent = state || "—";
  countLabel.textContent = String(playerCount ?? 0);

  const hasRoom = !!currentRoom;
  startBtn.disabled = !hasRoom;
  resetBtn.disabled = !hasRoom;
  openProjectorBtn.disabled = !hasRoom;
  copyPlayerBtn.disabled = !hasRoom;
}

function renderPlayers(list = []) {
  playersDiv.innerHTML = "";
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "muted small";
    empty.textContent = "Aucun joueur connecté pour l’instant.";
    playersDiv.appendChild(empty);
    return;
  }

  for (const p of list) {
    const row = document.createElement("div");
    row.className = "pRow";

    const left = document.createElement("div");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = p.color || "#fff";
    left.appendChild(dot);

    const name = document.createElement("span");
    name.style.fontWeight = "900";
    name.textContent = p.pseudo || "???";
    left.appendChild(name);

    row.appendChild(left);

    const right = document.createElement("div");
    right.className = "muted small";
    right.textContent = p.id ? p.id.slice(0, 6) : "";
    row.appendChild(right);

    playersDiv.appendChild(row);
  }
}

// Create room
createRoomBtn.onclick = async () => {
  setMsg("", "");
  try {
    createRoomBtn.disabled = true;
    createRoomBtn.textContent = "Création…";

    const r = await fetch("/api/create-room");
    const data = await r.json();

    const room = String(data.room || "").toUpperCase();
    roomInput.value = room;

    qrImg.src = data.qrDataUrl || "";
    playerLink.value = data.joinUrl || "";

    projectorLink.value = `${location.origin}/projector?room=${encodeURIComponent(room)}`;

    // join host socket room
    socket.emit("host:join", { room });
    setMsg("Room créée. Ouvre le projector puis lance la manche.", "");

  } catch (e) {
    setMsg("", "Erreur création room.");
  } finally {
    createRoomBtn.disabled = false;
    createRoomBtn.textContent = "Créer une room";
  }
};

// Join existing room
joinHostBtn.onclick = () => {
  setMsg("", "");
  const room = String(roomInput.value || "").trim().toUpperCase();
  if (!room) return setMsg("", "Indique une room.");
  projectorLink.value = `${location.origin}/projector?room=${encodeURIComponent(room)}`;
  socket.emit("host:join", { room });
};

// Copy player link
copyPlayerBtn.onclick = async () => {
  try {
    await navigator.clipboard.writeText(playerLink.value || "");
    setMsg("Lien joueur copié ✅", "");
    setTimeout(() => setMsg("", ""), 1200);
  } catch {
    setMsg("", "Copie impossible (navigateur).");
  }
};

// Open projector
openProjectorBtn.onclick = () => {
  if (!currentRoom) return;
  const url = `${location.origin}/projector?room=${encodeURIComponent(currentRoom)}`;
  window.open(url, "_blank", "noopener,noreferrer");
};

// Start / Reset
startBtn.onclick = () => {
  if (!currentRoom) return;
  socket.emit("host:start", { room: currentRoom });
  setMsg("Manche lancée ✅", "");
  setTimeout(() => setMsg("", ""), 1200);
};

resetBtn.onclick = () => {
  if (!currentRoom) return;
  socket.emit("host:reset", { room: currentRoom });
  setMsg("Retour lobby ✅", "");
  setTimeout(() => setMsg("", ""), 1200);
};

// socket events
socket.on("ok", (data) => {
  const room = String(data.room || "").toUpperCase();
  currentRoom = room;
  setRoomUI(room, "lobby", 0);
});

socket.on("err", (m) => {
  setMsg("", String(m || "Erreur."));
});

socket.on("lobby", (payload) => {
  const room = String(payload.room || "").toUpperCase();
  const state = payload.state || "lobby";
  const players = payload.players || [];
  setRoomUI(room, state, players.length);
  renderPlayers(players);

  // si on a rejoint une room existante, playerLink/qr ne sont pas connus => on met au moins les liens
  if (room && !playerLink.value) {
    playerLink.value = `${location.origin}/join/${encodeURIComponent(room)}`;
  }
  if (room && !projectorLink.value) {
    projectorLink.value = `${location.origin}/projector?room=${encodeURIComponent(room)}`;
  }
});

// init UI
setRoomUI(null, "—", 0);
renderPlayers([]);
