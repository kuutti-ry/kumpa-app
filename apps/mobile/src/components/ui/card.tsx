import { View } from "react-native";
import { Text, TextClassContext } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { HARD_SHADOW, useHardShadow } from "@/theme/shadow";
import { useLookTraits } from "@/theme/ThemeProvider";

function Card({
  className,
  style,
  ...props
}: React.ComponentProps<typeof View> & React.RefAttributes<View>) {
  const { ink, pill, glass } = useLookTraits();
  const shadow = useHardShadow(HARD_SHADOW.container);
  return (
    <TextClassContext.Provider value="text-card-foreground">
      <View
        className={cn(
          "flex flex-col gap-6 py-6",
          // Today's, or the try's: Neobrutalism's ink and hard shadow, Glass's
          // frosted pane over the backdrop, or the other pill styles' soft card.
          ink
            ? "bg-card border-stroke rounded-lg border-2 border-solid"
            : glass
              ? "bg-card/60 border-card/80 rounded-3xl border"
              : pill
                ? "bg-card border-border/70 rounded-3xl border"
                : "bg-card border-border rounded-xl border shadow-sm shadow-black/5",
          className,
        )}
        style={[ink && shadow, style]}
        {...props}
      />
    </TextClassContext.Provider>
  );
}

function CardHeader({
  className,
  ...props
}: React.ComponentProps<typeof View> & React.RefAttributes<View>) {
  return <View className={cn("flex flex-col gap-1.5 px-6", className)} {...props} />;
}

function CardTitle({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof Text> & React.RefAttributes<typeof Text>) {
  return (
    <Text
      ref={ref}
      variant="title"
      role="heading"
      aria-level={3}
      className={className}
      {...props}
    />
  );
}

function CardDescription({
  className,
  ...props
}: React.ComponentProps<typeof Text> & React.RefAttributes<typeof Text>) {
  return <Text className={cn("text-small text-muted-foreground", className)} {...props} />;
}

function CardContent({
  className,
  ...props
}: React.ComponentProps<typeof View> & React.RefAttributes<View>) {
  return <View className={cn("px-6", className)} {...props} />;
}

function CardFooter({
  className,
  ...props
}: React.ComponentProps<typeof View> & React.RefAttributes<View>) {
  return <View className={cn("flex flex-row items-center px-6", className)} {...props} />;
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
