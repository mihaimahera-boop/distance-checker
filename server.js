const express = require("express");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, ".env") });

const app = express();
const PORT = process.env.PORT || 3000;
const GOOGLE_MAPS_API_KEY = (process.env.GOOGLE_MAPS_API_KEY || "").trim();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let localPoiData = [];
try {
  const raw = fs.readFileSync(path.join(__dirname, "data", "poi.json"), "utf8");
  localPoiData = JSON.parse(raw);

  if (!Array.isArray(localPoiData)) {
    localPoiData = [];
  }
} catch (err) {
  console.log("Eroare la citirea data/poi.json:", err.message);
  localPoiData = [];
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeText(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function normalizePoiType(type) {
  const t = normalizeText(type);

  if (
    t.includes("invatamant") ||
    t.includes("educatie") ||
    t.includes("education") ||
    t.includes("school") ||
    t.includes("scoala") ||
    t.includes("gradinita") ||
    t.includes("liceu") ||
    t.includes("colegiu") ||
    t.includes("universitate") ||
    t.includes("after school") ||
    t.includes("afterschool")
  ) {
    return "invatamant";
  }

  if (
    t.includes("lacase_cult") ||
    t.includes("lacas_cult") ||
    t.includes("cult") ||
    t.includes("relig") ||
    t.includes("biseric") ||
    t.includes("manast") ||
    t.includes("catedr") ||
    t.includes("paroh")
  ) {
    return "lacase_cult";
  }

  return t;
}

function shouldExcludeSchoolLike(name) {
  const n = normalizeText(name);

  const excludedPatterns = [
    "scoala de soferi",
    "scoala soferi",
    "driver school",
    "driving school",
    "auto school",
    "after school",
    "afterschool",
    "beauty school",
    "make-up school",
    "makeup school",
    "dance school",
    "music school",
    "school of",
    "training center",
    "centru de formare",
    "centru formare",
    "cursuri",
    "meditatii",
    "meditatie",
    "curs",
    "atelier",
    "workshop",
    "creative boutique",
    "academy",
    "academy ",
    "academia de",
    "club sportiv",
    "fitness school",
    "sala de curs",
  ];

  return excludedPatterns.some((p) => n.includes(p));
}

async function geocodeAddress(address) {
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error("Lipsește cheia Google Maps în .env");
  }

  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}` +
    `&key=${GOOGLE_MAPS_API_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok) {
    throw new Error("Eroare la serviciul de geocodare Google.");
  }

  if (data.status !== "OK" || !data.results || !data.results.length) {
    throw new Error(data.error_message || "Adresa nu a putut fi geocodată.");
  }

  const result = data.results[0];

  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    formattedAddress: result.formatted_address,
  };
}

async function getWalkingRoute(origin, destination) {
  if (!GOOGLE_MAPS_API_KEY) return null;

  try {
    const url =
      `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.lat},${origin.lng}` +
      `&destination=${destination.lat},${destination.lng}` +
      `&mode=walking&key=${GOOGLE_MAPS_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "OK" || !data.routes || !data.routes.length) {
      console.log("Directions status:", data.status);
      return null;
    }

    const route = data.routes[0];
    const leg = route.legs?.[0];
    if (!leg) return null;

    return {
      distanceMeters: leg.distance?.value ?? null,
      distanceText: leg.distance?.text ?? null,
      durationText: leg.duration?.text ?? null,
      polyline: route.overview_polyline?.points ?? null,
    };
  } catch (err) {
    console.log("Eroare walking route:", err.message);
    return null;
  }
}

function preparePois(category) {
  let filtered = localPoiData.map((p) => ({
    ...p,
    type: normalizePoiType(p.type),
    lat: Number(p.lat),
    lon: Number(p.lon),
    name: p.name || "Obiectiv fără nume",
    source: p.source || "local",
  }));

  filtered = filtered.filter(
    (p) =>
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lon) &&
      p.name
  );

  filtered = filtered.filter((p) => {
    if (p.type === "invatamant" && shouldExcludeSchoolLike(p.name)) {
      return false;
    }
    return true;
  });

  if (category === "biserici") {
    filtered = filtered.filter((p) => p.type === "lacase_cult");
  } else if (category === "scoli") {
    filtered = filtered.filter((p) => p.type === "invatamant");
  }

  return filtered;
}

async function buildDistanceResponse(origin, category, threshold) {
  const selectedThreshold = Number(threshold || 150);
  const filtered = preparePois(category);

  const enriched = filtered.map((p) => ({
    ...p,
    distanceMeters: haversine(origin.lat, origin.lng, p.lat, p.lon),
  }));

  enriched.sort((a, b) => a.distanceMeters - b.distanceMeters);

  const nearest = enriched.length ? enriched[0] : null;
  const pointsUnderThreshold = enriched.filter(
    (p) => p.distanceMeters <= selectedThreshold
  );

  let walking = null;
  if (nearest) {
    walking = await getWalkingRoute(
      { lat: origin.lat, lng: origin.lng },
      { lat: nearest.lat, lng: nearest.lon }
    );
  }

  return {
    origin,
    threshold: selectedThreshold,
    nearest,
    pointsUnderThreshold,
    walking,
    verdict:
      nearest && nearest.distanceMeters < selectedThreshold ? "SUB prag" : "OK",
    hasGoogleKey: !!GOOGLE_MAPS_API_KEY,
  };
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    hasGoogleKey: !!GOOGLE_MAPS_API_KEY,
    poiCount: localPoiData.length,
  });
});

app.get("/api/config", (req, res) => {
  res.json({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY || null,
  });
});

app.post("/api/check-distance", async (req, res) => {
  try {
    const { address, category, threshold } = req.body;

    if (!address || !String(address).trim()) {
      return res.status(400).json({
        error: "Adresa este obligatorie.",
      });
    }

    const origin = await geocodeAddress(String(address).trim());
    const result = await buildDistanceResponse(origin, category, threshold);

    return res.json(result);
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Eroare internă la verificarea distanței.",
    });
  }
});

app.post("/api/check-distance-by-coords", async (req, res) => {
  try {
    const { lat, lng, category, threshold } = req.body;

    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
      return res.status(400).json({
        error: "Coordonatele sunt invalide.",
      });
    }

    const origin = {
      lat: Number(lat),
      lng: Number(lng),
      formattedAddress: `Coordonate mutate manual: ${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`,
    };

    const result = await buildDistanceResponse(origin, category, threshold);

    return res.json(result);
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Eroare internă la verificarea distanței.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server pornit pe http://localhost:${PORT}`);
  console.log(`Cheie Google prezentă: ${!!GOOGLE_MAPS_API_KEY}`);
  console.log(`POI locale încărcate: ${localPoiData.length}`);
});