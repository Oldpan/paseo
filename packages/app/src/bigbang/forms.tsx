import { type SelectFieldOption } from "@/components/ui/select-field";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import {
  BigbangField as Field,
  BigbangInput as FormTextInput,
  FormFrame,
  FormActions,
} from "./ui/FormChrome";
import { OptionSelect } from "./ui/OptionSelect";
import { Chip } from "./ui/ChatChrome";
import { AutonomyEditor, type HostOption } from "./ui/AutonomyEditor";
import { openBigbangForm } from "./form";
import type { Palette } from "./palette";

interface FormProps {
  title: string;
  fields: Array<{
    name: string;
    label: string;
    initial: string;
    multiline?: boolean;
    hidden?: boolean;
    options?: SelectFieldOption<string>[];
    modelHost?: string;
    /** Renders the assistant autonomy editor; its value is the JSON of `Autonomy`. */
    autonomy?: { hosts: HostOption[]; defaultHost: string };
  }>;
  palette: Palette;
  onSubmit(values: Record<string, string>): Promise<void>;
  onClose(): void;
}

export function BigbangForm({ title, fields, palette, onSubmit, onClose }: FormProps) {
  const [form] = useState(() =>
    openBigbangForm(
      Object.fromEntries(fields.map((field) => [field.name, field.initial])),
      onSubmit,
    ),
  );
  const snapshot = useSyncExternalStore(form.subscribe, form.getSnapshot, form.getSnapshot);
  const handlers = useMemo(
    () =>
      Object.fromEntries(
        fields.map((field) => [field.name, (text: string) => form.set(field.name, text)]),
      ),
    [fields, form],
  );
  const submit = useMemo(
    () => () => {
      void form.submit();
    },
    [form],
  );
  const textStyle = useMemo(() => ({ color: palette.textPrimary }), [palette.textPrimary]);
  const errorStyle = useMemo(() => ({ color: palette.destructive }), [palette.destructive]);
  return (
    <FormFrame title={title} onClose={onClose}>
      {fields
        .filter((field) => !field.hidden)
        .map((field) => (
          <FormInput
            key={
              field.name === "directory" ? `${field.name}:${snapshot.values.server}` : field.name
            }
            field={field}
            value={snapshot.values[field.name]}
            serverId={snapshot.values.server ?? field.modelHost ?? ""}
            onChange={handlers[field.name]}
            disabled={snapshot.status === "submitting"}
          />
        ))}
      {snapshot.error ? (
        <Text style={errorStyle} accessibilityRole="alert">
          {snapshot.error}
        </Text>
      ) : null}
      {snapshot.status === "saved" ? <Text style={textStyle}>Saved</Text> : null}
      <FormActions onSubmit={submit} onClose={onClose} busy={snapshot.status === "submitting"} />
    </FormFrame>
  );
}

type FieldDefinition = FormProps["fields"][number];
interface FormInputProps {
  field: FieldDefinition;
  value: string;
  serverId: string;
  onChange(value: string): void;
  disabled: boolean;
}
function FormInput(props: FormInputProps) {
  if (props.field.autonomy)
    return (
      <Field label={props.field.label}>
        <AutonomyEditor
          value={props.value}
          hosts={props.field.autonomy.hosts}
          defaultHost={props.field.autonomy.defaultHost}
          disabled={props.disabled}
          onChange={props.onChange}
        />
      </Field>
    );
  if (props.field.modelHost !== undefined) return <ModelInput {...props} />;
  if (props.field.options) return <ChoiceInput {...props} options={props.field.options} />;
  return (
    <Field label={props.field.label}>
      <FormTextInput
        accessibilityLabel={props.field.label}
        initialValue={props.value}
        onChangeText={props.onChange}
        multiline={props.field.multiline}
        editable={!props.disabled}
      />
    </Field>
  );
}
function ChoiceInput({
  field,
  value,
  onChange,
  disabled,
  options,
}: FormInputProps & { options: SelectFieldOption<string>[] }) {
  return (
    <Field label={field.label}>
      <OptionSelect
        label={field.label}
        value={value}
        options={options.map((option) => ({ value: option.value, label: option.label }))}
        onSelect={onChange}
        emptyLabel="Choose…"
        disabled={disabled}
      />
    </Field>
  );
}
function ModelInput(props: FormInputProps) {
  const models = useProvidersSnapshot(props.serverId);
  const options = useMemo(
    () =>
      (models.entries ?? []).flatMap((entry) =>
        (entry.models ?? [])
          .filter((model) => model.isSelectable !== false)
          .map((model) => ({
            id: `${entry.provider}/${model.id}`,
            value: `${entry.provider}/${model.id}`,
            label: `${entry.label ?? entry.provider} · ${model.label}`,
          })),
      ),
    [models.entries],
  );
  const refresh = useCallback(() => {
    models.refetchIfStale();
  }, [models]);
  return (
    <View>
      <ChoiceInput {...props} options={options} disabled={props.disabled || models.isLoading} />
      <Chip onPress={refresh}>Refresh models</Chip>
    </View>
  );
}
