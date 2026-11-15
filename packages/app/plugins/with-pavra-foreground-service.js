const { withAndroidManifest } = require("expo/config-plugins");

const KEEP_ALIVE_PERMISSIONS = [
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.REQUEST_INSTALL_PACKAGES",
];

const KEEP_ALIVE_SERVICE_NAME = "expo.modules.pavrakeepalive.PavraKeepaliveService";

function configurePavraForegroundServiceManifest(manifest) {
  const permissions = manifest["uses-permission"] ?? [];
  for (const name of KEEP_ALIVE_PERMISSIONS) {
    const exists = permissions.some((entry) => entry.$?.["android:name"] === name);
    if (!exists) {
      permissions.push({ $: { "android:name": name } });
    }
  }
  manifest["uses-permission"] = permissions;

  const application = manifest.application?.[0];
  if (!application) {
    throw new Error(
      "Could not register PavraKeepaliveService without an application manifest entry",
    );
  }

  const services = application.service ?? [];
  const existingService = services.find(
    (service) => service.$?.["android:name"] === KEEP_ALIVE_SERVICE_NAME,
  );
  const serviceAttributes = {
    "android:name": KEEP_ALIVE_SERVICE_NAME,
    "android:enabled": "true",
    "android:exported": "false",
    "android:foregroundServiceType": "dataSync",
  };
  if (existingService) {
    existingService.$ = { ...existingService.$, ...serviceAttributes };
  } else {
    services.push({ $: serviceAttributes });
  }
  application.service = services;

  return manifest;
}

function withPavraForegroundService(config) {
  return withAndroidManifest(config, (modConfig) => {
    configurePavraForegroundServiceManifest(modConfig.modResults.manifest);
    return modConfig;
  });
}

module.exports = withPavraForegroundService;
module.exports.configurePavraForegroundServiceManifest = configurePavraForegroundServiceManifest;
