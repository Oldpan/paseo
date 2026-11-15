import Constants from "expo-constants";
import { IS_PAVRA } from "@/pavra/build";
import pavraVersion from "@/pavra/version.json";
import appPackage from "../../package.json";

function toVersionOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed;
}

export function resolveAppVersion(): string | null {
  if (IS_PAVRA) {
    const pavraPkgVersion = toVersionOrNull(pavraVersion?.version);
    if (pavraPkgVersion) {
      return pavraPkgVersion;
    }
  }

  const packageVersion = toVersionOrNull(appPackage?.version);
  if (packageVersion) {
    return packageVersion;
  }

  const expoVersion = toVersionOrNull(Constants.expoConfig?.version);
  if (expoVersion) {
    return expoVersion;
  }

  const manifestVersion = toVersionOrNull(
    (Constants as unknown as { manifest?: { version?: unknown } }).manifest?.version,
  );
  if (manifestVersion) {
    return manifestVersion;
  }

  return null;
}
