// Flights pusher for GitHub Actions.
// Fetches all 6 coverage zones from free ADS-B providers and pushes each
// snapshot to the app ingest hook. Same provider order/fallback as the app.
//
// Required env: FLIGHTS_HOOK_SECRET (GitHub Actions repository secret)

const HOOK =
  "https://desk.8racle.com/api/public/hooks/ingest-flights";
const SECRET = process.env.FLIGHTS_HOOK_SECRET;

if (!SECRET) {
  console.error("missing FLIGHTS_HOOK_SECRET");
  process.exit(1);
}

// zone index → [lat, lon]
const ZONES = [
  [40, -100],
  [-20, -60],
  [35, 15],
  [-18, 28],
  [35, 100],
  [-15, 145],
];

const PROVIDERS = [
  { name: "adsb.lol", maxNm: 2500, url: (a, o, n) => `https://api.adsb.lol/v2/point/${a}/${o}/${n}` },
  { name: "airplanes.live", maxNm: 250, url: (a, o, n) => `https://api.airplanes.live/v2/point/${a}/${o}/${n}` },
  { name: "adsb.fi", maxNm: 250, url: (a, o, n) => `https://opendata.adsb.fi/api/v2/lat/${a}/lon/${o}/dist/${n}` },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchZone(lat, lon) {
  for (const p of PROVIDERS) {
    const nm = Math.min(2500, p.maxNm);
    try {
      const r = await fetch(p.url(lat, lon, nm), {
        headers: { "User-Agent": "8racle-worldmap/2.0", Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!r.ok) {
        console.warn(`[flights] ${p.name} ${r.status}`);
      } else {
        const j = await r.json();
        const list = j.ac ?? j.aircraft ?? [];
        if (list.length) return { provider: p.name, coverageRadiusNm: nm, list };
        console.warn(`[flights] ${p.name} returned no aircraft`);
      }
    } catch (e) {
      console.warn(`[flights] ${p.name} err ${e.message}`);
    }
    await sleep(2000);
  }
  return null;
}

let pushed = 0;
let failed = 0;

for (let zone = 0; zone < ZONES.length; zone++) {
  const [lat, lon] = ZONES[zone];
  const got = await fetchZone(lat, lon);
  if (got) {
    try {
      const r = await fetch(HOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-hook-secret": SECRET },
        body: JSON.stringify({
          zone,
          provider: got.provider,
          coverage_radius_nm: got.coverageRadiusNm,
          aircraft: got.list,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) {
        console.warn(`[flights] push zone ${zone} -> ${r.status} ${await r.text()}`);
        failed++;
      } else {
        pushed++;
        console.log(`[flights] zone ${zone} ${got.list.length} ac via ${got.provider}`);
      }
    } catch (e) {
      console.warn(`[flights] push zone ${zone} err ${e.message}`);
      failed++;
    }
  } else {
    failed++;
  }
  await sleep(2000);
}

console.log(`[flights] done: pushed ${pushed}, failed ${failed}`);
if (pushed === 0) process.exit(1);
