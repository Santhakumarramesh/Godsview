/**
 * GodsView WebSocket Load Test — k6
 *
 * Run: k6 run load-tests/k6-websocket.js
 * Tests WS connection stability, subscription throughput, and message handling.
 */
import ws from "k6/ws";
import { check, sleep } from "k6";
import { Rate, Counter } from "k6/metrics";

const WS_URL = __ENV.WS_URL || "ws://localhost:3000/ws";
const wsErrors = new Rate("ws_errors");
const msgsReceived = new Counter("ws_messages_received");

export const options = {
  stages: [
    { duration: "15s", target: 20 },
    { duration: "30s", target: 50 },
    { duration: "30s", target: 100 },
    { duration: "15s", target: 0 },
  ],
  thresholds: {
    ws_errors: ["rate<0.1"],
    ws_messages_received: ["count>100"],
  },
};

export default function () {
  const res = ws.connect(WS_URL, {}, function (socket) {
    socket.on("open", () => {
      /* Subscribe to channels */
      socket.send(JSON.stringify({ type: "subscribe", channel: "signals" }));
      socket.send(JSON.stringify({ type: "subscribe", channel: "brain" }));
      socket.send(JSON.stringify({ type: "subscribe", channel: "trades" }));

      /* Keep alive with pings */
      socket.setInterval(() => {
        socket.send(JSON.stringify({ type: "ping" }));
      }, 5000);

      /* Disconnect after 20s */
      socket.setTimeout(() => {
        socket.send(JSON.stringify({ type: "unsubscribe", channel: "signals" }));
        socket.close();
      }, 20000);
    });

    socket.on("message", (data) => {
      msgsReceived.add(1);
      try {
        const msg = JSON.parse(data);
        check(msg, { "has type field": (m) => typeof m.type === "string" });
      } catch (e) {
        wsErrors.add(true);
      }
    });

    socket.on("error", (e) => {
      wsErrors.add(true);
    });

    socket.on("close", () => {});
  });

  check(res, { "WS status 101": (r) => r && r.status === 101 });
  sleep(1);
}
