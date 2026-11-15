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
let startAfterCue = false;

const protocol =
  location.protocol === "https:" ? "wss:" : "ws:";

socket = new WebSocket(
  `${protocol}//${location.host}`
);

socket.onopen = () => {
  statusText.textContent = "Connected to Syncbeat";

  createBtn.disabled = false;
  joinBtn.disabled = false;
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

// LOAD YOUTUBE API ONLY AFTER CALLBACK IS READY

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

// CREATE PLAYER ONLY WHEN ROOM IS VISIBLE

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
          cueVideo(pendingVideoId);
          pendingVideoId = null;
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

          if (startAfterCue) {
            startAfterCue = false;
            attemptPlay();
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
          153: "YouTube cannot identify the website. Check Referer Policy."
        };

        const message =
          messages[event.data] ||
          `YouTube player error: ${event.data}`;

        statusText.textContent = message;

        console.error("YouTube error:", event.data);
      },

      onAutoplayBlocked: () => {
        enablePlaybackBtn.classList.remove("hidden");

        statusText.textContent =
          "Playback blocked. Tap the green button to play.";
      }
    }
  });
}

// VIDEO URL HANDLING

function extractVideoId(value) {
  value = value.trim();

  if (/^[a-zA-Z0-9_-]{11}$/.test(value)) {
    return value;
  }

  try {
    const url = new URL(value);

    let id = null;

    if (
      url.hostname === "youtu.be" ||
      url.hostname.endsWith(".youtu.be")
    ) {
      id = url.pathname.split("/")[1];
    } else if (
      url.hostname.includes("youtube.com")
    ) {
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

// LOAD VIDEO WITHOUT AUTOPLAY

function cueVideo(videoId) {
  currentVideoId = videoId;
  desiredState = "paused";
  desiredTime = 0;

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

// ADMIN PLAY

playBtn.onclick = () => {
  if (!isAdmin || !playerReady) return;

  desiredTime = player.getCurrentTime();
  desiredState = "playing";

  player.playVideo();

  send({
    type: "play",
    time: desiredTime
  });
};

// ADMIN PAUSE

pauseBtn.onclick = () => {
  if (!isAdmin || !playerReady) return;

  desiredTime = player.getCurrentTime();
  desiredState = "paused";

  player.pauseVideo();

  send({
    type: "pause",
    time: desiredTime
  });
};

// ADMIN SEEK

seekBar.addEventListener("change", () => {
  if (!isAdmin || !playerReady) return;

  const duration = player.getDuration();

  if (!duration) return;

  desiredTime =
    duration * Number(seekBar.value) / 100;

  player.seekTo(desiredTime, true);

  send({
    type: "seek",
    time: desiredTime
  });
});

// REMOTE PLAY

function attemptPlay() {
  if (!playerReady) return;

  player.seekTo(desiredTime, true);
  player.playVideo();
}

// LISTENER MANUAL PLAY BUTTON

enablePlaybackBtn.onclick = () => {
  if (!playerReady) {
    statusText.textContent =
      "YouTube player is still loading";
    return;
  }

  player.seekTo(desiredTime, true);
  player.playVideo();

  statusText.textContent =
    "Starting playback...";
};

// SERVER MESSAGES

socket.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === "created" ||
      data.type === "joined") {
    enterRoom(data);
    return;
  }

  if (data.type === "members") {
    memberCount.textContent =
      `Devices connected: ${data.count}`;
    return;
  }

  if (data.type === "load") {
    cueVideo(data.videoId);
    return;
  }

  if (data.type === "room_state") {

    if (data.videoId) {
      currentVideoId = data.videoId;
      desiredTime = Number(data.time) || 0;
      desiredState = data.state || "paused";

      if (playerReady) {
        cueVideo(data.videoId);

        if (desiredState === "playing") {
          startAfterCue = true;
        }
      } else {
        pendingVideoId = data.videoId;

        if (desiredState === "playing") {
          startAfterCue = true;
        }
      }
    }

    return;
  }

  if (data.type === "play") {
    desiredTime = Number(data.time) || 0;
    desiredState = "playing";

    if (playerReady) {
      attemptPlay();
    }

    return;
  }

  if (data.type === "pause") {
    desiredTime = Number(data.time) || 0;
    desiredState = "paused";

    if (playerReady) {
      player.seekTo(desiredTime, true);
      player.pauseVideo();
    }

    return;
  }

  if (data.type === "seek") {
    desiredTime = Number(data.time) || 0;

    if (playerReady) {
      player.seekTo(desiredTime, true);
    }

    return;
  }

  if (data.type === "room_closed") {
    statusText.textContent = "Admin closed the room";

    inRoom = false;

    playerSection.classList.add("hidden");
    roomSection.classList.remove("hidden");

    return;
  }

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
