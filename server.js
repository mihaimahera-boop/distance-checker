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

function normalizeText(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isExcludedEducationalName(name) {
  const t = normalizeText(name);

  // 🔥 BLOCĂM ORICE conține astea (FOARTE IMPORTANT)
  const blocked = [
    "after school",
    "afterschool",
    "before school",
    "driving school",
    "scoala de soferi",
    "școala de șoferi",
    "auto school",
    "curs",
    "cursuri",
    "training",
    "academy",
    "academie",
    "coaching",
    "workshop",
    "meditatii",
    "meditații",
    "pregatire",
    "pregătire",
    "learning center",
    "educational center",
    "centru educational",
    "centru educațional"
  ];

  if (blocked.some(x => t.includes(normalizeText(x)))) {
    return true;
  }

  // ✅ DOAR astea sunt acceptate ca educație reală
  const allowed = [
    "gradinita",
    "grădini",
    "kindergarten",
    "liceu",
    "scoala gimnaziala",
    "școala gimnazială",
    "colegiu",
    "colegiul",
    "universitate",
    "universitatea",
    "school",
    "high school",
    "college",
    "university"
  ];

  // dacă NU e în allowed → îl excludem
  return !allowed.some(x => t.includes(normalizeText(x)));
}

function normalizePoiType(type, name = "") {
  const t = normalizeText(type);
  const n = normalizeText(name);

  if (
    t.includes("invatamant") ||
    t.includes("educatie") ||
    t.includes("education") ||
    t.includes("scoala") ||
    t.includes("școala") ||
    t.includes("gradinita") ||
    t.includes("grădini") ||
    t.includes("liceu") ||
    t.includes("school") ||
    t.includes("kindergarten") ||
    t.includes("college") ||
    t.includes("university")
  ) {
    return "invatamant";
  }

  if (
    n.includes("gradinita") ||
    n.includes("grădini") ||
    n.includes("kindergarten") ||
    n.includes("liceu") ||
    n.includes("school") ||
    n.includes("college") ||
    n.includes("universitate") ||
    n.includes("universitatea")
  ) {
    return "invatamant";
  }

  if (
    t.includes("lacase_cult") ||
    t.includes("lacas_cult") ||
    t.includes("religie") ||
    t.includes("religion") ||
    t.includes("cult") ||
    t.includes("biser") ||
    t.includes("church") ||
    t.includes("manast") ||
    t.includes("mănăst") ||
    t.includes("paroh")
  ) {
    return "lacase_cult";
  }

  if (
    n.includes("biser") ||
    n.includes("church") ||
    n.includes("paroh") ||
    n.includes("manast") ||
    n.includes("mănăst")
  ) {
    return "lacase_cult";
  }

  return t;
}

function dedupePois(points) {
  const seen = new Set();
  const result = [];

  for (const p of points) {
    const key = [
      normalizeText(p.name),
      normalizePoiType(p.type, p.name),
      Number(p.lat).toFixed(6),
      Number(p.lon).toFixed(6),
    ].join("|");

    if (!seen.has(key)) {
      seen.add(key);
      result.push(p);
    }
  }

  return result;
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

async function reverseGeocode(lat, lng) {
  if (!GOOGLE_MAPS_API_KEY) return null;

  try {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}` +
      `&key=${GOOGLE_MAPS_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "OK" || !data.results || !data.results.length) {
      return null;
    }

    return data.results[0].formatted_address || null;
  } catch {
    return null;
  }
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
      if (data.error_message) {
        console.log("Directions error:", data.error_message);
      }
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
    console.log("Eroare Directions:", err.message);
    return null;
  }
}

