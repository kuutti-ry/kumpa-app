import { AGE_MAX, AGE_MIN, type AgeWindow } from "@kuutti/schema";
import { useWindowDimensions, View } from "react-native";
import { GradientBlob } from "@/components/organic";
import { Stepper } from "@/components/ui/stepper";
import { useT } from "@/lib/locale";
import { useLookTraits } from "@/theme/ThemeProvider";

/**
 * The youngest and the oldest one seeks, as What you seek and onboarding ask
 * them: one above the other, since side by side, with the minus and the plus
 * further from the number, they overflow a small phone (#581). The youngest
 * never passes the oldest. In the Organic Pop try the two stand on a soft
 * shape that comes in from the screen's edge, as on Sini's board.
 */
export function AgeWindowSteppers({
  ages,
  onChange,
}: {
  ages: AgeWindow;
  onChange: (ages: AgeWindow) => void;
}) {
  const { t } = useT();
  // Organic Pop draws a soft shape behind the two; the other styles' backdrop is the screen's.
  const organic = useLookTraits().backdrop === "blobs";
  const { width } = useWindowDimensions();
  const steppers = (
    <>
      <Stepper
        label={t("onboarding.age.youngest")}
        value={ages.min}
        shown={t("onboarding.age.years", { years: ages.min })}
        downLabel={t("onboarding.age.youngestDown")}
        upLabel={t("onboarding.age.youngestUp")}
        canDown={ages.min > AGE_MIN}
        canUp={ages.min < ages.max}
        onChange={(min) => onChange({ ...ages, min })}
      />
      <Stepper
        label={t("onboarding.age.oldest")}
        value={ages.max}
        shown={t("onboarding.age.years", { years: ages.max })}
        downLabel={t("onboarding.age.oldestDown")}
        upLabel={t("onboarding.age.oldestUp")}
        canDown={ages.max > ages.min}
        canUp={ages.max < AGE_MAX}
        onChange={(max) => onChange({ ...ages, max })}
        tone="secondary"
      />
    </>
  );
  if (!organic) return steppers;
  const room = Math.min(width, 448);
  return (
    <View className="gap-5 py-4">
      <GradientBlob
        width={room * 1.1}
        height={room * 0.92}
        shape="puddle"
        angle={160}
        style={{ position: "absolute", left: -room * 0.08, top: -room * 0.1 }}
      />
      {steppers}
    </View>
  );
}
