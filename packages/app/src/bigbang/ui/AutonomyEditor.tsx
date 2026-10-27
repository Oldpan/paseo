// The assistant form's "Allow starting tasks" toggle and its target rows. The value is the JSON of
// `Autonomy` (see ../autonomy); the editor owns its rows after mount, like the form's text inputs.
import { useCallback, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { parseAutonomy, serializeAutonomy, type Autonomy, type AutonomyTarget } from "../autonomy";
import { Chip } from "./ChatChrome";
import { BigbangField, BigbangInput } from "./FormChrome";
import { OptionSelect } from "./OptionSelect";
import { ctrlShadow, text as type } from "./theme";
import { useTheme } from "./ThemeProvider";

export interface HostOption {
  value: string;
  label: string;
}
interface Row extends AutonomyTarget {
  key: string;
}
const ISOLATION_OPTIONS = [
  { value: "worktree", label: "New Git worktree" },
  { value: "directory", label: "Existing directory" },
];

export function AutonomyEditor({
  value,
  hosts,
  defaultHost,
  disabled,
  onChange,
}: {
  value: string;
  hosts: HostOption[];
  defaultHost: string;
  disabled: boolean;
  onChange(value: string): void;
}) {
  const { palette: t, name } = useTheme();
  const [enabled, setEnabled] = useState(() => parseAutonomy(value).enabled);
  const [rows, setRows] = useState<Row[]>(() =>
    parseAutonomy(value).targets.map((target) => ({
      key: randomUUID(),
      serverId: target.serverId,
      directory: target.directory,
      isolation: target.isolation,
    })),
  );
  // The latest rows for handlers that fire between renders (typing, then pressing a chip).
  const latest = useRef({ enabled, rows });
  const publish = useCallback(
    (next: { enabled: boolean; rows: Row[] }) => {
      latest.current = next;
      setEnabled(next.enabled);
      setRows(next.rows);
      const autonomy: Autonomy = {
        enabled: next.enabled,
        targets: next.rows.map(({ key: _key, ...target }) => target),
      };
      onChange(serializeAutonomy(autonomy));
    },
    [onChange],
  );
  const toggle = () => publish({ ...latest.current, enabled: !latest.current.enabled });
  const add = () =>
    publish({
      ...latest.current,
      rows: [
        ...latest.current.rows,
        {
          key: randomUUID(),
          serverId: hosts.some((host) => host.value === defaultHost)
            ? defaultHost
            : (hosts[0]?.value ?? ""),
          directory: "",
          isolation: "worktree",
        },
      ],
    });
  const update = (key: string, patch: Partial<AutonomyTarget>) =>
    publish({
      ...latest.current,
      rows: latest.current.rows.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    });
  const remove = (key: string) =>
    publish({ ...latest.current, rows: latest.current.rows.filter((row) => row.key !== key) });
  return (
    <View testID="autonomy-editor" style={{ gap: 8 }}>
      <Pressable
        role="switch"
        accessibilityLabel="Allow starting tasks"
        accessibilityState={{ checked: enabled, disabled }}
        disabled={disabled}
        onPress={toggle}
        style={[
          {
            minHeight: 36,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: enabled ? t.brandAccentMuted : t.surfaceElevated,
            paddingHorizontal: 10,
            opacity: disabled ? 0.5 : 1,
          },
          ctrlShadow(t, name),
        ]}
      >
        <View
          style={{
            width: 14,
            height: 14,
            borderRadius: 4,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: enabled ? t.brandAccent : t.surfacePrimary,
          }}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={type(t.textPrimary, 12, { fontWeight: "600" })}>Allow starting tasks</Text>
          <Text style={type(t.textMuted, 10)}>
            The assistant may start tasks on its own, only in the targets below.
          </Text>
        </View>
        <Text style={type(t.textSecondary, 11, { fontWeight: "700" })}>
          {enabled ? "On" : "Off"}
        </Text>
      </Pressable>
      {rows.map((row, index) => (
        <View
          key={row.key}
          testID={`autonomy-target-${index + 1}`}
          style={{
            gap: 8,
            padding: 10,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: t.retroBorderLight,
            backgroundColor: t.surfaceSecondary,
          }}
        >
          <BigbangField label={`Task target ${index + 1}: machine`}>
            <OptionSelect
              label={`Task target ${index + 1} machine`}
              value={row.serverId}
              options={hosts}
              onSelect={(serverId) => update(row.key, { serverId })}
              emptyLabel="Choose…"
              disabled={disabled}
            />
          </BigbangField>
          <BigbangField label="Project directory on that machine">
            <BigbangInput
              accessibilityLabel={`Task target ${index + 1} directory`}
              initialValue={row.directory}
              onChangeText={(directory) => update(row.key, { directory })}
              editable={!disabled}
            />
          </BigbangField>
          <BigbangField label="Workspace">
            <OptionSelect
              label={`Task target ${index + 1} workspace`}
              value={row.isolation}
              options={ISOLATION_OPTIONS}
              onSelect={(isolation) =>
                update(row.key, { isolation: isolation === "directory" ? "directory" : "worktree" })
              }
              disabled={disabled}
            />
          </BigbangField>
          <View style={{ flexDirection: "row" }}>
            <Chip
              onPress={() => remove(row.key)}
              disabled={disabled}
              label={`Remove task target ${index + 1}`}
            >
              Remove target
            </Chip>
          </View>
        </View>
      ))}
      <View style={{ flexDirection: "row" }}>
        <Chip onPress={add} disabled={disabled || hosts.length === 0} label="Add task target">
          Add target
        </Chip>
      </View>
    </View>
  );
}
