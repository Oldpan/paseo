import { useCallback, useEffect, useRef, useState } from "react";
import { createPixelColWidthGate, nextPixelColWidth, rawPixelColWidth } from "../panel-resize";
import type { ColResizeHandleProps } from "./ColResizeHandle.types";
import { useTheme } from "./ThemeProvider";

export function ColResizeHandle({
  testID,
  accessibilityLabel,
  grow,
  width,
  minWidth,
  maxWidth,
  defaultWidth,
  collapseBelow,
  onCollapse,
  onWidthChange,
  onDragging,
  ruleWidth = 2,
  ruleColor,
}: ColResizeHandleProps) {
  const { palette: t } = useTheme();
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);

  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const draggingRef = useRef(false);
  const cursorRestoreRef = useRef<string | null>(null);
  const userSelectRestoreRef = useRef<string | null>(null);

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

  const widthGate = useRef(
    createPixelColWidthGate((next) => latestRef.current.onWidthChange(next)),
  ).current;

  const restoreBodyDragStyles = useCallback(() => {
    if (typeof document === "undefined") return;
    if (cursorRestoreRef.current !== null) {
      document.body.style.cursor = cursorRestoreRef.current;
      cursorRestoreRef.current = null;
    }
    if (userSelectRestoreRef.current !== null) {
      document.body.style.userSelect = userSelectRestoreRef.current;
      userSelectRestoreRef.current = null;
    }
  }, []);

  const stopDragging = useCallback(
    (flush: boolean) => {
      if (flush) widthGate.flush();
      else widthGate.cancel();
      dragRef.current = null;
      restoreBodyDragStyles();
      if (draggingRef.current) {
        draggingRef.current = false;
        setDragging(false);
        latestRef.current.onDragging?.(false);
      }
    },
    [restoreBodyDragStyles, widthGate],
  );

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const latest = latestRef.current;
      const raw = rawPixelColWidth(current.startWidth, current.startX, event.clientX, latest.grow);
      if (latest.collapseBelow !== undefined && latest.onCollapse && raw < latest.collapseBelow) {
        stopDragging(false);
        // Preserve the user's pre-collapse expanded width for the next expand.
        latest.onWidthChange(current.startWidth);
        latest.onCollapse();
        return;
      }
      widthGate.schedule(
        nextPixelColWidth(
          current.startWidth,
          current.startX,
          event.clientX,
          latest.grow,
          latest.minWidth,
          latest.maxWidth,
        ),
      );
    };

    const onEnd = () => {
      if (!dragRef.current && !draggingRef.current) return;
      stopDragging(true);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    window.addEventListener("blur", onEnd);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      window.removeEventListener("blur", onEnd);
      stopDragging(true);
    };
  }, [stopDragging, widthGate]);

  const active = dragging || hovered;
  const lineColor = active ? t.brandAccent : (ruleColor ?? t.black);

  return (
    <div
      style={{
        width: ruleWidth,
        flexShrink: 0,
        position: "relative",
        zIndex: 20,
        backgroundColor: lineColor,
        transition: "background-color 140ms ease",
      }}
    >
      <div
        data-testid={testID}
        role="separator"
        aria-orientation="vertical"
        aria-label={accessibilityLabel ?? "Resize panel"}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onPointerDown={(event) => {
          event.preventDefault();
          dragRef.current = { startX: event.clientX, startWidth: latestRef.current.width };
          if (!draggingRef.current) {
            draggingRef.current = true;
            setDragging(true);
            latestRef.current.onDragging?.(true);
          }
          if (typeof document !== "undefined") {
            if (cursorRestoreRef.current === null) {
              cursorRestoreRef.current = document.body.style.cursor;
            }
            if (userSelectRestoreRef.current === null) {
              userSelectRestoreRef.current = document.body.style.userSelect;
            }
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }
        }}
        onDoubleClick={() => {
          if (defaultWidth === undefined) return;
          const clamped = Math.round(Math.min(maxWidth, Math.max(minWidth, defaultWidth)));
          onWidthChange(clamped);
        }}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: -5,
          right: -5,
          cursor: "col-resize",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        <div
          style={{
            pointerEvents: "none",
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: 10,
            height: 26,
            borderRadius: 5,
            border: `1px solid ${t.retroBorder}`,
            backgroundColor: t.brandAccent,
            opacity: active ? 1 : 0,
            transition: "opacity 140ms ease",
          }}
        />
      </div>
    </div>
  );
}
