/** The Pavra fork build, where Pavra's shell replaces Paseo's app chrome. */
export const IS_PAVRA =
  process.env.EXPO_PUBLIC_PAVRA === "true" || process.env.EXPO_PUBLIC_BIGBANG === "true";
