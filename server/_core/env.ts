import dotenv from "dotenv";
dotenv.config();

const isProduction = process.env.NODE_ENV === "production";

// 1. Refuse to start in production if JWT_SECRET is missing (Fail closed)
if (isProduction && !process.env.JWT_SECRET) {
  throw new Error("[Security] FATAL: JWT_SECRET must be configured in production environment!");
}

// 2. Require ALLOWED_ORIGINS in production
if (isProduction && !process.env.ALLOWED_ORIGINS) {
  throw new Error("[Security] FATAL: ALLOWED_ORIGINS must be configured in production environment!");
}

const cookieSecret = process.env.JWT_SECRET || "sologix-development-jwt-secret-key-32-chars-long";

export const ENV = {
  // Constant appId instead of requiring VITE_APP_ID
  appId: "sologix-attendance-app",
  cookieSecret,
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction,
  allowedOrigins: process.env.ALLOWED_ORIGINS ?? "",
  superAdminPhone: process.env.SUPER_ADMIN_PHONE ?? "+919835916278",
  allowInsecureDev: process.env.ALLOW_INSECURE_DEV === "true",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  firebaseServiceAccount: process.env.FIREBASE_SERVICE_ACCOUNT ?? "",
};
