// Migrated from Bigbang apps/app/src/icons.tsx. Keep presentation changes reviewable against that source.
import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";
import type { IconProps } from "./iconTypes";

function IconFrame({ size, children }: { size: number; children: ReactNode }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {children}
    </View>
  );
}

export function PinIcon({ color, size = 12 }: IconProps) {
  return (
    <IconFrame size={size}>
      <View style={{ width: size, height: size, transform: [{ rotate: "45deg" }] }}>
        <View
          style={{
            position: "absolute",
            left: size * 0.25,
            top: size * 0.1,
            width: size * 0.5,
            height: size * 0.45,
            borderWidth: 1.2,
            borderColor: color,
          }}
        />
        <View
          style={{
            position: "absolute",
            left: size * 0.1,
            top: size * 0.55,
            width: size * 0.8,
            height: 1.2,
            backgroundColor: color,
          }}
        />
        <View
          style={{
            position: "absolute",
            left: size * 0.5,
            top: size * 0.55,
            width: 1.2,
            height: size * 0.4,
            backgroundColor: color,
          }}
        />
      </View>
    </IconFrame>
  );
}

export function MenuIcon({ color, size = 16 }: { color: string; size?: number }) {
  const bar: ViewStyle = {
    width: size * 0.72,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: color,
    marginVertical: 1.6,
  };
  return (
    <IconFrame size={size}>
      <View style={bar} />
      <View style={bar} />
      <View style={bar} />
    </IconFrame>
  );
}

/** lucide PanelLeft / Sidebar: rounded square with a left rail. Independent of MenuIcon. */
export function SidebarIcon({ color, size = 16 }: IconProps) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.78,
          height: size * 0.78,
          borderWidth: 1.4,
          borderColor: color,
          borderRadius: size * 0.12,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size * 0.34,
          width: 1.4,
          height: size * 0.78,
          backgroundColor: color,
        }}
      />
    </IconFrame>
  );
}

/** lucide PanelLeftOpen: square, left rail, chevron pointing out (right). */
export function PanelLeftOpenIcon({ color, size = 20 }: IconProps) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.78,
          height: size * 0.78,
          borderWidth: 1.4,
          borderColor: color,
          borderRadius: size * 0.12,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size * 0.34,
          width: 1.4,
          height: size * 0.78,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          right: size * 0.16,
          width: 0,
          height: 0,
          borderTopWidth: 3.2,
          borderBottomWidth: 3.2,
          borderLeftWidth: 4,
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
          borderLeftColor: color,
        }}
      />
    </IconFrame>
  );
}

/** lucide PanelLeftClose: square, left rail, chevron pointing in (left). */
export function PanelLeftCloseIcon({ color, size = 14 }: IconProps) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.78,
          height: size * 0.78,
          borderWidth: 1.4,
          borderColor: color,
          borderRadius: size * 0.12,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size * 0.34,
          width: 1.4,
          height: size * 0.78,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          right: size * 0.18,
          width: 0,
          height: 0,
          borderTopWidth: 3.2,
          borderBottomWidth: 3.2,
          borderRightWidth: 4,
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
          borderRightColor: color,
        }}
      />
    </IconFrame>
  );
}

/** lucide PanelRightOpen: square, right rail, chevron pointing out. */
export function PanelRightOpenIcon({ color, size = 14 }: IconProps) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.78,
          height: size * 0.78,
          borderWidth: 1.4,
          borderColor: color,
          borderRadius: size * 0.12,
        }}
      />
      <View
        style={{
          position: "absolute",
          right: size * 0.34,
          width: 1.4,
          height: size * 0.78,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size * 0.18,
          width: 0,
          height: 0,
          borderTopWidth: 3.2,
          borderBottomWidth: 3.2,
          borderRightWidth: 4,
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
          borderRightColor: color,
        }}
      />
    </IconFrame>
  );
}

/** lucide PanelRightClose: square, right rail, chevron pointing in. */
export function PanelRightCloseIcon({ color, size = 14 }: IconProps) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.78,
          height: size * 0.78,
          borderWidth: 1.4,
          borderColor: color,
          borderRadius: size * 0.12,
        }}
      />
      <View
        style={{
          position: "absolute",
          right: size * 0.34,
          width: 1.4,
          height: size * 0.78,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size * 0.16,
          width: 0,
          height: 0,
          borderTopWidth: 3.2,
          borderBottomWidth: 3.2,
          borderLeftWidth: 4,
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
          borderLeftColor: color,
        }}
      />
    </IconFrame>
  );
}

/** lucide PanelTopOpen: square, top bar, chevron down. */
export function PanelTopOpenIcon({ color, size = 14 }: IconProps) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.78,
          height: size * 0.78,
          borderWidth: 1.4,
          borderColor: color,
          borderRadius: size * 0.12,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: size * 0.34,
          width: size * 0.78,
          height: 1.4,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          bottom: size * 0.2,
          width: 0,
          height: 0,
          borderLeftWidth: 3.2,
          borderRightWidth: 3.2,
          borderTopWidth: 4,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderTopColor: color,
        }}
      />
    </IconFrame>
  );
}

