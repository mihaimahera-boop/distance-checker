const express = require("express");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, ".env") });

const app = express();
const PORT = process.env.PORT || 3000;
const GOOGLE_MAPS_API_KEY = (process.env.GOOGLE_MAPS_API_KEY || "").trim();

app.use(express.json({ limit: "2mb" }));
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
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function normalizePoiType(type) {
  const t = normalizeText(type);

  if (
    t === "invatamant" ||
    t === "scoala" ||
    t === "scoli" ||
    t === "school" ||
    t === "education" ||
    t === "educatie" ||
    t === "liceu" ||
    t === "gradinita" ||
    t === "universitate"
  ) {
    return "invatamant";
  }

  if (
    t === "lacase_cult" ||
    t === "lacas_cult" ||
    t === "lacas de cult" ||
    t === "lacase de cult" ||
    t === "biserica" ||
    t === "biserici" ||
    t === "church" ||
    t === "religion" ||
    t === "cult"
  ) {
    return "lacase_cult";
  }

  return t;
}

function mapGooglePlaceToType(place, fallbackType = "") {
  const types = Array.isArray(place.types) ? place.types.map(normalizeText) : [];
  const name = normalizeText(place.name);

  if (
    types.includes("school") ||
    types.includes("primary_school") ||
    types.includes("secondary_school") ||
    types.includes("university") ||
    name.includes("scoala") ||
    name.includes("colegiul") ||
    name.includes("liceul") ||
    name.includes("gradinita") ||
    name.includes("universitatea")
  ) {
    return "invatamant";
  }

  if (
    types.includes("church") ||
    types.includes("place_of_worship") ||
    types.includes("hindu_temple") ||
    types.includes("mosque") ||
    types.includes("synagogue") ||
    name.includes("biserica") ||
    name.includes("manastirea") ||
    name.includes("parohia") ||
    name.includes("catedrala")
  ) {
    return "lacase_cult";
  }

  return normalizePoiType(fallbackType);
}

function dedupePois(items) {
  const out = [];
  const seen = new Set();

  for (const item of items) {
    const nameKey = normalizeText(item.name);
    const latKey = Number(item.lat).toFixed(5);
    const lonKey = Number(item.lon).toFixed(5);
    const typeKey = normalizePoiType(item.type);
    const key = `${nameKey}|${latKey}|${lonKey}|${typeKey}`;

    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }

  return out;
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

    console.log(`➡️ Directions request: ${origin.lat},${origin.lng} -> ${destination.lat},${destination.lng}`);

    const response = await fetch(url);
    const data = await response.json();

    console.log("➡️ Directions status:", data.status);

    if (data.status !== "OK" || !data.routes || !data.routes.length) {
      console.log("❌ Directions error details:", data.error_message || data.status);
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
    console.log("❌ Eroare getWalkingRoute:", err.message);
    return null;
  }
}

function buildNearbyUrl({ lat, lng, radius, type, keyword }) {
  const params = new URLSearchParams({
    location: `${lat},${lng}`,
    radius: String(radius),
    key: GOOGLE_MAPS_API_KEY,
  });

  if (type) params.set("type", type);
  if (keyword) params.set("keyword", keyword);

  return `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params.toString()}`;
}

function buildTextSearchUrl({ query, lat, lng, radius }) {
  const params = new URLSearchParams({
    query,
    location: `${lat},${lng}`,
    radius: String(radius),
    key: GOOGLE_MAPS_API_KEY,
  });

  return `https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`;
}

async function fetchGooglePlaces(url, forcedType = "") {
  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.log("Google Places status:", data.status, data.error_message || "");
    }

    if (!Array.isArray(data.results)) {
      return [];
    }

    return data.results
      .map((place) => ({
        name: place.name || "Obiectiv Google",
        type: mapGooglePlaceToType(place, forcedType),
        lat: Number(place.geometry?.location?.lat),
        lon: Number(place.geometry?.location?.lng),
        source: "google",
        placeId: place.place_id || null,
        vicinity: place.vicinity || place.formatted_address || "",
      }))
      .filter(
        (p) =>
          p.name &&
          Number.isFinite(p.lat) &&
          Number.isFinite(p.lon) &&
          (p.type === "invatamant" || p.type === "lacase_cult")
      );
  } catch (err) {
    console.log("❌ Eroare fetchGooglePlaces:", err.message);
    return [];
  }
}

