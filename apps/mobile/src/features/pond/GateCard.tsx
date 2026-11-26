import type { ReactNode } from "react";
import { LoadFailed } from "@/components/LoadFailed";
import { Card, CardContent } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/locale";
import { useHapticTap } from "@/theme/haptics";
import { useGate } from "./useGate";

/**
 * Whether matching is open for the person (#500, ADR-060 §4), one sentence for
 * each of three things: the profile lacks something, it is finished and
 * matching has not opened, or open. Each says Matching, so the card has no name
 * of its own to draw or to hear (#581): a label here would reach no phone, since a
 * plain view is flattened away, and `accessible` would fold See people into one
 * element. The gate's answer has no number. The card carries what the home
 * screen hands it for two of the three: once matching is open, the way to the
 * queue (#379, ADR-062); while the profile lacks something, what it lacks, in
 * the profile's words, and the way to the profile as the one thing to do there,
 * which otherwise follows the card (#745).
 */
export function GateCard({
  whenOpen,
  whenIncomplete,
  toProfile,
}: {
  whenOpen?: ReactNode;
  whenIncomplete?: ReactNode;
  /** The way to the profile, told whether it is drawn in the card or after it. */
  toProfile?: (inCard: boolean) => ReactNode;
}) {
  const { t } = useT();
  const tap = useHapticTap();
  const view = useGate();
  const gate = view.status === "ready" ? view.gate : null;
  const lacking = gate?.state === "incomplete";

  return (
    <>
      <Card className="w-full max-w-md">
        <CardContent className="gap-2">
          {view.status === "loading" && (
            <Text accessibilityLiveRegion="polite">{t("load.loading")}</Text>
          )}
          {view.status === "failed" && (
            <LoadFailed
              error={view.error}
              onRetry={() => {
                tap();
                view.retry();
              }}
            />
          )}
          {lacking && (
            <>
              <Text>{t("pond.gate.incomplete")}</Text>
              {whenIncomplete}
              {toProfile?.(true)}
            </>
          )}
          {gate?.state === "closed" && <Text>{t("pond.gate.closed")}</Text>}
          {gate?.state === "open" && (
            <>
              <Text>{t("pond.gate.open")}</Text>
              {whenOpen}
            </>
          )}
        </CardContent>
      </Card>
      {!lacking && toProfile?.(false)}
    </>
  );
}