/** lucide PanelTopClose: square, top bar, chevron up. */
export function PanelTopCloseIcon({ color, size = 14 }: IconProps) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.78,
          height: size * 0.78,
          borderWidth: 1.4,
          borderColor: color,
          borderRadius: size * 0.12,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: size * 0.34,
          width: size * 0.78,
          height: 1.4,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          bottom: size * 0.18,
          width: 0,
          height: 0,
          borderLeftWidth: 3.2,
          borderRightWidth: 3.2,
          borderBottomWidth: 4,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderBottomColor: color,
        }}
      />
    </IconFrame>
  );
}

/** Both side panels in one glyph. Open → chevrons point outward (collapse); collapsed → inward (expand). */
export function PanelsToggleIcon({
  color,
  size = 14,
  collapsed = false,
}: IconProps & { collapsed?: boolean }) {
  const half = size * 0.22;
  const thick = Math.max(3, size * 0.3);
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.86,
          height: size * 0.82,
          borderWidth: 1.4,
          borderColor: color,
          borderRadius: size * 0.12,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size * 0.36,
          width: 1.4,
          height: size * 0.82,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          right: size * 0.36,
          width: 1.4,
          height: size * 0.82,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size * 0.1,
          width: 0,
          height: 0,
          borderTopWidth: half,
          borderBottomWidth: half,
          ...(collapsed
            ? { borderLeftWidth: thick, borderLeftColor: color, borderRightColor: "transparent" }
            : { borderRightWidth: thick, borderRightColor: color, borderLeftColor: "transparent" }),
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
        }}
      />
      <View
        style={{
          position: "absolute",
          right: size * 0.1,
          width: 0,
          height: 0,
          borderTopWidth: half,
          borderBottomWidth: half,
          ...(collapsed
            ? { borderRightWidth: thick, borderRightColor: color, borderLeftColor: "transparent" }
            : { borderLeftWidth: thick, borderLeftColor: color, borderRightColor: "transparent" }),
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
        }}
      />
    </IconFrame>
  );
}

export function CloseIcon({ color, size = 14 }: { color: string; size?: number }) {
  const arm: ViewStyle = {
    position: "absolute",
    width: size * 0.62,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: color,
  };
  return (
    <IconFrame size={size}>
      <View style={[arm, { transform: [{ rotate: "45deg" }] }]} />
      <View style={[arm, { transform: [{ rotate: "-45deg" }] }]} />
    </IconFrame>
  );
}

export function SendIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: 0,
          height: 0,
          borderTopWidth: size * 0.28,
          borderBottomWidth: size * 0.28,
          borderLeftWidth: size * 0.48,
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
          borderLeftColor: color,
          marginLeft: 2,
        }}
      />
    </IconFrame>
  );
}

export function StopIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View
        style={{ width: size * 0.42, height: size * 0.42, borderRadius: 1, backgroundColor: color }}
      />
    </IconFrame>
  );
}

export function UserIcon({ color, size = 16, strokeWidth = 2.5 }: IconProps) {
  const stroke = Math.max(1.5, strokeWidth);
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.34,
          height: size * 0.34,
          borderRadius: size,
          borderWidth: stroke,
          borderColor: color,
          marginBottom: 2,
        }}
      />
      <View
        style={{
          width: size * 0.66,
          height: size * 0.3,
          borderTopLeftRadius: size,
          borderTopRightRadius: size,
          borderWidth: stroke,
          borderBottomWidth: 0,
          borderColor: color,
        }}
      />
    </IconFrame>
  );
}

export function LogoutIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.42,
          height: size * 0.55,
          borderWidth: 1.4,
          borderColor: color,
          borderRadius: 2,
          marginRight: 2,
        }}
      />
      <View
        style={{
          position: "absolute",
          right: 2,
          width: size * 0.32,
          height: 1.4,
          backgroundColor: color,
        }}
      />
    </IconFrame>
  );
}

export function BellIcon({ color, size = 14 }: IconProps) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.46,
          height: size * 0.42,
          borderTopLeftRadius: size,
          borderTopRightRadius: size,
          borderWidth: 1.4,
          borderBottomWidth: 0,
          borderColor: color,
          marginTop: 2,
        }}
      />
      <View style={{ width: size * 0.62, height: 1.4, backgroundColor: color, marginTop: 1 }} />
      <View
        style={{
          width: size * 0.16,
          height: size * 0.16,
          borderRadius: size,
          backgroundColor: color,
          marginTop: 1,
        }}
      />
    </IconFrame>
  );
}

