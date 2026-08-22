import pg from "pg";

const { Pool } = pg;

// DATABASE_URL comes from your hosted Postgres (e.g. Supabase). If it's not
// set, `pool` stays null and store.js falls back to the local JSON file —
// fine for local testing, but on Render (or any host with ephemeral disk)
// that means accounts disappear on every redeploy. Set DATABASE_URL to fix
// that permanently.
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn(
    "⚠ DATABASE_URL is not set — using local brands.json instead of a real database. Accounts will NOT survive a redeploy on Render. See README for Supabase setup."
  );
}

export const pool = connectionString
  ? new Pool({ connectionString, ssl: { rejectUnauthorized: false } })
  : null;

export const initDb = async () => {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS brands (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      logo TEXT,
      created_at BIGINT NOT NULL
    );
  `);
  // Added later — IF NOT EXISTS keeps this safe to re-run on an existing table.
  await pool.query(`ALTER TABLE brands ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS enquiries (
      id UUID PRIMARY KEY,
      brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
      customer_name TEXT NOT NULL,
      customer_phone TEXT,
      note TEXT,
      created_at BIGINT NOT NULL
    );
  `);
  console.log("✅ Connected to Postgres — brands table ready");
};
