const $ = (id) => document.getElementById(id);

const statusText = $("status");
const createBtn = $("createBtn");
const joinBtn = $("joinBtn");
const roomInput = $("roomCode");

const roomSection = $("roomSection");
const playerSection = $("playerSection");

const roomDisplay = $("roomDisplay");
const roleDisplay = $("roleDisplay");
const memberCount = $("memberCount");

const adminControls = $("adminControls");
const youtubeUrl = $("youtubeUrl");

const loadBtn = $("loadBtn");
const playBtn = $("playBtn");
const pauseBtn = $("pauseBtn");
const seekBar = $("seekBar");

const enablePlaybackBtn = $("enablePlaybackBtn");

let socket;
let player = null;

let isAdmin = false;
let inRoom = false;
let playerReady = false;
let youtubeApiReady = false;

let currentVideoId = null;

let desiredTime = 0;
let desiredState = "paused";

let pendingVideoId = null;
let pendingAction = null;

let clockOffset = 0;
let clockSynced = false;

let commandTimer = null;
let pendingStart = false;

const protocol =
  location.protocol === "https:" ? "wss:" : "ws:";

socket = new WebSocket(
  `${protocol}//${location.host}`
);

// CONNECTION

socket.onopen = () => {
  statusText.textContent = "Connected to Syncbeat";

  createBtn.disabled = false;
  joinBtn.disabled = false;

  startClockSync();
};

socket.onclose = () => {
  statusText.textContent = "Server disconnected";
};

socket.onerror = () => {
  statusText.textContent = "Connection error";
};

createBtn.disabled = true;
joinBtn.disabled = true;

function send(data) {
  if (socket.readyState !== WebSocket.OPEN) {
    statusText.textContent = "Server not connected";
    return;
  }

  socket.send(JSON.stringify(data));
}

// CLOCK SYNCHRONIZATION

function serverNow() {
  return Date.now() + clockOffset;
}

function startClockSync() {
  syncClock();

  setInterval(syncClock, 2000);
}

function syncClock() {
  if (socket.readyState !== WebSocket.OPEN) return;

  send({
    type: "ping",
    clientSentAt: Date.now()
  });
}

// YOUTUBE API

window.onYouTubeIframeAPIReady = () => {
  youtubeApiReady = true;

  if (inRoom) {
    createPlayer();
  }
};

const youtubeScript = document.createElement("script");

youtubeScript.src =
  "https://www.youtube.com/iframe_api";

youtubeScript.async = true;

document.head.appendChild(youtubeScript);

// ROOM FUNCTIONS

createBtn.onclick = () => {
  send({ type: "create" });
};

joinBtn.onclick = () => {
  const code = roomInput.value.trim().toUpperCase();

  if (!code) {
    statusText.textContent = "Enter room code";
    return;
  }

  send({
    type: "join",
    code
  });
};

function enterRoom(data) {
  isAdmin = data.admin;
  inRoom = true;

  roomDisplay.textContent = data.code;

  roleDisplay.textContent = isAdmin
    ? "You are the Admin"
    : "You are a Listener";

  adminControls.style.display =
    isAdmin ? "block" : "none";

  roomSection.classList.add("hidden");
  playerSection.classList.remove("hidden");

  statusText.textContent = "Room connected";

  if (youtubeApiReady) {
    createPlayer();
  }
}

// CREATE PLAYER

