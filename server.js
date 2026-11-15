const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({ status: "Syncbeat is running" });
});

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, data, except = null) {
  for (const client of room.clients) {
    if (client !== except) send(client, data);
  }
}

wss.on("connection", (ws) => {
  ws.on("message", (message) => {
    let data;

    try {
      data = JSON.parse(message);
    } catch {
      return send(ws, { type: "error", message: "Invalid message" });
    }

    if (data.type === "create") {
      const code = crypto.randomBytes(3).toString("hex").toUpperCase();
      const room = { admin: ws, clients: new Set([ws]) };

      rooms.set(code, room);
      ws.roomCode = code;
      ws.isAdmin = true;

      return send(ws, {
        type: "created",
        code,
        admin: true
      });
    }

    if (data.type === "join") {
      const code = String(data.code || "").toUpperCase();
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

    if (["play", "pause", "seek", "load"].includes(data.type)) {
      broadcast(room, data, ws);
    }
  });

  ws.on("close", () => {
    const room = rooms.get(ws.roomCode);
    if (!room) return;

    room.clients.delete(ws);

    if (room.admin === ws) {
      broadcast(room, { type: "room_closed" });
      rooms.delete(ws.roomCode);
    } else {
      broadcast(room, {
        type: "members",
        count: room.clients.size
      });
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Syncbeat running on port ${PORT}`);
});
