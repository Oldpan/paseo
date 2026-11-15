import { startKeepalive, stopKeepalive } from "../../modules/pavra-keepalive";

export const PAVRA_KEEPALIVE_CHANNEL_ID = "pavra-keepalive";
export const PAVRA_KEEPALIVE_BODY = "Listening for assistant replies, tasks & reminders";

export interface KeepaliveInput {
  isPavra: boolean;
  platformOs: string;
  coordinatorId: string;
  connected: boolean;
  coordinatorLabel?: string;
}

export interface KeepaliveState {
  active: boolean;
  title: string;
  body: string;
}

export interface KeepaliveDriver {
  startKeepalive(title: string, body: string): void;
  stopKeepalive(): void;
}

export function resolveKeepaliveState(input: KeepaliveInput): KeepaliveState {
  const coordinatorId = input.coordinatorId.trim();
  if (!input.isPavra || input.platformOs !== "android" || !coordinatorId || !input.connected) {
    return {
      active: false,
      title: "",
      body: "",
    };
  }

  const label = input.coordinatorLabel?.trim() || coordinatorId;
  return {
    active: true,
    title: `Pavra · Connected to ${label}`,
    body: PAVRA_KEEPALIVE_BODY,
  };
}

export function createPavraKeepaliveController(
  driver: KeepaliveDriver = { startKeepalive, stopKeepalive },
) {
  let lastState: KeepaliveState = { active: false, title: "", body: "" };

  return {
    update(input: KeepaliveInput): KeepaliveState {
      const next = resolveKeepaliveState(input);
      if (next.active) {
        if (!lastState.active || lastState.title !== next.title || lastState.body !== next.body) {
          driver.startKeepalive(next.title, next.body);
        }
      } else if (lastState.active) {
        driver.stopKeepalive();
      }
      lastState = next;
      return next;
    },
    stop(): void {
      if (lastState.active) {
        lastState = { active: false, title: "", body: "" };
        driver.stopKeepalive();
      }
    },
  };
}