export function UsersIcon({ color, size = 16 }: IconProps) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.34,
          height: size * 0.34,
          borderRadius: size,
          borderWidth: 1.4,
          borderColor: color,
          marginBottom: 2,
        }}
      />
      <View
        style={{
          width: size * 0.58,
          height: size * 0.28,
          borderTopLeftRadius: size,
          borderTopRightRadius: size,
          borderWidth: 1.4,
          borderBottomWidth: 0,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          right: size * 0.08,
          top: size * 0.12,
          width: size * 0.26,
          height: size * 0.26,
          borderRadius: size,
          borderWidth: 1.3,
          borderColor: color,
          backgroundColor: "transparent",
        }}
      />
    </IconFrame>
  );
}

export function HashIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          position: "absolute",
          width: size * 0.62,
          height: 1.4,
          backgroundColor: color,
          top: size * 0.32,
          transform: [{ rotate: "-12deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          width: size * 0.62,
          height: 1.4,
          backgroundColor: color,
          top: size * 0.52,
          transform: [{ rotate: "-12deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          height: size * 0.62,
          width: 1.4,
          backgroundColor: color,
          left: size * 0.32,
          transform: [{ rotate: "-12deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          height: size * 0.62,
          width: 1.4,
          backgroundColor: color,
          left: size * 0.52,
          transform: [{ rotate: "-12deg" }],
        }}
      />
    </IconFrame>
  );
}

export function MessagesSquareIcon({ color, size = 14 }: IconProps) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          position: "absolute",
          left: size * 0.3,
          top: size * 0.35,
          width: size * 0.58,
          height: size * 0.53,
          borderWidth: 1.2,
          borderColor: color,
          borderRadius: size * 0.08,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size * 0.08,
          top: size * 0.08,
          width: size * 0.58,
          height: size * 0.53,
          borderWidth: 1.2,
          borderColor: color,
          borderRadius: size * 0.08,
        }}
      />
    </IconFrame>
  );
}

export function ChatIcon({ color, size = 20 }: IconProps) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.72,
          height: size * 0.52,
          borderRadius: 3,
          borderWidth: 1.6,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          bottom: size * 0.18,
          left: size * 0.28,
          width: 0,
          height: 0,
          borderTopWidth: 5,
          borderLeftWidth: 4,
          borderRightWidth: 4,
          borderTopColor: color,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
        }}
      />
    </IconFrame>
  );
}

export function ChevronIcon({ color, size = 12, down }: IconProps) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.42,
          height: size * 0.42,
          borderRightWidth: 1.4,
          borderBottomWidth: 1.4,
          borderColor: color,
          transform: [{ rotate: down ? "45deg" : "-45deg" }],
          marginTop: down ? -2 : 2,
        }}
      />
    </IconFrame>
  );
}

export function CopyIcon({ color, size = 12 }: { color: string; size?: number }) {
  const box: ViewStyle = {
    position: "absolute",
    width: size * 0.48,
    height: size * 0.52,
    borderWidth: 1.3,
    borderColor: color,
    borderRadius: 1.5,
  };
  return (
    <IconFrame size={size}>
      <View style={[box, { top: size * 0.12, left: size * 0.12 }]} />
      <View
        style={[box, { top: size * 0.28, left: size * 0.32, backgroundColor: "transparent" }]}
      />
    </IconFrame>
  );
}

export function PlusIcon({ color, size = 12 }: { color: string; size?: number }) {
  const bar: ViewStyle = { position: "absolute", backgroundColor: color, borderRadius: 1 };
  return (
    <IconFrame size={size}>
      <View style={[bar, { width: size * 0.62, height: 1.5 }]} />
      <View style={[bar, { width: 1.5, height: size * 0.62 }]} />
    </IconFrame>
  );
}

export function CheckIcon({ color, size = 12 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.22,
          height: size * 0.42,
          borderRightWidth: 1.6,
          borderBottomWidth: 1.6,
          borderColor: color,
          transform: [{ rotate: "45deg" }],
          marginTop: -2,
        }}
      />
    </IconFrame>
  );
}

export function SettingsIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.38,
          height: size * 0.38,
          borderRadius: size,
          borderWidth: 1.5,
          borderColor: color,
        }}
      />
      {[0, 45, 90, 135].map((deg) => (
        <View
          key={deg}
          style={{
            position: "absolute",
            width: 1.5,
            height: size * 0.28,
            backgroundColor: color,
            borderRadius: 1,
            transform: [{ rotate: `${deg}deg` }],
          }}
        />
      ))}
    </IconFrame>
  );
}

/** lucide Settings2: knobs at (7,7) and (17,17) with horizontal tracks. Independent of SettingsIcon. */
export function Settings2Icon({ color, size = 14 }: IconProps) {
  const knob = size * (6 / 24);
  const trackH = Math.max(1.4, size * 0.08);
  return (
    <IconFrame size={size}>
      <View
        style={{
          position: "absolute",
          left: size * (7 / 24) - knob / 2,
          top: size * (7 / 24) - knob / 2,
          width: knob,
          height: knob,
          borderRadius: knob,
          borderWidth: 1.4,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size * (11 / 24),
          top: size * (7 / 24) - trackH / 2,
          width: size * (9 / 24),
          height: trackH,
          borderRadius: 1,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size * (17 / 24) - knob / 2,
          top: size * (17 / 24) - knob / 2,
          width: knob,
          height: knob,
          borderRadius: knob,
          borderWidth: 1.4,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size * (5 / 24),
          top: size * (17 / 24) - trackH / 2,
          width: size * (9 / 24),
          height: trackH,
          borderRadius: 1,
          backgroundColor: color,
        }}
      />
    </IconFrame>
  );
}

