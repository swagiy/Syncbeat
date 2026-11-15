(function (global) {
  "use strict";

  class Syncbeat {
    constructor({
      audio,
      serverUrl,
      onState,
      onError,
      onStatus
    } = {}) {
      if (!audio) {
        throw new Error("Audio element required");
      }

      this.audio = audio;
      this.serverUrl = serverUrl;
      this.onState = onState || (() => {});
      this.onError = onError || console.error;
      this.onStatus = onStatus || (() => {});

      this.socket = null;
      this.serverOffsetMs = 0;
      this.clockSamples = [];
      this.pendingStartAt = null;
      this.driftTimer = null;
      this.syncTimer = null;
      this.isApplyingCorrection = false;
    }

    connect() {
      if (typeof global.io !== "function") {
        throw new Error("Socket.IO client missing");
      }

      if (this.socket) return this;

      this.socket = global.io(this.serverUrl || undefined);

      this.socket.on("connect", () => {
        this.onStatus("connected");
        this.syncClock();

        this.syncTimer = setInterval(
          () => this.syncClock(),
          10000
        );
      });

      this.socket.on("disconnect", () => {
        this.onStatus("disconnected");
      });

      this.socket.on("app:error", message => {
        this.onError(message);
      });

      this.socket.on("room:joined", state => {
        this.onState(state);
      });

      this.socket.on("room:state", state => {
        this.onState(state);

        if (state.trackUrl &&
            this.audio.src !== state.trackUrl) {
          this.audio.src = state.trackUrl;
          this.audio.load();
        }

        if (state.playback?.status === "playing") {
          this.correctDrift(state.playback.position);
        }
      });

      this.socket.on("track:changed", ({ url }) => {
        this.audio.src = url;
        this.audio.load();
      });

      this.socket.on("clock:pong", sample => {
        this.recordClockSample(sample);
      });

      this.socket.on("play:scheduled", ({ startAt }) => {
        this.scheduleStart(startAt);
      });

      this.socket.on("play:paused", ({ position }) => {
        this.pendingStartAt = null;
        this.audio.pause();
        this.seekSafely(position);
      });

      this.socket.on("playback:tick", ({ position }) => {
        this.correctDrift(position);
      });

      return this;
    }

    join(roomId, name = "Guest") {
      if (!this.socket) this.connect();

      this.socket.emit("room:join", {
        roomId,
        name
      });

      return this;
    }

    setTrack(url) {
      this.socket.emit("track:set", { url });
      return this;
    }

    setReady(ready = true) {
      this.socket.emit("client:ready", { ready });
      return this;
    }

    play() {
      this.socket.emit("play:request");
      return this;
    }

    pause() {
      this.socket.emit("pause:request");
      return this;
    }

    syncClock() {
      if (!this.socket?.connected) return;

      this.socket.emit("clock:ping", {
        clientSentAt: Date.now()
      });
    }

    recordClockSample(sample) {
      const receivedAt = Date.now();
      const rtt = receivedAt - sample.clientSentAt;

      const offset =
        ((sample.serverReceivedAt + sample.serverSentAt) / 2) -
        ((sample.clientSentAt + receivedAt) / 2);

      this.clockSamples.push({ rtt, offset });
      this.clockSamples = this.clockSamples.slice(-12);

      const best = [...this.clockSamples]
        .sort((a, b) => a.rtt - b.rtt)
        .slice(0, 5);

      this.serverOffsetMs =
        best.reduce((sum, item) => sum + item.offset, 0) /
        best.length;
    }

    serverNow() {
      return Date.now() + this.serverOffsetMs;
    }

    scheduleStart(startAt) {
      this.pendingStartAt = startAt;

      const waitMs = Math.max(
        0,
        startAt - this.serverNow()
      );

      setTimeout(async () => {
        if (this.pendingStartAt !== startAt) return;

        const lateBy = Math.max(
          0,
          (this.serverNow() - startAt) / 1000
        );

        this.seekSafely(lateBy);

        try {
          await this.audio.play();
          this.onStatus("playing");
        } catch (error) {
          this.onError("Tap Play on this device to allow playback.");
        }

        this.pendingStartAt = null;
      }, waitMs);
    }

    correctDrift(targetPosition) {
      if (!Number.isFinite(targetPosition)) return;
      if (this.pendingStartAt) return;
      if (this.audio.paused) return;

      const drift =
        targetPosition - this.audio.currentTime;

      const absDrift = Math.abs(drift);

      if (absDrift > 0.45) {
        this.seekSafely(targetPosition);

      } else if (absDrift > 0.08) {
        this.isApplyingCorrection = true;

        this.audio.playbackRate =
          drift > 0 ? 1.04 : 0.96;

        clearTimeout(this.driftTimer);

        this.driftTimer = setTimeout(() => {
          this.audio.playbackRate = 1;
          this.isApplyingCorrection = false;
        }, 1200);

      } else if (!this.isApplyingCorrection) {
        this.audio.playbackRate = 1;
      }
    }

    seekSafely(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) return;

      const apply = () => {
        if (Number.isFinite(this.audio.duration)) {
          this.audio.currentTime = Math.min(
            seconds,
            Math.max(0, this.audio.duration - 0.05)
          );
        } else {
          this.audio.currentTime = seconds;
        }
      };

      if (this.audio.readyState >= 1) {
        apply();
      } else {
        this.audio.addEventListener(
          "loadedmetadata",
          apply,
          { once: true }
        );
      }
    }

    disconnect() {
      clearInterval(this.syncTimer);
      clearTimeout(this.driftTimer);

      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
      }

      this.onStatus("disconnected");
    }
  }

  global.Syncbeat = Syncbeat;

})(window);
