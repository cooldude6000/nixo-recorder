import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

import { commands as store2Commands } from "@anlg/plugin-store2";

import { env } from "~/env";

// Session storage lives in the OS keychain (store2), same mechanism as AI
// provider API keys. This module is deliberately independent of the vendor
// auth stack (~/auth) so signing in to Nixo never activates the upstream
// cloud/billing machinery.

const SECRET_SCOPE = "nixo-account";
const SESSION_KEY = "session";
const REFRESH_LEEWAY_SECONDS = 120;

export const NIXO_SESSION_QUERY_KEY = ["nixo-session"] as const;

export type NixoSession = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string; email: string };
};

export function nixoApiUrl(): string {
  return env.VITE_NIXO_API_URL.replace(/\/+$/, "");
}

function parseSession(raw: string | null): NixoSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<NixoSession>;
    if (
      typeof value.access_token === "string" &&
      typeof value.refresh_token === "string" &&
      typeof value.expires_at === "number" &&
      value.user &&
      typeof value.user.id === "string"
    ) {
      return value as NixoSession;
    }
  } catch {
    // fall through
  }
  return null;
}

function toSession(data: {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  user?: { id?: string; email?: string };
}): NixoSession {
  if (!data.access_token || !data.refresh_token || !data.user?.id) {
    throw new Error("Malformed session response");
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at:
      data.expires_at ??
      Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
    user: { id: data.user.id, email: data.user.email ?? "" },
  };
}

async function saveSession(session: NixoSession): Promise<void> {
  const result = await store2Commands.setSecret(
    SECRET_SCOPE,
    SESSION_KEY,
    JSON.stringify(session),
  );
  if (result.status === "error") throw new Error(result.error);
}

export async function getNixoSession(): Promise<NixoSession | null> {
  const result = await store2Commands.getSecret(SECRET_SCOPE, SESSION_KEY);
  if (result.status === "error") return null;
  return parseSession(result.data);
}

export async function signInToNixo(
  email: string,
  password: string,
): Promise<NixoSession> {
  const resp = await tauriFetch(`${nixoApiUrl()}/api/recorder/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (resp.status === 401) throw new Error("invalid_credentials");
  if (!resp.ok) throw new Error(`login_failed:${resp.status}`);
  const session = toSession(await resp.json());
  await saveSession(session);
  return session;
}

export async function signOutOfNixo(): Promise<void> {
  await store2Commands.deleteSecret(SECRET_SCOPE, SESSION_KEY);
}

// Single-flight refresh: concurrent callers (LLM stream + STT key refresh)
// must not race the rotating refresh token — GoTrue invalidates the old one
// on each use.
let refreshInFlight: Promise<NixoSession | null> | null = null;

async function refreshNixoSession(
  refreshToken: string,
): Promise<NixoSession | null> {
  try {
    const resp = await tauriFetch(`${nixoApiUrl()}/api/recorder/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (resp.status === 401) {
      // Refresh token is dead; keeping the session would loop forever.
      await signOutOfNixo();
      return null;
    }
    if (!resp.ok) return null;
    const session = toSession(await resp.json());
    await saveSession(session);
    return session;
  } catch {
    // Transient network failure: keep the stored session for a later retry.
    return null;
  }
}

export async function getNixoAccessToken(): Promise<string | null> {
  const session = await getNixoSession();
  if (!session) return null;

  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at - now > REFRESH_LEEWAY_SECONDS) {
    return session.access_token;
  }

  refreshInFlight ??= refreshNixoSession(session.refresh_token).finally(() => {
    refreshInFlight = null;
  });
  const refreshed = await refreshInFlight;
  return refreshed?.access_token ?? null;
}
