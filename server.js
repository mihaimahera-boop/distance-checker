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
    t.includes("paroh") ||
    t.includes("church") ||
    t.includes("cathedral")
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
    "academia de",
    "club sportiv",
    "fitness school",
    "sala de curs",
  ];

  return excludedPatterns.some((p) => n.includes(p));
}

function shouldExcludeEducationFalsePositive(name) {
  const n = normalizeText(name);

  const excludedPatterns = [
    "primaria",
    "primarie",
    "city hall",
    "town hall",
    "consiliul local",
    "consiliu local",
    "prefectura",
    "politia",
    "jandarmeria",
    "posta",
    "tribunal",
    "judecatoria",
    "notariat",
    "parlament",
    "senat",
    "camera deputatilor",
    "directia",
    "administratia",
    "administratie",
    "serviciul public",
    "serviciu public",
    "spital",
    "clinica",
    "farmacie",
    "banca",
    "restaurant",
    "hotel",
    "market",
    "supermarket",
    "magazin",
    "mall",
    "bar",
    "cafe",
    "cofetarie",
    "library",
    "biblioteca",
    "muzeu",
    "teatru",
    "church",
    "biserica",
    "cathedral",
    "catedrala",
    "parohie",
    "manastire"
  ];

  return excludedPatterns.some((p) => n.includes(p));
}

function looksLikeRealSchool(name) {
  const n = normalizeText(name);

  const goodPatterns = [
    "scoala",
    "școala",
    "liceul",
    "liceu",
    "gradinita",
    "grădinița",
    "colegiul",
    "colegiu",
    "seminar",
    "universitatea",
    "universitate",
    "school",
    "kindergarten",
    "high school",
    "college",
    "university"
  ];

  return goodPatterns.some((p) => n.includes(p));
}

