import type { Queryable } from "@kuutti/db";
import type { PlainMessageKey, TFunction } from "@kuutti/i18n";
import {
  type CardPhoto,
  type ExportedAnchor,
  type GuildOption,
  guildName,
  type LikeAnchor,
  type LikeAnchorKind,
  type LikedPart,
  type PhotoId,
  type ProfileCard,
  type PromptKey,
  type SharedField,
} from "@kuutti/schema";

// The anchored like (#463, ADR-077): the part of a card a like names, kept as a
// reference in three columns (`anchor_kind`, `anchor_ref`, `anchor_field`) on the
// like's entry and, once it makes a match, on the conversation's participant row.
// What a reference points at is always read from the profile as it stands, so a
// part that has gone since is no part at all.

/**
 * What of a card a like may name, as the card the queue builds for this viewer
 * would show it now (`cardParts` in the profile slice): the approved photos, the
 * answered prompts, whether it has a bio or a ready line, and its "you too" items.
 */
export type CardParts = {
  photos: readonly CardPhoto[];
  prompts: readonly PromptKey[];
  bio: boolean;
  shared: ProfileCard["shared"];
};

/** The card's parts as `viewer` would see `subject`'s now, read in the caller's transaction, or null where `subject` has no card: the profile slice's `cardParts`, handed in by app.ts. */
export type PartsOf = (
  db: Queryable,
  input: { viewerAccountId: string; subjectAccountId: string },
) => Promise<CardParts | null>;

/** The three columns as they are read. */
export type AnchorRow = {
  anchor_kind: LikeAnchorKind | null;
  anchor_ref: string | null;
  anchor_field: string | null;
};

/** The columns an anchor is written as; all null for none. */
export function anchorColumns(
  anchor: LikeAnchor | null,
): [LikeAnchorKind | null, string | null, string | null] {
  switch (anchor?.kind) {
    case undefined:
      return [null, null, null];
    case "photo":
      return ["photo", anchor.photoId, null];
    case "prompt":
      return ["prompt", anchor.prompt, null];
    case "bio":
      return ["bio", null, null];
    case "shared":
      return ["shared", anchor.option, anchor.field];
  }
}

/** The anchor the columns hold, or null with none. The table's checks keep a kind with its reference. */
export function anchorOf(row: AnchorRow): LikeAnchor | null {
  switch (row.anchor_kind) {
    case null:
      return null;
    case "photo":
      return { kind: "photo", photoId: row.anchor_ref as PhotoId };
    case "prompt":
      return { kind: "prompt", prompt: row.anchor_ref as PromptKey };
    case "bio":
      return { kind: "bio" };
    case "shared":
      return {
        kind: "shared",
        field: row.anchor_field as SharedField,
        option: row.anchor_ref as string,
      };
  }
}

/** Whether two anchors name the same part: the same like again writes nothing (ADR-034 §5). */
export function sameAnchor(a: LikeAnchor | null, b: LikeAnchor | null): boolean {
  const [kindA, refA, fieldA] = anchorColumns(a);
  const [kindB, refB, fieldB] = anchorColumns(b);
  return kindA === kindB && refA === refB && fieldA === fieldB;
}

/**
 * The part an anchor names on these parts of a card, as it stands, or null where
 * the card has no such part: a photo gone, a prompt no longer answered, a bio and
 * a ready line both cleared, or a "you too" item no longer both people's.
 */
export function partOn(parts: CardParts | null, anchor: LikeAnchor | null): LikedPart | null {
  if (!parts || !anchor) return null;
  switch (anchor.kind) {
    case "photo": {
      const photo = parts.photos.find((p) => p.id === anchor.photoId);
      return photo ? { kind: "photo", photo } : null;
    }
    case "prompt":
      return parts.prompts.includes(anchor.prompt)
        ? { kind: "prompt", prompt: anchor.prompt }
        : null;
    case "bio":
      return parts.bio ? { kind: "bio" } : null;
    case "shared":
      return parts.shared[anchor.field].includes(anchor.option)
        ? { kind: "shared", field: anchor.field, option: anchor.option }
        : null;
  }
}

/**
 * The part the person's own like named, for their export (ADR-007 §4): in keys,
 * and in words in the request's language. Only what the person could read on
 * the card: never the other person's photo, words or name, so a photo is "their
 * photo" and a prompt its question.
 */
export function exportedAnchor(t: TFunction, anchor: LikeAnchor): ExportedAnchor {
  switch (anchor.kind) {
    case "photo":
      return {
        kind: "photo",
        prompt: null,
        shared: null,
        inWords: t("account.export.anchor.photo"),
      };
    case "prompt":
      return {
        kind: "prompt",
        prompt: anchor.prompt,
        shared: null,
        inWords: t("account.export.anchor.prompt", {
          prompt: t(`profile.prompt.${anchor.prompt}` as PlainMessageKey),
        }),
      };
    case "bio":
      return { kind: "bio", prompt: null, shared: null, inWords: t("account.export.anchor.bio") };
    case "shared": {
      // A guild is named by its own name, the same in every language (#677).
      const option =
        anchor.field === "guild"
          ? (guildName(anchor.option as GuildOption) ?? t("profile.guild.other"))
          : t(`profile.option.${anchor.field}.${anchor.option}` as PlainMessageKey);
      return {
        kind: "shared",
        prompt: null,
        shared: { field: anchor.field, option: anchor.option },
        inWords: t("account.export.anchor.shared", { option }),
      };
    }
  }
}
