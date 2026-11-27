import { Image } from "expo-image";
import ArrowRight from "lucide-react-native/icons/arrow-right";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Animated, ScrollView, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Backdrop, MomentGround, momentInk, Patch } from "@/components/backdrop";
import { Blob, Slab, Sparks, UNSPOKEN } from "@/components/celebration";
import { PopHeadline, Sparkle } from "@/components/organic";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { focusOnMount } from "@/theme/a11y";
import { useHapticTap } from "@/theme/haptics";
import { useLookTraits } from "@/theme/ThemeProvider";

const ROOM_MAX = 400;

/**
 * Sini's high five from Figma ("High-Five Lime Celebration", 15/11/2026): two
 * hands meeting over a lime splash, with its own sparkles. A picture, so its
 * colours are Neobrutalism's whatever the scheme; 960 px wide, three
 * times the width it is drawn at on a phone.
 */
const HIGH_FIVE = require("../../../../assets/try/high-five.png");
const HIGH_FIVE_RATIO = 960 / 971;

/**
 * The end of making a profile, celebrated, in every look but today's: in the
 * pill styles, Kumpa's among them, as `ReadyPop` below; in the tech screen's
 * neubrutalism (outside production) as Sini's screens of 15/11/2026 draw it.
 * Making a profile is the laborious part, so its end says so: the
 * headline in a tilted slab, Sini's high five, one line, and the
 * one way on, which is home's. It promises nothing about who will see the
 * profile or when, which the home screen's matching card says. With reduce
 * motion on (`still`) it stands as it ends.
 */
export function ProfileReady({
  still,
  onContinue,
  you,
}: {
  still: boolean;
  onContinue: () => void;
  /** The person's own first photo, filling its circle in the pill styles. */
  you?: ReactNode;
}) {
  if (useLookTraits().moment === "pop") {
    return <ReadyPop still={still} onContinue={onContinue} you={you} />;
  }
  return <ReadyLoud still={still} onContinue={onContinue} />;
}

