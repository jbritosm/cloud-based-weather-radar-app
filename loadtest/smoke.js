// Load test with k6 (https://k6.io). Run without installing anything:
//   docker run --rm -i -e BASE_URL=http://host.docker.internal:8080 grafana/k6 run - < loadtest/smoke.js
// Against AWS: -e BASE_URL=http://<elastic-ip>
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  stages: [
    { duration: "30s", target: 20 },
    { duration: "1m", target: 20 },
    { duration: "15s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";

export default function () {
  const responses = http.batch([
    ["GET", `${BASE_URL}/`],
    ["GET", `${BASE_URL}/api/health`],
    ["GET", `${BASE_URL}/api/products?limit=20`],
  ]);
  responses.forEach((r) => check(r, { "status is 200": (res) => res.status === 200 }));
  sleep(1);
}
