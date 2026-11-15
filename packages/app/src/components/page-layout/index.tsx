import { useMemo, type ReactNode } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { BackHeader } from "@/components/headers/back-header";
import { MenuHeader } from "@/components/headers/menu-header";
import { useIsCompactFormFactor } from "@/constants/layout";
import { IS_PAVRA } from "@/pavra/build";
import { SPACING } from "@/styles/theme";

const PageScrollView = Platform.OS === "android" ? KeyboardAwareScrollView : ScrollView;

interface PageLayoutProps {
  title?: string;
  /** Compact back button. Defaults to navigating back. */
  onBack?: () => void;
  testID?: string;
  titleTestID?: string;
  /** Controls for the whole page: right of the title on desktop, in the back header on compact. */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * A full-width page with a centered content column. On desktop the title is a
 * document heading inside the page and the header only keeps the titlebar drag
 * region and window controls; on compact the title moves into a back header.
 */
export function PageLayout({
  title,
  onBack,
  testID,
  titleTestID,
  actions,
  children,
}: PageLayoutProps) {
  const isCompact = useIsCompactFormFactor();
  const insets = useSafeAreaInsets();
  const scrollContentStyle = useMemo(() => ({ paddingBottom: insets.bottom }), [insets.bottom]);
  const showTitle = !isCompact && title !== undefined;
  let header: ReactNode;
  if (isCompact) {
    header = <BackHeader title={title} onBack={onBack} rightContent={actions} />;
  } else if (IS_PAVRA && showTitle) {
    header = (
      <View style={styles.pavraTopHeader} testID={titleTestID}>
        <Text style={styles.pavraTopTitle} testID="page-title" numberOfLines={1}>
          {title}
        </Text>
        {actions}
      </View>
    );
  } else {
    header = <MenuHeader borderless />;
  }

  return (
    <View style={styles.container}>
      {header}
      <PageScrollView
        // Leave room for field borders and padding around the focused native input.
        {...(Platform.OS === "android" ? { bottomOffset: SPACING[4] } : {})}
        style={styles.scroll}
        contentContainerStyle={scrollContentStyle}
        testID={testID}
      >
        <View style={styles.content}>
          {showTitle && !IS_PAVRA ? (
            <View style={styles.titleRow} testID={titleTestID}>
              <Text style={styles.title} testID="page-title">
                {title}
              </Text>
              {actions}
            </View>
          ) : null}
          {children}
        </View>
      </PageScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  scroll: {
    flex: 1,
  },
  pavraTopHeader: {
    minHeight: 56,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    backgroundColor: theme.colors.surface0,
    borderBottomWidth: theme.chrome.headerRule.width,
    borderBottomColor: theme.chrome.headerRule.color,
  },
  pavraTopTitle: {
    fontSize: 16,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.foreground,
    flex: 1,
  },
  content: {
    padding: theme.spacing[4],
    paddingTop: IS_PAVRA ? theme.spacing[4] : theme.spacing[6],
    width: "100%",
    maxWidth: IS_PAVRA ? 680 : 720,
    alignSelf: "center",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[4],
    marginBottom: theme.spacing[6],
  },
  title: {
    // Line up with the section titles, which sit inset from their cards.
    marginLeft: theme.spacing[1],
    fontSize: theme.fontSize["4xl"],
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
}));
