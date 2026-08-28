import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getNixoSession: vi.fn<() => Promise<unknown>>(() => Promise.resolve(null)),
  signOutOfNixo: vi.fn(() => Promise.resolve()),
  disableNixoWebhooks: vi.fn(() => Promise.resolve()),
  provisionNixo: vi.fn(() => Promise.resolve()),
  callOrder: [] as string[],
}));

vi.mock("~/nixo/auth", () => ({
  NIXO_SESSION_QUERY_KEY: ["nixo-session"],
  getNixoSession: mocks.getNixoSession,
  signOutOfNixo: mocks.signOutOfNixo,
}));

vi.mock("~/nixo/provision", () => ({
  disableNixoWebhooks: mocks.disableNixoWebhooks,
  provisionNixo: mocks.provisionNixo,
}));

vi.mock("~/nixo/login-form", () => ({
  NixoLoginForm: () => <div data-testid="nixo-login-form" />,
}));

import { SettingsAccount } from "./account";

const SESSION = {
  access_token: "at",
  refresh_token: "rt",
  expires_at: 4102444800,
  user: { id: "u1", email: "stephanie@withnixo.com" },
};

const renderAccount = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsAccount />
    </QueryClientProvider>,
  );
};

describe("SettingsAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callOrder.length = 0;
    mocks.signOutOfNixo.mockImplementation(() => {
      mocks.callOrder.push("signOut");
      return Promise.resolve();
    });
    mocks.disableNixoWebhooks.mockImplementation(() => {
      mocks.callOrder.push("disableWebhooks");
      return Promise.resolve();
    });
  });

  afterEach(cleanup);

  it("shows the sign-in form when signed out", async () => {
    mocks.getNixoSession.mockResolvedValue(null);

    renderAccount();

    expect(await screen.findByTestId("nixo-login-form")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("pauses webhook delivery before clearing the session on sign-out", async () => {
    // WHY: a signed-out recorder must not keep shipping meetings to the
    // dashboard, and the webhook pause has to land while we still can act —
    // clearing the session first and then failing would leave delivery live.
    mocks.getNixoSession.mockResolvedValue(SESSION);

    renderAccount();

    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(mocks.signOutOfNixo).toHaveBeenCalledOnce());
    expect(mocks.callOrder).toEqual(["disableWebhooks", "signOut"]);
  });

  it("re-runs the full provisioning from the settings page", async () => {
    // WHY: this is the recovery path when webhook/STT/LLM wiring breaks
    // without a fresh sign-in (e.g. backend secret reset).
    mocks.getNixoSession.mockResolvedValue(SESSION);

    renderAccount();

    fireEvent.click(
      await screen.findByRole("button", { name: "Re-run setup" }),
    );

    await waitFor(() => expect(mocks.provisionNixo).toHaveBeenCalledOnce());
  });
});
