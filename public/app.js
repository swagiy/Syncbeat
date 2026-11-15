const statusText = document.getElementById("status");
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const roomInput = document.getElementById("roomCode");

const roomSection = document.getElementById("roomSection");
const playerSection = document.getElementById("playerSection");

const roomDisplay = document.getElementById("roomDisplay");
const roleDisplay = document.getElementById("roleDisplay");
const memberCount = document.getElementById("memberCount");

const adminControls = document.getElementById("adminControls");
const youtubeUrl = document.getElementById("youtubeUrl");

const loadBtn = document.getElementById("loadBtn");
const playBtn = document.getElementById("playBtn");
const pauseBtn = document.getElementById("pauseBtn");
const seekBar = document.getElementById("seekBar");

let socket;
let isAdmin = false;
let player;
let playerReady = false;
let pendingVideoId = null;

const protocol = location.protocol === "https:" ? "wss:" : "ws:";

socket = new WebSocket(`${protocol}//${location.host}`);

socket.onopen = () => {
  statusText.textContent = "Connected to Syncbeat";
};

socket.onclose = () => {
  statusText.textContent = "Disconnected from server";
};

socket.onerror = () => {
  statusText.textContent = "Connection error";
};

function send(data) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  } else {
    statusText.textContent = "Server is not connected";
  }
}

createBtn.onclick = () => {
  send({ type: "create" });
};

joinBtn.onclick = () => {
  const code = roomInput.value.trim().toUpperCase();

  if (!code) {
    statusText.textContent = "Enter a room code";
    return;
  }

  send({
    type: "join",
    code
  });
};

socket.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === "created" || data.type === "joined") {
    isAdmin = data.admin;

    roomDisplay.textContent = data.code;
    roleDisplay.textContent = isAdmin
      ? "You are the Admin"
      : "You are a Listener";

    adminControls.style.display = isAdmin ? "block" : "none";

    roomSection.classList.add("hidden");
    playerSection.classList.remove("hidden");

    statusText.textContent = "Room connected";
  }

  if (data.type === "members") {
    memberCount.textContent =
      `Devices connected: ${data.count}`;
  }

  if (data.type === "load") {
    loadVideo(data.videoId);
  }

  if (data.type === "play") {
    syncPlay(data.time);
  }

  if (data.type === "pause") {
    if (playerReady) {
      player.pauseVideo();
    }
  }

  if (data.type === "seek") {
    if (playerReady) {
      player.seekTo(data.time, true);
    }
  }

  if (data.type === "room_closed") {
    statusText.textContent = "Admin closed the room";
    playerSection.classList.add("hidden");
    roomSection.classList.remove("hidden");
  }

  if (data.type === "error") {
    statusText.textContent = data.message;
  }
};

function extractVideoId(url) {
  try {
    const parsed = new URL(url);

    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.slice(1);
    }

    if (parsed.searchParams.get("v")) {
      return parsed.searchParams.get("v");
    }

    const parts = parsed.pathname.split("/");

    if (
      ["embed", "shorts", "live"].includes(parts[1])
    ) {
      return parts[2];
    }

    return null;
  } catch {
    return null;
  }
}

loadBtn.onclick = () => {
  if (!isAdmin) return;

  const videoId = extractVideoId(youtubeUrl.value.trim());

  if (!videoId) {
    statusText.textContent = "Enter a valid YouTube link";
    return;
  }

  loadVideo(videoId);

  send({
    type: "load",
    videoId
  });
};

function loadVideo(videoId) {
  if (!playerReady) {
    pendingVideoId = videoId;
    return;
  }

  player.loadVideoById(videoId);
  statusText.textContent = "Loading song...";
}

playBtn.onclick = () => {
  if (!isAdmin || !playerReady) return;

  const time = player.getCurrentTime();

  player.playVideo();

  send({
    type: "play",
    time
  });
};

pauseBtn.onclick = () => {
  if (!isAdmin || !playerReady) return;

  player.pauseVideo();

  send({
    type: "pause"
  });
};

seekBar.addEventListener("change", () => {
  if (!isAdmin || !playerReady) return;

  const duration = player.getDuration();
  const time = duration * (Number(seekBar.value) / 100);

  player.seekTo(time, true);

  send({
    type: "seek",
    time
  });
});

function syncPlay(time) {
  if (!playerReady) return;

  if (typeof time === "number") {
    player.seekTo(time, true);
  }

  player.playVideo();
}

window.onYouTubeIframeAPIReady = function () {
  player = new YT.Player("player", {
    height: "225",
    width: "100%",
    videoId: "",
    playerVars: {
      playsinline: 1,
      controls: 1,
      rel: 0
    },
    events: {
      onReady: () => {
        playerReady = true;

        if (pendingVideoId) {
          loadVideo(pendingVideoId);
          pendingVideoId = null;
        }
      },

      onStateChange: (event) => {
        if (event.data === YT.PlayerState.PLAYING) {
          statusText.textContent = "Playing";
        }

        if (event.data === YT.PlayerState.PAUSED) {
          statusText.textContent = "Paused";
        }

        if (event.data === YT.PlayerState.ENDED) {
          statusText.textContent = "Song ended";
        }
      }
    }
  });
};

setInterval(() => {
  if (
    playerReady &&
    player.getDuration() > 0 &&
    player.getPlayerState() === YT.PlayerState.PLAYING
  ) {
    seekBar.value =
      (player.getCurrentTime() / player.getDuration()) * 100;
  }
}, 1000);
