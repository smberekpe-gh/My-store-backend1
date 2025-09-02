const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const mongoose = require("mongoose");
const axios = require("axios");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());
app.use(cors());

const OrderSchema = new mongoose.Schema({ email: String, amount: Number, reference: String, status: String }, { timestamps: true });
const Order = mongoose.model("Order", OrderSchema);

mongoose.connect(process.env.MONGO_URI).then(() => console.log("MongoDB connected")).catch(err => console.error(err.message));

async function sendMetaPurchase({ email, amount, reference }) {
  const pixelId = process.env.META_PIXEL_ID; const token = process.env.META_ACCESS_TOKEN;
  if (!pixelId || !token) return;
  const emailNorm = (email || "").trim().toLowerCase();
  const emailHash = crypto.createHash("sha256").update(emailNorm).digest("hex");

  const payload = { data: [{ event_name: "Purchase", event_time: Math.floor(Date.now() / 1000), action_source: "website", user_data: { em: [emailHash] }, custom_data: { currency: "NGN", value: amount }, event_source_url: "https://yourusername.github.io/my-store-frontend/", test_event_code: process.env.META_TEST_EVENT_CODE || undefined }] };

  try { await axios.post(`https://graph.facebook.com/v18.0/${pixelId}/events?access_token=${token}`, payload); console.log("Sent Meta CAPI Purchase"); }
  catch (e) { console.error("Meta CAPI error", e.response?.data || e.message); }
}

app.post("/verify-payment", async (req, res) => {
  const { reference, email } = req.body; if (!reference) return res.status(400).json({ error: "missing reference" });
  try {
    const r = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } });
    const ok = r.data?.status && r.data?.data?.status === "success";
    const amountKobo = r.data?.data?.amount || 0; const amountNaira = Math.round(amountKobo / 100);
    if (ok) {
      const order = await Order.create({ email, amount: amountNaira, reference, status: "success" });
      sendMetaPurchase({ email, amount: amountNaira, reference }).catch(() => {});
      return res.json({ status: "success", order });
    }
    return res.json({ status: "failed" });
  } catch (err) { console.error(err.response?.data || err.message); return res.status(500).json({ error: "verification_failed" }); }
});

app.get("/health", (req, res) => res.json({ ok: true }));
app.listen(process.env.PORT || 5000, () => console.log(`Server running`));
