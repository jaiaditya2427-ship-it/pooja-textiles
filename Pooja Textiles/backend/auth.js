import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { findByPhone, findById, createBrand, updateBrand } from "./store.js";

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Fail loud rather than silently signing tokens with a guessable default.
  console.warn(
    "⚠ JWT_SECRET is not set in .env — using an insecure fallback. Set JWT_SECRET before deploying."
  );
}
const SECRET = JWT_SECRET || "dev-only-insecure-secret-change-me";

const sign = (brand) => jwt.sign({ id: brand.id }, SECRET, { expiresIn: "30d" });

// Never send the password hash back to the client.
const publicBrand = (b) => ({
  id: b.id,
  name: b.name,
  phone: b.phone,
  logo: b.logo || null,
  usageCount: b.usage_count ?? b.usageCount ?? 0,
});

router.post("/signup", async (req, res) => {
  try {
    const { name, phone, password } = req.body || {};
    if (!name?.trim() || !phone?.trim() || !password) {
      return res
        .status(400)
        .json({ success: false, error: "Brand name, phone number and password are required" });
    }
    if (password.length < 6) {
      return res
        .status(400)
        .json({ success: false, error: "Password must be at least 6 characters" });
    }
    if (await findByPhone(phone.trim())) {
      return res
        .status(409)
        .json({ success: false, error: "An account with this phone number already exists" });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const brand = await createBrand({
      id: crypto.randomUUID(),
      name: name.trim(),
      phone: phone.trim(),
      password_hash,
      logo: null,
      createdAt: Date.now(),
    });

    res.json({ success: true, token: sign(brand), brand: publicBrand(brand) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: "Signup failed, please try again" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { phone, password } = req.body || {};
    if (!phone?.trim() || !password) {
      return res
        .status(400)
        .json({ success: false, error: "Phone number and password are required" });
    }

    const brand = await findByPhone(phone.trim());
    const ok = brand && (await bcrypt.compare(password, brand.password_hash));
    if (!ok) {
      return res
        .status(401)
        .json({ success: false, error: "Incorrect phone number or password" });
    }

    res.json({ success: true, token: sign(brand), brand: publicBrand(brand) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: "Login failed, please try again" });
  }
});

export const requireAuth = async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, error: "Not authenticated" });
  try {
    const payload = jwt.verify(token, SECRET);
    const brand = await findById(payload.id);
    if (!brand) return res.status(401).json({ success: false, error: "Account no longer exists" });
    req.brand = brand;
    next();
  } catch {
    res.status(401).json({ success: false, error: "Session expired, please log in again" });
  }
};

router.get("/me", requireAuth, (req, res) => {
  res.json({ success: true, brand: publicBrand(req.brand) });
});

// Update brand name and/or logo (logo is a data URL or hosted image URL — kept
// as a plain string so no file-upload/storage plumbing is required to start).
router.put("/profile", requireAuth, async (req, res) => {
  const { name, logo } = req.body || {};
  const updates = {};
  if (name?.trim()) updates.name = name.trim();
  if (typeof logo === "string") updates.logo = logo;

  const updated = await updateBrand(req.brand.id, updates);
  res.json({ success: true, brand: publicBrand(updated) });
});

export default router;
