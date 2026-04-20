const fs = require("fs");
const path = require("path");

const inputFile = path.join(__dirname, "poi.csv");
const outputFile = path.join(__dirname, "poi.json");

const raw = fs.readFileSync(inputFile, "utf8").trim();

// detectează separatorul
const firstLine = raw.split(/\r?\n/)[0];
const delimiter = firstLine.includes(";") ? ";" : ",";

const lines = raw
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => line.length > 0);

if (lines.length < 2) {
  throw new Error("CSV-ul nu are suficiente rânduri.");
}

const headers = lines[0].split(delimiter).map(h => h.trim().toLowerCase());

function getValue(obj, keys) {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== "") {
      return obj[key];
    }
  }
  return "";
}

function normalizeType(value) {
  const t = String(value || "").trim().toLowerCase();

  if (
    t.includes("biser") ||
    t.includes("cult") ||
    t.includes("relig") ||
    t === "lacase_cult" ||
    t === "lacas_cult"
  ) {
    return "lacase_cult";
  }

  if (
    t.includes("scoal") ||
    t.includes("școal") ||
    t.includes("lice") ||
    t.includes("gradinit") ||
    t.includes("grădini") ||
    t.includes("invat") ||
    t.includes("învăț") ||
    t.includes("educ")
  ) {
    return "invatamant";
  }

  return t;
}

const result = lines.slice(1).map((line, index) => {
  const values = line.split(delimiter).map(v => v.trim());
  const obj = {};

  headers.forEach((h, i) => {
    obj[h] = values[i] ?? "";
  });

  const name = getValue(obj, ["name", "nume", "denumire"]);
  const rawType = getValue(obj, ["type", "categorie", "category"]);
  const lat = Number(getValue(obj, ["lat", "latitude"]));
  const lon = Number(getValue(obj, ["lon", "lng", "long", "longitude"]));

  return {
    name: name || `Obiectiv ${index + 1}`,
    type: normalizeType(rawType),
    lat,
    lon,
    source: "csv"
  };
}).filter(p =>
  p.name &&
  p.type &&
  Number.isFinite(p.lat) &&
  Number.isFinite(p.lon)
);

fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), "utf8");

console.log("✅ Gata! POI convertite:", result.length);
console.log("✅ Fișier generat:", outputFile);