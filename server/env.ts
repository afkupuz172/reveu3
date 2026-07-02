import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

export const env = {
  root,
  // API_PORT, not PORT: dev harnesses commonly inject PORT for the web server.
  apiPort: Number(process.env.API_PORT || 3001),
  hubspotKey: process.env.HUBSPOT_PA_KEY || "",
  stripeKey: process.env.STRIPE_KEY || "",
  qboClientId: process.env.QUICKBOOKS_CLIENT_ID || "",
  qboClientSecret: process.env.QUICKBOOKS_CLIENT_SECRET || "",
  qboEnv: (process.env.QUICKBOOKS_ENV || "sandbox") as "sandbox" | "production",
  webOrigin: process.env.WEB_ORIGIN || "http://localhost:5173",
};

if (!env.hubspotKey) {
  console.error("HUBSPOT_PA_KEY is required (HubSpot is the anchor data source). Set it in .env");
  process.exit(1);
}
