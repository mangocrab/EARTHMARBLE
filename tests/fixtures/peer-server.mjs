import { PeerServer } from "peer";
import { spawn } from "node:child_process";
const turn = spawn(
  process.env.TURN_SERVER_BIN || "turnserver",
  [
    "--listening-port=3208",
    "--listening-ip=127.0.0.1",
    "--relay-ip=127.0.0.1",
    "--min-port=49160",
    "--max-port=49200",
    "--lt-cred-mech",
    "--realm=earth-test",
    "--user=earth:earth-test",
    "--no-cli",
    "--no-tls",
    "--no-dtls",
    "--allow-loopback-peers",
    "--log-file=stdout",
    "--pidfile=/tmp/earth-peer-turn.pid",
  ],
  { stdio: "ignore" },
);
turn.on("error", (e) => {
  console.error("Test TCP TURN relay could not start:", e.message);
  process.exit(1);
});
PeerServer({ port: 3206, host: "127.0.0.1", path: "/" });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    turn.kill("SIGTERM");
    process.exit(0);
  });
