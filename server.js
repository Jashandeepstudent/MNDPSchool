// backend/server.js
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const webpush = require("web-push");
const fs = require("fs");
const session = require("express-session");
const bcrypt = require("bcrypt");

// --- File storage for subscriptions ---
const SUB_FILE = "./subs.json";
let subscriptions = [];
try { subscriptions = JSON.parse(fs.readFileSync(SUB_FILE)); } catch(e) { subscriptions = []; }
function saveSubs() { fs.writeFileSync(SUB_FILE, JSON.stringify(subscriptions, null, 2)); }

// --- VAPID keys for push ---
const VAPID_PUBLIC = "BHWc5lZp511aGI0p7ca4nBJIz-hSMC29h4guSDW4OUNkYYgcpr4wllsiJHEdVQxdM2Fn8EeM4RgE3YhOi0DHSCc";
const VAPID_PRIVATE = "GUQ9KKEqBhm_KJzNYriYSVY0tA1YCHEoyXi6JnHvBiM";

webpush.setVapidDetails("mailto:you@example.com", VAPID_PUBLIC, VAPID_PRIVATE);

// --- Express setup ---
const app = express();
app.use(cors({
  origin: "http://localhost:5500", // change to your frontend URL
  credentials: true
}));
app.use(bodyParser.json());
app.use(session({
  secret: "super_secret_school_key", // change this to something random
  resave: false,
  saveUninitialized: true,
  cookie: { httpOnly: true } // secure:true if you use HTTPS
}));

// --- Admin password (change before use!) ---
const ADMIN_HASH = bcrypt.hashSync("SchoolAdmin123", 10);

// --- Login route ---
app.post("/login", async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "Password required" });

  const match = await bcrypt.compare(password, ADMIN_HASH);
  if (!match) return res.status(401).json({ error: "Invalid password" });

  req.session.isAdmin = true;
  res.json({ success: true });
});

// --- Logout route ---
app.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// --- Middleware for protected routes ---
function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.status(403).json({ error: "Not authorized" });
  next();
}

// --- Public: return VAPID public key ---
app.get("/vapidPublicKey", (req, res) => res.send(VAPID_PUBLIC));

// --- Public: save subscription ---
app.post("/subscribe", (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: "Invalid subscription" });
  if (!subscriptions.find(s => s.endpoint === sub.endpoint)) {
    subscriptions.push(sub);
    saveSubs();
  }
  res.status(201).json({});
});

// --- Protected: send notification ---
app.post("/notify", requireAdmin, async (req, res) => {
  const payload = JSON.stringify({
    title: req.body.title || "New School Update",
    body: req.body.body || "Check announcements/polls.",
    url: req.body.url || "/"
  });

  const results = await Promise.all(subscriptions.map(async (sub, i) => {
    try {
      await webpush.sendNotification(sub, payload);
      return { ok: true };
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        subscriptions.splice(i, 1);
        saveSubs();
      }
      return { ok: false, error: err.toString() };
    }
  }));

  res.json({ success: true, results });
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Secure backend running at http://localhost:${PORT}`));
