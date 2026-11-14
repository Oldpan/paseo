import { Redirect } from "expo-router";
import { IS_BIGBANG } from "@/bigbang/build";
import { WelcomeScreen } from "@/components/welcome-screen";

export default function WelcomeRoute() {
  if (IS_BIGBANG) return <Redirect href="/bigbang" />;
  return <WelcomeScreen />;
}
