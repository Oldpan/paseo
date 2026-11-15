import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { isWeb } from "@/constants/platform";
import { useAddHost } from "@/hosts/add-host";
import { readInitialDaemonConnectionHint, useHostMutations } from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";
import { parseConnectionUri } from "@/utils/daemon-endpoints";
import { Chip } from "./ChatChrome";
import { PavraField, PavraInput, FormFrame } from "./FormChrome";
import { ResourceChoice } from "./ResourceChoice";
import { text as type } from "./theme";
import { useTheme } from "./ThemeProvider";

function resolveDefaultEndpoint(): { endpoint: string; useTls: boolean } {
  const hint = readInitialDaemonConnectionHint();
  if (hint?.listen) {
    return { endpoint: hint.listen, useTls: Boolean(hint.useTls) };
  }
  if (isWeb && typeof window !== "undefined" && window.location?.host) {
    const useTls = window.location.protocol === "https:";
    const rawHost = window.location.host;
    const hasPort = rawHost.includes(":");
    const defaultPort = useTls ? "443" : "80";
    return {
      endpoint: hasPort ? rawHost : `${rawHost}:${defaultPort}`,
      useTls,
    };
  }
  return { endpoint: "localhost:6778", useTls: false };
}

function isPairingOfferLink(value: string): boolean {
  return (
    value.includes("#offer=") ||
    value.includes("#connect=") ||
    value.startsWith("relay://") ||
    /^paseo:\/\/.*(?:#offer=|#connect=|[?&]offer=)/i.test(value) ||
    /^pavra:\/\/.*(?:#offer=|#connect=|[?&]offer=)/i.test(value)
  );
}

export function CoordinatorPickerModal({
  hosts,
  onSelect,
  onClose,
}: {
  hosts: readonly HostProfile[];
  onSelect(serverId: string): void;
  onClose(): void;
}) {
  const { palette: t } = useTheme();
  const { probeAndUpsertDirectConnection, beginLinkPairing } = useHostMutations();
  const defaultTarget = useMemo(resolveDefaultEndpoint, []);
  const [endpoint, setEndpoint] = useState(defaultTarget.endpoint);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConnectForm, setShowConnectForm] = useState(hosts.length === 0);

  const openAddHost = useAddHost({
    onAdded: (serverId) => {
      onSelect(serverId);
      onClose();
    },
  });

  const openPairLink = useAddHost({
    method: "link",
    onAdded: (serverId) => {
      onSelect(serverId);
      onClose();
    },
  });

  const handleConnect = useCallback(async () => {
    const trimmed = endpoint.trim();
    if (!trimmed) {
      setError("Enter a host address or pairing link (for example 192.168.0.149:6778).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (isPairingOfferLink(trimmed)) {
        const pairing = beginLinkPairing();
        const result = await pairing.submit(trimmed, password || undefined);
        if (result.status === "cancelled") return;
        onSelect(result.serverId);
        onClose();
        return;
      }
      if (trimmed.startsWith("tcp://")) {
        const parsed = parseConnectionUri(trimmed);
        const hostPart = parsed.isIpv6
          ? `[${parsed.host}]:${parsed.port}`
          : `${parsed.host}:${parsed.port}`;
        const resolvedPassword = password || parsed.password;
        const result = await probeAndUpsertDirectConnection({
          endpoint: hostPart,
          useTls: parsed.useTls,
          ...(resolvedPassword ? { password: resolvedPassword } : {}),
        });
        onSelect(result.serverId);
        onClose();
        return;
      }
      const useTls =
        trimmed.startsWith("https://") ||
        trimmed.endsWith(":443") ||
        (trimmed === defaultTarget.endpoint && defaultTarget.useTls);
      const cleanEndpoint = trimmed.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      const result = await probeAndUpsertDirectConnection({
        endpoint: cleanEndpoint,
        useTls,
        ...(password ? { password } : {}),
      });
      onSelect(result.serverId);
      onClose();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not connect to host. Check the address and daemon password.",
      );
    } finally {
      setBusy(false);
    }
  }, [
    beginLinkPairing,
    defaultTarget,
    endpoint,
    onClose,
    onSelect,
    password,
    probeAndUpsertDirectConnection,
  ]);

  return (
    <FormFrame title="Chat coordinator" onClose={onClose}>
      <Text style={type(t.textPrimary, 12)}>
        Choose the host that stores Chat. Switching Studio never changes this choice.
      </Text>
      {hosts.map((host) => (
        <ResourceChoice
          key={host.serverId}
          label={host.label}
          onPress={() => {
            onSelect(host.serverId);
            onClose();
          }}
        />
      ))}
      {hosts.length === 0 || showConnectForm ? (
        <View
          style={{
            gap: 10,
            paddingTop: hosts.length > 0 ? 8 : 4,
            borderTopWidth: hosts.length > 0 ? 1 : 0,
            borderColor: t.retroBorder,
          }}
        >
          <PavraField label="Host address or pairing link">
            <PavraInput
              accessibilityLabel="Host address"
              initialValue={endpoint}
              onChangeText={setEndpoint}
              placeholder="192.168.0.149:6778 or https://app.paseo.sh/#offer=..."
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
            />
          </PavraField>
          <PavraField label="Daemon password (if enabled)">
            <PavraInput
              accessibilityLabel="Daemon password"
              initialValue={password}
              onChangeText={setPassword}
              placeholder="Enter password…"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              onSubmitEditing={() => {
                void handleConnect();
              }}
            />
          </PavraField>
          {error ? (
            <Text style={type(t.destructive, 12)} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 2 }}>
            <Chip
              onPress={() => {
                void handleConnect();
              }}
              disabled={busy}
              accent
            >
              {busy ? "Connecting…" : "Connect coordinator"}
            </Chip>
            <Chip onPress={openAddHost} disabled={busy}>
              Add / Pair host
            </Chip>
            <Chip onPress={openPairLink} disabled={busy}>
              Paste pairing link
            </Chip>
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 4 }}>
          <Chip onPress={openAddHost} accent>
            Add / Pair host
          </Chip>
          <Chip onPress={openPairLink}>Paste pairing link</Chip>
          <Chip onPress={() => setShowConnectForm(true)}>+ Direct host</Chip>
        </View>
      )}
    </FormFrame>
  );
}
