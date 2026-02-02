const socket = io();

const createBtn = document.getElementById("create");
const openProjectorBtn = document.getElementById("openProjector");
const copyJoinBtn = document.getElementById("copyJoin");
const startBtn = document.getElementById("start");
const resetBtn = document.getElementById("reset");

const roomBox = document.getElementById("roomBox");
const qrBox = document.getElementById("qrBox");
const playersDiv = document.getElementById("players");

let currentRoom = null;
let joinUrl = null;

function renderPlayers(list) {
  playersDiv.innerHTML = "";
  if (!list.length) {
    playersDiv.textContent = "(personne)";
    return;
  }
  for (const p of list) {
    const row = document.createElement("div");
    row.textContent = p.pseudo;
    row.style.color = p.color;
    playersDiv.appendChild(row);
  }
}

createBtn.onclick = async () => {
  const r = await fetch("/api/create-room");
  const data = await r.json();

  currentRoom = data.room;
  joinUrl = data.joinUrl;

  const projectorUrl = `${location.origin}/projector?room=${encodeURIComponent(currentRoom)}`;

  roomBox.innerHTML = `
    <div><b>Room :</b> ${data.room}</div>
    <div class="mt"><b>Lien joueur :</b> <a href="${data.joinUrl}" target="_blank" rel="noreferrer">${data.joinUrl}</a></div>
    <div class="mt"><b>Lien projecteur :</b> <a href="${projectorUrl}" target="_blank" rel="noreferrer">${projectorUrl}</a></div>
  `;

  qrBox.innerHTML = `<img alt="QR" src="${data.qrDataUrl}" style="max-width:260px;border-radius:12px;" />`;

  socket.emit("host:join", { room: currentRoom });

  openProjectorBtn.disabled = false;
  copyJoinBtn.disabled = false;
  startBtn.disabled = false;
  resetBtn.disabled = false;
};

openProjectorBtn.onclick = () => {
  if (!currentRoom) return;
  const url = `${location.origin}/projector?room=${encodeURIComponent(currentRoom)}`;
  window.open(url, "_blank", "noopener,noreferrer");
};

copyJoinBtn.onclick = async () => {
  if (!joinUrl) return;
  try {
    await navigator.clipboard.writeText(joinUrl);
    copyJoinBtn.textContent = "Copié ✅";
    setTimeout(() => (copyJoinBtn.textContent = "Copier lien joueur"), 1000);
  } catch {
    alert("Impossible de copier automatiquement. Copie le lien affiché.");
  }
};

startBtn.onclick = () => {
  if (!currentRoom) return;
  socket.emit("host:start", { room: currentRoom });
};

resetBtn.onclick = () => {
  if (!currentRoom) return;
  socket.emit("host:reset", { room: currentRoom });
};

socket.on("lobby", (payload) => {
  if (payload.room !== currentRoom) return;
  renderPlayers(payload.players || []);
});

socket.on("err", (msg) => alert(msg));