function ReadyLoud({ still, onContinue }: { still: boolean; onContinue: () => void }) {
  const { t } = useT();
  const tap = useHapticTap();
  const { width } = useWindowDimensions();
  const room = Math.min(width - 48, ROOM_MAX);

  const start = still ? 1 : 0;
  const stamp = useRef(new Animated.Value(start)).current;
  const pop = useRef(new Animated.Value(start)).current;
  useEffect(() => {
    if (still) {
      stamp.setValue(1);
      pop.setValue(1);
      return;
    }
    const spring = (value: Animated.Value) =>
      Animated.spring(value, { toValue: 1, friction: 6, tension: 120, useNativeDriver: true });
    const run = Animated.parallel([
      spring(stamp),
      Animated.sequence([Animated.delay(260), spring(pop)]),
    ]);
    run.start();
    return () => run.stop();
  }, [still, stamp, pop]);

  return (
    <SafeAreaView className="flex-1 bg-background">
      <Backdrop />
      {/* Wider than a phone, it stands centred in its room, the headline over the hands. */}
      <ScrollView
        contentContainerClassName="w-full flex-grow justify-center gap-6 self-center p-6"
        contentContainerStyle={{ maxWidth: ROOM_MAX + 48 }}
      >
        <View>
          <View
            className="absolute"
            style={{ right: -room * 0.14, top: -room * 0.2 }}
            {...UNSPOKEN}
          >
            <Blob size={room * 0.66} colour="text-secondary" />
          </View>
          <View className="self-start">
            <Animated.View
              style={{
                transform: [
                  { scale: stamp.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
                  {
                    rotate: stamp.interpolate({
                      inputRange: [0, 1],
                      outputRange: ["6deg", "-6deg"],
                    }),
                  },
                ],
              }}
            >
              <Slab room={room} textRef={focusOnMount}>
                {t("onboarding.ready.title")}
              </Slab>
            </Animated.View>
            <Animated.View
              style={{ position: "absolute", right: -50, top: -16, opacity: pop }}
              {...UNSPOKEN}
            >
              <Sparks size={52} />
            </Animated.View>
          </View>
        </View>
        <Animated.View
          style={{
            alignSelf: "center",
            transform: [
              { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) },
              { rotate: pop.interpolate({ inputRange: [0, 1], outputRange: ["-12deg", "0deg"] }) },
            ],
            opacity: pop.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 1] }),
          }}
          {...UNSPOKEN}
        >
          <Image
            source={HIGH_FIVE}
            contentFit="contain"
            style={{ width: room * 0.96, aspectRatio: HIGH_FIVE_RATIO }}
          />
        </Animated.View>
        <Text className="text-center">{t("onboarding.ready.body")}</Text>
        <Button
          size="lg"
          accessibilityLabel={t("onboarding.continue")}
          onPress={() => {
            tap();
            onContinue();
          }}
        >
          <Text>{t("onboarding.continue")}</Text>
          <Icon as={ArrowRight} />
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * The same end in the pill styles (Kumpa, the look every phone starts in, and
 * the tech screen's Organic Pop, Glass and Bold Contrast), after Sini's Organic
 * Pop board of 15/11/2026, which has no high five: the headline on the style's
 * ground (none in Kumpa), the person's own photo in a circle among two more
 * shapes and sparkles, as her "Hyvä löytö!", one line, and the way on. The
 * picture is decoration; the words say it all.
 */
function ReadyPop({
  still,
  onContinue,
  you,
}: {
  still: boolean;
  onContinue: () => void;
  you?: ReactNode;
}) {
  const { t } = useT();
  const tap = useHapticTap();
  const { backdrop } = useLookTraits();
  const { width } = useWindowDimensions();
  const room = Math.min(width - 48, ROOM_MAX);
  const face = Math.round(room * 0.56);
  const [ink, setInk] = useState(0);

  const start = still ? 1 : 0;
  const grow = useRef(new Animated.Value(start)).current;
  const pop = useRef(new Animated.Value(start)).current;
  useEffect(() => {
    if (still) {
      grow.setValue(1);
      pop.setValue(1);
      return;
    }
    const spring = (value: Animated.Value) =>
      Animated.spring(value, { toValue: 1, friction: 7, tension: 90, useNativeDriver: true });
    const run = Animated.parallel([
      spring(grow),
      Animated.sequence([Animated.delay(300), spring(pop)]),
    ]);
    run.start();
    return () => run.stop();
  }, [still, grow, pop]);

  return (
    <SafeAreaView className="flex-1 bg-background">
      <Backdrop />
      <ScrollView
        contentContainerClassName="w-full flex-grow justify-center gap-6 self-center p-6"
        contentContainerStyle={{ maxWidth: ROOM_MAX + 48 }}
      >
        <View className="items-center justify-center" style={{ minHeight: room * 0.62 }}>
          <Animated.View
            style={{
              position: "absolute",
              transform: [
                { scale: grow.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
                {
                  rotate: grow.interpolate({ inputRange: [0, 1], outputRange: ["12deg", "0deg"] }),
                },
              ],
            }}
          >
            <MomentGround
              width={Math.max(room, ink * 1.2)}
              height={room * 0.62}
              shape="cloud"
              angle={-20}
            />
          </Animated.View>
          <Animated.View
            onLayout={(event) => setInk(event.nativeEvent.layout.width)}
            style={{
              transform: [
                { scale: grow.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
              ],
            }}
          >
            {/* On the shape, in the ink its colour is paired with in either scheme. */}
            <PopHeadline
              textRef={focusOnMount}
              size={Math.min(60, Math.floor(room * 0.17))}
              className={cn("text-center", momentInk(backdrop))}
            >
              {t("onboarding.ready.title")}
            </PopHeadline>
          </Animated.View>
          <Animated.View
            style={{ position: "absolute", right: 0, top: -room * 0.04, opacity: pop }}
            {...UNSPOKEN}
          >
            <Sparks size={44} line={3} />
          </Animated.View>
        </View>
        <Animated.View
          style={{
            // NativeWind hands an Animated.View no class: the layout is its style.
            alignItems: "center",
            justifyContent: "center",
            alignSelf: "center",
            width: room,
            height: face * 1.12,
            opacity: pop.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
            transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }],
          }}
          {...UNSPOKEN}
        >
          <Patch
            width={face * 0.95}
            height={face * 0.7}
            shape="bean"
            run="soft"
            angle={200}
            style={{ position: "absolute", left: room * 0.02, bottom: 0 }}
          />
          <Patch
            width={face * 0.7}
            height={face * 0.6}
            shape="puddle"
            run="lavender"
            style={{ position: "absolute", right: room * 0.04, top: 0 }}
          />
          <View
            className="overflow-hidden rounded-full border-solid border-background bg-secondary"
            style={{ width: face, height: face, borderWidth: 5 }}
          >
            {you}
          </View>
          <Sparkle
            size={34}
            colour="text-accent-foreground"
            style={{ position: "absolute", right: room * 0.12, top: face * 0.1 }}
          />
          <Sparkle
            size={22}
            colour="text-accent-foreground"
            style={{ position: "absolute", right: room * 0.06, top: face * 0.34 }}
          />
          <Sparkle size={26} style={{ position: "absolute", left: room * 0.1, top: face * 0.06 }} />
        </Animated.View>
        <Text className="text-center text-title">{t("onboarding.ready.body")}</Text>
        <Button
          size="lg"
          onward
          onPress={() => {
            tap();
            onContinue();
          }}
        >
          {t("onboarding.continue")}
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}
