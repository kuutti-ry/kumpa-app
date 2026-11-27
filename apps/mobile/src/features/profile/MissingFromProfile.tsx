import type { CompletenessItem } from "@kuutti/schema";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/locale";
import { fetchProfile } from "./client";
import { completenessText } from "./keys";

/**
 * What the profile still lacks before its card can be shown, a line each in the
 * profile screen's words (#239), for the home screen's matching card while that
 * says the profile is unfinished (#745). Read whenever the screen comes to the
 * front, as the card's own answer is, since the profile is finished on other
 * screens. Until the answer is there, and when it cannot be read, it draws
 * nothing: the card's sentence and the way to the profile say the rest, and the
 * profile screen says why it could not be read. A later read that fails takes
 * nothing away that was known.
 */
export function MissingFromProfile() {
  const { t } = useT();
  const [missing, setMissing] = useState<readonly CompletenessItem[]>([]);
  const asked = useRef(0);

  useFocusEffect(
    useCallback(() => {
      asked.current += 1;
      const mine = asked.current;
      fetchProfile()
        .then(({ completeness }) => {
          // Of two reads under way the later one speaks.
          if (mine === asked.current) setMissing(completeness.missing);
        })
        .catch(() => undefined);
    }, []),
  );

  if (missing.length === 0) return null;
  return (
    <View className="gap-1">
      {missing.map((item) => (
        <Text key={item}>{completenessText(t, item)}</Text>
      ))}
    </View>
  );
}
