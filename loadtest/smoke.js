// Load test with k6 (https://k6.io). Nothing to install: run it with Docker.
//
//   docker run --rm -v "${PWD}/loadtest:/scripts" -e BASE_URL=http://host.docker.internal:8080 \
//     -e PROFILE=load grafana/k6 run /scripts/smoke.js
//
// Against AWS: -e BASE_URL=https://weatherradarapp.duckdns.org
//
// PROFILE: smoke  = 1 virtual user for 20 s (does it work at all?)
//          load   = up to 20 users for ~2 min (the expected university-level traffic)  [default]
//          stress = ramps up to 100 users (where does it start to hurt?)
//
// What a virtual user does, like a real visitor: opens the page, reads the platform's data (the
// sources and the latest products) and checks health. One visit in five is a first-time visitor
// that also downloads the JavaScript/CSS bundle (repeat visitors have it in their browser cache).
// The satellite and radar tiles come straight from EUMETSAT and RainViewer, not from our server,
// so they are not part of this test.
import http from "k6/http";
import { check, group, sleep } from "k6";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:8080").replace(/\/$/, "");
const PROFILE = __ENV.PROFILE || "load";

const STAGES = {
  smoke: [{ duration: "20s", target: 1 }],
  load: [
    { duration: "30s", target: 20 },
    { duration: "1m", target: 20 },
    { duration: "15s", target: 0 },
  ],
  stress: [
    { duration: "30s", target: 20 },
    { duration: "30s", target: 50 },
    { duration: "30s", target: 100 },
    { duration: "1m", target: 100 },
    { duration: "20s", target: 0 },
  ],
};

export const options = {
  stages: STAGES[PROFILE] || STAGES.load,
  thresholds: {
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"],
    // one threshold per kind of request, so a slow endpoint cannot hide behind fast ones
    "http_req_duration{endpoint:page}": ["p(95)<800"],
    "http_req_duration{endpoint:health}": ["p(95)<500"],
    "http_req_duration{endpoint:providers}": ["p(95)<500"],
    "http_req_duration{endpoint:products}": ["p(95)<800"],
    "http_req_duration{endpoint:asset}": ["p(95)<2000"],
  },
};

// Finds the hashed JS/CSS files the home page loads, once, before the test starts.
export function setup() {
  const page = http.get(`${BASE_URL}/`);
  if (page.status !== 200) throw new Error(`${BASE_URL}/ answered ${page.status}: is the stack up?`);
  const assets = [...page.body.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  console.log(`profile=${PROFILE} base=${BASE_URL} bundle files=${assets.length}`);
  return { assets };
}

const get = (path, endpoint) => ["GET", `${BASE_URL}${path}`, null, { tags: { endpoint } }];
const ok = (res) => res.status === 200;

export default function (data) {
  group("visit", () => {
    check(http.get(`${BASE_URL}/`, { tags: { endpoint: "page" } }), { "page is 200": ok });

    if (__ITER % 5 === 0 && data.assets.length > 0) {
      const files = http.batch(data.assets.map((path) => get(path, "asset")));
      check(files[0], { "bundle is 200": ok });
    }

    const [providers, products] = http.batch([get("/api/providers", "providers"), get("/api/products?limit=20", "products")]);
    check(providers, { "providers is 200": ok, "providers is a list": (r) => Array.isArray(r.json()) });
    check(products, { "products is 200": ok, "products is a list": (r) => Array.isArray(r.json()) });
  });

  const health = http.get(`${BASE_URL}/api/health`, { tags: { endpoint: "health" } });
  check(health, { "health is 200": ok, "database is up": (r) => r.json("status") === "ok" });

  sleep(1 + Math.random()); // people read the map between requests
}
