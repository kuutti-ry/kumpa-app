import { z } from "zod";
import { PhotoId } from "./media.ts";
import { CardPhoto, ProfileCard, PromptKey } from "./profile.ts";

// The anchored like (#463, ADR-077): a like, a fish too, may name the one part
// of the card it is for. It is a reference to the card the queue built for
// that place, never a copy of anybody's words, and no words of the sender
// travel with it (the maintainer, 25/10/2026). The person liked reads the part
// on the liker's card, and a match carries both likes' parts into the
// conversation, each drawn from the profile as it stands at the read; a part
// that has gone since is left out. Nothing counts which parts draw likes.

/** What a part of a card is: a photo, an answered prompt, the bio or its ready line, a "you too" item. Mirrors the database's like_anchor_kind. */
export const LikeAnchorKind = z
  .enum(["photo", "prompt", "bio", "shared"])
  .meta({ id: "LikeAnchorKind" });
export type LikeAnchorKind = z.infer<typeof LikeAnchorKind>;

/** The fields of a card's "you too" marks (`ProfileCard.shared`, #150, #677). */
export const SharedField = ProfileCard.shape.shared.keyof().meta({ id: "SharedField" });
export type SharedField = z.infer<typeof SharedField>;

/** The longest option of a "you too" field: a guild's name (`ProfileCard.shared`). */
const SHARED_OPTION_MAX = 80;

/**
 * The part a like names, as the phone sends it: a photo of the card by its id,
 * an answered prompt by its key, the bio (a ready line counts as one, the
 * maintainer, 26/11/2026), or one option of the card's `shared`. The API checks
 * it against the card it builds for that place.
 */
export const LikeAnchor = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("photo"), photoId: PhotoId }).strict(),
    z.object({ kind: z.literal("prompt"), prompt: PromptKey }).strict(),
    z.object({ kind: z.literal("bio") }).strict(),
    z
      .object({
        kind: z.literal("shared"),
        field: SharedField,
        option: z.string().min(1).max(SHARED_OPTION_MAX),
      })
      .strict(),
  ])
  .meta({ id: "LikeAnchor" });
export type LikeAnchor = z.infer<typeof LikeAnchor>;

/**
 * A part a like named, drawn from its owner's profile as it stands at the read:
 * a photo with what it takes to paint it (bytes through GET /photos/{id}/{variant},
 * under the photo rules as they stand), a prompt by its key, the bio, or a
 * "you too" item. Never anybody's words: the phone says the prompt and the
 * option in the reader's language, and the bio as "your bio" or "their bio".
 */
export const LikedPart = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("photo"), photo: CardPhoto }).strict(),
    z.object({ kind: z.literal("prompt"), prompt: PromptKey }).strict(),
    z.object({ kind: z.literal("bio") }).strict(),
    z
      .object({
        kind: z.literal("shared"),
        field: SharedField,
        option: z.string().min(1).max(SHARED_OPTION_MAX),
      })
      .strict(),
  ])
  .meta({ id: "LikedPart" });
export type LikedPart = z.infer<typeof LikedPart>;

/**
 * The part the person's own like named, in their export (ADR-007 §4), in keys and
 * in words in the request's language: never the other person's photo, words or
 * name, so a photo is only "a photo".
 */
export const ExportedAnchor = z
  .object({
    kind: LikeAnchorKind,
    /** The prompt's key for a prompt, null otherwise. */
    prompt: PromptKey.nullable(),
    /** The field and the option for a "you too" item, null otherwise: an answer the person gave as well. */
    shared: z
      .object({ field: SharedField, option: z.string().max(SHARED_OPTION_MAX) })
      .strict()
      .nullable(),
    inWords: z.string(),
  })
  .strict()
  .meta({ id: "ExportedAnchor" });
export type ExportedAnchor = z.infer<typeof ExportedAnchor>;
