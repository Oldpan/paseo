import { useCallback, useImperativeHandle, useRef } from "react";
import type { DOMProps } from "expo/dom";
import type {
  TerminalEmulatorProps,
  TerminalEmulatorHandle,
} from "@/components/terminal-emulator-contract";
import DomTerminal from "@/components/terminal-emulator-dom";
import { openExternalUrl } from "@/utils/open-external-url";
import { decodeTerminalBytes, type EncodedTerminalFile, encodeTerminalBytes } from "./bridge";

interface TerminalDomHandle extends TerminalEmulatorHandle {
  writeEncodedOutput(streamKey: string, data: string): void;
  restoreEncodedOutput(streamKey: string, data: string): void;
  readSelection(): Promise<string>;
  findSearch(query: string, direction?: string): void;
  findClear(): void;
  findSize(width: number, height: number): void;
}
const DOM: DOMProps = {
  style: { flex: 1 },
  containerStyle: { flex: 1 },
  scrollEnabled: false,
  bounces: false,
};

// Bigbang's native terminal architecture: the authenticated stream stays in RN and a retained
// local DOM surface owns xterm/input. The stream controller and PTY remain owned by Paseo.
export function BigbangTerminalEmulator({
  ref,
  onInput,
  onFilePaste,
  ...props
}: TerminalEmulatorProps) {
  const latest = useRef({ streamKey: props.streamKey, onInput, onFilePaste });
  latest.current = { streamKey: props.streamKey, onInput, onFilePaste };
  const dom = useRef<TerminalDomHandle>(null);
  const writeOutput = useCallback(
    (data: Uint8Array) =>
      dom.current?.writeEncodedOutput(props.streamKey, encodeTerminalBytes(data)),
    [props.streamKey],
  );
  const restoreOutput = useCallback(
    (data: Uint8Array) =>
      dom.current?.restoreEncodedOutput(props.streamKey, encodeTerminalBytes(data)),
    [props.streamKey],
  );
  useImperativeHandle(
    ref,
    () => ({
      writeOutput,
      restoreOutput,
      find: {
        search: (query, direction) => dom.current?.findSearch(query, direction),
        clear: () => dom.current?.findClear(),
        setWidgetSize: ({ width, height }) => dom.current?.findSize(width, height),
      },
      renderSnapshot: (state) => dom.current?.renderSnapshot(state),
      paste: (text) => dom.current?.paste(text),
      copySelection: async (clipboard) => {
        const text = (await dom.current?.readSelection()) ?? "";
        if (text) await clipboard.writeText(text);
        return text;
      },
      clear: () => dom.current?.clear(),
      claimSize: () => dom.current?.claimSize(),
      showKeyboard: () => dom.current?.showKeyboard(),
      blur: () => dom.current?.blur(),
    }),
    [restoreOutput, writeOutput],
  );
  const input = useCallback(async (streamKey: string, data: string) => {
    if (streamKey === latest.current.streamKey) await latest.current.onInput?.(data);
  }, []);
  const filePaste = useCallback(async (message: EncodedTerminalFile) => {
    if (message.streamKey !== latest.current.streamKey) return;
    if ("error" in message) latest.current.onFilePaste?.(Promise.reject(new Error(message.error)));
    else
      latest.current.onFilePaste?.(
        Promise.resolve(
          message.file
            ? {
                fileName: message.file.fileName,
                mimeType: message.file.mimeType,
                bytes: decodeTerminalBytes(message.file.base64),
              }
            : null,
        ),
      );
  }, []);
  return (
    <DomTerminal
      {...props}
      ref={dom}
      dom={DOM}
      onScopedInput={input}
      onEncodedFilePaste={filePaste}
      onOpenExternalUrl={openExternalUrl}
    />
  );
}
