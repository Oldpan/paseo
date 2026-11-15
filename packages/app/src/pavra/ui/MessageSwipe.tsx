import { useMemo, useRef, type ReactNode } from "react";
import { Animated, Easing, PanResponder, Text, View } from "react-native";
import { isWeb } from "@/constants/platform";
import { text as type } from "./theme";
import { useTheme } from "./ThemeProvider";

export const MESSAGE_SWIPE_MAX_OFFSET_PX = 170;
const SWIPE_ACTIVATE_PX = 8;
const SWIPE_FULL_REVEAL_PX = 70;
const SWIPE_RESET_MS = 250;

export function formatMessageTime(createdAt: string | number): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return date.toLocaleString(undefined, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return date.toISOString().slice(5, 16).replace("T", " ");
  }
}

export function MessageTimestamp({
  createdAt,
  side,
  visible,
  embedded,
}: {
  createdAt: string | number;
  side: "start" | "end";
  visible: boolean;
  embedded?: boolean;
}) {
  const { palette: t } = useTheme();
  if (!visible) return null;
  const formatted = formatMessageTime(createdAt);
  return (
    <Text
      accessibilityLabel={`Sent ${formatted}`}
      testID="message-timestamp"
      style={[
        type(t.textSubtle, 10, { fontFamily: "monospace" }),
        embedded
          ? null
          : {
              position: "absolute",
              top: 8,
              [side === "start" ? "left" : "right"]: 8,
            },
      ]}
    >
      {formatted}
    </Text>
  );
}

export function MessageSwipeReveal({
  createdAt,
  side,
  children,
}: {
  createdAt: string | number;
  side: "start" | "end";
  children: ReactNode;
}) {
  const offset = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const start = useRef({ x: 0, y: 0, active: false });
  const direction = side === "start" ? 1 : -1;

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) => {
          const absX = Math.abs(gesture.dx);
          const absY = Math.abs(gesture.dy);
          return (
            absX > SWIPE_ACTIVATE_PX &&
            absX > absY &&
            (direction < 0 ? gesture.dx < 0 : gesture.dx > 0)
          );
        },
        onMoveShouldSetPanResponderCapture: (_event, gesture) => {
          const absX = Math.abs(gesture.dx);
          const absY = Math.abs(gesture.dy);
          return (
            absX > SWIPE_ACTIVATE_PX &&
            absX > absY &&
            (direction < 0 ? gesture.dx < 0 : gesture.dx > 0)
          );
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          start.current.active = true;
          offset.stopAnimation();
          opacity.stopAnimation();
        },
        onPanResponderMove: (_event, gesture) => {
          const raw = direction < 0 ? Math.min(0, gesture.dx) : Math.max(0, gesture.dx);
          const clamped = Math.max(
            -MESSAGE_SWIPE_MAX_OFFSET_PX,
            Math.min(MESSAGE_SWIPE_MAX_OFFSET_PX, raw),
          );
          offset.setValue(clamped);
          opacity.setValue(Math.min(1, Math.abs(clamped) / SWIPE_FULL_REVEAL_PX));
        },
        onPanResponderRelease: () => {
          start.current.active = false;
          const easing = Easing.bezier(0.2, 0.8, 0.25, 1);
          Animated.parallel([
            Animated.timing(offset, {
              toValue: 0,
              duration: SWIPE_RESET_MS,
              easing,
              useNativeDriver: true,
            }),
            Animated.timing(opacity, {
              toValue: 0,
              duration: SWIPE_RESET_MS,
              easing,
              useNativeDriver: true,
            }),
          ]).start();
        },
        onPanResponderTerminate: () => {
          start.current.active = false;
          offset.setValue(0);
          opacity.setValue(0);
        },
      }),
    [direction, offset, opacity],
  );

  return (
    <View style={{ position: "relative", overflow: "visible" }}>
      <Animated.View
        testID="message-swipe-content"
        {...responder.panHandlers}
        style={{
          transform: [{ translateX: offset }],
          ...(isWeb ? ({ userSelect: "none", WebkitUserSelect: "none" } as object) : null),
        }}
      >
        {children}
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 8,
          [side === "start" ? "left" : "right"]: 8,
          opacity,
        }}
      >
        <MessageTimestamp createdAt={createdAt} side={side} visible embedded />
      </Animated.View>
    </View>
  );
}
