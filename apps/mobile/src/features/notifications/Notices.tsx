import { sanctionStatement } from "@kuutti/i18n";
import type { Notice } from "@kuutti/schema";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import { sayOnIos } from "@/components/Notice";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/locale";
import { useHapticTap } from "@/theme/haptics";
import { fetchNotices, markNoticeRead } from "./client";

/**
 * A notice's title, its sentence and, for a sanction, its statement's lines
 * (#715, ADR-073 §1), from its kind and what it points at; an announcement's
 * words are its own.
 */
function wordsOf(
  notice: Notice,
  t: ReturnType<typeof useT>["t"],
): { title: string; body: string; statement?: string[] } {
  // Kuutti's words to everybody, already in the reader's language (#573, ADR-068 §3).
  if (notice.kind === "announcement") return { title: notice.title, body: notice.body };
  // A moderator's warning (ADR-024 §7): its reason, the rule and how to contest it.
  if (notice.kind === "warning") {
    return {
      title: t("notices.warning.title"),
      body: t("notices.warning.body"),
      statement: sanctionStatement(t, notice.reason),
    };
  }
  // A moderator's shadow ban, told at once (ADR-073 §2); a rule's is never told.
  if (notice.kind === "shadow_ban") {
    return {
      title: t("notices.shadowBan.title"),
      body: t("notices.shadowBan.body"),
      statement: sanctionStatement(t, notice.reason),
    };
  }
  // What the counted invitation earned the person, never who the other was (ADR-044 §9).
  if (notice.kind === "invitation_friend") {
    return {
      title: t("notices.invitationFriend.title"),
      body: t("notices.invitationFriend.body", { fish: notice.reward.fish }),
    };
  }
  return {
    title: t("notices.invitationCounted.title"),
    body: t("notices.invitationCounted.body", { fish: notice.reward.fish }),
  };
}

/**
 * The notices on the home screen (#176, ADR-032): what must reach the person
 * even without a push, the unread ones only, newest first, under a heading of
 * their own; nothing at all when there are none. Today that is a moderator's
 * warning (ADR-024 §7) and shadow ban (#715), each with its reason, the
 * rule it rests on and how to contest it, an invitation of the person's that
 * counted, with what it earned (#107), and an announcement to everybody in
 * its own words (#573). Each has Got it, a button, which marks
 * it read and takes it off the screen; a failure says so and keeps it. Read
 * again whenever the home screen comes into focus. A notice that cannot be
 * read is left out quietly: the home screen does not fail for it.
 */
export function Notices() {
  const { t } = useT();
  const tap = useHapticTap();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const focused = useRef(false);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      fetchNotices().then(
        (answer) => focused.current && setNotices(answer.notices.filter((n) => !n.readAt)),
        () => undefined,
      );
      return () => {
        focused.current = false;
      };
    }, []),
  );

  const read = async (notice: Notice) => {
    tap();
    setFailed(null);
    try {
      await markNoticeRead(notice.id);
      setNotices((shown) => shown.filter((n) => n.id !== notice.id));
    } catch {
      setFailed(notice.id);
      sayOnIos(t("load.failed.press"));
    }
  };

  if (notices.length === 0) return null;
  return (
    <View className="gap-3">
      <Text variant="h4" accessibilityRole="header">
        {t("notices.title")}
      </Text>
      {notices.map((notice) => {
        const words = wordsOf(notice, t);
        return (
          <View key={notice.id} className="gap-2 rounded-lg border border-border p-4">
            <Text className="font-semibold">{words.title}</Text>
            <Text>{words.body}</Text>
            {words.statement?.map((line) => (
              <Text key={line}>{line}</Text>
            ))}
            {failed === notice.id && (
              <Text accessibilityLiveRegion="assertive">{t("load.failed.press")}</Text>
            )}
            <Button variant="outline" onPress={() => void read(notice)}>
              {t("notices.read")}
            </Button>
          </View>
        );
      })}
    </View>
  );
}
