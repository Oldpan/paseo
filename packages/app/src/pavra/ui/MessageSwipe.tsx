import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  const [activeSide, setActiveSide] = useState<"start" | "end">(side);
  const activeSideRef = useRef<"start" | "end">(side);
  const contentRef = useRef<View | null>(null);

  const applyDelta = useCallback(
    (dx: number) => {
      const clamped = Math.max(
        -MESSAGE_SWIPE_MAX_OFFSET_PX,
        Math.min(MESSAGE_SWIPE_MAX_OFFSET_PX, dx),
      );
      const nextSide: "start" | "end" = clamped >= 0 ? "start" : "end";
      if (activeSideRef.current !== nextSide) {
        activeSideRef.current = nextSide;
        setActiveSide(nextSide);
      }
      offset.setValue(clamped);
      opacity.setValue(Math.min(1, Math.abs(clamped) / SWIPE_FULL_REVEAL_PX));
    },
    [offset, opacity],
  );

  const springBack = useCallback(() => {
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
  }, [offset, opacity]);

  useEffect(() => {
    if (!isWeb) return;
    const node = contentRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== "function") return;

    let pointerStart: { x: number; y: number; id: number } | null = null;
    let dragging = false;
    let wheelAccum = 0;
    let wheelTimer: ReturnType<typeof setTimeout> | null = null;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
      dragging = false;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!pointerStart) return;
      const dx = event.clientX - pointerStart.x;
      const dy = event.clientY - pointerStart.y;
      if (!dragging) {
        if (Math.abs(dx) > SWIPE_ACTIVATE_PX && Math.abs(dx) > Math.abs(dy)) {
          dragging = true;
          offset.stopAnimation();
          opacity.stopAnimation();
          try {
            node.setPointerCapture(pointerStart.id);
          } catch {
            // Ignore pointer capture errors
          }
        } else if (Math.abs(dy) > SWIPE_ACTIVATE_PX) {
          pointerStart = null;
          return;
        } else {
          return;
        }
      }
      applyDelta(dx);
      if (event.cancelable) event.preventDefault();
    };

    const finishPointer = () => {
      if (!pointerStart) return;
      if (node.hasPointerCapture?.(pointerStart.id)) {
        try {
          node.releasePointerCapture(pointerStart.id);
        } catch {
          // Ignore release errors
        }
      }
      pointerStart = null;
      if (dragging) {
        dragging = false;
        springBack();
      }
    };

    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || Math.abs(event.deltaX) < 2) {
        return;
      }
      offset.stopAnimation();
      opacity.stopAnimation();
      wheelAccum = Math.max(
        -MESSAGE_SWIPE_MAX_OFFSET_PX,
        Math.min(MESSAGE_SWIPE_MAX_OFFSET_PX, wheelAccum - event.deltaX),
      );
      if (Math.abs(wheelAccum) < SWIPE_ACTIVATE_PX) return;
      if (event.cancelable) event.preventDefault();
      applyDelta(wheelAccum);
      if (wheelTimer) clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => {
        wheelAccum = 0;
        springBack();
      }, 180);
    };

    node.addEventListener("pointerdown", onPointerDown);
    node.addEventListener("pointermove", onPointerMove);
    node.addEventListener("pointerup", finishPointer);
    node.addEventListener("pointercancel", finishPointer);
    node.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      if (wheelTimer) clearTimeout(wheelTimer);
      node.removeEventListener("pointerdown", onPointerDown);
      node.removeEventListener("pointermove", onPointerMove);
      node.removeEventListener("pointerup", finishPointer);
      node.removeEventListener("pointercancel", finishPointer);
      node.removeEventListener("wheel", onWheel);
    };
  });

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) => {
          const absX = Math.abs(gesture.dx);
          const absY = Math.abs(gesture.dy);
          return absX > SWIPE_ACTIVATE_PX && absX > absY;
        },
        onMoveShouldSetPanResponderCapture: (_event, gesture) => {
          const absX = Math.abs(gesture.dx);
          const absY = Math.abs(gesture.dy);
          return absX > SWIPE_ACTIVATE_PX && absX > absY;
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          offset.stopAnimation();
          opacity.stopAnimation();
        },
        onPanResponderMove: (_event, gesture) => {
          applyDelta(gesture.dx);
        },
        onPanResponderRelease: () => {
          springBack();
        },
        onPanResponderTerminate: () => {
          offset.setValue(0);
          opacity.setValue(0);
        },
      }),
    [applyDelta, offset, opacity, springBack],
  );

  return (
    <View style={{ position: "relative", overflow: "visible" }}>
      <Animated.View
        ref={contentRef}
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
          top: 10,
          [activeSide === "start" ? "left" : "right"]: 8,
          opacity,
        }}
      >
        <MessageTimestamp createdAt={createdAt} side={activeSide} visible embedded />
      </Animated.View>
    </View>
  );
}
