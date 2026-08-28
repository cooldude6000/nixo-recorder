import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

import { commands as webhookCommands } from "@anlg/plugin-local-api";

import { getNixoAccessToken, nixoApiUrl } from "./auth";

import { setAiProvider } from "~/settings/providers";
import { setSettingValues } from "~/settings/queries";

// Configures the app end-to-end from a signed-in Nixo session: webhook to
// the Nixo backend, LLM via the Nixo relay, STT via a short-lived Deepgram
// key minted by the backend. Provider *selection* is only written here (on
// explicit sign-in / re-run), never by the periodic key refresh — switching
// providers manually must survive an app restart.

const STT_MODEL = "nova-3-general";
const FALLBACK_LLM_MODEL = "nixo-default";

function unwrap<T>(
  result: { status: "ok"; data: T } | { status: "error"; error: string },
): T {
  if (result.status === "error") throw new Error(result.error);
  return result.data;
}

async function authedFetch(
  pathOrUrl: string,
  init?: Parameters<typeof tauriFetch>[1],
): Promise<Response> {
  const token = await getNixoAccessToken();
  if (!token) throw new Error("not_signed_in");
  const url = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `${nixoApiUrl()}${pathOrUrl}`;
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return tauriFetch(url, { ...init, headers });
}

export async function provisionNixo(): Promise<void> {
  const configResp = await authedFetch("/api/recorder/config");
  if (!configResp.ok) {
    throw new Error(`config_failed:${configResp.status}`);
  }
  const config = (await configResp.json()) as {
    webhook_url: string;
    llm_base_url: string;
  };

  await reconcileWebhook(config.webhook_url);
  await configureLlm(config.llm_base_url);
  await refreshNixoSttKey();
  await setSettingValues({
    current_stt_provider: "deepgram",
    current_stt_model: STT_MODEL,
  });
}

// The local webhook API is create-or-delete only (no update, and the secret
// is shown exactly once at creation), so reconciliation is: drop whatever
// already points at our URL, create fresh, and push the new secret to the
// backend in the same pass — both sides rotate together or not at all.
async function reconcileWebhook(webhookUrl: string): Promise<void> {
  const existing = unwrap(await webhookCommands.listWebhooks());
  for (const hook of existing) {
    if (hook.url === webhookUrl) {
      unwrap(await webhookCommands.deleteWebhook(hook.id));
    }
  }

  const created = unwrap(await webhookCommands.createWebhook(webhookUrl, []));

  const put = await authedFetch("/api/nixo_recorder/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nixo_recorder_webhook_secret: created.secret }),
  });
  if (!put.ok) {
    // Backend never saw the secret — remove the endpoint so no delivery
    // goes out signed with a key the verifier doesn't hold.
    await webhookCommands.deleteWebhook(created.id);
    throw new Error(`webhook_secret_sync_failed:${put.status}`);
  }
}

async function configureLlm(llmBaseUrl: string): Promise<void> {
  await setAiProvider("llm", "nixo", { base_url: llmBaseUrl });
  await setSettingValues({
    current_llm_provider: "nixo",
    current_llm_model: await fetchPinnedModel(llmBaseUrl),
  });
}

async function fetchPinnedModel(llmBaseUrl: string): Promise<string> {
  try {
    const resp = await authedFetch(`${llmBaseUrl.replace(/\/+$/, "")}/models`);
    if (!resp.ok) return FALLBACK_LLM_MODEL;
    const body = (await resp.json()) as { data?: Array<{ id?: string }> };
    return body.data?.[0]?.id || FALLBACK_LLM_MODEL;
  } catch {
    return FALLBACK_LLM_MODEL;
  }
}

// Pauses delivery to Nixo on sign-out: a signed-out recorder must not keep
// shipping meetings to the dashboard. Matched by URL shape (no token needed),
// paused rather than deleted so signing back in reconciles cleanly.
export async function disableNixoWebhooks(): Promise<void> {
  const existing = unwrap(await webhookCommands.listWebhooks());
  for (const hook of existing) {
    if (hook.url.includes("platform=nixo_recorder") && hook.active) {
      unwrap(await webhookCommands.setWebhookActive(hook.id, false));
    }
  }
}

// Mints a fresh short-lived Deepgram key and stores it as the deepgram
// provider's API key. Quiet no-op when not signed in; never touches the
// current_stt_* selection.
export async function refreshNixoSttKey(): Promise<boolean> {
  try {
    const token = await getNixoAccessToken();
    if (!token) return false;
    const resp = await tauriFetch(`${nixoApiUrl()}/api/recorder/stt-key`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return false;
    const body = (await resp.json()) as { stt_api_key?: string };
    if (!body.stt_api_key) return false;
    await setAiProvider("stt", "deepgram", { api_key: body.stt_api_key });
    return true;
  } catch {
    return false;
  }
}
