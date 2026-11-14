export interface OptionSelectItem {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface OptionSelectProps {
  label: string;
  value: string;
  options: OptionSelectItem[];
  onSelect: (value: string) => void;
  disabled?: boolean;
  testID?: string;
  emptyLabel?: string;
}
