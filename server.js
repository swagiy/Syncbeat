const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = new Map();

const COMMAND_DELAY = 1500;

app.use((req, res, next) => {
  res.setHeader(
    "Referrer-Policy",
    "strict-origin-when-cross-origin"
  );
  next();
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({ status: "Syncbeat is running" });
});

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, data) {
  for (const client of room.clients) {
    send(client, data);
  }
}

function getCurrentTime(room) {
  if (room.playback.state === "playing") {
    return room.playback.time +
      (Date.now() - room.playback.updatedAt) / 1000;
  }

  return room.playback.time;
}

function scheduleCommand(room, command) {
  const executeAt = Date.now() + COMMAND_DELAY;

  broadcast(room, {
    ...command,
    executeAt
  });

  return executeAt;
}

wss.on("connection", (ws) => {

  ws.on("message", (message) => {
    let data;

    try {
      data = JSON.parse(message);
    } catch {
      return send(ws, {
        type: "error",
        message: "Invalid message"
      });
    }

    // CLOCK SYNCHRONIZATION

    if (data.type === "ping") {
      return send(ws, {
        type: "pong",
        clientSentAt: data.clientSentAt,
        serverTime: Date.now()
      });
    }

    // CREATE ROOM

    if (data.type === "create") {
      const code = crypto.randomBytes(3)
        .toString("hex")
        .toUpperCase();

      const room = {
        admin: ws,
        clients: new Set([ws]),
        videoId: null,
        playback: {
          state: "paused",
          time: 0,
          updatedAt: Date.now()
        }
      };

      rooms.set(code, room);

      ws.roomCode = code;
      ws.isAdmin = true;

      return send(ws, {
        type: "created",
        code,
        admin: true
      });
    }

    // JOIN ROOM

    if (data.type === "join") {
      const code = String(data.code || "")
        .trim()
        .toUpperCase();

      const room = rooms.get(code);

      if (!room) {
        return send(ws, {
          type: "error",
          message: "Room not found"
        });
      }

      room.clients.add(ws);

      ws.roomCode = code;
      ws.isAdmin = false;

      send(ws, {
        type: "joined",
        code,
        admin: false
      });

      send(ws, {
        type: "room_state",
        videoId: room.videoId,
        state: room.playback.state,
        time: getCurrentTime(room),
        serverTime: Date.now()
      });

      broadcast(room, {
        type: "members",
        count: room.clients.size
      });

      return;
    }

    const room = rooms.get(ws.roomCode);

    if (!room || !ws.isAdmin) {
      return send(ws, {
        type: "error",
        message: "Only admin can control playback"
      });
    }

    // LOAD VIDEO

    if (data.type === "load") {
      const videoId = String(data.videoId || "");

      if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return send(ws, {
          type: "error",
          message: "Invalid YouTube video ID"
        });
      }

      room.videoId = videoId;

      room.playback = {
        state: "paused",
        time: 0,
        updatedAt: Date.now()
      };

      broadcast(room, {
        type: "load",
        videoId
      });

      return;
    }

    // PLAY

    if (data.type === "play") {
      const time = Math.max(
        0,
        Number(data.time) || 0
      );

      const executeAt = scheduleCommand(room, {
        type: "play",
        time
      });

      room.playback = {
        state: "playing",
        time,
        updatedAt: executeAt
      };

      return;
    }

    // PAUSE

    if (data.type === "pause") {
      const time =
  getCurrentTime(room) + COMMAND_DELAY / 1000;

      const executeAt = scheduleCommand(room, {
        type: "pause",
        time
      });

      room.playback = {
        state: "paused",
        time,
        updatedAt: executeAt
      };

      return;
    }

    // SEEK

    if (data.type === "seek") {
      const time = Math.max(
        0,
        Number(data.time) || 0
      );

      const executeAt = scheduleCommand(room, {
        type: "seek",
        time
      });

      room.playback.time = time;
      room.playback.updatedAt = executeAt;
    }

  });

  ws.on("close", () => {
    const room = rooms.get(ws.roomCode);

    if (!room) return;

    room.clients.delete(ws);

    if (room.admin === ws) {
      broadcast(room, {
        type: "room_closed"
      });

      rooms.delete(ws.roomCode);
      return;
    }

    broadcast(room, {
      type: "members",
      count: room.clients.size
    });
  });

});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Syncbeat running on port ${PORT}`);
});
