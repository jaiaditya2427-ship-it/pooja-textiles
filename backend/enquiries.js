import express from "express";
import crypto from "crypto";
import { requireAuth } from "./auth.js";
import { createEnquiry, listEnquiries, deleteEnquiry } from "./store.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const rows = await listEnquiries(req.brand.id);
  res.json({
    success: true,
    enquiries: rows.map((r) => ({
      id: r.id,
      customerName: r.customer_name ?? r.customerName,
      customerPhone: r.customer_phone ?? r.customerPhone,
      note: r.note,
      createdAt: r.createdAt ?? Number(r.created_at),
    })),
  });
});

router.post("/", requireAuth, async (req, res) => {
  const { customerName, customerPhone, note } = req.body || {};
  if (!customerName?.trim()) {
    return res.status(400).json({ success: false, error: "Customer name is required" });
  }
  const enq = await createEnquiry({
    id: crypto.randomUUID(),
    brandId: req.brand.id,
    customerName: customerName.trim(),
    customerPhone: customerPhone?.trim() || null,
    note: note?.trim() || null,
    createdAt: Date.now(),
  });
  res.json({ success: true, enquiry: enq });
});

router.delete("/:id", requireAuth, async (req, res) => {
  await deleteEnquiry(req.params.id, req.brand.id);
  res.json({ success: true });
});

export default router;
