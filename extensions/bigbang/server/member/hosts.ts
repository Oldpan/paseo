import type { PaseoApi } from "@getpaseo/client";
import { PLUGIN_ID } from "../../shared/member";
import type { HostDirectoryPort } from "./link";

/** The coordinator's saved hosts, reached over the daemon's own host links. */
export function hostDirectory(api: PaseoApi): HostDirectoryPort & { dispose(): Promise<void> } {
  const clients = new Map<string, Promise<PaseoApi>>();
  let self: Promise<string> | null = null;
  function client(serverId: string): Promise<PaseoApi> {
    let existing = clients.get(serverId);
    if (!existing) {
      existing = api.hosts.client(serverId);
      clients.set(serverId, existing);
      existing.catch(() => clients.delete(serverId));
    }
    return existing;
  }
  return {
    self() {
      self ??= api.hosts.list().then((directory) => directory.self.serverId);
      self.catch(() => (self = null));
      return self;
    },
    async list() {
      const directory = await api.hosts.list();
      return directory.hosts.flatMap((host) =>
        host.serverId && host.enabled
          ? [{ serverId: host.serverId, online: host.status === "online" }]
          : [],
      );
    },
    async invoke(serverId, method, input) {
      return (await client(serverId)).plugins.invoke(PLUGIN_ID, method, input);
    },
    async dispose() {
      const settled = await Promise.allSettled(clients.values());
      clients.clear();
      await Promise.allSettled(
        settled.flatMap((entry) => (entry.status === "fulfilled" ? [entry.value.dispose()] : [])),
      );
    },
  };
}
