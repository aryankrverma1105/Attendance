import * as Api from "@/lib/_core/api";
import * as Auth from "@/lib/_core/auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";

type UseAuthOptions = {
  autoFetch?: boolean;
};

export function useAuth(options?: UseAuthOptions) {
  const { autoFetch = true } = options ?? {};
  const [user, setUser] = useState<Auth.User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchUser = useCallback(async () => {
    console.log("[useAuth] fetchUser called");
    try {
      setLoading(true);
      setError(null);

      // Web platform: use cookie-based auth, fetch user from API
      if (Platform.OS === "web") {
        console.log("[useAuth] Web platform: fetching user from API...");
        const apiUser = await Api.getMe();
        console.log("[useAuth] API user response:", apiUser);

        if (apiUser) {
          const userInfo: Auth.User = {
            id: apiUser.id,
            openId: apiUser.openId,
            name: apiUser.name,
            email: apiUser.email,
            loginMethod: apiUser.loginMethod,
            lastSignedIn: new Date(apiUser.lastSignedIn),
          };
          setUser(userInfo);
          // Cache user info in localStorage for faster subsequent loads
          await Auth.setUserInfo(userInfo);
          console.log("[useAuth] Web user set from API:", userInfo);
        } else {
          console.log("[useAuth] Web: No authenticated user from API");
          setUser(null);
          await Auth.clearUserInfo();
        }
        return;
      }

      // Native platform: use token-based auth
      const sessionToken = await Auth.getSessionToken();
      if (!sessionToken) {
        setUser(null);
        return;
      }

      // Use cached user info for native
      const cachedUser = await Auth.getUserInfo();
      if (cachedUser) {
        setUser(cachedUser);
      }

      // On native app start, if online, validate the cached session via GET /api/auth/me; on 401/403 log out. If offline, keep the cached user.
      let isOnline = false;
      try {
        const Network = await import("expo-network");
        const netState = await Network.getNetworkStateAsync();
        isOnline = Boolean(netState.isConnected && netState.isInternetReachable);
      } catch {
        isOnline = true;
      }

      if (isOnline) {
        try {
          const res = await Api.authedFetch("/api/auth/me");
          const resData = await res.json();
          if (resData?.user) {
            const validatedUser: Auth.User = {
              id: resData.user.id,
              openId: resData.user.openId,
              name: resData.user.name,
              email: resData.user.email,
              loginMethod: resData.user.loginMethod,
              lastSignedIn: new Date(resData.user.lastSignedIn),
            };
            setUser(validatedUser);
            await Auth.setUserInfo(validatedUser);
          } else {
            await logout();
            return;
          }
        } catch (err: any) {
          const status = err?.status;
          if (status === 401 || status === 403) {
            await logout();
            return;
          }
          // Network error or other non-auth error: keep cachedUser
          if (!cachedUser) {
            setUser(null);
          }
        }
      } else {
        // Offline: keep cached user
        if (!cachedUser) {
          setUser(null);
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Failed to fetch user");
      console.error("[useAuth] fetchUser error:", error);
      setError(error);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await Api.logout();
    } catch (err) {
      console.error("[Auth] Logout API call failed:", err);
      // Continue with logout even if API call fails
    } finally {
      await Auth.removeSessionToken();
      await Auth.clearUserInfo();
      try {
        const { resumeQueue } = await import("@/lib/offline-sync");
        resumeQueue();
      } catch {
        // ignore
      }
      setUser(null);
      setError(null);
      try {
        const { router } = await import("expo-router");
        router.replace("/login");
      } catch {
        // ignore
      }
    }
  }, []);

  const isAuthenticated = useMemo(() => Boolean(user), [user]);

  useEffect(() => {
    if (autoFetch) {
      if (Platform.OS === "web") {
        fetchUser();
      } else {
        // Native: check for cached user info first for instant load, then validate session
        Auth.getUserInfo().then((cachedUser) => {
          if (cachedUser) {
            setUser(cachedUser);
            setLoading(false);
          }
          fetchUser();
        });
      }
    } else {
      setLoading(false);
    }
  }, [autoFetch, fetchUser]);

  useEffect(() => {
    console.log("[useAuth] State updated:", {
      hasUser: !!user,
      loading,
      isAuthenticated,
      error: error?.message,
    });
  }, [user, loading, isAuthenticated, error]);

  return {
    user,
    loading,
    error,
    isAuthenticated,
    refresh: fetchUser,
    logout,
  };
}
