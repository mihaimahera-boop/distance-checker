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
    t === "invatamant" ||
    t === "educatie" ||
    t === "education" ||
    t === "school" ||
    t === "scoala" ||
    t === "școala" ||
    t === "gradinita" ||
    t === "grădiniță" ||
    t === "liceu" ||
    t === "kindergarten"
  ) {
    return "invatamant";
  }

  if (
    t === "lacase_cult" ||
    t === "lacas_cult" ||
    t === "religion" ||
    t === "cult" ||
    t === "church" ||
    t === "biserica" ||
    t === "biserici"
  ) {
    return "lacase_cult";
  }

  return t;
}

function isDrivingSchool(name) {
  const n = normalizeText(name);

  return (
    n.includes("scoala de soferi") ||
    n.includes("școala de șoferi") ||
    n.includes("driving school") ||
    n.includes("auto school") ||
    n.includes("instructor auto") ||
    n.includes("scoala auto") ||
    n.includes("școala auto")
  );
}

function detectTypeFromName(name) {
  const n = normalizeText(name);

  if (
    n.includes("biser") ||
    n.includes("church") ||
    n.includes("paroh") ||
    n.includes("manast") ||
    n.includes("mănăst") ||
    n.includes("catedr") ||
    n.includes("cathedral") ||
    n.includes("moschee") ||
    n.includes("mosque")
  ) {
    return "lacase_cult";
  }

  if (
    n.includes("gradinita") ||
    n.includes("grădiniț") ||
    n.includes("scoala") ||
    n.includes("școal") ||
    n.includes("liceu") ||
    n.includes("school") ||
    n.includes("kindergarten") ||
    n.includes("college") ||
    n.includes("seminar") ||
    n.includes("after school")
  ) {
    return "invatamant";
  }

  return null;
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

    console.log(
      `Directions request: ${origin.lat},${origin.lng} -> ${destination.lat},${destination.lng}`
    );

    const response = await fetch(url);
    const data = await response.json();

    console.log("Directions status:", data.status);

    if (data.status !== "OK" || !data.routes || !data.routes.length) {
      console.log("Directions error details:", data.error_message || data.status);
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
    console.log("Eroare la ruta pietonală:", err.message);
    return null;
  }
}

async function fetchNearbyByKeyword(lat, lng, keyword, radius) {
  try {
    const url =
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
      `?location=${lat},${lng}` +
      `&radius=${radius}` +
      `&keyword=${encodeURIComponent(keyword)}` +
      `&key=${GOOGLE_MAPS_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.log(`NearbySearch [${keyword}] status:`, data.status, data.error_message || "");
    }

    if (!Array.isArray(data.results)) return [];

    return data.results;
  } catch (err) {
    console.log(`Eroare NearbySearch [${keyword}]:`, err.message);
    return [];
  }
}

async function fetchOnlinePois(lat, lng, category, radius = 300) {
  if (!GOOGLE_MAPS_API_KEY) return [];

  const keywords = [];

  if (category === "biserici" || category === "ambele") {
    keywords.push("biserica");
    keywords.push("church");
    keywords.push("parohie");
    keywords.push("manastire");
    keywords.push("catedrala");
  }

  if (category === "scoli" || category === "ambele") {
    keywords.push("gradinita");
    keywords.push("grădiniță");
    keywords.push("scoala");
    keywords.push("școală");
    keywords.push("liceu");
    keywords.push("school");
    keywords.push("kindergarten");
    keywords.push("after school");
  }

  const results = [];

  for (const keyword of keywords) {
    const places = await fetchNearbyByKeyword(lat, lng, keyword, radius);

    for (const place of places) {
      const pLat = place.geometry?.location?.lat;
      const pLng = place.geometry?.location?.lng;
      const name = place.name || "";
      const vicinity = place.vicinity || "";

      if (!Number.isFinite(pLat) || !Number.isFinite(pLng) || !name) continue;

      let type = detectTypeFromName(name);

      if (!type) {
        type = detectTypeFromName(vicinity);
      }

      if (!type) continue;

      results.push({
        name,
        type,
        lat: pLat,
        lon: pLng,
        source: "online",
        placeId: place.place_id || null,
        vicinity,
      });
    }
  }

  const dedup = new Map();

  for (const item of results) {
    const key = `${normalizeText(item.name)}_${item.lat.toFixed(6)}_${item.lon.toFixed(6)}`;
    if (!dedup.has(key)) {
      dedup.set(key, item);
    }
  }

  return [...dedup.values()];
}

function prepareLocalPois(category) {
  let arr = localPoiData.map((p) => ({
    ...p,
    type: normalizePoiType(p.type),
    lat: Number(p.lat),
    lon: Number(p.lon),
    name: p.name || "Obiectiv fără nume",
    source: p.source || "csv",
  }));

  arr = arr.filter(
    (p) =>
      p.name &&
      p.type &&
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lon)
  );

  if (category === "biserici") {
    arr = arr.filter((p) => p.type === "lacase_cult");
  } else if (category === "scoli") {
    arr = arr.filter((p) => p.type === "invatamant");
  }

  arr = arr.filter((p) => {
    if (p.type === "invatamant" && isDrivingSchool(p.name)) return false;
    return true;
  });

  return arr;
}

function mergePois(localPois, onlinePois, category) {
  let merged = [...localPois, ...onlinePois];

  if (category === "biserici") {
    merged = merged.filter((p) => p.type === "lacase_cult");
  } else if (category === "scoli") {
    merged = merged.filter((p) => p.type === "invatamant");
  }

  merged = merged.filter((p) => {
    if (p.type === "invatamant" && isDrivingSchool(p.name)) return false;
    return true;
  });

  const dedup = new Map();

  for (const item of merged) {
    const key = `${normalizeText(item.name)}_${item.lat.toFixed(6)}_${item.lon.toFixed(6)}`;

    if (!dedup.has(key)) {
      dedup.set(key, item);
    } else {
      const existing = dedup.get(key);

      if (existing.source !== "csv" && item.source === "csv") {
        dedup.set(key, item);
      }
    }
  }

  return [...dedup.values()];
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
    const { address, category, threshold, manualLat, manualLng } = req.body;

    if (!address || !String(address).trim()) {
      return res.status(400).json({
        error: "Adresa este obligatorie.",
      });
    }

    const selectedThreshold = Number(threshold || 150);

    let origin = await geocodeAddress(String(address).trim());

    if (Number.isFinite(Number(manualLat)) && Number.isFinite(Number(manualLng))) {
      origin = {
        ...origin,
        lat: Number(manualLat),
        lng: Number(manualLng),
      };
    }

    const localPois = prepareLocalPois(category);

    const onlinePois = await fetchOnlinePois(
      origin.lat,
      origin.lng,
      category,
      Math.max(selectedThreshold, 300)
    );

    let filtered = mergePois(localPois, onlinePois, category);

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

    return res.json({
      origin,
      threshold: selectedThreshold,
      nearest,
      pointsUnderThreshold,
      walking,
      verdict:
        nearest && nearest.distanceMeters < selectedThreshold ? "SUB prag" : "OK",
      hasGoogleKey: !!GOOGLE_MAPS_API_KEY,
    });
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