import express from "express";
import { rateLimit } from "./middleware/rateLimit.middleware";
import { getMetrics } from "./utils/metrics";

const app = express();
app.use(express.json());

app.set("trust proxy", true);


app.get("/metrics", (_req, res) => {
  res.json(getMetrics());
});


// Apply rate limit to a route
app.get(
  "/api/test",
  rateLimit({
    limit: 5,
    windowSeconds: 10,
    algorithm: "leaky_bucket",
    failureStrategy: "local-fallback"
  }),
  (_req, res) => {
    res.json({ message: "Request successful" });
  }
);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

export default app;
