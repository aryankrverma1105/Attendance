import dotenv from "dotenv";
dotenv.config();

const isProduction = process.env.NODE_ENV === "production";
const cookieSecret = process.env.JWT_SECRET || (isProduction ? "" : "sologix-development-jwt-secret-key-32-chars-long");

if (isProduction && !process.env.JWT_SECRET) {
  console.error("[Security] FATAL: JWT_SECRET must be configured in production environment!");
}

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret,
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction,
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  firebaseServiceAccount: process.env.FIREBASE_SERVICE_ACCOUNT ?? "",
};
