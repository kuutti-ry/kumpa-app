import { formatDate, type PlainMessageKey } from "@kuutti/i18n";
import type {
  DealBreakerField,
  LikeAnchor,
  QueueChoice,
  QueueEntry,
  QueueResponse,
  Relaxation,
} from "@kuutti/schema";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { fetchConversations } from "@/features/chat";
import { codeOf, statusOf } from "@/lib/api";
import { decide, fetchQueue, openStar, relaxToday, reportSeen, undoRelaxation } from "./client";

type QueueView =
  | { status: "loading" }
  /** `error` says why, for the screen to say so (LoadFailed). */
  | { status: "failed"; error: unknown }
  /**
   * The day's cards are used up (ADR-034 Open 7), where the panel has set a
   * budget (ADR-062 §9): said in words, nothing to try again.
   */
  | { status: "budget" }
  /** A star opened that the list no longer shows (#575, ADR-064 §6): said with no word why. */
  | { status: "gone" }
  /** The cards the phone holds; with none left to decide, the queue's end, or null entries before matching opens. */
  | { status: "ready"; queue: QueueResponse };

/**
 * The queue past the cards the phone holds (ADR-062 §1): the next read still to
 * be asked, a read on its way or what became of it, or the end one found.
 */
type More = { status: "ask" } | { status: "end" } | Exclude<QueueView, { status: "ready" }>;

/**
 * What the screen says above the card, once, after something the person did
 * not see coming: a sentence of the catalogue, or the your-turn refusal
 * (ADR-062 §5), which says how many conversations wait.
 */
export type QueueNotice =
  | Extract<
      PlainMessageKey,
      | "errors.day_ended"
      | "errors.match_made"
      | "errors.like_budget_exceeded"
      | "errors.fish_budget_exceeded"
      | "errors.already_relaxed"
      | "errors.relaxations_changed"
      | "errors.card_budget_exceeded"
      | "errors.anchor_not_on_card"
      | "queue.later.first"
      | "queue.later.full"
      | "load.failed.press"
      | "queue.short.nobody"
      | "queue.gone"
    >
  | { waiting: number };

/** The card on the screen, with the day its queue is of. */
export type QueueCard = { day: string; entry: QueueEntry };

/** The Finnish day of an instant, only ever compared: a queue is Finland's day (ADR-034). */
const finnishDay = (at: Date | number) => formatDate("fi", at, { timeZone: "Europe/Helsinki" });

/** Each place once, in order, the later copy winning: a read's answer is the newer word on a card. */
const byPosition = (entries: readonly QueueEntry[]): QueueEntry[] =>
  [...new Map(entries.map((entry) => [entry.position, entry])).values()].sort(
    (a, b) => a.position - b.position,
  );

/**
 * The queue on the phone (#379, #502, ADR-034, ADR-062): one card at a time,
 * the first one not yet decided, and once none is left the next read, whose
 * cards come after those the phone holds, so that Undo's last card stays. A
 * read that finds nobody is the queue's end, and nothing else is. A decision is
 * a button, dimmed while one is on its way, so nothing repeats. The last
 * decision can be taken back (ADR-034 §5): Undo brings its card back, and the
 * decision stands until another one replaces it. A like that made a match is
 * final (ADR-038 §3), so nothing offers it back. Each card reports itself seen
 * once. Whether a fish can go today, how many likes are left and how many
 * conversations wait come with each read and with every decision's answer
 * (#475, #524, ADR-062 §5), never from a read of the queue of their own (ADR-008);
 * a like refused over the conversations waiting asks the list, which hands over
 * no card.
 *
 * A day that ended while the screen was open is read anew: the API refuses
 * the old day's writes (409 `day_ended`), and the screen says that a press
 * was lost; so is a queue that comes back in sight on another day, and one whose
 * next read finds another day, with no word, since nothing was lost and the next
 * card is simply there (#581). An answer to the old day's request that lands
 * after that changes nothing of the new day. A card that is gone meanwhile (404)
 * leaves the screen.
 *
 * Given `star`, the id of a star on the Later list (#575, ADR-064 §2), the same
 * for that one card, as it stands in today's log, however it was left there, and
 * no read after it: its decision and its Undo are the queue's, and what comes next
 * is the way back to the list.
 */
