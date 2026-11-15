import { describe, expect, it, vi } from "vitest";
import {
  PAVRA_KEEPALIVE_BODY,
  createPavraKeepaliveController,
  resolveKeepaliveState,
} from "./keepalive-service";

const {
  configurePavraForegroundServiceManifest,
} = require("../../plugins/with-pavra-foreground-service");

describe("resolveKeepaliveState", () => {
  it("activates on Android Pavra builds when connected to a coordinator", () => {
    expect(
      resolveKeepaliveState({
        isPavra: true,
        platformOs: "android",
        coordinatorId: "aitopatom-e2eb",
        connected: true,
        coordinatorLabel: "Spark",
      }),
    ).toEqual({
      active: true,
      title: "Pavra · Connected to Spark",
      body: PAVRA_KEEPALIVE_BODY,
    });
  });

  it("falls back to coordinatorId when coordinatorLabel is omitted or blank", () => {
    expect(
      resolveKeepaliveState({
        isPavra: true,
        platformOs: "android",
        coordinatorId: "  aitopatom-e2eb  ",
        connected: true,
        coordinatorLabel: "   ",
      }),
    ).toEqual({
      active: true,
      title: "Pavra · Connected to aitopatom-e2eb",
      body: PAVRA_KEEPALIVE_BODY,
    });
  });

  it("stays inactive on non-Pavra builds, non-Android platforms, disconnected state, or empty coordinatorId", () => {
    expect(
      resolveKeepaliveState({
        isPavra: false,
        platformOs: "android",
        coordinatorId: "aitopatom-e2eb",
        connected: true,
      }),
    ).toEqual({ active: false, title: "", body: "" });

    expect(
      resolveKeepaliveState({
        isPavra: true,
        platformOs: "ios",
        coordinatorId: "aitopatom-e2eb",
        connected: true,
      }),
    ).toEqual({ active: false, title: "", body: "" });

    expect(
      resolveKeepaliveState({
        isPavra: true,
        platformOs: "web",
        coordinatorId: "aitopatom-e2eb",
        connected: true,
      }),
    ).toEqual({ active: false, title: "", body: "" });

    expect(
      resolveKeepaliveState({
        isPavra: true,
        platformOs: "android",
        coordinatorId: "   ",
        connected: true,
      }),
    ).toEqual({ active: false, title: "", body: "" });

    expect(
      resolveKeepaliveState({
        isPavra: true,
        platformOs: "android",
        coordinatorId: "aitopatom-e2eb",
        connected: false,
      }),
    ).toEqual({ active: false, title: "", body: "" });
  });
});

describe("createPavraKeepaliveController", () => {
  it("starts, deduplicates, updates notification text, and stops on disconnect or clear", () => {
    const startKeepalive = vi.fn();
    const stopKeepalive = vi.fn();
    const controller = createPavraKeepaliveController({
      startKeepalive,
      stopKeepalive,
    });

    controller.update({
      isPavra: true,
      platformOs: "android",
      coordinatorId: "aitopatom-e2eb",
      connected: false,
      coordinatorLabel: "Spark",
    });
    expect(startKeepalive).not.toHaveBeenCalled();
    expect(stopKeepalive).not.toHaveBeenCalled();

    controller.update({
      isPavra: true,
      platformOs: "android",
      coordinatorId: "aitopatom-e2eb",
      connected: true,
      coordinatorLabel: "Spark",
    });
    expect(startKeepalive).toHaveBeenCalledTimes(1);
    expect(startKeepalive).toHaveBeenLastCalledWith(
      "Pavra · Connected to Spark",
      PAVRA_KEEPALIVE_BODY,
    );

    // Identical state does not re-trigger startKeepalive.
    controller.update({
      isPavra: true,
      platformOs: "android",
      coordinatorId: "aitopatom-e2eb",
      connected: true,
      coordinatorLabel: "Spark",
    });
    expect(startKeepalive).toHaveBeenCalledTimes(1);

    // Updating coordinator label updates ongoing notification text.
    controller.update({
      isPavra: true,
      platformOs: "android",
      coordinatorId: "aitopatom-e2eb",
      connected: true,
      coordinatorLabel: "Spark · DGX",
    });
    expect(startKeepalive).toHaveBeenCalledTimes(2);
    expect(startKeepalive).toHaveBeenLastCalledWith(
      "Pavra · Connected to Spark · DGX",
      PAVRA_KEEPALIVE_BODY,
    );

    // Disconnecting stops keepalive once.
    controller.update({
      isPavra: true,
      platformOs: "android",
      coordinatorId: "aitopatom-e2eb",
      connected: false,
      coordinatorLabel: "Spark · DGX",
    });
    expect(stopKeepalive).toHaveBeenCalledTimes(1);

    controller.update({
      isPavra: true,
      platformOs: "android",
      coordinatorId: "",
      connected: false,
    });
    expect(stopKeepalive).toHaveBeenCalledTimes(1);

    // Reconnecting and calling stop() stops keepalive on cleanup.
    controller.update({
      isPavra: true,
      platformOs: "android",
      coordinatorId: "mac-dev",
      connected: true,
      coordinatorLabel: "Mac",
    });
    expect(startKeepalive).toHaveBeenCalledTimes(3);

    controller.stop();
    expect(stopKeepalive).toHaveBeenCalledTimes(2);
  });
});

describe("withPavraForegroundService manifest configuration", () => {
  it("registers foreground service permissions and dataSync service idempotently", () => {
    const manifest = {
      "uses-permission": [{ $: { "android:name": "android.permission.INTERNET" } }],
      application: [{ $: { "android:name": ".MainApplication" }, service: [] }],
    };

    configurePavraForegroundServiceManifest(manifest);
    configurePavraForegroundServiceManifest(manifest);

    const permissionNames = manifest["uses-permission"].map((entry) => entry.$["android:name"]);
    expect(permissionNames).toEqual([
      "android.permission.INTERNET",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.REQUEST_INSTALL_PACKAGES",
    ]);

    expect(manifest.application[0].service).toEqual([
      {
        $: {
          "android:name": "expo.modules.pavrakeepalive.PavraKeepaliveService",
          "android:enabled": "true",
          "android:exported": "false",
          "android:foregroundServiceType": "dataSync",
        },
      },
    ]);
  });
});
