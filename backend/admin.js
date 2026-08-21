import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { listBrands, findById, updateBrand, deleteBrand } from "./store.js";

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-insecure-secret-change-me";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.warn(
    "⚠ ADMIN_PASSWORD is not set — the admin panel is disabled until you add it to .env"
  );
}

const publicBrand = (b) => ({
  id: b.id,
  name: b.name,
  phone: b.phone,
  logo: b.logo || null,
  usageCount: b.usage_count ?? b.usageCount ?? 0,
  createdAt: b.createdAt ?? Number(b.created_at) ?? null,
});

router.post("/login", async (req, res) => {
  const { password } = req.body || {};
  if (!ADMIN_PASSWORD) {
    return res
      .status(503)
      .json({ success: false, error: "Admin panel not set up — add ADMIN_PASSWORD to .env" });
  }
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, error: "Incorrect admin password" });
  }
  const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: "12h" });
  res.json({ success: true, token });
});

export const requireAdmin = (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, error: "Not authenticated" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload.admin) throw new Error("not admin");
    next();
  } catch {
    res.status(401).json({ success: false, error: "Admin session expired, please log in again" });
  }
};

router.get("/brands", requireAdmin, async (req, res) => {
  const brands = await listBrands();
  res.json({ success: true, brands: brands.map(publicBrand) });
});

router.put("/brands/:id", requireAdmin, async (req, res) => {
  const { name, logo } = req.body || {};
  const updates = {};
  if (name?.trim()) updates.name = name.trim();
  if (typeof logo === "string") updates.logo = logo;

  const existing = await findById(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: "Brand not found" });

  const updated = await updateBrand(req.params.id, updates);
  res.json({ success: true, brand: publicBrand(updated) });
});

router.post("/brands/:id/reset-password", requireAdmin, async (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res
      .status(400)
      .json({ success: false, error: "New password must be at least 6 characters" });
  }
  const existing = await findById(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: "Brand not found" });

  const password_hash = await bcrypt.hash(newPassword, 10);
  await updateBrand(req.params.id, { password_hash });
  res.json({ success: true });
});

router.delete("/brands/:id", requireAdmin, async (req, res) => {
  const existing = await findById(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: "Brand not found" });

  await deleteBrand(req.params.id);
  res.json({ success: true });
});

export default router;