async function searchNearbyOnline(origin, category, radius = 1200) {
  if (!GOOGLE_MAPS_API_KEY) return [];

  let keyword = "";
  if (category === "biserici") keyword = "church";
  else if (category === "scoli") keyword = "school kindergarten";
  else keyword = "church school kindergarten";

  try {
    const url =
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${origin.lat},${origin.lng}` +
      `&radius=${radius}&keyword=${encodeURIComponent(keyword)}&key=${GOOGLE_MAPS_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.log("Places status:", data.status);
      if (data.error_message) {
        console.log("Places error:", data.error_message);
      }
      return [];
    }

    const results = data.results || [];

    return results
      .map((p) => {
        const name = p.name || "Obiectiv online";
        const text = normalizeText(name);

        let type = "";

        if (
          text.includes("biser") ||
          text.includes("church") ||
          text.includes("paroh") ||
          text.includes("manast") ||
          text.includes("mănăst")
        ) {
          type = "lacase_cult";
        } else if (
          text.includes("scoal") ||
          text.includes("școal") ||
          text.includes("gradinita") ||
          text.includes("grădini") ||
          text.includes("kindergarten") ||
          text.includes("lice") ||
          text.includes("school") ||
          text.includes("college") ||
          text.includes("university")
        ) {
          type = "invatamant";
        } else {
          if (category === "biserici") type = "lacase_cult";
          else if (category === "scoli") type = "invatamant";
          else type = normalizePoiType("", name);
        }

        return {
          name,
          type,
          lat: Number(p.geometry?.location?.lat),
          lon: Number(p.geometry?.location?.lng),
          source: "online",
        };
      })
      .filter((p) => {
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) {
          return false;
        }

        if (category === "biserici" && p.type !== "lacase_cult") {
          return false;
        }

        if (category === "scoli" && p.type !== "invatamant") {
          return false;
        }

        if (
          p.type === "invatamant" &&
          isExcludedEducationalName(p.name)
        ) {
          return false;
        }

        return p.type === "lacase_cult" || p.type === "invatamant";
      });
  } catch (err) {
    console.log("Eroare Places:", err.message);
    return [];
  }
}

function getFilteredLocalPoi(category) {
  let filtered = localPoiData.map((p) => ({
    ...p,
    type: normalizePoiType(p.type, p.name),
    lat: Number(p.lat),
    lon: Number(p.lon),
    name: p.name || "Obiectiv fără nume",
    source: p.source || "local",
  }));

  filtered = filtered.filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.name
  );

  if (category === "biserici") {
    filtered = filtered.filter((p) => p.type === "lacase_cult");
  } else if (category === "scoli") {
    filtered = filtered.filter((p) => p.type === "invatamant");
  } else {
    filtered = filtered.filter(
      (p) => p.type === "lacase_cult" || p.type === "invatamant"
    );
  }

  filtered = filtered.filter((p) => {
    const isRelevantType =
      p.type === "lacase_cult" || p.type === "invatamant";

    if (!isRelevantType) return false;

    if (p.type === "invatamant" && isExcludedEducationalName(p.name)) {
      return false;
    }

    return true;
  });

  return filtered;
}

async function analyzePoint({ origin, category, threshold, formattedAddress }) {
  const localPoints = getFilteredLocalPoi(category);
  const onlinePoints = await searchNearbyOnline(origin, category, 1200);

  let allPoints = [...localPoints, ...onlinePoints];
  allPoints = dedupePois(allPoints);

  const enriched = allPoints.map((p) => ({
    ...p,
    distanceMeters: haversine(origin.lat, origin.lng, p.lat, p.lon),
  }));

  enriched.sort((a, b) => a.distanceMeters - b.distanceMeters);

  const nearest = enriched.length ? enriched[0] : null;
  const pointsUnderThreshold = enriched.filter((p) => p.distanceMeters <= threshold);

  let walking = null;
  if (nearest) {
    walking = await getWalkingRoute(
      { lat: origin.lat, lng: origin.lng },
      { lat: nearest.lat, lng: nearest.lon }
    );
  }

  return {
    origin: {
      lat: origin.lat,
      lng: origin.lng,
      formattedAddress: formattedAddress || `${origin.lat}, ${origin.lng}`,
    },
    threshold,
    nearest,
    pointsUnderThreshold,
    walking,
    verdict: nearest && nearest.distanceMeters < threshold ? "SUB prag" : "OK",
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

    const selectedThreshold = Number(threshold || 150);
    const selectedCategory = String(category || "ambele");

    const origin = await geocodeAddress(String(address).trim());

    const result = await analyzePoint({
      origin: { lat: origin.lat, lng: origin.lng },
      category: selectedCategory,
      threshold: selectedThreshold,
      formattedAddress: origin.formattedAddress,
    });

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

    const selectedThreshold = Number(threshold || 150);
    const selectedCategory = String(category || "ambele");

    const origin = {
      lat: Number(lat),
      lng: Number(lng),
    };

    const formattedAddress = await reverseGeocode(origin.lat, origin.lng);

    const result = await analyzePoint({
      origin,
      category: selectedCategory,
      threshold: selectedThreshold,
      formattedAddress,
    });

    return res.json(result);
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Eroare internă la verificarea după coordonate.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server pornit pe http://localhost:${PORT}`);
  console.log(`Cheie Google prezentă: ${!!GOOGLE_MAPS_API_KEY}`);
  console.log(`POI locale încărcate: ${localPoiData.length}`);
});