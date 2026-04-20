const fs = require("fs");
const path = require("path");

const OVERPASS_URL = "https://overpass.kumi.systems/api/interpreter";

const bounds = {
  minLat: 43.5,
  maxLat: 48.5,
  minLon: 20.0,
  maxLon: 30.5,
};

const STEP = 0.5;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function shouldExcludeSchoolLike(name) {
  const n = normalize(name);

  const excluded = [
    "scoala de soferi",
    "școala de șoferi",
    "driving school",
    "after school",
    "afterschool",
    "creative boutique",
    "cursuri",
    "training",
    "club",
    "academy",
    "atelier",
    "meditatii",
    "meditații",
  ];

  return excluded.some((x) => n.includes(x));
}

function extractCoords(el) {
  if (typeof el.lat === "number" && typeof el.lon === "number") {
    return { lat: el.lat, lon: el.lon };
  }

  if (el.center && typeof el.center.lat === "number" && typeof el.center.lon === "number") {
    return { lat: el.center.lat, lon: el.center.lon };
  }

  return null;
}

async function fetchTile(minLat, minLon, maxLat, maxLon) {
  const query = `
[out:json][timeout:60];
(
  node["amenity"="place_of_worship"](${minLat},${minLon},${maxLat},${maxLon});
  way["amenity"="place_of_worship"](${minLat},${minLon},${maxLat},${maxLon});
  relation["amenity"="place_of_worship"](${minLat},${minLon},${maxLat},${maxLon});

  node["building"="church"](${minLat},${minLon},${maxLat},${maxLon});
  way["building"="church"](${minLat},${minLon},${maxLat},${maxLon});
  relation["building"="church"](${minLat},${minLon},${maxLat},${maxLon});

  node["religion"="christian"]["building"="yes"](${minLat},${minLon},${maxLat},${maxLon});
  way["religion"="christian"]["building"="yes"](${minLat},${minLon},${maxLat},${maxLon});
  relation["religion"="christian"]["building"="yes"](${minLat},${minLon},${maxLat},${maxLon});

  node["amenity"="school"](${minLat},${minLon},${maxLat},${maxLon});
  way["amenity"="school"](${minLat},${minLon},${maxLat},${maxLon});
  relation["amenity"="school"](${minLat},${minLon},${maxLat},${maxLon});

  node["amenity"="kindergarten"](${minLat},${minLon},${maxLat},${maxLon});
  way["amenity"="kindergarten"](${minLat},${minLon},${maxLat},${maxLon});
  relation["amenity"="kindergarten"](${minLat},${minLon},${maxLat},${maxLon});

  node["building"="school"](${minLat},${minLon},${maxLat},${maxLon});
  way["building"="school"](${minLat},${minLon},${maxLat},${maxLon});
  relation["building"="school"](${minLat},${minLon},${maxLat},${maxLon});

  node["building"="kindergarten"](${minLat},${minLon},${maxLat},${maxLon});
  way["building"="kindergarten"](${minLat},${minLon},${maxLat},${maxLon});
  relation["building"="kindergarten"](${minLat},${minLon},${maxLat},${maxLon});
);
out center tags;
`;

  const body = new URLSearchParams({ data: query }).toString();

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": "distance-checker/1.0",
      "Accept": "application/json",
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} - ${text.slice(0, 300)}`);
  }

  const json = await res.json();

  return (json.elements || [])
    .map((el) => {
      const coords = extractCoords(el);
      if (!coords) return null;

      const tags = el.tags || {};
      const name = tags.name || "Fără nume";

      let type = null;

      if (
        tags.amenity === "place_of_worship" ||
        tags.building === "church" ||
        tags.religion === "christian"
      ) {
        type = "lacase_cult";
      }

      if (
        tags.amenity === "school" ||
        tags.amenity === "kindergarten" ||
        tags.building === "school" ||
        tags.building === "kindergarten"
      ) {
        type = "invatamant";
      }

      if (!type) return null;

      return {
        name,
        type,
        lat: coords.lat,
        lon: coords.lon,
        source: "osm",
      };
    })
    .filter(Boolean);
}

async function main() {
  let all = [];

  for (let lat = bounds.minLat; lat < bounds.maxLat; lat += STEP) {
    for (let lon = bounds.minLon; lon < bounds.maxLon; lon += STEP) {
      const minLat = Number(lat.toFixed(2));
      const maxLat = Number((lat + STEP).toFixed(2));
      const minLon = Number(lon.toFixed(2));
      const maxLon = Number((lon + STEP).toFixed(2));

      console.log(`Tile: ${minLat}, ${minLon} -> ${maxLat}, ${maxLon}`);

      try {
        const items = await fetchTile(minLat, minLon, maxLat, maxLon);

        const filtered = items.filter((x) => {
          if (x.type === "invatamant") {
            return !shouldExcludeSchoolLike(x.name);
          }
          return true;
        });

        all.push(...filtered);
        console.log(`+ ${filtered.length}`);
      } catch (err) {
        console.log("Eroare tile:", err.message);
      }

      await sleep(1200);
    }
  }

  const dedup = new Map();

  for (const p of all) {
    const key = `${normalize(p.name)}_${p.type}_${p.lat.toFixed(5)}_${p.lon.toFixed(5)}`;
    if (!dedup.has(key)) {
      dedup.set(key, p);
    }
  }

  const final = Array.from(dedup.values());

  const outPath = path.join(__dirname, "data", "poi.json");
  fs.writeFileSync(outPath, JSON.stringify(final, null, 2), "utf8");

  console.log("FINAL:", final.length);
  console.log("Salvat în:", outPath);
}

main();