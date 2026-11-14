import type { PixelColGrow } from "../panel-resize";

export interface ColResizeHandleProps {
  testID?: string;
  accessibilityLabel?: string;
  grow: PixelColGrow;
  width: number;
  minWidth: number;
  maxWidth: number;
  defaultWidth?: number;
  collapseBelow?: number;
  onCollapse?: () => void;
  onWidthChange: (width: number) => void;
  onDragging?: (dragging: boolean) => void;
  ruleWidth?: 1 | 2;
  ruleColor?: string;
}