function createPlayer() {
  if (player || !youtubeApiReady || !inRoom) {
    return;
  }

  player = new YT.Player("player", {
    width: "100%",
    height: "100%",

    playerVars: {
      playsinline: 1,
      controls: 0,
      rel: 0,
      origin: location.origin
    },

    events: {
      onReady: () => {
        playerReady = true;

        statusText.textContent =
          "YouTube player ready";

        if (pendingVideoId) {
          const id = pendingVideoId;
          pendingVideoId = null;
          cueVideo(id);
        }

        if (pendingAction) {
          const action = pendingAction;
          pendingAction = null;
          scheduleAction(action);
        }
      },

      onStateChange: (event) => {

        if (event.data === YT.PlayerState.PLAYING) {
          enablePlaybackBtn.classList.add("hidden");
          statusText.textContent = "Playing";
        }

        if (event.data === YT.PlayerState.PAUSED) {
          statusText.textContent = "Paused";
        }

        if (event.data === YT.PlayerState.CUED) {
          statusText.textContent = "Song ready";

          if (pendingAction) {
            const action = pendingAction;
            pendingAction = null;
            scheduleAction(action);
          }
        }

        if (event.data === YT.PlayerState.BUFFERING) {
          statusText.textContent = "Buffering...";
        }

        if (event.data === YT.PlayerState.ENDED) {
          statusText.textContent = "Song ended";
        }
      },

      onError: (event) => {
        const messages = {
          2: "Invalid YouTube video ID",
          5: "HTML5 player error",
          100: "Video unavailable or private",
          101: "Video owner does not allow embedding",
          150: "Video owner does not allow embedding",
          153: "YouTube cannot identify this website"
        };

        statusText.textContent =
          messages[event.data] ||
          `YouTube error: ${event.data}`;

        console.error("YouTube error:", event.data);
      },

      onAutoplayBlocked: () => {
        enablePlaybackBtn.classList.remove("hidden");

        statusText.textContent =
          "Playback blocked. Tap to enable playback.";
      }
    }
  });
}

// VIDEO URL

function extractVideoId(value) {
  value = value.trim();

  if (/^[a-zA-Z0-9_-]{11}$/.test(value)) {
    return value;
  }

  try {
    const url = new URL(value);

    let id = null;

    if (url.hostname.includes("youtu.be")) {
      id = url.pathname.split("/")[1];
    } else if (url.hostname.includes("youtube.com")) {
      id = url.searchParams.get("v");

      if (!id) {
        const parts = url.pathname.split("/");

        if (
          ["embed", "shorts", "live"].includes(parts[1])
        ) {
          id = parts[2];
        }
      }
    }

    return id && /^[a-zA-Z0-9_-]{11}$/.test(id)
      ? id
      : null;

  } catch {
    return null;
  }
}

// LOAD VIDEO

function cueVideo(videoId) {
  currentVideoId = videoId;

  desiredTime = 0;
  desiredState = "paused";

  if (!playerReady) {
    pendingVideoId = videoId;
    return;
  }

  player.cueVideoById({
    videoId,
    startSeconds: 0
  });

  statusText.textContent = "Loading video...";
}

// ADMIN LOAD

loadBtn.onclick = () => {
  if (!isAdmin) return;

  const videoId = extractVideoId(youtubeUrl.value);

  if (!videoId) {
    statusText.textContent =
      "Enter a valid YouTube link";
    return;
  }

  cueVideo(videoId);

  send({
    type: "load",
    videoId
  });
};

// SCHEDULE COMMAND

function scheduleAction(data) {
  if (!playerReady) {
    pendingAction = data;
    return;
  }

  if (commandTimer) {
    clearTimeout(commandTimer);
    commandTimer = null;
  }

  const executeAt = Number(data.executeAt) || serverNow();

  const delay = Math.max(
    0,
    executeAt - serverNow()
  );

  commandTimer = setTimeout(() => {
    executeCommand(data);
  }, delay);
}

// EXECUTE COMMAND

function executeCommand(data) {
  if (!playerReady) {
    pendingAction = data;
    return;
  }

  const type = data.type;

  if (type === "play") {
    const elapsed = Math.max(
      0,
      (serverNow() - Number(data.executeAt)) / 1000
    );

    const targetTime =
      Number(data.time || 0) + elapsed;

    desiredTime = targetTime;
    desiredState = "playing";

    player.seekTo(targetTime, true);
    player.playVideo();

    return;
  }

  if (type === "pause") {
    desiredTime = Number(data.time) || 0;
    desiredState = "paused";

    player.seekTo(desiredTime, true);
    player.pauseVideo();

    return;
  }

  if (type === "seek") {
    desiredTime = Number(data.time) || 0;

    player.seekTo(desiredTime, true);

    return;
  }
}

