const fs = require("fs");
const path = require("path");

const csvPath = path.join(__dirname, "data", "poi.csv");
const jsonPath = path.join(__dirname, "data", "poi.json");

const csv = fs.readFileSync(csvPath, "utf8");

const lines = csv.split("\n").filter(line => line.trim() !== "");

const headers = lines[0].split(",");

const data = lines.slice(1).map(line => {
  const values = line.split(",");

  const obj = {};
  headers.forEach((h, i) => {
    obj[h.trim()] = values[i].trim();
  });

  return {
    name: obj.name,
    type: obj.type.toLowerCase().includes("biser")
  ? "lacas_cult"
  : "unitate_invatamant",
    lat: Number(obj.lat),
    lon: Number(obj.lon)
  };
});

fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));

console.log("✅ Conversie gata: poi.json creat!");