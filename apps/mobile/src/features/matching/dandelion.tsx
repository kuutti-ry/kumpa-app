import { Circle, G, Path } from "react-native-svg";
import { drawn } from "@/components/ui/icon";

/** The seed head's centre, in Lucide's 24-point grid. */
const CX = 12;
const CY = 9;

/** The rays, by angle: all round but straight down, where the stem is. */
const RAYS = [0, 45, 90, 135, 180, 225, 315];

const at = (degrees: number, radius: number) => {
  const r = (degrees * Math.PI) / 180;
  return { x: +(CX + radius * Math.cos(r)).toFixed(2), y: +(CY - radius * Math.sin(r)).toFixed(2) };
};

/**
 * The flower, a dandelion gone to seed (#681, the maintainer's of 18/11/2026:
 * the fish becomes a flower, and the icon the white one): a stem, and a round
 * head of seeds, each a ray with a knob for its seed, in Lucide's line and the
 * text's colour, as every icon. Lucide has no dandelion; our own drawing,
 * until the designers' set takes it into its line (#410).
 */
export const Dandelion = drawn(
  "Dandelion",
  <>
    <Path d={`M${CX} 11.5V22`} />
    <Circle cx={CX} cy={CY} r={1} fill="currentColor" stroke="none" />
    {RAYS.map((degrees) => {
      const from = at(degrees, 2.4);
      const to = at(degrees, 6.2);
      const seed = at(degrees, 6.9);
      return (
        <G key={degrees}>
          <Path d={`M${from.x} ${from.y}L${to.x} ${to.y}`} />
          <Circle cx={seed.x} cy={seed.y} r={1.3} fill="currentColor" stroke="none" />
        </G>
      );
    })}
  </>,
);
