import React, { useEffect, useState } from "react";
import { Image, type ImageProps } from "expo-image";
import { getApiBaseUrl } from "@/constants/oauth";
import { getSessionToken } from "@/lib/_core/auth";

export function AuthImage({ source, style, ...props }: ImageProps & { source: { uri?: string } | any }) {
  const [authToken, setAuthToken] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    getSessionToken()
      .then((tok) => {
        if (mounted) setAuthToken(tok);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const rawUri = typeof source === "object" && source?.uri ? source.uri : null;

  if (rawUri) {
    const apiBase = getApiBaseUrl();
    const fullUri = rawUri.startsWith("/") && apiBase ? `${apiBase}${rawUri}` : rawUri;
    return (
      <Image
        {...props}
        source={{
          uri: fullUri,
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        }}
        style={style}
      />
    );
  }

  return <Image {...props} source={source} style={style} />;
}