export function RefreshIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.58,
          height: size * 0.58,
          borderRadius: size,
          borderWidth: 1.5,
          borderTopColor: "transparent",
          borderRightColor: color,
          borderBottomColor: color,
          borderLeftColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: size * 0.08,
          right: size * 0.12,
          width: 0,
          height: 0,
          borderLeftWidth: 3,
          borderRightWidth: 3,
          borderBottomWidth: 4,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderBottomColor: color,
          transform: [{ rotate: "40deg" }],
        }}
      />
    </IconFrame>
  );
}

export function ChatOffIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.62,
          height: size * 0.42,
          borderRadius: 2,
          borderWidth: 1.4,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: size * 0.78,
          height: 1.5,
          backgroundColor: color,
          transform: [{ rotate: "-42deg" }],
        }}
      />
    </IconFrame>
  );
}

export function TrashIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.44,
          height: size * 0.48,
          borderWidth: 1.3,
          borderColor: color,
          borderRadius: 1.5,
          marginTop: 3,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: 2,
          width: size * 0.54,
          height: 1.4,
          backgroundColor: color,
          borderRadius: 1,
        }}
      />
    </IconFrame>
  );
}

export function SunIcon({ color, size = 12 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.36,
          height: size * 0.36,
          borderRadius: size,
          borderWidth: 1.4,
          borderColor: color,
        }}
      />
      {[0, 45, 90, 135].map((deg) => (
        <View
          key={deg}
          style={{
            position: "absolute",
            width: 1.3,
            height: size * 0.78,
            backgroundColor: color,
            opacity: 0.85,
            transform: [{ rotate: `${deg}deg` }],
          }}
        />
      ))}
    </IconFrame>
  );
}

export function MoonIcon({ color, size = 12 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.52,
          height: size * 0.52,
          borderRadius: size,
          borderWidth: 1.4,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: size * 0.08,
          left: size * 0.22,
          width: size * 0.4,
          height: size * 0.4,
          borderRadius: size,
          backgroundColor: "transparent",
          borderWidth: 1.4,
          borderColor: color,
        }}
      />
    </IconFrame>
  );
}

export function MonitorIcon({ color, size = 12 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.62,
          height: size * 0.42,
          borderRadius: 1.5,
          borderWidth: 1.4,
          borderColor: color,
          marginBottom: 3,
        }}
      />
      <View
        style={{
          position: "absolute",
          bottom: 1,
          width: size * 0.28,
          height: 1.4,
          backgroundColor: color,
        }}
      />
    </IconFrame>
  );
}

export function ShieldIcon({ color, size = 12 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.46,
          height: size * 0.52,
          borderWidth: 1.4,
          borderColor: color,
          borderTopLeftRadius: 2,
          borderTopRightRadius: 2,
          borderBottomLeftRadius: size * 0.23,
          borderBottomRightRadius: size * 0.23,
        }}
      />
    </IconFrame>
  );
}

export function LinkIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.38,
          height: size * 0.38,
          borderRadius: 3,
          borderWidth: 1.4,
          borderColor: color,
          transform: [{ rotate: "20deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          width: size * 0.38,
          height: size * 0.38,
          borderRadius: 3,
          borderWidth: 1.4,
          borderColor: color,
          transform: [{ rotate: "20deg" }, { translateX: 3 }],
        }}
      />
    </IconFrame>
  );
}

export function BookmarkIcon({
  color,
  size = 14,
  filled,
}: {
  color: string;
  size?: number;
  filled?: boolean;
}) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.42,
          height: size * 0.56,
          borderWidth: 1.4,
          borderColor: color,
          borderTopLeftRadius: 1.5,
          borderTopRightRadius: 1.5,
          backgroundColor: filled ? color : "transparent",
        }}
      />
      <View
        style={{
          position: "absolute",
          bottom: 1,
          width: 0,
          height: 0,
          borderLeftWidth: size * 0.21,
          borderRightWidth: size * 0.21,
          borderBottomWidth: size * 0.18,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderBottomColor: color,
          transform: [{ rotate: "180deg" }],
        }}
      />
    </IconFrame>
  );
}

export function ForwardIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View style={{ width: size * 0.42, height: 1.4, backgroundColor: color }} />
      <View
        style={{
          position: "absolute",
          right: 2,
          width: 0,
          height: 0,
          borderTopWidth: 4,
          borderBottomWidth: 4,
          borderLeftWidth: 6,
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
          borderLeftColor: color,
        }}
      />
    </IconFrame>
  );
}

