import { useRouter } from "expo-router";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/locale";
import { useHapticTap } from "@/theme/haptics";
import { useStars } from "./useStars";

/**
 * The way to the Later list (#575, ADR-064 §6, #681), on the home screen beside the
 * way to the queue and where the queue ends, only while the list shows somebody.
 * Its words only: no count. From the queue's end it takes the queue's place, so
 * that the list's back arrow goes home, as it says.
 */
export function StarsButton({ replace = false }: { replace?: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const tap = useHapticTap();
  const { view } = useStars();
  if (view.status !== "ready" || view.items.length === 0) return null;
  return (
    <Button
      variant="outline"
      onPress={() => {
        tap();
        if (replace) router.replace("/stars");
        else router.push("/stars");
      }}
    >
      {t("stars.home.open")}
    </Button>
  );
}
