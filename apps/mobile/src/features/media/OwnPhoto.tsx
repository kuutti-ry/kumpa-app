import { useEffect, useState } from "react";
import { listPhotos } from "./client";
import { PhotoImage } from "./PhotoImage";

const FILL = { width: "100%", height: "100%" } as const;

/**
 * The reader's own first photo, in the card size, filling its frame, for every
 * look but today's, Kumpa's among them: beside the other person in a match,
 * where it is the first one others see, and at the end of making a profile,
 * where `inReview` lets a photo still being checked stand in, it being the
 * person's own. Nothing while it loads, where there is none, and where the
 * read failed: a celebration is no place for an error about one's own photos.
 */
export function OwnPhoto({ label, inReview = false }: { label: string; inReview?: boolean }) {
  const [photo, setPhoto] = useState<{ id: string; blurhash: string } | null>(null);
  useEffect(() => {
    let mounted = true;
    listPhotos().then(
      ({ photos }) => {
        const shown =
          photos.find((each) => each.state === "approved") ??
          (inReview
            ? photos.find((each) => each.state === "pending" || each.state === "queued")
            : undefined);
        if (mounted && shown) setPhoto(shown);
      },
      () => undefined,
    );
    return () => {
      mounted = false;
    };
  }, [inReview]);
  return photo ? (
    <PhotoImage
      id={photo.id}
      variant="card"
      blurhash={photo.blurhash}
      accessibilityLabel={label}
      style={FILL}
    />
  ) : null;
}
