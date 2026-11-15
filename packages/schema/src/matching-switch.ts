import { z } from "zod";

/**
 * The switch that opens matching, as the panel reads and turns it (#500,
 * ADR-060 §2): one, for the whole country, with no pond behind it (ADR-061 §8,
 * #607). An admin turns it and nothing else does, so the press and the answer
 * say which way and nothing more: no count, no figure and no words.
 */
export const MatchingSwitchState = z
  .object({ open: z.boolean() })
  .strict()
  .meta({ id: "MatchingSwitchState" });
export type MatchingSwitchState = z.infer<typeof MatchingSwitchState>;
