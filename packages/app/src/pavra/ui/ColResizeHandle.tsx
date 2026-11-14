import { useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { nextPixelColWidth, rawPixelColWidth } from "../panel-resize";
import type { ColResizeHandleProps } from "./ColResizeHandle.types";
import { useTheme } from "./ThemeProvider";

export function ColResizeHandle({
  testID,
  accessibilityLabel,
  grow,
  width,
  minWidth,
  maxWidth,
  collapseBelow,
  onCollapse,
  onWidthChange,
  onDragging,
  ruleWidth = 2,
  ruleColor,
}: ColResizeHandleProps) {
  const { palette: t } = useTheme();
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const latestRef = useRef({
    grow,
    width,
    minWidth,
    maxWidth,
    collapseBelow,
    onCollapse,
    onWidthChange,
    onDragging,
  });
  latestRef.current = {
    grow,
    width,
    minWidth,
    maxWidth,
    collapseBelow,
    onCollapse,
    onWidthChange,
    onDragging,
  };

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetX([-4, 4])
        .failOffsetY([-12, 12])
        .onBegin((event) => {
          const latest = latestRef.current;
          dragRef.current = { startX: event.absoluteX, startWidth: latest.width };
          setDragging(true);
          latest.onDragging?.(true);
        })
        .onUpdate((event) => {
          const current = dragRef.current;
          if (!current) return;
          const latest = latestRef.current;
          const raw = rawPixelColWidth(
            current.startWidth,
            current.startX,
            event.absoluteX,
            latest.grow,
          );
          if (
            latest.collapseBelow !== undefined &&
            latest.onCollapse &&
            raw < latest.collapseBelow
          ) {
            dragRef.current = null;
            latest.onWidthChange(current.startWidth);
            latest.onCollapse();
            return;
          }
          latest.onWidthChange(
            nextPixelColWidth(
              current.startWidth,
              current.startX,
              event.absoluteX,
              latest.grow,
              latest.minWidth,
              latest.maxWidth,
            ),
          );
        })
        .onFinalize(() => {
          dragRef.current = null;
          setDragging(false);
          latestRef.current.onDragging?.(false);
        }),
    [],
  );

  return (
    <View
      style={{
        width: ruleWidth,
        flexShrink: 0,
        position: "relative",
        zIndex: 20,
        backgroundColor: dragging ? t.brandAccent : (ruleColor ?? t.black),
      }}
    >
      <GestureDetector gesture={panGesture}>
        <View
          testID={testID}
          role="separator"
          aria-orientation="vertical"
          accessibilityLabel={accessibilityLabel ?? "Resize panel"}
          collapsable={false}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: -9,
            right: -9,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {dragging ? (
            <View
              pointerEvents="none"
              style={{
                width: 10,
                height: 28,
                borderRadius: 5,
                borderWidth: 1,
                borderColor: t.retroBorder,
                backgroundColor: t.brandAccent,
              }}
            />
          ) : null}
        </View>
      </GestureDetector>
    </View>
  );
}