export function ActivityIcon({ color, size = 14 }: { color: string; size?: number }) {
  const bar = (h: number, x: number) => (
    <View
      key={x}
      style={{
        position: "absolute",
        left: x,
        bottom: size * 0.18,
        width: 1.6,
        height: h,
        borderRadius: 1,
        backgroundColor: color,
      }}
    />
  );
  return (
    <IconFrame size={size}>
      {bar(size * 0.28, size * 0.22)}
      {bar(size * 0.48, size * 0.42)}
      {bar(size * 0.34, size * 0.62)}
    </IconFrame>
  );
}

export function SmilePlusIcon({ color, size = 12 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.72,
          height: size * 0.72,
          borderRadius: size,
          borderWidth: 1.4,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: size * 0.28,
          left: size * 0.28,
          width: 1.6,
          height: 1.6,
          borderRadius: 1,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: size * 0.28,
          right: size * 0.28,
          width: 1.6,
          height: 1.6,
          borderRadius: 1,
          backgroundColor: color,
        }}
      />
    </IconFrame>
  );
}

export function AlertIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: size * 0.32,
          borderRightWidth: size * 0.32,
          borderBottomWidth: size * 0.56,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderBottomColor: color,
        }}
      />
    </IconFrame>
  );
}

export function FolderIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.28,
          height: size * 0.16,
          borderWidth: 1.3,
          borderColor: color,
          borderTopLeftRadius: 2,
          borderTopRightRadius: 2,
          marginBottom: -1,
          alignSelf: "flex-start",
          marginLeft: size * 0.12,
        }}
      />
      <View
        style={{
          width: size * 0.68,
          height: size * 0.42,
          borderWidth: 1.3,
          borderColor: color,
          borderRadius: 2,
        }}
      />
    </IconFrame>
  );
}

export function FileGlyphIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.46,
          height: size * 0.58,
          borderWidth: 1.3,
          borderColor: color,
          borderRadius: 1.5,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: size * 0.18,
          width: size * 0.26,
          height: 1.2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: size * 0.3,
          width: size * 0.26,
          height: 1.2,
          backgroundColor: color,
        }}
      />
    </IconFrame>
  );
}

export function FilesIcon({ color, size = 14, strokeWidth = 2.5 }: IconProps) {
  const stroke = Math.max(1.4, strokeWidth * 0.55);
  const back = {
    position: "absolute" as const,
    width: size * 0.42,
    height: size * 0.5,
    borderWidth: stroke,
    borderColor: color,
    borderRadius: 1.5,
    left: size * 0.18,
    top: size * 0.16,
  };
  const front = {
    position: "absolute" as const,
    width: size * 0.42,
    height: size * 0.5,
    borderWidth: stroke,
    borderColor: color,
    borderRadius: 1.5,
    left: size * 0.34,
    top: size * 0.3,
  };
  return (
    <IconFrame size={size}>
      <View style={back} />
      <View style={front} />
    </IconFrame>
  );
}

export function FileTextIcon({ color, size = 14 }: IconProps) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.46,
          height: size * 0.58,
          borderWidth: 1.3,
          borderColor: color,
          borderRadius: 1.5,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: size * 0.22,
          width: size * 0.26,
          height: 1.2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: size * 0.34,
          width: size * 0.26,
          height: 1.2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: size * 0.46,
          width: size * 0.18,
          height: 1.2,
          backgroundColor: color,
        }}
      />
    </IconFrame>
  );
}

export function ArrowLeftIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View style={{ width: size * 0.5, height: 1.4, backgroundColor: color, marginLeft: 2 }} />
      <View
        style={{
          position: "absolute",
          left: 2,
          width: 0,
          height: 0,
          borderTopWidth: 4,
          borderBottomWidth: 4,
          borderRightWidth: 6,
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
          borderRightColor: color,
        }}
      />
    </IconFrame>
  );
}

export function BoxesIcon({ color, size = 16 }: IconProps) {
  const box = (left: number, top: number): ViewStyle => ({
    position: "absolute",
    left,
    top,
    width: size * 0.32,
    height: size * 0.32,
    borderWidth: 1.3,
    borderColor: color,
    borderRadius: 1,
  });
  return (
    <IconFrame size={size}>
      <View style={box(size * 0.18, size * 0.18)} />
      <View style={box(size * 0.5, size * 0.18)} />
      <View style={box(size * 0.34, size * 0.46)} />
    </IconFrame>
  );
}

export function SearchIcon({ color, size = 16 }: IconProps) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.48,
          height: size * 0.48,
          borderRadius: size,
          borderWidth: 1.6,
          borderColor: color,
          marginRight: 2,
          marginBottom: 2,
        }}
      />
      <View
        style={{
          position: "absolute",
          right: size * 0.12,
          bottom: size * 0.12,
          width: size * 0.28,
          height: 1.6,
          backgroundColor: color,
          transform: [{ rotate: "40deg" }],
        }}
      />
    </IconFrame>
  );
}