function shouldExcludeChurchFalsePositive(name) {
  const n = normalizeText(name);

  const excludedPatterns = [
    "restaurant",
    "hotel",
    "market",
    "supermarket",
    "magazin",
    "clinica",
    "farmacie",
    "scoala",
    "school",
    "liceu",
    "gradinita",
    "university",
    "universitate",
    "primaria",
    "primarie",
    "city hall",
    "town hall",
    "biblioteca",
    "muzeu",
    "teatru",
    "bar",
    "cafe",
    "cofetarie"
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

function prepareLocalPois(category) {
  let filtered = localPoiData.map((p) => ({
    ...p,
    type: normalizePoiType(p.type),
    lat: Number(p.lat),
    lon: Number(p.lon),
    name: p.name || "Obiectiv fără nume",
    source: p.source || "local",
  }));

  filtered = filtered.filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.name
  );

  filtered = filtered.filter((p) => {
    if (p.type === "invatamant") {
      if (shouldExcludeSchoolLike(p.name)) return false;
      if (shouldExcludeEducationFalsePositive(p.name)) return false;
    }

    if (p.type === "lacase_cult") {
      if (shouldExcludeChurchFalsePositive(p.name)) return false;
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

async function fetchGooglePlacesByKeyword(origin, keyword, radius = 300) {
  if (!GOOGLE_MAPS_API_KEY) return [];

  try {
    const url =
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${origin.lat},${origin.lng}` +
      `&radius=${radius}&keyword=${encodeURIComponent(keyword)}&key=${GOOGLE_MAPS_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.log("Google Places keyword status:", keyword, data.status);
      return [];
    }

    return (data.results || []).map((p) => ({
      name: p.name || "Obiectiv Google",
      lat: p.geometry?.location?.lat,
      lon: p.geometry?.location?.lng,
      googleTypes: Array.isArray(p.types) ? p.types : [],
      vicinity: p.vicinity || "",
      source: "google",
    }));
  } catch (err) {
    console.log("Eroare Google Places keyword:", keyword, err.message);
    return [];
  }
}

function classifyGooglePlace(place) {
  const name = normalizeText(place.name);
  const vicinity = normalizeText(place.vicinity);
  const joinedTypes = normalizeText((place.googleTypes || []).join(" "));

  const schoolSignals = [
    "scoala",
    "school",
    "liceu",
    "gradinita",
    "colegiu",
    "universitate",
    "university",
    "kindergarten",
    "high school",
    "college"
  ];

  const churchSignals = [
    "biserica",
    "church",
    "cathedral",
    "catedrala",
    "parohie",
    "manastire",
    "monastery"
  ];

  const hasSchoolSignal =
    schoolSignals.some((s) => name.includes(s) || vicinity.includes(s)) ||
    joinedTypes.includes("school") ||
    joinedTypes.includes("primary_school") ||
    joinedTypes.includes("secondary_school");

  const hasChurchSignal =
    churchSignals.some((s) => name.includes(s) || vicinity.includes(s)) ||
    joinedTypes.includes("church") ||
    joinedTypes.includes("place_of_worship");

  if (hasSchoolSignal && !hasChurchSignal) return "invatamant";
  if (hasChurchSignal && !hasSchoolSignal) return "lacase_cult";
  if (hasSchoolSignal && hasChurchSignal) {
    if (churchSignals.some((s) => name.includes(s))) return "lacase_cult";
    if (schoolSignals.some((s) => name.includes(s))) return "invatamant";
  }

  return "";
}

async function fetchOnlinePois(origin, category) {
  const keywords = [];

  if (category === "biserici") {
    keywords.push("biserica", "church", "parohie");
  } else if (category === "scoli") {
    keywords.push("scoala", "school", "gradinita", "liceu");
  } else {
    keywords.push("biserica", "church", "parohie", "scoala", "school", "gradinita", "liceu");
  }

  const results = await Promise.all(
    keywords.map((k) => fetchGooglePlacesByKeyword(origin, k, 300))
  );

  const merged = results.flat();

  const seen = new Set();
  const deduped = [];

  for (const p of merged) {
    const lat = Number(p.lat);
    const lon = Number(p.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const key = `${normalizeText(p.name)}|${lat.toFixed(6)}|${lon.toFixed(6)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const type = classifyGooglePlace(p);
    if (!type) continue;

    if (type === "invatamant") {
      if (shouldExcludeSchoolLike(p.name)) continue;
      if (shouldExcludeEducationFalsePositive(p.name)) continue;
      if (!looksLikeRealSchool(p.name)) continue;
    }

    if (type === "lacase_cult") {
      if (shouldExcludeChurchFalsePositive(p.name)) continue;
    }

    deduped.push({
      name: p.name,
      type,
      lat,
      lon,
      source: "google",
    });
  }

  return deduped;
}

function mergePois(localPois, onlinePois) {
  const seen = new Set();
  const merged = [];

  for (const p of [...localPois, ...onlinePois]) {
    const key = `${normalizeText(p.name)}|${Number(p.lat).toFixed(6)}|${Number(p.lon).toFixed(6)}|${p.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(p);
  }

  return merged;
}

async function buildDistanceResponse(origin, category, threshold) {
  const selectedThreshold = Number(threshold || 150);

  const localPois = prepareLocalPois(category);
  const onlinePois = await fetchOnlinePois(origin, category);
  const mergedPois = mergePois(localPois, onlinePois);

  const enriched = mergedPois.map((p) => ({
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
    stats: {
      local: localPois.length,
      google: onlinePois.length,
      total: mergedPois.length,
      biserici: mergedPois.filter((p) => p.type === "lacase_cult").length,
      scoli: mergedPois.filter((p) => p.type === "invatamant").length,
    },
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server pornit pe http://localhost:${PORT}`);
  console.log(`Cheie Google prezentă: ${!!GOOGLE_MAPS_API_KEY}`);
  console.log(`POI locale încărcate: ${localPoiData.length}`);
});