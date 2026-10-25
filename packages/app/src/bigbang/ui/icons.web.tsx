// Migrated from Bigbang apps/app/src/icons.web.tsx. Keep presentation changes reviewable against that source.
import type { LucideIcon } from "lucide-react-native";
import { View } from "react-native";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bell,
  Bookmark,
  Bot,
  Boxes,
  Briefcase,
  Check,
  CheckCheck,
  ChevronDown,
  Clock3,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  File,
  Files,
  FileText,
  FlaskConical,
  Folder,
  FolderSearch,
  Forward,
  Hash,
  Inbox,
  Keyboard,
  Lightbulb,
  Link,
  LogOut,
  Menu,
  MessageSquare,
  MessagesSquare,
  MessageSquareOff,
  MessageSquarePlus,
  Milestone,
  Monitor,
  Moon,
  MoreHorizontal,
  OctagonX,
  Paperclip,
  Maximize,
  Minimize,
  PanelLeft,
  PanelsTopLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PanelTopClose,
  PanelTopOpen,
  Plus,
  Pin,
  Quote,
  RefreshCw,
  Rows3,
  Search,
  Send,
  Settings,
  Settings2,
  Shield,
  SlidersHorizontal,
  SmilePlus,
  Square,
  SquareTerminal,
  Sun,
  Terminal,
  Trash2,
  Unplug,
  User,
  Users,
  Wrench,
  X,
  Zap,
} from "lucide-react-native";
import type { IconProps } from "./iconTypes";

function wrap(Icon: LucideIcon, defaultSize: number, defaultStroke = 2) {
  return function Wrapped({
    color,
    size = defaultSize,
    strokeWidth = defaultStroke,
    filled,
  }: IconProps) {
    return (
      <Icon
        color={color}
        size={size}
        strokeWidth={strokeWidth}
        fill={filled ? color : "none"}
        aria-hidden
      />
    );
  };
}

export const PinIcon = wrap(Pin, 12);

export const MenuIcon = wrap(Menu, 16);
export const CloseIcon = wrap(X, 14);
export const SendIcon = wrap(Send, 14);
export const StopIcon = wrap(Square, 14);
export const LogoutIcon = wrap(LogOut, 14);
export const UserIcon = wrap(User, 16);
export const UsersIcon = wrap(Users, 16);
export const HashIcon = wrap(Hash, 14);
export const ChatIcon = wrap(MessageSquare, 20);
export const MessagesSquareIcon = wrap(MessagesSquare, 14);
export const CopyIcon = wrap(Copy, 12);
export const PlusIcon = wrap(Plus, 12);
export const CheckIcon = wrap(Check, 12);
export const SettingsIcon = wrap(Settings, 14);
export const Settings2Icon = wrap(Settings2, 14);
export const RefreshIcon = wrap(RefreshCw, 14);
export const ChatOffIcon = wrap(MessageSquareOff, 14);
export const TrashIcon = wrap(Trash2, 14);
export const SunIcon = wrap(Sun, 12);
export const MoonIcon = wrap(Moon, 12);
export const MonitorIcon = wrap(Monitor, 12);
export const ShieldIcon = wrap(Shield, 12);
export const LinkIcon = wrap(Link, 14);
export const BellIcon = wrap(Bell, 14);
export const BookmarkIcon = wrap(Bookmark, 14);
export const ForwardIcon = wrap(Forward, 14);
export const ActivityIcon = wrap(Activity, 14);
export const SmilePlusIcon = wrap(SmilePlus, 12);
export const AlertIcon = wrap(AlertTriangle, 14);
export const FolderIcon = wrap(Folder, 14);
export const FileGlyphIcon = wrap(File, 14);
export const FilesIcon = wrap(Files, 14);
export const FileTextIcon = wrap(FileText, 14);
export const RowsIcon = wrap(Rows3, 16);
export const MaximizeIcon = wrap(Maximize, 14);
export const MinimizeIcon = wrap(Minimize, 14);
export const SidebarIcon = wrap(PanelLeft, 16);
export const PanelLeftOpenIcon = wrap(PanelLeftOpen, 20);
export const PanelLeftCloseIcon = wrap(PanelLeftClose, 14);
export const PanelTopOpenIcon = wrap(PanelTopOpen, 14);
export const PanelTopCloseIcon = wrap(PanelTopClose, 14);
export const PanelRightOpenIcon = wrap(PanelRightOpen, 14);
export const PanelRightCloseIcon = wrap(PanelRightClose, 14);
export const ArrowLeftIcon = wrap(ArrowLeft, 14);
export const BoxesIcon = wrap(Boxes, 16);
export const HerdrIcon = wrap(PanelsTopLeft, 16);
export const SearchIcon = wrap(Search, 16);
export const InboxIcon = wrap(Inbox, 16);
export const QuoteIcon = wrap(Quote, 14);
export const CheckCheckIcon = wrap(CheckCheck, 14);
export const MoreIcon = wrap(MoreHorizontal, 16);
export const SlidersIcon = wrap(SlidersHorizontal, 12);
export const TerminalIcon = wrap(Terminal, 14);
export const SquareTerminalIcon = wrap(SquareTerminal, 14);
export const OctagonXIcon = wrap(OctagonX, 12);
export const UnplugIcon = wrap(Unplug, 14);
export const ZapIcon = wrap(Zap, 14);
export const BotIcon = wrap(Bot, 16);
export const FlaskIcon = wrap(FlaskConical, 16);
export const FlagIcon = wrap(Milestone, 16);
export const BriefcaseIcon = wrap(Briefcase, 16);
export const KeyboardIcon = wrap(Keyboard, 14);
export const ExternalLinkIcon = wrap(ExternalLink, 14);
export const DownloadIcon = wrap(Download, 14);
export const WrenchIcon = wrap(Wrench, 20);
export const PaperclipIcon = wrap(Paperclip, 14);
export const FolderSearchIcon = wrap(FolderSearch, 20);
export const LightbulbIcon = wrap(Lightbulb, 20);
export const ClockIcon = wrap(Clock3, 14);
export const MessagePlusIcon = wrap(MessageSquarePlus, 14);

export function ChevronIcon({ color, size = 12, down, strokeWidth = 2 }: IconProps) {
  const Icon = down ? ChevronDown : ChevronRight;
  return <Icon color={color} size={size} strokeWidth={strokeWidth} aria-hidden />;
}

/** Both side panels in one glyph — same composition as the native icons.tsx. */
export function PanelsToggleIcon({
  color,
  size = 14,
  collapsed = false,
}: IconProps & { collapsed?: boolean }) {
  const half = size * 0.22;
  const thick = Math.max(3, size * 0.3);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
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
    </View>
  );
}