export function InboxIcon({ color, size = 16 }: IconProps) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.68,
          height: size * 0.48,
          borderWidth: 1.4,
          borderColor: color,
          borderRadius: 2,
          marginTop: 4,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: size * 0.18,
          width: size * 0.42,
          height: 1.4,
          backgroundColor: color,
        }}
      />
    </IconFrame>
  );
}

export function QuoteIcon({ color, size = 14 }: { color: string; size?: number }) {
  const bar = (left: number) => (
    <View
      key={left}
      style={{
        position: "absolute",
        left,
        top: size * 0.22,
        width: 2,
        height: size * 0.46,
        borderRadius: 1,
        backgroundColor: color,
      }}
    />
  );
  return (
    <IconFrame size={size}>
      {bar(size * 0.28)}
      {bar(size * 0.52)}
    </IconFrame>
  );
}

export function CheckCheckIcon({ color, size = 14 }: { color: string; size?: number }) {
  const tick = (left: number): ViewStyle => ({
    position: "absolute",
    left,
    top: size * 0.28,
    width: size * 0.22,
    height: size * 0.12,
    borderLeftWidth: 1.4,
    borderBottomWidth: 1.4,
    borderColor: color,
    transform: [{ rotate: "-45deg" }],
  });
  return (
    <IconFrame size={size}>
      <View style={tick(size * 0.18)} />
      <View style={tick(size * 0.38)} />
    </IconFrame>
  );
}

export function MoreIcon({ color, size = 16 }: IconProps) {
  const dot = (left: number) => (
    <View
      key={left}
      style={{
        position: "absolute",
        left,
        top: size * 0.42,
        width: 2.4,
        height: 2.4,
        borderRadius: 2,
        backgroundColor: color,
      }}
    />
  );
  return (
    <IconFrame size={size}>
      {dot(size * 0.22)}
      {dot(size * 0.44)}
      {dot(size * 0.66)}
    </IconFrame>
  );
}

export function SlidersIcon({ color, size = 12 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View
        style={{ width: size * 0.62, height: 1.4, backgroundColor: color, marginVertical: 2.2 }}
      />
      <View
        style={{ width: size * 0.62, height: 1.4, backgroundColor: color, marginVertical: 2.2 }}
      />
      <View
        style={{
          position: "absolute",
          left: size * 0.22,
          top: size * 0.18,
          width: 4,
          height: 4,
          borderRadius: 2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          right: size * 0.22,
          bottom: size * 0.18,
          width: 4,
          height: 4,
          borderRadius: 2,
          backgroundColor: color,
        }}
      />
    </IconFrame>
  );
}

export function TerminalIcon({ color, size = 14 }: IconProps) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.72,
          height: size * 0.52,
          borderWidth: 1.4,
          borderColor: color,
          borderRadius: 2,
        }}
      />
      <View
        style={{
          position: "absolute",
          bottom: size * 0.22,
          width: size * 0.36,
          height: 1.3,
          backgroundColor: color,
        }}
      />
    </IconFrame>
  );
}

/** lucide OctagonX. Independent of StopIcon. */
export function OctagonXIcon({ color, size = 12 }: IconProps) {
  const edge = size * 0.72;
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: edge,
          height: edge,
          borderWidth: 1.4,
          borderColor: color,
          borderRadius: 2,
          transform: [{ rotate: "22.5deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          width: size * 0.34,
          height: 1.4,
          backgroundColor: color,
          transform: [{ rotate: "45deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          width: size * 0.34,
          height: 1.4,
          backgroundColor: color,
          transform: [{ rotate: "-45deg" }],
        }}
      />
    </IconFrame>
  );
}

/** lucide SquareTerminal: rounded square, prompt chevron, cursor bar. Independent of TerminalIcon. */
export function SquareTerminalIcon({ color, size = 14 }: IconProps) {
  const chevron = size * 0.16;
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.78,
          height: size * 0.78,
          borderWidth: 1.4,
          borderColor: color,
          borderRadius: size * 0.12,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size * 0.28,
          top: size * 0.34,
          width: chevron,
          height: chevron,
          borderRightWidth: 1.4,
          borderTopWidth: 1.4,
          borderColor: color,
          transform: [{ rotate: "45deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size * 0.44,
          bottom: size * 0.3,
          width: size * 0.22,
          height: 1.4,
          backgroundColor: color,
          borderRadius: 1,
        }}
      />
    </IconFrame>
  );
}

export function UnplugIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.38,
          height: size * 0.28,
          borderWidth: 1.3,
          borderColor: color,
          borderRadius: 2,
        }}
      />
      <View
        style={{ width: size * 0.2, height: 1.3, backgroundColor: color, marginVertical: 1.5 }}
      />
      <View
        style={{
          width: size * 0.38,
          height: size * 0.28,
          borderWidth: 1.3,
          borderColor: color,
          borderRadius: 2,
          borderStyle: "dashed",
        }}
      />
    </IconFrame>
  );
}

