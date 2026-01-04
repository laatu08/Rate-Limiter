import express from "express";
import { rateLimit } from "./middleware/rateLimit.middleware";

const app = express();
app.use(express.json());

app.set("trust proxy", true);

// Apply rate limit to a route
app.get(
  "/api/test",
  rateLimit({
    limit: 5,
    windowSeconds: 10,
    algorithm: "sliding_window",
  }),
  (_req, res) => {
    res.json({ message: "Request successful" });
  }
);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

export default app;
