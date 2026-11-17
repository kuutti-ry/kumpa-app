import { type ReactNode, useEffect, useRef } from "react";
import { Animated, Easing, useWindowDimensions, View } from "react-native";
import {
  Blob,
  Burst,
  Face,
  INK,
  LOUD_SHADOW,
  Slab,
  Sparks,
  Sticker,
  UNSPOKEN,
} from "@/components/celebration";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/locale";
import { focusOnMount } from "@/theme/a11y";
import { useHardShadow } from "@/theme/shadow";

/** The widest the two photos are drawn, on a tablet or the web preview. */
const ROOM_MAX = 400;

/** A photo in a frame with its caption under it, as a print would carry a name. */
function Frame({
  caption,
  width,
  style,
  children,
}: {
  caption: string;
  width: number;
  style: Animated.WithAnimatedValue<object>;
  children: ReactNode;
}) {
  const shadow = useHardShadow(LOUD_SHADOW);
  // The motion is an Animated.View's style and the drawing a View's classes:
  // NativeWind hands an Animated.View no class.
  return (
    <Animated.View style={[{ width }, style]}>
      <View
        className="rounded-2xl border-solid border-stroke bg-card p-2"
        style={[shadow, { borderWidth: INK }]}
      >
        <View className="aspect-[4/5] overflow-hidden rounded-xl border-2 border-solid border-stroke bg-secondary">
          {children}
        </View>
        <Text variant="h4" className="pt-1.5 text-center text-card-foreground">
          {caption}
        </Text>
      </View>
    </Animated.View>
  );
}

/**
 * A match as a hello: the designers' try (outside production, the tech
 * screen's neubrutalism), from Sini's idea and screens of 15/11/2026. "Match"
 * sounds bigger than what happened, which is that two people would each like
 * to hear more about the other, so the screen greets, like a smile across a
 * room: the greeting in a tilted slab, the one sentence that says what
 * happened, and the two photos, which begin apart and upright, lean in until
 * they overlap, and a face between them winks, once. Nothing loops and nothing
 * counts. With reduce motion on (`still`) it stands as it ends.
 *
 * It says no more than the plain match did: no score, no fit, nothing the two
 * are said to share (CLAUDE.md, Product constraints). The reader is taken to
 * the greeting, the photos are one image named in words, and what to do next
 * is the buttons under it, which the round screen keeps.
 */
