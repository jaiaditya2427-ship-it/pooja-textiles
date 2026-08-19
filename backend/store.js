import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Lightweight JSON-file store — no external database needed to run this.
// NOTE: on hosts with ephemeral disks (e.g. Render free tier), this file
// resets on every redeploy. Fine to launch with; swap for a real database
// (Postgres/Mongo) once brands start relying on their saved data.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, "brands.json");

const readAll = () => {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  } catch {
    return [];
  }
};

const writeAll = (brands) => {
  fs.writeFileSync(DB_FILE, JSON.stringify(brands, null, 2));
};

export const findByPhone = (phone) => readAll().find((b) => b.phone === phone);

export const findById = (id) => readAll().find((b) => b.id === id);

export const createBrand = (brand) => {
  const brands = readAll();
  brands.push(brand);
  writeAll(brands);
  return brand;
};

export const updateBrand = (id, updates) => {
  const brands = readAll();
  const idx = brands.findIndex((b) => b.id === id);
  if (idx === -1) return null;
  brands[idx] = { ...brands[idx], ...updates };
  writeAll(brands);
  return brands[idx];
};
