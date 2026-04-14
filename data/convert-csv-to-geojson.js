const fs = require("fs");
const path = require("path");

const inputPath = path.join(__dirname, "poi-extra.csv");
const outputPath = path.join(__dirname, "..", "public", "poi-extra.geojson");

// schimbă aici separatorul dacă CSV-ul tău are ;
const SEPARATOR = ",";

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function detectCategory(value) {
  const t = normalizeText(value);

  if (
    t.includes("biser") ||
    t.includes("manast") ||
    t.includes("lacas") ||
    t.includes("cult") ||
    t.includes("church") ||
    t.includes("place_of_worship")
  ) {
    return "biserici";
  }

  if (
    t.includes("scoal") ||
    t.includes("gradinit") ||
    t.includes("lice") ||
    t.includes("coleg") ||
    t.includes("invat") ||
    t.includes("school") ||
    t.includes("kindergarten") ||
    t.includes("college") ||
    t.includes("university")
  ) {
    return "scoli";
  }

  return "necunoscut";
}

function parseNumber(value) {
  if (value === undefined || value === null) return null;
  const n = Number(String(value).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function splitCsvLine(line, separator = ",") {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === separator && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result.map(v => v.trim());
}

const raw = fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, "");
const lines = raw.split(/\r?\n/).filter(line => line.trim() !== "");

if (lines.length < 2) {
  throw new Error("CSV-ul nu are suficiente linii.");
}

const headers = splitCsvLine(lines[0], SEPARATOR).map(h => normalizeText(h));

function findHeaderIndex(possibleNames) {
  for (const name of possibleNames) {
    const idx = headers.indexOf(normalizeText(name));
    if (idx !== -1) return idx;
  }
  return -1;
}

// încearcă automat mai multe variante de nume de coloane
const nameIdx = findHeaderIndex(["name", "denumire", "nume"]);
const typeIdx = findHeaderIndex(["type", "categorie", "category", "tip"]);
const latIdx = findHeaderIndex(["lat", "latitude", "latitudine", "y"]);
const lonIdx = findHeaderIndex(["lon", "lng", "long", "longitude", "longitudine", "x"]);

if (nameIdx === -1 || latIdx === -1 || lonIdx === -1) {
  console.log("Header-ele detectate sunt:", headers);
  throw new Error(
    "Nu am găsit coloanele necesare. Am nevoie de name/nume, lat și lon/lng."
  );
}

const features = [];

for (let i = 1; i < lines.length; i++) {
  const cols = splitCsvLine(lines[i], SEPARATOR);

  const name = cols[nameIdx] || `POI ${i}`;
  const rawType = typeIdx !== -1 ? cols[typeIdx] : "";
  const lat = parseNumber(cols[latIdx]);
  const lon = parseNumber(cols[lonIdx]);

  if (lat === null || lon === null) continue;

  const feature = {
    type: "Feature",
    properties: {
      name,
      type: rawType,
      category: detectCategory(rawType || name)
    },
    geometry: {
      type: "Point",
      coordinates: [lon, lat]
    }
  };

  features.push(feature);
}

const geojson = {
  type: "FeatureCollection",
  features
};

fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2), "utf8");

console.log(`Gata. Am creat ${outputPath}`);
console.log(`Features exportate: ${features.length}`);