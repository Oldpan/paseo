import { Redirect } from "expo-router";
import { IS_PAVRA } from "@/pavra/build";
import { WelcomeScreen } from "@/components/welcome-screen";

export default function WelcomeRoute() {
  if (IS_PAVRA) return <Redirect href="/pavra" />;
  return <WelcomeScreen />;
}