export function ZapIcon({ color, size = 14 }: IconProps) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: size * 0.22,
          borderRightWidth: size * 0.18,
          borderBottomWidth: size * 0.42,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderBottomColor: color,
          transform: [{ translateX: 2 }],
        }}
      />
      <View
        style={{
          position: "absolute",
          bottom: size * 0.12,
          width: 0,
          height: 0,
          borderLeftWidth: size * 0.18,
          borderRightWidth: size * 0.22,
          borderTopWidth: size * 0.42,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderTopColor: color,
          transform: [{ translateX: -2 }],
        }}
      />
    </IconFrame>
  );
}

export function BotIcon({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.62,
          height: size * 0.5,
          borderWidth: 1.3,
          borderColor: color,
          borderRadius: 4,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: size * 0.1,
          height: size * 0.1,
          borderRadius: size * 0.05,
          backgroundColor: color,
          left: size * 0.28,
          top: size * 0.32,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: size * 0.1,
          height: size * 0.1,
          borderRadius: size * 0.05,
          backgroundColor: color,
          right: size * 0.28,
          top: size * 0.32,
        }}
      />
    </IconFrame>
  );
}

export function FlaskIcon({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.28,
          height: size * 0.22,
          borderWidth: 1.3,
          borderColor: color,
          borderBottomWidth: 0,
        }}
      />
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: size * 0.28,
          borderRightWidth: size * 0.28,
          borderTopWidth: size * 0.36,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderTopColor: color,
        }}
      />
    </IconFrame>
  );
}

export function FlagIcon({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          position: "absolute",
          left: size * 0.22,
          top: size * 0.16,
          width: 1.4,
          height: size * 0.68,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size * 0.22,
          top: size * 0.16,
          width: size * 0.48,
          height: size * 0.32,
          borderWidth: 1.3,
          borderColor: color,
          borderLeftWidth: 0,
        }}
      />
    </IconFrame>
  );
}

export function BriefcaseIcon({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.7,
          height: size * 0.46,
          borderWidth: 1.3,
          borderColor: color,
          borderRadius: 2,
          marginTop: 3,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: size * 0.16,
          width: size * 0.28,
          height: size * 0.16,
          borderWidth: 1.3,
          borderColor: color,
          borderBottomWidth: 0,
        }}
      />
    </IconFrame>
  );
}

export function KeyboardIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.72,
          height: size * 0.48,
          borderWidth: 1.3,
          borderColor: color,
          borderRadius: 2,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: size * 0.12,
          height: size * 0.12,
          backgroundColor: color,
          left: size * 0.22,
          top: size * 0.28,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: size * 0.12,
          height: size * 0.12,
          backgroundColor: color,
          right: size * 0.22,
          top: size * 0.28,
        }}
      />
    </IconFrame>
  );
}

export function ExternalLinkIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.42,
          height: size * 0.42,
          borderWidth: 1.3,
          borderColor: color,
          position: "absolute",
          left: size * 0.12,
          bottom: size * 0.12,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: size * 0.34,
          height: 1.3,
          backgroundColor: color,
          right: size * 0.12,
          top: size * 0.22,
          transform: [{ rotate: "-45deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          width: 1.3,
          height: size * 0.28,
          backgroundColor: color,
          right: size * 0.16,
          top: size * 0.14,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: size * 0.28,
          height: 1.3,
          backgroundColor: color,
          right: size * 0.14,
          top: size * 0.14,
        }}
      />
    </IconFrame>
  );
}

export function DownloadIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <IconFrame size={size}>
      <View style={{ width: 1.4, height: size * 0.38, backgroundColor: color, marginBottom: 2 }} />
      <View
        style={{
          position: "absolute",
          top: size * 0.34,
          width: 0,
          height: 0,
          borderLeftWidth: 4,
          borderRightWidth: 4,
          borderTopWidth: 5,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderTopColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          bottom: 2,
          width: size * 0.5,
          height: 1.4,
          backgroundColor: color,
        }}
      />
    </IconFrame>
  );
}

export function PaperclipIcon({ color, size = 14 }: IconProps) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.28,
          height: size * 0.62,
          borderWidth: 1.5,
          borderColor: color,
          borderRadius: size,
          transform: [{ rotate: "35deg" }],
        }}
      />
    </IconFrame>
  );
}

export function WrenchIcon({ color, size = 16 }: IconProps) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.18,
          height: size * 0.55,
          borderRadius: 1,
          backgroundColor: color,
          transform: [{ rotate: "40deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          top: size * 0.18,
          width: size * 0.34,
          height: size * 0.22,
          borderWidth: 1.4,
          borderColor: color,
          borderRadius: 2,
          transform: [{ rotate: "40deg" }],
        }}
      />
    </IconFrame>
  );
}

