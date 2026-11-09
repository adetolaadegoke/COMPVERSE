import "dotenv/config";

import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const app = express();

const PORT = process.env.PORT || 3000;

const ORIGIN =
  process.env.APP_ORIGIN || `http://localhost:${PORT}`;

const configured = Boolean(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const admin = configured
  ? createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )
  : null;

app.use(helmet({
  contentSecurityPolicy: false
}));

app.use(cors({
  origin: ORIGIN
}));

app.use(compression());
app.use(morgan("tiny"));

app.use("/api", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 150
}));

// PAYSTACK WEBHOOK

app.post(
  "/api/payments/paystack/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {

    const secret = process.env.PAYSTACK_SECRET_KEY;

    const signature =
      req.headers["x-paystack-signature"];

    if (!secret || !signature) {
      return res.sendStatus(400);
    }

    const expected = crypto
      .createHmac("sha512", secret)
      .update(req.body)
      .digest("hex");

    const a = Buffer.from(String(signature));
    const b = Buffer.from(expected);

    if (
      a.length !== b.length ||
      !crypto.timingSafeEqual(a, b)
    ) {
      return res.sendStatus(401);
    }

    let event;

    try {
      event = JSON.parse(req.body.toString("utf8"));
    } catch {
      return res.sendStatus(400);
    }

    if (event.event === "charge.success") {
      console.log(
        "Verified payment:",
        event.data?.reference
      );

      // TODO: Credit the wallet through an
      // idempotent database transaction.
    }

    return res.sendStatus(200);
  }
);

app.use(express.json({ limit: "1mb" }));

app.use(express.static("public"));

function getBearer(req) {
  const header = req.headers.authorization || "";

  return header.startsWith("Bearer ")
    ? header.slice(7)
    : null;
}

async function requireUser(req, res, next) {

  if (!admin) {
    return res.status(503).json({
      error: "Supabase is not configured."
    });
  }

  const token = getBearer(req);

  if (!token) {
    return res.status(401).json({
      error: "Sign in required."
    });
  }

  const { data, error } =
    await admin.auth.getUser(token);

  if (error || !data.user) {
    return res.status(401).json({
      error: "Invalid session."
    });
  }

  req.user = data.user;

  next();
}

async function requireAdmin(req, res, next) {

  const { data, error } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", req.user.id)
    .single();

  if (error || !data?.is_admin) {
    return res.status(403).json({
      error: "Administrator access required."
    });
  }

  next();
}

// HEALTH CHECK

app.get("/api/health", (req, res) => {

  res.json({
    app: "CAMPVERSE",
    status: "online",
    databaseConfigured: configured,
    paymentsConfigured: Boolean(
      process.env.PAYSTACK_SECRET_KEY
    )
  });

});

// UNIVERSITY DIRECTORY

app.get("/api/universities", async (req, res) => {

  if (!admin) {
    return res.status(503).json({
      error: "Database not configured."
    });
  }

  const { data, error } = await admin
    .from("universities")
    .select("id,name,slug,city,state")
    .eq("is_active", true)
    .order("name");

  if (error) {
    return res.status(500).json({
      error: "Could not load universities."
    });
  }

  res.json({
    universities: data
  });

});

// ADMIN VERIFICATION REVIEW

app.post(
  "/api/admin/verifications/:id/review",
  requireUser,
  requireAdmin,
  async (req, res) => {

    const { status, note = "" } = req.body || {};

    if (![
      "approved",
      "rejected",
      "needs_review"
    ].includes(status)) {

      return res.status(400).json({
        error: "Invalid review status."
      });

    }

    const { data: item, error: readError } =
      await admin
        .from("admission_verifications")
        .select("id,user_id")
        .eq("id", req.params.id)
        .single();

    if (readError || !item) {
      return res.status(404).json({
        error: "Verification not found."
      });
    }

    const { error } = await admin
      .from("admission_verifications")
      .update({
        status,
        reviewer_id: req.user.id,
        reviewer_note: String(note).slice(0, 500),
        reviewed_at: new Date().toISOString()
      })
      .eq("id", item.id);

    if (error) {
      return res.status(500).json({
        error: "Could not update verification."
      });
    }

    if (status === "approved" || status === "rejected") {
      await admin
        .from("profiles")
        .update({
          verification_status: status
        })
        .eq("id", item.user_id);
    }

    res.json({ success: true });

  }
);

// PAYMENT INITIALIZATION

app.post(
  "/api/payments/initialize",
  requireUser,
  async (req, res) => {

    const amountKobo = Number(req.body?.amountKobo);
    const coins = Number(req.body?.coins);

    if (
      !Number.isSafeInteger(amountKobo) ||
      !Number.isSafeInteger(coins) ||
      amountKobo < 10000 ||
      coins < 1
    ) {
      return res.status(400).json({
        error: "Invalid purchase."
      });
    }

    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(503).json({
        error: "Paystack is not configured."
      });
    }

    const allowed = new Map([
      [10000, 100],
      [25000, 250],
      [50000, 550]
    ]);

    if (allowed.get(amountKobo) !== coins) {
      return res.status(400).json({
        error: "Unknown coin package."
      });
    }

    const reference =
      `cv_${req.user.id.slice(0, 8)}_${crypto.randomUUID()}`;

    const response = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: req.user.email,
          amount: amountKobo,
          reference,
          metadata: {
            user_id: req.user.id,
            coins
          }
        })
      }
    );

    const result = await response.json();

    if (!response.ok || !result.status) {
      return res.status(502).json({
        error: "Payment initialization failed."
      });
    }

    res.json({
      authorization_url: result.data.authorization_url,
      reference
    });

  }
);

// FRONTEND ROUTE

app.get("*", (req, res, next) => {

  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      error: "API route not found."
    });
  }

  res.sendFile(
    "index.html",
    { root: "public" },
    next
  );

});

app.listen(PORT, () => {
  console.log(
    `CAMPVERSE running on port ${PORT}`
  );
});
