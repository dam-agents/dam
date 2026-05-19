import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import {
  bracketMatching,
  indentOnInput,
  indentUnit,
} from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { useEffect, useRef } from "react";

function languageExtension(path: string): Extension | null {
  const filename = path.split("/").pop()?.toLowerCase() ?? "";
  const ext = filename.split(".").pop();
  switch (ext) {
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return javascript();
    case "ts":
    case "tsx":
      return javascript({ typescript: true });
    case "json":
    case "jsonl":
      return json();
    case "md":
    case "mdx":
      return markdown();
    case "yml":
    case "yaml":
      return yaml();
    default:
      return null;
  }
}

interface Props {
  value: string;
  path: string;
  onChange: (next: string) => void;
  onSave: () => void;
  readOnly?: boolean;
}

/** Thin CodeMirror 6 wrapper. Keeps the editor view alive across renders and
 *  mirrors the controlled `value` prop only when the caller's value diverges
 *  from the editor's (prevents cursor reset on every keystroke). */
export function CodeEditor({ value, path, onChange, onSave, readOnly }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const languageCompRef = useRef(new Compartment());
  const readOnlyCompRef = useRef(new Compartment());

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    if (!hostRef.current) return;
    const lang = languageExtension(path);
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        history(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        indentUnit.of("  "),
        EditorState.tabSize.of(2),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              onSaveRef.current();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        }),
        languageCompRef.current.of(lang ?? []),
        readOnlyCompRef.current.of(EditorState.readOnly.of(!!readOnly)),
        EditorView.theme({
          "&": { height: "100%", fontSize: "12px" },
          ".cm-scroller": {
            fontFamily: "var(--font-mono, ui-monospace, monospace)",
          },
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Editor is set up once per mounted instance; language + content are
    // reconciled by the effects below to avoid tearing down on each keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (view.state.doc.toString() !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const lang = languageExtension(path);
    view.dispatch({ effects: languageCompRef.current.reconfigure(lang ?? []) });
  }, [path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompRef.current.reconfigure(
        EditorState.readOnly.of(!!readOnly),
      ),
    });
  }, [readOnly]);

  return (
    <div
      ref={hostRef}
      className="h-full min-h-[200px] border border-border-light rounded overflow-hidden"
    />
  );
}
