import { Text, View } from "react-native";
import { useHosts } from "@/runtime/host-runtime";
import { usePavraData } from "../data";
import { resolveDefaultCoordinatorId } from "../model";
import {
  formatRoutineCadence,
  formatRoutineOutcome,
  routineKindLabel,
  routineTargetLabel,
  useAssistantRoutines,
} from "../routines";
import { usePavraView } from "../store";
import { Chip } from "./ChatChrome";
import { text as type } from "./theme";
import { useTheme } from "./ThemeProvider";

export function RoutinesSection() {
  const { palette: t } = useTheme();
  const hosts = useHosts();
  const savedCoordinatorId = usePavraView((state) => state.coordinatorId);
  const coordinatorId = resolveDefaultCoordinatorId(savedCoordinatorId, hosts);
  const data = usePavraData(coordinatorId);
  const routines = useAssistantRoutines(data);

  if (routines.routines.length === 0 && !routines.error) return null;

  return (
    <View
      testID="pavra-schedules-routines"
      style={{
        paddingHorizontal: 20,
        paddingVertical: 14,
        gap: 10,
        borderBottomWidth: 2,
        borderBottomColor: t.black,
        backgroundColor: t.surfacePrimary,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <Text style={type(t.textPrimary, 14, { fontWeight: "700" })}>
          Assistant Routines & Reminders
        </Text>
        <Text style={type(t.textMuted, 11)}>{`${routines.routines.length} configured`}</Text>
      </View>
      {routines.error ? (
        <Text accessibilityRole="alert" style={type(t.destructive, 12)}>
          {routines.error}
        </Text>
      ) : null}
      {routines.routines.map((routine) => {
        const target = routineTargetLabel(routine, data.state.assistants, data.state.conversations);
        const lastRun = routine.runs.at(-1);
        const busy = routines.busyId === routine.id;
        return (
          <View
            key={routine.id}
            testID={`schedule-routine-${routine.id}`}
            style={{
              borderWidth: 1,
              borderColor: t.retroBorder,
              borderRadius: 12,
              backgroundColor: t.surfaceSecondary,
              padding: 12,
              gap: 6,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 6,
              }}
            >
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}
              >
                <Text style={type(t.textPrimary, 13, { fontWeight: "700" })}>{routine.name}</Text>
                <Text style={type(t.textSecondary, 11, { fontWeight: "600" })}>{target}</Text>
              </View>
              <Text style={type(t.textMuted, 11, { fontWeight: "600" })}>
                {`${routineKindLabel(routine)} · ${routine.status} · ${formatRoutineCadence(routine.cadence)}`}
              </Text>
            </View>
            <Text
              style={type(t.textMuted, 11)}
            >{`Last run: ${formatRoutineOutcome(lastRun)}`}</Text>
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              <Chip
                label={`Run ${routine.name} now`}
                onPress={() => void routines.runOnce(routine.id)}
                disabled={busy}
              >
                Run now
              </Chip>
              {routine.status === "active" ? (
                <Chip
                  label={`Pause ${routine.name}`}
                  onPress={() => void routines.pause(routine.id)}
                  disabled={busy}
                >
                  Pause
                </Chip>
              ) : (
                <Chip
                  label={`Resume ${routine.name}`}
                  onPress={() => void routines.resume(routine.id)}
                  disabled={busy}
                >
                  Resume
                </Chip>
              )}
              <Chip
                label={`Delete ${routine.name}`}
                onPress={() => void routines.remove(routine.id)}
                disabled={busy}
              >
                Delete
              </Chip>
            </View>
          </View>
        );
      })}
    </View>
  );
}