export function FolderSearchIcon({ color, size = 16 }: IconProps) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.62,
          height: size * 0.42,
          borderWidth: 1.4,
          borderColor: color,
          borderRadius: 2,
        }}
      />
      <View
        style={{
          position: "absolute",
          right: size * 0.12,
          bottom: size * 0.12,
          width: size * 0.28,
          height: size * 0.28,
          borderRadius: size,
          borderWidth: 1.4,
          borderColor: color,
        }}
      />
    </IconFrame>
  );
}

export function LightbulbIcon({ color, size = 20 }: IconProps) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.42,
          height: size * 0.42,
          borderRadius: size,
          borderWidth: 1.5,
          borderColor: color,
        }}
      />
      <View
        style={{
          width: size * 0.28,
          height: size * 0.14,
          borderBottomLeftRadius: 2,
          borderBottomRightRadius: 2,
          borderWidth: 1.4,
          borderTopWidth: 0,
          borderColor: color,
          marginTop: 1,
        }}
      />
    </IconFrame>
  );
}

export function ClockIcon({ color, size = 14 }: IconProps) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.72,
          height: size * 0.72,
          borderRadius: size,
          borderWidth: 1.4,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: 1.4,
          height: size * 0.22,
          backgroundColor: color,
          top: size * 0.22,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: size * 0.18,
          height: 1.4,
          backgroundColor: color,
          top: size * 0.46,
          left: size * 0.48,
        }}
      />
    </IconFrame>
  );
}

export function MessagePlusIcon({ color, size = 14 }: IconProps) {
  return (
    <IconFrame size={size}>
      <View
        style={{
          width: size * 0.72,
          height: size * 0.5,
          borderRadius: 3,
          borderWidth: 1.4,
          borderColor: color,
        }}
      />
      <View
        style={{ position: "absolute", width: size * 0.28, height: 1.4, backgroundColor: color }}
      />
      <View
        style={{ position: "absolute", width: 1.4, height: size * 0.28, backgroundColor: color }}
      />
    </IconFrame>
  );
}

/** herdr: a window split into a top bar and side-by-side panes. */
export function HerdrIcon({ color, size = 16 }: IconProps) {
  const left = size * 0.14,
    top = size * 0.14,
    side = size * 0.72;
  return (
    <IconFrame size={size}>
      <View
        style={{
          position: "absolute",
          left,
          top,
          width: side,
          height: side,
          borderRadius: 2,
          borderWidth: 1.4,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          left,
          top: top + side * 0.36,
          width: side,
          height: 1.4,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: left + side * 0.36,
          top: top + side * 0.36,
          width: 1.4,
          height: side * 0.64,
          backgroundColor: color,
        }}
      />
    </IconFrame>
  );
}

export function RowsIcon({ color, size = 16 }: IconProps) {
  const bar = (top: number) => (
    <View
      key={top}
      style={{
        position: "absolute",
        left: size * 0.18,
        top,
        width: size * 0.64,
        height: 1.5,
        backgroundColor: color,
        borderRadius: 1,
      }}
    />
  );
  return (
    <IconFrame size={size}>
      {bar(size * 0.28)}
      {bar(size * 0.48)}
      {bar(size * 0.68)}
    </IconFrame>
  );
}

export function MaximizeIcon({ color, size = 14 }: IconProps) {
  return (
    <IconFrame size={size}>
      {[0, 1, 2, 3].map((corner) => (
        <View
          key={corner}
          style={{
            position: "absolute",
            width: size * 0.3,
            height: size * 0.3,
            left: corner % 2 ? undefined : size * 0.1,
            right: corner % 2 ? size * 0.1 : undefined,
            top: corner < 2 ? size * 0.1 : undefined,
            bottom: corner >= 2 ? size * 0.1 : undefined,
            borderColor: color,
            borderTopWidth: corner < 2 ? 1.4 : 0,
            borderBottomWidth: corner >= 2 ? 1.4 : 0,
            borderLeftWidth: corner % 2 ? 0 : 1.4,
            borderRightWidth: corner % 2 ? 1.4 : 0,
          }}
        />
      ))}
    </IconFrame>
  );
}
export function MinimizeIcon({ color, size = 14 }: IconProps) {
  return (
    <IconFrame size={size}>
      {[0, 1, 2, 3].map((corner) => (
        <View
          key={corner}
          style={{
            position: "absolute",
            width: size * 0.3,
            height: size * 0.3,
            left: corner % 2 ? undefined : size * 0.1,
            right: corner % 2 ? size * 0.1 : undefined,
            top: corner < 2 ? size * 0.1 : undefined,
            bottom: corner >= 2 ? size * 0.1 : undefined,
            borderColor: color,
            borderBottomWidth: corner < 2 ? 1.4 : 0,
            borderTopWidth: corner >= 2 ? 1.4 : 0,
            borderRightWidth: corner % 2 ? 0 : 1.4,
            borderLeftWidth: corner % 2 ? 1.4 : 0,
          }}
        />
      ))}
    </IconFrame>
  );
}
