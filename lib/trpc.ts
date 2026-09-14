import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, createTRPCProxyClient } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/server/routers";
import { getApiBaseUrl } from "@/constants/oauth";
import * as Auth from "@/lib/_core/auth";

/**
 * tRPC React client for type-safe API calls in hooks.
 */
export const trpc = createTRPCReact<AppRouter>();

/**
 * Creates client links with dynamic authentication and base URL resolution.
 */
export function getTRPCClientLinks() {
  return [
    httpBatchLink({
      url: `${getApiBaseUrl()}/api/trpc`,
      transformer: superjson,
      async headers() {
        try {
          const token = await Auth.getSessionToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        } catch {
          return {};
        }
      },
      fetch(url, options) {
        return fetch(url, {
          ...options,
          credentials: "include",
        });
      },
    }),
  ];
}

/**
 * Creates the tRPC React Query client for app root provider.
 */
export function createTRPCClient() {
  return trpc.createClient({
    links: getTRPCClientLinks(),
  });
}

/**
 * Vanilla tRPC proxy client for imperative calls (outside React components, background sync, etc.).
 */
export const trpcClient = createTRPCProxyClient<AppRouter>({
  links: getTRPCClientLinks(),
});
