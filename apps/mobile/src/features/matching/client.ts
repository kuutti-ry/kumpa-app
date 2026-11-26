import {
  type ApiComponents,
  type DealBreakerField,
  type LikeAnchor,
  type QueueChoice,
  QueueDecisionAnswer,
  type QueueEntry,
  QueueResponse,
  type Relaxation,
  RelaxationAnswer,
  RelaxationsResponse,
  RelaxationUndone,
  StarList,
  type StarredPerson,
} from "@kuutti/schema";
import { api, failed } from "@/lib/api";

// The queue as the app calls it (#379, #502, ADR-034 §4, ADR-062), through the
// typed client; the zod contracts guard the runtime (ADR-003). A refusal keeps
// the envelope's code, which the screen says in words.

/**
 * The day and the next cards, undecided, in order, a page of them: a read with
 * none left adds the next people. Null entries before matching opens, an empty
 * list at the queue's end (ADR-062 §1).
 */
export async function fetchQueue(): Promise<QueueResponse> {
  const { data, error, response } = await api.GET("/queue/today");
  if (!data) throw failed(response, error, "queue");
  return QueueResponse.parse(data);
}

/** The card was on the screen: the first report is recorded, a repeat writes nothing. */
export async function reportSeen(day: string, position: number): Promise<void> {
  const { error, response } = await api.POST("/queue/{day}/entries/{position}/seen", {
    params: { path: { day, position } },
  });
  if (!response.ok) throw failed(response, error, "seen");
}

/**
 * A like, a pass, a fish or a skip, replacing the day's earlier one; a like or
 * a fish may name the part of the card it is for (#463), and one naming none
 * names none. The answer names a match's conversation (#100), and says whether
 * a fish can still go today (#475), the likes left (#524) and the conversations
 * waiting (ADR-062 §5).
 */
export async function decide(
  day: string,
  position: number,
  decision: QueueChoice,
  anchor: LikeAnchor | null = null,
): Promise<QueueDecisionAnswer> {
  const { data, error, response } = await api.PUT("/queue/{day}/entries/{position}/decision", {
    params: { path: { day, position } },
    // The answer says where a Later left the person only when asked (#745).
    body: { decision, later: true, ...(anchor && { anchor }) },
  });
  if (!data) throw failed(response, error, "decision");
  return QueueDecisionAnswer.parse(data);
}

/** What a short queue may relax today, and what is relaxed (#99, ADR-042 §4); counted when asked. */
export async function fetchRelaxations(day: string): Promise<RelaxationsResponse> {
  const { data, error, response } = await api.GET("/queue/{day}/relaxations", {
    params: { path: { day } },
  });
  if (!data) throw failed(response, error, "relaxations");
  return RelaxationsResponse.parse(data);
}

/** One deal-breaker relaxed for today: the first cards it added, to append without a read (§5, ADR-062 §10). */
export async function relaxToday(day: string, relaxation: Relaxation): Promise<QueueEntry[]> {
  const { data, error, response } = await api.POST("/queue/{day}/relaxations", {
    params: { path: { day } },
    // The contract's field is the deal-breakers' enum; zod's type of it is the wider field key.
    body: relaxation as ApiComponents["schemas"]["Relaxation"],
  });
  if (!data) throw failed(response, error, "relax");
  return RelaxationAnswer.parse(data).entries;
}

/** Today's relaxation undone: the places of the undecided cards it took back (§6). */
export async function undoRelaxation(day: string, field: DealBreakerField): Promise<number[]> {
  const { data, error, response } = await api.DELETE("/queue/{day}/relaxations/{field}", {
    params: { path: { day, field: field as ApiComponents["schemas"]["DealBreakerField"] } },
  });
  if (!data) throw failed(response, error, "undo relaxation");
  return RelaxationUndone.parse(data).removed;
}

/** The people on the person's Later list who may be shown now, the latest first (#575, ADR-064 §6). It serves no card and signs no photo. */
export async function fetchStars(): Promise<StarredPerson[]> {
  const { data, error, response } = await api.GET("/stars");
  if (!data) throw failed(response, error, "stars");
  return StarList.parse(data).items;
}

/** Somebody taken off the Later list (#681). */
export async function clearStar(id: string): Promise<void> {
  const { error, response } = await api.DELETE("/stars/{id}", { params: { path: { id } } });
  if (!response.ok) throw failed(response, error, "clear star");
}

/** A starred person's card, in today's log (§4): answered as a read of the queue is, with that one card. */
export async function openStar(id: string): Promise<QueueResponse> {
  const { data, error, response } = await api.POST("/stars/{id}/open", {
    params: { path: { id } },
  });
  if (!data) throw failed(response, error, "open star");
  return QueueResponse.parse(data);
}