export function MatchHello({
  name,
  them,
  you,
  still,
}: {
  /** The other person's name, as their card says it. */
  name: string;
  /** Their photo, and the reader's own: each fills its frame. */
  them: ReactNode;
  you: ReactNode;
  /** Reduce motion is on: no entrance, the screen as it ends. */
  still: boolean;
}) {
  const { t } = useT();
  const { width } = useWindowDimensions();
  const room = Math.min(width - 48, ROOM_MAX);
  const frame = room * 0.54;
  const sticker = Math.round(room * 0.3);
  // Where the face sits: where the two photos meet, its lower edge no lower than
  // the other's photo (its frame's top, ink and padding, then the photo at 4:5),
  // so a long name under that photo, on two lines on a small phone, is never
  // under the face.
  const theirPhotoEnds = room * 0.11 + INK + 8 + (frame - 2 * INK - 16) * 1.25;
  const stickerTop = Math.min(frame * 0.82, theirPhotoEnds - sticker);

  // One value each for the three beats and the wink: the greeting lands, the
  // two come together, the face appears, and winks.
  const start = still ? 1 : 0;
  const stamp = useRef(new Animated.Value(start)).current;
  const meet = useRef(new Animated.Value(start)).current;
  const pop = useRef(new Animated.Value(start)).current;
  const wink = useRef(new Animated.Value(start)).current;
  useEffect(() => {
    if (still) {
      for (const value of [stamp, meet, pop, wink]) value.setValue(1);
      return;
    }
    // Each beat starts at its own moment, so the wink never waits on a spring
    // coming to rest: the greeting at once, the two from 0.18 s, the face at
    // 0.62 s and its wink at 1.15 s.
    const spring = (value: Animated.Value) =>
      Animated.spring(value, { toValue: 1, friction: 6, tension: 120, useNativeDriver: true });
    const run = Animated.parallel([
      spring(stamp),
      Animated.timing(meet, {
        toValue: 1,
        duration: 520,
        delay: 180,
        easing: Easing.out(Easing.back(1.4)),
        useNativeDriver: true,
      }),
      Animated.sequence([Animated.delay(620), spring(pop)]),
      Animated.timing(wink, { toValue: 1, duration: 140, delay: 1150, useNativeDriver: true }),
    ]);
    run.start();
    return () => run.stop();
  }, [still, stamp, meet, pop, wink]);

  const apart = room * 0.12;
  const arriving = meet.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] });
  // On a phone the hello is the screen's width; wider, on a tablet or the web
  // preview, it stands centred in its room, the greeting over the photos.
  return (
    <View className="w-full gap-5 self-center" style={{ maxWidth: ROOM_MAX }}>
      <View>
        <View className="absolute" style={{ right: -room * 0.16, top: -room * 0.2 }} {...UNSPOKEN}>
          <Blob size={room * 0.6} colour="text-secondary" />
        </View>
        <View className="self-start pt-2">
          <Animated.View
            style={{
              transform: [
                { scale: stamp.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
                {
                  rotate: stamp.interpolate({ inputRange: [0, 1], outputRange: ["6deg", "-6deg"] }),
                },
              ],
            }}
          >
            <Slab room={room} textRef={focusOnMount}>
              {t("round.hello.title")}
            </Slab>
          </Animated.View>
          <Animated.View
            style={{ position: "absolute", right: -50, top: -8, opacity: pop }}
            {...UNSPOKEN}
          >
            <Sparks size={52} />
          </Animated.View>
        </View>
      </View>
      <Text className="pt-2 text-center">{t("round.hello.both")}</Text>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={t("round.hello.photos", { name })}
        className="self-center"
        style={{ width: room, paddingTop: room * 0.03, paddingBottom: room * 0.13 }}
      >
        <View {...UNSPOKEN}>
          <View className="absolute" style={{ left: -room * 0.05, top: room * 0.06 }}>
            <Blob size={room} colour="text-secondary" />
          </View>
          <Animated.View
            style={{
              position: "absolute",
              right: -room * 0.09,
              bottom: -room * 0.15,
              transform: [{ scale: pop }, { rotate: "12deg" }],
            }}
          >
            <Burst size={room * 0.56} colour="text-primary" />
          </Animated.View>
          <View className="flex-row justify-center">
            <Frame
              caption={t("round.hello.you")}
              width={frame}
              style={{
                zIndex: 1,
                opacity: arriving,
                transform: [
                  {
                    translateX: meet.interpolate({ inputRange: [0, 1], outputRange: [-apart, 0] }),
                  },
                  {
                    rotate: meet.interpolate({
                      inputRange: [0, 1],
                      outputRange: ["0deg", "-7deg"],
                    }),
                  },
                ],
              }}
            >
              {you}
            </Frame>
            <Frame
              caption={name}
              width={frame}
              style={{
                marginLeft: -room * 0.12,
                marginTop: room * 0.11,
                opacity: arriving,
                transform: [
                  { translateX: meet.interpolate({ inputRange: [0, 1], outputRange: [apart, 0] }) },
                  {
                    rotate: meet.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "6deg"] }),
                  },
                ],
              }}
            >
              {them}
            </Frame>
          </View>
          <Animated.View
            style={{
              position: "absolute",
              zIndex: 2,
              left: room * 0.535 - sticker / 2,
              top: stickerTop,
              transform: [
                { scale: pop },
                {
                  rotate: pop.interpolate({ inputRange: [0, 1], outputRange: ["-40deg", "8deg"] }),
                },
              ],
            }}
          >
            <Sticker size={sticker}>
              <Animated.View
                style={{
                  position: "absolute",
                  opacity: wink.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
                }}
              >
                <Face size={sticker * 0.86} wink={false} />
              </Animated.View>
              <Animated.View style={{ opacity: wink }}>
                <Face size={sticker * 0.86} wink />
              </Animated.View>
            </Sticker>
          </Animated.View>
          <Animated.View
            style={{
              position: "absolute",
              left: -room * 0.04,
              bottom: -room * 0.13,
              opacity: pop,
              transform: [{ rotate: "200deg" }],
            }}
          >
            <Sparks size={46} />
          </Animated.View>
        </View>
      </View>
    </View>
  );
}
