export interface PavraKeepaliveNativeModule {
  startKeepalive(title: string, body: string): boolean;
  stopKeepalive(): boolean;
}

interface ExpoModulesCore {
  requireOptionalNativeModule<T>(name: string): T | null;
}

let cachedModule: PavraKeepaliveNativeModule | null | undefined;

function getNativeKeepaliveModule(): PavraKeepaliveNativeModule | null {
  if (cachedModule !== undefined) {
    return cachedModule;
  }
  try {
    // Lazy-loaded so Node/Vitest unit tests do not evaluate expo-modules-core's __DEV__ globals at import time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const core = require("expo-modules-core") as ExpoModulesCore;
    cachedModule = core.requireOptionalNativeModule<PavraKeepaliveNativeModule>("PavraKeepalive");
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

export function startKeepalive(title: string, body: string): boolean {
  const nativeModule = getNativeKeepaliveModule();
  if (!nativeModule) return false;
  try {
    return Boolean(nativeModule.startKeepalive(title, body));
  } catch {
    return false;
  }
}

export function stopKeepalive(): boolean {
  const nativeModule = getNativeKeepaliveModule();
  if (!nativeModule) return false;
  try {
    return Boolean(nativeModule.stopKeepalive());
  } catch {
    return false;
  }
}