async function searchOnlinePois(origin, category, radiusMeters = 1000) {
  if (!GOOGLE_MAPS_API_KEY) return [];

  const tasks = [];

  if (category === "ambele" || category === "biserici") {
    tasks.push(
      fetchGooglePlaces(
        buildNearbyUrl({
          lat: origin.lat,
          lng: origin.lng,
          radius: radiusMeters,
          type: "church",
          keyword: "biserica",
        }),
        "lacase_cult"
      )
    );

    tasks.push(
      fetchGooglePlaces(
        buildNearbyUrl({
          lat: origin.lat,
          lng: origin.lng,
          radius: radiusMeters,
          type: "place_of_worship",
          keyword: "biserica",
        }),
        "lacase_cult"
      )
    );

    tasks.push(
      fetchGooglePlaces(
        buildTextSearchUrl({
          query: "biserica ortodoxa",
          lat: origin.lat,
          lng: origin.lng,
          radius: radiusMeters,
        }),
        "lacase_cult"
      )
    );

    tasks.push(
      fetchGooglePlaces(
        buildTextSearchUrl({
          query: "church",
          lat: origin.lat,
          lng: origin.lng,
          radius: radiusMeters,
        }),
        "lacase_cult"
      )
    );
  }

  if (category === "ambele" || category === "scoli") {
    tasks.push(
      fetchGooglePlaces(
        buildNearbyUrl({
          lat: origin.lat,
          lng: origin.lng,
          radius: radiusMeters,
          type: "school",
          keyword: "scoala",
        }),
        "invatamant"
      )
    );

    tasks.push(
      fetchGooglePlaces(
        buildTextSearchUrl({
          query: "scoala",
          lat: origin.lat,
          lng: origin.lng,
          radius: radiusMeters,
        }),
        "invatamant"
      )
    );

    tasks.push(
      fetchGooglePlaces(
        buildTextSearchUrl({
          query: "liceu",
          lat: origin.lat,
          lng: origin.lng,
          radius: radiusMeters,
        }),
        "invatamant"
      )
    );

    tasks.push(
      fetchGooglePlaces(
        buildTextSearchUrl({
          query: "gradinita",
          lat: origin.lat,
          lng: origin.lng,
          radius: radiusMeters,
        }),
        "invatamant"
      )
    );
  }

  const results = await Promise.all(tasks);
  return dedupePois(results.flat());
}

function getLocalPois(category) {
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
      p.name &&
      (p.type === "invatamant" || p.type === "lacase_cult")
  );

  if (category === "biserici") {
    filtered = filtered.filter((p) => p.type === "lacase_cult");
  } else if (category === "scoli") {
    filtered = filtered.filter((p) => p.type === "invatamant");
  }

  return filtered;
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

    const selectedCategory = ["ambele", "biserici", "scoli"].includes(category)
      ? category
      : "ambele";

    const selectedThreshold = Number(threshold || 150);
    const origin = await geocodeAddress(String(address).trim());

    const localPois = getLocalPois(selectedCategory);
    const onlinePois = await searchOnlinePois(origin, selectedCategory, Math.max(selectedThreshold, 1000));

    let combined = dedupePois([...localPois, ...onlinePois]);

    combined = combined.map((p) => ({
      ...p,
      distanceMeters: haversine(origin.lat, origin.lng, p.lat, p.lon),
    }));

    combined.sort((a, b) => a.distanceMeters - b.distanceMeters);

    const nearest = combined.length ? combined[0] : null;
    const pointsUnderThreshold = combined.filter(
      (p) => p.distanceMeters <= selectedThreshold
    );

    console.log("📍 Rezultate apropiate:", combined.slice(0, 10).map((x) => ({
      name: x.name,
      type: x.type,
      source: x.source,
      distanceMeters: Math.round(x.distanceMeters),
    })));

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
      stats: {
        localCount: localPois.length,
        onlineCount: onlinePois.length,
        combinedCount: combined.length,
      },
    });
  } catch (err) {
    console.log("❌ Eroare /api/check-distance:", err.message);

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