#!/usr/bin/env bash
set -euo pipefail
# A local TCP relay for browser tests; no public listener or external credentials.
local_docker() {
  env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
    docker --host=unix:///var/run/docker.sock "$@"
}
case "${1:-start}" in
  start)
    local_docker run --detach --name earthmarble-test-turn --network host coturn/coturn:4.6.3 \
      --listening-port=3208 --listening-ip=127.0.0.1 --relay-ip=127.0.0.1 \
      --min-port=49160 --max-port=49200 --lt-cred-mech --realm=earth-test \
      --user=earth:earth-test --no-cli --no-tls --no-dtls --allow-loopback-peers \
      --log-file=stdout --pidfile=/tmp/earth-test-turn.pid
    node --input-type=module <<'JS'
import { connect } from "node:net";
import { setTimeout } from "node:timers/promises";
const deadline = Date.now() + 15000;
for (;;) {
  try {
    await new Promise((resolve, reject) => {
      const socket = connect(3208, "127.0.0.1");
      socket.setTimeout(1000, () => { socket.destroy(); reject(Error("TURN timeout")); });
      socket.once("connect", () => { socket.destroy(); resolve(); });
      socket.once("error", reject);
    });
    break;
  } catch (error) {
    if (Date.now() >= deadline) throw error;
    await setTimeout(200);
  }
}
JS
    ;;
  stop)
    local_docker rm --force earthmarble-test-turn 2>/dev/null || true
    ;;
  *) echo "Usage: $0 start|stop" >&2; exit 2 ;;
esac
