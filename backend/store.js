import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./db.js";

// ── Local JSON fallback (used only when DATABASE_URL isn't set) ──
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

const usingDb = () => !!pool;

// ── Public API — same shape whether backed by Postgres or the JSON file ──

export const findByPhone = async (phone) => {
  if (usingDb()) {
    const { rows } = await pool.query("SELECT * FROM brands WHERE phone = $1", [phone]);
    return rows[0] || null;
  }
  return readAll().find((b) => b.phone === phone) || null;
};

export const findById = async (id) => {
  if (usingDb()) {
    const { rows } = await pool.query("SELECT * FROM brands WHERE id = $1", [id]);
    return rows[0] || null;
  }
  return readAll().find((b) => b.id === id) || null;
};

export const createBrand = async (brand) => {
  if (usingDb()) {
    await pool.query(
      `INSERT INTO brands (id, name, phone, password_hash, logo, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [brand.id, brand.name, brand.phone, brand.password_hash, brand.logo, brand.createdAt]
    );
    return brand;
  }
  const brands = readAll();
  brands.push(brand);
  writeAll(brands);
  return brand;
};

export const updateBrand = async (id, updates) => {
  if (usingDb()) {
    const fields = [];
    const values = [];
    let i = 1;
    for (const [key, val] of Object.entries(updates)) {
      const col = key === "password_hash" ? "password_hash" : key; // name/logo pass through
      fields.push(`${col} = $${i}`);
      values.push(val);
      i++;
    }
    if (!fields.length) return findById(id);
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE brands SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
      values
    );
    return rows[0] || null;
  }
  const brands = readAll();
  const idx = brands.findIndex((b) => b.id === id);
  if (idx === -1) return null;
  brands[idx] = { ...brands[idx], ...updates };
  writeAll(brands);
  return brands[idx];
};

export const deleteBrand = async (id) => {
  if (usingDb()) {
    await pool.query("DELETE FROM brands WHERE id = $1", [id]);
    return true;
  }
  const brands = readAll().filter((b) => b.id !== id);
  writeAll(brands);
  return true;
};

export const listBrands = async () => {
  if (usingDb()) {
    const { rows } = await pool.query("SELECT * FROM brands ORDER BY created_at DESC");
    return rows;
  }
  return readAll().sort((a, b) => b.createdAt - a.createdAt);
};

export const incrementUsage = async (id) => {
  if (usingDb()) {
    await pool.query(
      "UPDATE brands SET usage_count = COALESCE(usage_count,0) + 1 WHERE id = $1",
      [id]
    );
    return;
  }
  const brands = readAll();
  const idx = brands.findIndex((b) => b.id === id);
  if (idx === -1) return;
  brands[idx].usageCount = (brands[idx].usageCount || 0) + 1;
  writeAll(brands);
};