export function useQueue(star?: string) {
  // The cards the phone holds, of one day; null until a read answers.
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [more, setMore] = useState<More>({ status: "loading" });
  // A card brought back by Undo, by its place; null while the queue goes on in order.
  const [revisit, setRevisit] = useState<number | null>(null);
  // The place of the last decision that Undo may bring back.
  const [last, setLast] = useState<number | null>(null);
  // The conversation a like just opened (#100).
  const [match, setMatch] = useState<string | null>(null);
  const [notice, setNotice] = useState<QueueNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const seen = useRef(new Set<string>());
  const mounted = useRef(true);
  // The queue on the screen as the last answer left it (null while none is),
  // and the phone's Finnish day when it was read. An answer looks here when
  // it lands, not at the queue its request went from: one to another day's
  // request (a new day was read meanwhile) changes and says nothing.
  const shown = useRef<QueueResponse | null>(null);
  const readOn = useRef<string | null>(null);
  // Of two reads under way the later one speaks.
  const asked = useRef(0);

  const showQueue = useCallback((queue: QueueResponse) => {
    shown.current = queue;
    setQueue(queue);
  }, []);

  /** What belongs to the day on the screen goes, and `said` takes its place above the card. */
  const leaveDay = useCallback((said: QueueNotice | null) => {
    setRevisit(null);
    setLast(null);
    setMatch(null);
    setNotice(said);
  }, []);

  /**
   * The next cards (ADR-062 §1), kept after those of the same day the phone
   * holds. An answer of another day takes their place: the day ended between
   * the last card and this read. One with nothing undecided in it ends the
   * queue, so that no answer can bring on another read by itself.
   */
  const readCards = useCallback(() => {
    asked.current += 1;
    const mine = asked.current;
    setMore({ status: "loading" });
    (star ? openStar(star) : fetchQueue()).then(
      (answer) => {
        if (mine !== asked.current) return;
        readOn.current = finnishDay(Date.now());
        const held = shown.current;
        if (held && held.day !== answer.day) leaveDay(null);
        const kept = held?.day === answer.day ? held.entries : null;
        showQueue({
          ...answer,
          entries: answer.entries && byPosition([...(kept ?? []), ...answer.entries]),
        });
        // The opened card comes as it stands, Later on it or not, and nothing after it.
        if (star) setRevisit(answer.entries?.[0]?.position ?? null);
        setMore({
          status: !star && answer.entries?.some((entry) => entry.decision === null) ? "ask" : "end",
        });
      },
      (error: unknown) => {
        if (mine !== asked.current) return;
        setMore(
          codeOf(error) === "card_budget_exceeded"
            ? { status: "budget" }
            : star && statusOf(error) === 404
              ? { status: "gone" }
              : { status: "failed", error },
        );
      },
    );
  }, [star, showQueue, leaveDay]);

  // Never after the screen is gone: a read serves the cards again (ADR-008).
  const read = useCallback(
    (said: QueueNotice | null) => {
      if (!mounted.current) return;
      shown.current = null;
      setQueue(null);
      leaveDay(said);
      readCards();
    },
    [leaveDay, readCards],
  );

  useEffect(() => {
    mounted.current = true;
    read(null);
    return () => {
      mounted.current = false;
    };
  }, [read]);

  /** The queue on the screen while it is `day`'s; null once another day was read. */
  const onDay = useCallback((day: string) => {
    const queue = shown.current;
    return queue?.day === day ? queue : null;
  }, []);

  /** Rewrites the entries of the queue on the screen, which has the card answered. */
  const rewrite = useCallback(
    (queue: QueueResponse, change: (entries: QueueEntry[]) => QueueEntry[]) =>
      showQueue({ ...queue, entries: queue.entries && change(queue.entries) }),
    [showQueue],
  );

  /**
   * A card gone meanwhile, or blocked or reported from the card (ADR-030
   * §11): it leaves the screen, when its day's queue is still there. It is
   * the card on the screen, so never the last decision's, which Undo would
   * bring back.
   */
  const drop = useCallback(
    (day: string, position: number) => {
      const queue = onDay(day);
      if (!queue) return;
      rewrite(queue, (entries) => entries.filter((entry) => entry.position !== position));
      setRevisit((was) => (was === position ? null : was));
    },
    [onDay, rewrite],
  );

  /**
   * A queue left open past midnight is read anew when it comes back in sight
   * on another Finnish day (#379): nothing on one that has ended or not opened
   * asks the API, which would refuse the old day. Never on its own day, nor on
   * the phone's day it was read on, whatever the phone's clock says: each read
   * serves the cards again (ADR-008). On its own day the queue's end asks once
   * more when the person comes back to the screen, since a change of filters or
   * home works on the next read (ADR-062 §8) and the way into What you seek leads
   * back here. The app coming back asks nothing: a notification pulled down would
   * take the end and its offers away, with a loading line in their place.
   */
  const freshen = useCallback(
    (backOnScreen: boolean) => {
      const queue = shown.current;
      const today = finnishDay(Date.now());
      if (
        queue &&
        today !== finnishDay(new Date(`${queue.day}T12:00:00Z`)) &&
        today !== readOn.current
      ) {
        read(null);
      } else if (backOnScreen && !star) {
        setMore((was) => (was.status === "end" ? { status: "ask" } : was));
      }
    },
    [star, read],
  );

  // In sight: the app in the foreground, and no conversation pushed over the
  // queue, under which a new day's card would be reported seen unseen.
  useFocusEffect(
    useCallback(() => {
      freshen(true);
      const subscription = AppState.addEventListener("change", (next) => {
        if (next === "active") freshen(false);
      });
      return () => subscription.remove();
    }, [freshen]),
  );

  const entry =
    queue?.entries?.find((each) =>
      revisit === null ? each.decision === null : each.position === revisit,
    ) ?? null;
  const current: QueueCard | null = queue && entry ? { day: queue.day, entry } : null;

  // The card on the screen, reported once (ADR-034 §2); not while a match
  // stands in front of it. The report gates nothing, so a failure is not
  // said, except what it tells about the card or the day.
  const day = queue?.day;
  const position = match === null ? entry?.position : undefined;
  useEffect(() => {
    if (day === undefined || position === undefined) return;
    const key = `${day}/${position}`;
    if (seen.current.has(key)) return;
    seen.current.add(key);
    reportSeen(day, position).catch((error: unknown) => {
      if (statusOf(error) === 404) drop(day, position);
      else if (codeOf(error) === "day_ended" && onDay(day)) read(null);
    });
  }, [day, position, read, drop, onDay]);

  // No card left to decide and no end found: the next read. A match stands in
  // front of it as it stands in front of a seen report, and a read hands cards
  // over (ADR-008), so it waits until the match is closed.
  const ask = !!queue?.entries && !current && match === null && more.status === "ask";
  useEffect(() => {
    if (ask) readCards();
  }, [ask, readCards]);

  // The cards while one is left, or a match in front of them. Past the last
  // one the read of the next speaks, and only its empty answer is the end.
  const view: QueueView =
    queue && (current || match !== null || !queue.entries || more.status === "end")
      ? { status: "ready", queue }
      : more.status === "ask" || more.status === "end"
        ? { status: "loading" }
        : more;

  const choose = useCallback(
    async (
      { day, entry }: QueueCard,
      decision: QueueChoice,
      anchor: LikeAnchor | null = null,
    ): Promise<"anchor_not_on_card" | null> => {
      const { position } = entry;
      // A like or a pass takes the person off the Later list (ADR-064 §3), and Later
      // puts them on it (#681), with no id the phone needs: the card has left the queue.
      const decided = (queue: QueueResponse, as: QueueChoice) =>
        rewrite(queue, (entries) =>
          entries.map((each) =>
            each.position === position
              ? { ...each, decision: as, star: as === "skip" ? each.star : null }
              : each,
          ),
        );
      setBusy(true);
      setNotice(null);
      try {
        const answer = await decide(day, position, decision, anchor);
        const queue = onDay(day);
        if (!queue) return null;
        const { fishToSend, likesLeft, yourTurn } = answer;
        decided({ ...queue, fishToSend, likesLeft, yourTurn }, decision);
        setRevisit(null);
        setLast(answer.match ? null : position);
        setMatch(answer.match?.conversationId ?? null);
        // The first on the list says who sees it (ADR-064 §7); at the most it may
        // hold, the card comes back another day, as a skip does (#681).
        if (answer.later === "first") setNotice("queue.later.first");
        if (answer.later === "full") setNotice("queue.later.full");
      } catch (error) {
        // Nothing to say of another day's card: the new queue was read already.
        const queue = onDay(day);
        if (!queue) return null;
        const code = codeOf(error);
        if (code === "day_ended") {
          read("errors.day_ended");
        } else if (code === "match_made") {
          // The like stands, as it was, and the queue goes on to the next card (ADR-038 §3).
          decided(queue, entry.decision ?? "like");
          setRevisit(null);
          setLast(null);
          setNotice("errors.match_made");
        } else if (statusOf(error) === 404) {
          drop(day, position);
          setNotice("queue.gone");
        } else if (code === "like_budget_exceeded") {
          // Another phone spent the day's last like meanwhile (#524): the line says so too.
          showQueue({ ...queue, likesLeft: 0 });
          setNotice("errors.like_budget_exceeded");
        } else if (code === "fish_budget_exceeded") {
          // Another phone sent the week's fish meanwhile (#475): the fish leaves the bar.
          showQueue({ ...queue, fishToSend: false });
          setNotice("errors.fish_budget_exceeded");
        } else if (code === "your_turn_limit") {
          // Nothing was saved: the card stays, for a pass or Later (ADR-062 §5). The
          // refusal carries no number, and the one held may be hours old, so the list
          // says how many wait now (ADR-062 §5): without thumbs, which signs and spends
          // nothing, where a read of the queue would serve its cards again (ADR-008) and
          // count towards its alarm (ADR-041). A read that fails leaves the number held.
          const now = await fetchConversations(false)
            .then((list) => list.yourTurn.waiting)
            .catch(() => null);
          const held = onDay(day);
          if (!held) return null;
          const waiting = now ?? held.yourTurn;
          showQueue({ ...held, yourTurn: waiting });
          setNotice({ waiting });
        } else if (code === "anchor_not_on_card") {
          // Nothing was saved: the part picked has left the card since it was read
          // (#463, ADR-077). The card stays, and the screen clears the pick.
          setNotice("errors.anchor_not_on_card");
          return code;
        } else {
          setNotice("load.failed.press");
        }
      } finally {
        setBusy(false);
      }
      return null;
    },
    [rewrite, onDay, read, drop, showQueue],
  );

  /**
   * A deal-breaker relaxed for today (#99, ADR-042 §5): the first cards it
   * added come after the last, without a read (each read serves its cards,
   * ADR-008), and the first of them is the next on the screen. The queue is
   * open again: the read after them goes on to the rest it lets in (ADR-062 §10).
   */
  const relax = useCallback(
    async (day: string, relaxation: Relaxation) => {
      setBusy(true);
      setNotice(null);
      try {
        const added = await relaxToday(day, relaxation);
        const queue = onDay(day);
        if (!queue) return;
        if (added.length === 0) {
          setNotice("queue.short.nobody");
        } else {
          rewrite(queue, (entries) => byPosition([...entries, ...added]));
          setMore({ status: "ask" });
        }
      } catch (error) {
        if (!onDay(day)) return;
        const code = codeOf(error);
        if (code === "day_ended") read("errors.day_ended");
        else if (code === "already_relaxed") setNotice("errors.already_relaxed");
        // Another device relaxed or undid one meanwhile: the panel reads the offers again.
        else if (code === "relaxations_changed") setNotice("errors.relaxations_changed");
        // Relaxed, its cards in the queue: the day's cards ran out serving them.
        else if (code === "card_budget_exceeded") setNotice("errors.card_budget_exceeded");
        else setNotice("load.failed.press");
      } finally {
        setBusy(false);
      }
    },
    [onDay, rewrite, read],
  );

  /** Today's relaxation undone (§6): the undecided cards it brought leave the screen. */
  const unrelax = useCallback(
    async (day: string, field: DealBreakerField) => {
      setBusy(true);
      setNotice(null);
      try {
        const removed = new Set(await undoRelaxation(day, field));
        const queue = onDay(day);
        if (!queue) return;
        rewrite(queue, (entries) => entries.filter((entry) => !removed.has(entry.position)));
      } catch (error) {
        if (!onDay(day)) return;
        if (codeOf(error) === "day_ended") read("errors.day_ended");
        else setNotice("load.failed.press");
      } finally {
        setBusy(false);
      }
    },
    [onDay, rewrite, read],
  );

  const undo = useCallback(() => {
    setRevisit(last);
    setLast(null);
    setNotice(null);
  }, [last]);

  return {
    view,
    /** A read past the cards the phone holds, not the first of the screen: what the screen says aloud. */
    readingOn: queue !== null && view.status === "loading",
    /** The card on the screen: the first undecided one, or the one Undo brought back, decided already. */
    current,
    canUndo: last !== null && !busy && match === null,
    busy,
    match,
    notice,
    choose,
    undo,
    drop,
    relax,
    unrelax,
    closeMatch: useCallback(() => setMatch(null), []),
    // Past the cards the phone holds, a failed read is asked again without losing them.
    retry: useCallback(() => (shown.current ? readCards() : read(null)), [read, readCards]),
  };
}
