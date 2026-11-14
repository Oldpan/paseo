import { setStringAsync } from "expo-clipboard";
export async function copyText(value: string): Promise<"copied" | "failed"> {
  try {
    await setStringAsync(value);
    return "copied";
  } catch {
    return "failed";
  }
}
