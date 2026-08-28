import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode } from "react";

import { Button } from "@anlg/ui/components/ui/button";
import { sonnerToast } from "@anlg/ui/components/ui/toast";

import {
  getNixoSession,
  NIXO_SESSION_QUERY_KEY,
  signOutOfNixo,
} from "~/nixo/auth";
import { NixoLoginForm } from "~/nixo/login-form";
import { disableNixoWebhooks, provisionNixo } from "~/nixo/provision";
import { SettingsPageTitle } from "~/settings/page-title";

export function SettingsAccount() {
  const { t } = useLingui();
  const queryClient = useQueryClient();

  const { data: session } = useQuery({
    queryKey: NIXO_SESSION_QUERY_KEY,
    queryFn: getNixoSession,
  });

  const invalidateSession = () =>
    queryClient.invalidateQueries({ queryKey: NIXO_SESSION_QUERY_KEY });

  const signOutMutation = useMutation({
    mutationFn: async () => {
      await disableNixoWebhooks();
      await signOutOfNixo();
    },
    onSuccess: () => {
      void invalidateSession();
    },
    onError: () => {
      sonnerToast.error(t`Nixo couldn't sign you out. Try again.`);
    },
  });

  const reprovisionMutation = useMutation({
    mutationFn: provisionNixo,
    onSuccess: () => {
      sonnerToast.success(t`Recorder setup refreshed.`);
    },
    onError: () => {
      sonnerToast.error(t`Setup did not finish. Check your connection and try again.`);
    },
  });

  if (!session) {
    return (
      <div className="flex flex-col gap-8">
        <SettingsPageTitle title={<Trans>Account</Trans>} />
        <Container
          title={<Trans>Sign in to Nixo</Trans>}
          description={
            <Trans>
              Sign in with your Nixo account and the recorder wires itself up
              — meeting delivery, transcription, and note generation are
              configured automatically.
            </Trans>
          }
        >
          <NixoLoginForm onSignedIn={() => void invalidateSession()} />
        </Container>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <SettingsPageTitle title={<Trans>Account</Trans>} />
      <Container
        title={<Trans>Your Account</Trans>}
        description={session.user.email || t`Signed in`}
        action={
          <Button
            variant="destructive"
            onClick={() => signOutMutation.mutate()}
            disabled={signOutMutation.isPending}
          >
            {signOutMutation.isPending ? t`Signing out...` : t`Sign out`}
          </Button>
        }
      >
        <p className="text-muted-foreground text-xs">
          <Trans>
            Signing out pauses meeting delivery to the Nixo dashboard.
          </Trans>
        </p>
      </Container>

      <Container
        title={<Trans>Recorder setup</Trans>}
        description={
          <Trans>
            Re-runs the automatic setup: webhook delivery, transcription key,
            and note generation.
          </Trans>
        }
        action={
          <Button
            variant="outline"
            onClick={() => reprovisionMutation.mutate()}
            disabled={reprovisionMutation.isPending}
          >
            {reprovisionMutation.isPending ? t`Refreshing...` : t`Re-run setup`}
          </Button>
        }
      />
    </div>
  );
}

function Container({
  title,
  description,
  action,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h3 className="text-sm font-medium">{title}</h3>
          {description && (
            <div className="text-muted-foreground text-sm">{description}</div>
          )}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}