// ADMIN PLAY

playBtn.onclick = () => {
  if (!isAdmin || !playerReady) return;

  const time = player.getCurrentTime();

  send({
    type: "play",
    time
  });

  statusText.textContent =
    "Play command scheduled...";
};

// ADMIN PAUSE

pauseBtn.onclick = () => {
  if (!isAdmin || !playerReady) return;

  const time = player.getCurrentTime();

  send({
    type: "pause",
    time
  });

  statusText.textContent =
    "Pause command scheduled...";
};

// ADMIN SEEK

seekBar.addEventListener("change", () => {
  if (!isAdmin || !playerReady) return;

  const duration = player.getDuration();

  if (!duration) return;

  const time =
    duration * Number(seekBar.value) / 100;

  send({
    type: "seek",
    time
  });

  statusText.textContent =
    "Seek command scheduled...";
});

// LISTENER MANUAL PLAY

enablePlaybackBtn.onclick = () => {
  if (!playerReady) return;

  const time = desiredTime;

  player.seekTo(time, true);
  player.playVideo();

  enablePlaybackBtn.classList.add("hidden");

  statusText.textContent =
    "Starting playback...";
};

// SERVER MESSAGES

socket.onmessage = (event) => {
  const data = JSON.parse(event.data);

  // CLOCK RESPONSE

  if (data.type === "pong") {
    const receivedAt = Date.now();

    const sentAt = Number(data.clientSentAt);
    const serverTime = Number(data.serverTime);

    const midpoint = (sentAt + receivedAt) / 2;

    const newOffset = serverTime - midpoint;

    if (!clockSynced) {
      clockOffset = newOffset;
      clockSynced = true;
    } else {
      clockOffset =
        clockOffset * 0.8 +
        newOffset * 0.2;
    }

    return;
  }

  // ROOM CREATED OR JOINED

  if (
    data.type === "created" ||
    data.type === "joined"
  ) {
    enterRoom(data);
    return;
  }

  // MEMBERS

  if (data.type === "members") {
    memberCount.textContent =
      `Devices connected: ${data.count}`;

    return;
  }

  // LOAD VIDEO

  if (data.type === "load") {
    pendingAction = null;

    if (commandTimer) {
      clearTimeout(commandTimer);
      commandTimer = null;
    }

    cueVideo(data.videoId);

    return;
  }

  // ROOM STATE

  if (data.type === "room_state") {
    if (!data.videoId) return;

    currentVideoId = data.videoId;

    desiredTime = Number(data.time) || 0;
    desiredState = data.state || "paused";

    const elapsed = Math.max(
      0,
      (serverNow() - Number(data.serverTime)) / 1000
    );

    if (desiredState === "playing") {
      desiredTime += elapsed;
    }

    pendingVideoId = data.videoId;

    if (playerReady) {
      cueVideo(data.videoId);

      if (desiredState === "playing") {
        pendingAction = {
          type: "play",
          time: desiredTime,
          executeAt: serverNow() + 500
        };
      }
    }

    return;
  }

  // PLAY

  if (data.type === "play") {
    scheduleAction(data);
    return;
  }

  // PAUSE

  if (data.type === "pause") {
    scheduleAction(data);
    return;
  }

  // SEEK

  if (data.type === "seek") {
    scheduleAction(data);
    return;
  }

  // ROOM CLOSED

  if (data.type === "room_closed") {
    statusText.textContent =
      "Admin closed the room";

    inRoom = false;

    playerSection.classList.add("hidden");
    roomSection.classList.remove("hidden");

    return;
  }

  // ERROR

  if (data.type === "error") {
    statusText.textContent = data.message;
  }
};

// UPDATE SEEK BAR

setInterval(() => {
  if (
    playerReady &&
    player.getDuration() > 0 &&
    player.getPlayerState() === YT.PlayerState.PLAYING
  ) {
    seekBar.value =
      player.getCurrentTime() /
      player.getDuration() * 100;
  }
}, 1000);
