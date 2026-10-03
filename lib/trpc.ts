import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/server/routers";
import { getApiBaseUrl } from "@/constants/oauth";
import * as Auth from "@/lib/_core/auth";

/**
 * tRPC React client for type-safe API calls.
 *
 * IMPORTANT (tRPC v11): The `transformer` must be inside `httpBatchLink`,
 * NOT at the root createClient level. This ensures client and server
 * use the same serialization format (superjson).
 */
export const trpc = createTRPCReact<AppRouter>();

/**
 * Creates the tRPC client with proper configuration.
 * Call this once in your app's root layout.
 */
export function createTRPCClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${getApiBaseUrl()}/api/trpc`,
        // tRPC v11: transformer MUST be inside httpBatchLink, not at root
        transformer: superjson,
        async headers() {
          const token = await Auth.getSessionToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
        // Custom fetch to include credentials for cookie-based auth and intercept 401s
        async fetch(url, options) {
          const res = await fetch(url, {
            ...options,
            credentials: "include",
          });

          if (res.status === 401) {
            const urlStr = String(url);
            Auth.handleGlobalUnauthorized(urlStr).catch(() => {});
          } else {
            try {
              const clone = res.clone();
              const json = await clone.json();
              const items = Array.isArray(json) ? json : [json];
              const isUnauthorized = items.some(
                (item) => item?.error?.data?.code === "UNAUTHORIZED" || item?.error?.data?.httpStatus === 401
              );
              if (isUnauthorized) {
                const urlStr = String(url);
                Auth.handleGlobalUnauthorized(urlStr).catch(() => {});
              }
            } catch {
              // ignore clone json parse error
            }
          }

          return res;
        },
      }),
    ],
  });
}

/**
 * Module-level singleton tRPC client for direct/imperative calls outside React components
 * (offline sync, background tracking, field data callbacks) and for trpc.Provider.
 */
export const trpcClient = createTRPCClient();
