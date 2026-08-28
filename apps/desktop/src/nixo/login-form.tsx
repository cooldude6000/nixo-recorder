import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { Input } from "@anlg/ui/components/ui/input";

import { signInToNixo } from "./auth";
import { provisionNixo } from "./provision";

// Shared between onboarding and Settings → Account: signs in and runs the
// full recorder provisioning (webhook + LLM + STT) in one motion.
export function NixoLoginForm({ onSignedIn }: { onSignedIn: () => void }) {
  const { t } = useLingui();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const signInMutation = useMutation({
    mutationFn: async () => {
      await signInToNixo(email.trim(), password);
      await provisionNixo();
    },
    onSuccess: onSignedIn,
  });

  const errorMessage = signInMutation.error
    ? String(signInMutation.error.message) === "invalid_credentials"
      ? t`Invalid email or password.`
      : t`Sign-in worked but setup did not finish. Check your connection and try again.`
    : null;

  return (
    <form
      className="flex max-w-sm flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!signInMutation.isPending) signInMutation.mutate();
      }}
    >
      <Input
        type="email"
        autoComplete="email"
        placeholder={t`Work email`}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={signInMutation.isPending}
      />
      <Input
        type="password"
        autoComplete="current-password"
        placeholder={t`Password`}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={signInMutation.isPending}
      />
      {errorMessage && (
        <p className="text-destructive text-sm">{errorMessage}</p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={signInMutation.isPending || !email.trim() || !password}
          className="bg-primary text-primary-foreground hover:bg-primary/90 w-fit rounded-full px-4 py-1.5 text-sm font-medium duration-150 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
        >
          {signInMutation.isPending ? (
            <Trans>Setting up…</Trans>
          ) : (
            <Trans>Sign in</Trans>
          )}
        </button>
        {signInMutation.isPending && (
          <span className="text-muted-foreground text-sm">
            <Trans>Connecting your recorder to Nixo…</Trans>
          </span>
        )}
      </div>
    </form>
  );
}
