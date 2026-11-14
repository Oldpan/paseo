import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { PressHighlight } from "@/components/ui/press-highlight";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";

const ENTER_MS = 220;
const EXIT_MS = 180;
const UNMOUNT_DELAY_MS = 190;
const DRAWER_EASING = Easing.bezier(0.4, 0, 0.2, 1);

/**
 * Retains the last non-null id while an exit animation plays so panels remain populated
 * while sliding out.
 */
export function usePresenceId(
  id: string | null,
  exitMs = UNMOUNT_DELAY_MS,
): { activeId: string | null; open: boolean } {
  const [retainedId, setRetainedId] = useState<string | null>(id);

  useEffect(() => {
    if (id !== null) {
      setRetainedId(id);
      return;
    }
    if (retainedId === null) return;
    const timer = setTimeout(() => setRetainedId(null), exitMs);
    return () => clearTimeout(timer);
  }, [exitMs, id, retainedId]);

  return { activeId: id ?? retainedId, open: id !== null };
}

export function AnimatedDrawer({
  open,
  side,
  drawerWidth,
  fullWidth = false,
  backdrop = true,
  zIndex = 100,
  closeLabel = "Close panel",
  onClose,
  testID,
  children,
}: {
  open: boolean;
  side: "left" | "right";
  drawerWidth: number;
  fullWidth?: boolean;
  backdrop?: boolean;
  zIndex?: number;
  closeLabel?: string;
  onClose?: () => void;
  testID?: string;
  children: ReactNode;
}) {
  const [rendered, setRendered] = useState(open);
  const progress = useSharedValue(open ? 1 : 0);

  useEffect(() => {
    if (open) {
      setRendered(true);
      progress.value = withTiming(1, { duration: ENTER_MS, easing: DRAWER_EASING });
      return;
    }
    if (!rendered) return;
    progress.value = withTiming(0, { duration: EXIT_MS, easing: DRAWER_EASING });
    const timer = setTimeout(() => setRendered(false), UNMOUNT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [open, progress, rendered]);

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  const travel = Math.max(1, drawerWidth);
  const direction = side === "left" ? -1 : 1;
  const panelAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - progress.value) * travel * direction }],
  }));

  if (!rendered) return null;

  return (
    <View
      testID={testID}
      pointerEvents={open ? "auto" : "none"}
      style={[styles.overlay, { zIndex, elevation: zIndex }]}
    >
      {backdrop ? (
        <Animated.View style={[styles.backdropLayer, backdropAnimatedStyle]}>
          <PressHighlight
            accessibilityLabel={closeLabel}
            onPress={onClose}
            style={styles.backdropButton}
          />
        </Animated.View>
      ) : null}
      <Animated.View
        style={[
          styles.panelContainer,
          side === "right" ? styles.alignEnd : styles.alignStart,
          fullWidth ? styles.fullPanel : inlineUnistylesStyle({ width: drawerWidth }),
          panelAnimatedStyle,
        ]}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    flexDirection: "row",
  },
  backdropLayer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  backdropButton: {
    ...StyleSheet.absoluteFill,
  },
  panelContainer: {
    height: "100%",
    minHeight: 0,
    zIndex: 1,
  },
  alignStart: {
    marginRight: "auto",
  },
  alignEnd: {
    marginLeft: "auto",
  },
  fullPanel: {
    width: "100%",
    flex: 1,
  },
});
