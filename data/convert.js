const fs = require("fs");
const path = require("path");

const inputFile = path.join(__dirname, "poi.csv");
const outputFile = path.join(__dirname, "poi.json");

function stripBom(text) {
  return text.replace(/^\uFEFF/, "");
}

function detectDelimiter(headerLine) {
  const semicolons = (headerLine.match(/;/g) || []).length;
  const commas = (headerLine.match(/,/g) || []).length;
  return semicolons >= commas ? ";" : ",";
}

function parseCsvLine(line, delimiter) {
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
      continue;
    }

    if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current.trim());
  return result.map((v) => v.replace(/^"|"$/g, "").trim());
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getValue(obj, keys) {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && String(obj[key]).trim() !== "") {
      return String(obj[key]).trim();
    }
  }
  return "";
}

function normalizeType(value) {
  const t = normalizeText(value).toLowerCase();

  if (
    t.includes("biser") ||
    t.includes("cult") ||
    t.includes("relig") ||
    t.includes("manast") ||
    t.includes("catedr") ||
    t.includes("paroh") ||
    t === "lacase_cult" ||
    t === "lacas_cult"
  ) {
    return "lacase_cult";
  }

  if (
    t.includes("scoal") ||
    t.includes("lice") ||
    t.includes("gradinit") ||
    t.includes("invat") ||
    t.includes("educ") ||
    t.includes("coleg") ||
    t.includes("univers")
  ) {
    return "invatamant";
  }

  return t;
}

function parseNumber(value) {
  if (value === undefined || value === null) return NaN;

  const cleaned = String(value)
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".");

  return Number(cleaned);
}

function validateCoordinate(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

function main() {
  if (!fs.existsSync(inputFile)) {
    throw new Error(`Fișierul nu există: ${inputFile}`);
  }

  const raw = stripBom(fs.readFileSync(inputFile, "utf8")).trim();

  if (!raw) {
    throw new Error("Fișierul CSV este gol.");
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    throw new Error("CSV-ul nu are suficiente rânduri.");
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter).map(normalizeHeader);

  const result = [];
  let skipped = 0;

  for (let index = 1; index < lines.length; index++) {
    const values = parseCsvLine(lines[index], delimiter);
    const obj = {};

    headers.forEach((header, i) => {
      obj[header] = values[i] ?? "";
    });

    const name = getValue(obj, [
      "name",
      "nume",
      "denumire",
      "unitate",
      "titlu"
    ]);

    const rawType = getValue(obj, [
      "type",
      "categorie",
      "category",
      "tip",
      "tip_obiectiv"
    ]);

    const lat = parseNumber(
      getValue(obj, ["lat", "latitude", "latitudine", "y"])
    );

    const lon = parseNumber(
      getValue(obj, ["lon", "lng", "long", "longitude", "longitudine", "x"])
    );

    const type = normalizeType(rawType);

    if (!name || !type || !validateCoordinate(lat, lon)) {
      skipped++;
      continue;
    }

    result.push({
      name,
      type,
      lat,
      lon,
      source: "csv"
    });
  }

  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), "utf8");

  console.log("✅ Gata!");
  console.log("📥 Input:", inputFile);
  console.log("📤 Output:", outputFile);
  console.log("✅ POI convertite:", result.length);
  console.log("⚠️ Rânduri sărite:", skipped);
}

main();