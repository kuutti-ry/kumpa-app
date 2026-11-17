import { type ReactNode, useEffect, useRef, useState } from "react";
import { Animated, Easing, useWindowDimensions, View } from "react-native";
import { MomentGround, momentInk } from "@/components/backdrop";
import { Sparks, UNSPOKEN } from "@/components/celebration";
import { PopHeadline } from "@/components/organic";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/locale";
import { focusOnMount } from "@/theme/a11y";
import { useLookTraits } from "@/theme/ThemeProvider";

/** The widest the hello is drawn, on a tablet or the web preview. */
const ROOM_MAX = 400;

/** A face in a circle, ringed in the screen's own colour where it overlaps the other. */
function Round({ size, children }: { size: number; children: ReactNode }) {
  return (
    <View
      className="overflow-hidden rounded-full border-solid border-background bg-secondary"
      style={{ width: size, height: size, borderWidth: Math.max(4, Math.round(size * 0.03)) }}
    >
      {children}
    </View>
  );
}

/**
 * A match as a hello in the try's pill styles (outside production, the tech
 * screen's), from Sini's "It's a Match!" of 15/11/2026: the greeting large on
 * the style's ground (Organic Pop's soft shape of lavender running into lime,
 * Glass's frosted pane on bubbles, Bold Contrast's blocks of colour),
 * three strokes beside it, the two faces in circles that come together until
 * they overlap, and the one sentence that says what happened. Nothing loops and
 * nothing counts; with reduce motion on (`still`) it stands as it ends.
 *
 * It says what `MatchHello` says, no more: no score, no fit, nothing the two
 * are said to share (CLAUDE.md, Product constraints). The reader is taken to
 * the greeting, the faces are one image named in words, and what to do next is
 * the buttons under it, which the queue screen keeps.
 */
export function MatchPop({
  name,
  them,
  you,
  still,
}: {
  /** The other person's name, as their card says it. */
  name: string;
  /** Their photo, and the reader's own: each fills its circle. */
  them: ReactNode;
  you: ReactNode;
  /** Reduce motion is on: no entrance, the screen as it ends. */
  still: boolean;
}) {
  const { t } = useT();
  const { backdrop } = useLookTraits();
  const { width } = useWindowDimensions();
  const room = Math.min(width - 48, ROOM_MAX);
  const face = Math.round(room * 0.5);
  const [ink, setInk] = useState(0);

  const start = still ? 1 : 0;
  const grow = useRef(new Animated.Value(start)).current;
  const meet = useRef(new Animated.Value(start)).current;
  const pop = useRef(new Animated.Value(start)).current;
  useEffect(() => {
    if (still) {
      for (const value of [grow, meet, pop]) value.setValue(1);
      return;
    }
    // The shape swells in and the greeting with it, the two come together from
    // 0.2 s, and the strokes appear at 0.7 s.
    const spring = (value: Animated.Value) =>
      Animated.spring(value, { toValue: 1, friction: 7, tension: 90, useNativeDriver: true });
    const run = Animated.parallel([
      spring(grow),
      Animated.timing(meet, {
        toValue: 1,
        duration: 620,
        delay: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.sequence([Animated.delay(700), spring(pop)]),
    ]);
    run.start();
    return () => run.stop();
  }, [still, grow, meet, pop]);

  const apart = room * 0.14;
  const arriving = meet.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] });
  return (
    <View className="w-full gap-5 self-center" style={{ maxWidth: ROOM_MAX }}>
      <View className="items-center justify-center" style={{ minHeight: room * 0.6 }}>
        <Animated.View
          style={{
            position: "absolute",
            transform: [
              { scale: grow.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
              { rotate: grow.interpolate({ inputRange: [0, 1], outputRange: ["-10deg", "0deg"] }) },
            ],
          }}
        >
          <MomentGround
            width={Math.max(room * 1.02, ink * 1.22)}
            height={room * 0.6}
            shape="bean"
            angle={-12}
          />
        </Animated.View>
        <Animated.View
          onLayout={(event) => setInk(event.nativeEvent.layout.width)}
          style={{
            transform: [{ scale: grow.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
          }}
        >
          {/* On the shape, in the ink its colour is paired with in either scheme, which the shape is as wide as. */}
          <PopHeadline
            textRef={focusOnMount}
            size={Math.min(64, Math.floor(room * 0.17))}
            className={momentInk(backdrop)}
          >
            {t("queue.hello.title")}
          </PopHeadline>
        </Animated.View>
        <Animated.View
          style={{ position: "absolute", right: room * 0.02, top: -room * 0.02, opacity: pop }}
          {...UNSPOKEN}
        >
          <Sparks size={44} line={3} />
        </Animated.View>
      </View>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={t("queue.hello.photos", { name })}
        className="self-center"
        style={{ width: room, height: face * 1.08 }}
      >
        <View {...UNSPOKEN}>
          <Animated.View
            style={{
              position: "absolute",
              left: room * 0.02,
              top: face * 0.08,
              opacity: arriving,
              transform: [
                { translateX: meet.interpolate({ inputRange: [0, 1], outputRange: [-apart, 0] }) },
              ],
            }}
          >
            <Round size={face}>{you}</Round>
          </Animated.View>
          <Animated.View
            style={{
              position: "absolute",
              right: room * 0.02,
              top: 0,
              opacity: arriving,
              transform: [
                { translateX: meet.interpolate({ inputRange: [0, 1], outputRange: [apart, 0] }) },
              ],
            }}
          >
            <Round size={face}>{them}</Round>
          </Animated.View>
          <Animated.View
            style={{
              position: "absolute",
              left: room / 2 - 20,
              top: -room * 0.09,
              opacity: pop,
              transform: [{ rotate: "-35deg" }],
            }}
          >
            <Sparks size={40} line={3} />
          </Animated.View>
        </View>
      </View>
      <Text className="text-center text-title">{t("queue.hello.both")}</Text>
    </View>
  );
}
