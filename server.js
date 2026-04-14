require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const poiPath = path.join(__dirname, "data", "poi.json");

function loadPoi() {
  try {
    const raw = fs.readFileSync(poiPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("Eroare la citirea poi.json:", err.message);
    return [];
  }
}

function toRadians(deg) {
  return deg * (Math.PI / 180);
}

function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeType(value) {
  const t = normalizeText(value);

  if (
    t.includes("biser") ||
    t.includes("manast") ||
    t.includes("lacas") ||
    t.includes("cult") ||
    t.includes("church")
  ) {
    return "lacas_cult";
  }

  if (
    t.includes("scoal") ||
    t.includes("gradinit") ||
    t.includes("lice") ||
    t.includes("coleg") ||
    t.includes("unitate") ||
    t.includes("invat")
  ) {
    return "unitate_invatamant";
  }

  return t;
}

function parseCoord(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(",", ".").trim());
  return Number.isFinite(n) ? n : null;
}

async function geocodeAddress(address) {
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error("Lipsește GOOGLE_MAPS_API_KEY în .env");
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    address
  )}&key=${GOOGLE_MAPS_API_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  if (!data.results || !data.results.length) {
    throw new Error("Adresa nu a putut fi geocodată.");
  }

  const result = data.results[0];

  return {
    formattedAddress: result.formatted_address,
    lat: result.geometry.location.lat,
    lon: result.geometry.location.lng
  };
}

async function getWalkingDistance(origin, destination) {
  if (!GOOGLE_MAPS_API_KEY) {
    return { distanceMeters: null, duration: null };
  }

  const url = "https://routes.googleapis.com/directions/v2:computeRoutes";

  const body = {
    origin: {
      location: {
        latLng: {
          latitude: origin.lat,
          longitude: origin.lon
        }
      }
    },
    destination: {
      location: {
        latLng: {
          latitude: destination.lat,
          longitude: destination.lon
        }
      }
    },
    travelMode: "WALK",
    computeAlternativeRoutes: false,
    languageCode: "ro",
    units: "METRIC"
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
      "X-Goog-FieldMask": "routes.distanceMeters,routes.duration"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    return { distanceMeters: null, duration: null };
  }

  const data = await response.json();

  if (!data.routes || !data.routes.length) {
    return { distanceMeters: null, duration: null };
  }

  return {
    distanceMeters: data.routes[0].distanceMeters ?? null,
    duration: data.routes[0].duration ?? null
  };
}

app.post("/api/check-distance", async (req, res) => {
  try {
    const { address, category, threshold } = req.body;

    if (!address || typeof address !== "string") {
      return res.status(400).json({ error: "Adresă lipsă." });
    }

    const wantedCategory = normalizeType(category);
    const thresholdNumber = Number(threshold);

    if (!wantedCategory) {
      return res.status(400).json({ error: "Categorie lipsă." });
    }

    if (!thresholdNumber) {
      return res.status(400).json({ error: "Prag invalid." });
    }

    const allPoiRaw = loadPoi();

    const allPoi = allPoiRaw.map((p) => ({
      name: p.name || "",
      address: p.address || "-",
      type: normalizeType(p.type),
      lat: parseCoord(p.lat),
      lon: parseCoord(p.lon ?? p.lng)
    }));

    const filteredPoi = allPoi.filter(
      (p) =>
        p.type === wantedCategory &&
        typeof p.lat === "number" &&
        typeof p.lon === "number"
    );

    if (!filteredPoi.length) {
      return res.status(404).json({
        error:
          "Nu există obiective valide pentru categoria selectată în poi.json."
      });
    }

    const origin = await geocodeAddress(address);

    const allDistances = filteredPoi
      .map((poi) => {
        const straightDistanceMeters = haversineDistanceMeters(
          origin.lat,
          origin.lon,
          poi.lat,
          poi.lon
        );

        return {
          name: poi.name,
          address: poi.address,
          lat: poi.lat,
          lon: poi.lon,
          type: poi.type,
          straightDistanceMeters: Math.round(straightDistanceMeters)
        };
      })
      .filter((poi) => poi.straightDistanceMeters <= 10000)
      .sort((a, b) => a.straightDistanceMeters - b.straightDistanceMeters);

    if (!allDistances.length) {
      return res.status(404).json({
        error: "Nu există obiective din categoria selectată în raza de 10 km."
      });
    }

    const nearestObjective = { ...allDistances[0] };

    const walking = await getWalkingDistance(origin, {
      lat: nearestObjective.lat,
      lon: nearestObjective.lon
    });

    nearestObjective.walkingDistanceMeters = walking.distanceMeters;
    nearestObjective.walkingDuration = walking.duration;

    const verdict =
      nearestObjective.straightDistanceMeters <= thresholdNumber
        ? "SUB prag"
        : "OK";

    res.json({
      origin: {
        lat: origin.lat,
        lon: origin.lon,
        formattedAddress: origin.formattedAddress
      },
      nearestObjective,
      nearbyObjectives: allDistances.slice(0, 20),
      verdict
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error.message || "A apărut o eroare internă."
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server pornit la http://localhost:${PORT}`);
});