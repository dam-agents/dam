import { match, P } from "ts-pattern";

import type { A2uiComponent as Component } from "../lib/schema.js";
import { A2uiAudioPlayer } from "./catalog/a2ui-audio-player.js";
import { A2uiBadge } from "./catalog/a2ui-badge.js";
import { A2uiButton } from "./catalog/a2ui-button.js";
import { A2uiCallout } from "./catalog/a2ui-callout.js";
import { A2uiCard } from "./catalog/a2ui-card.js";
import { A2uiCheckBox } from "./catalog/a2ui-check-box.js";
import { A2uiChoicePicker } from "./catalog/a2ui-choice-picker.js";
import { A2uiCodeBlock } from "./catalog/a2ui-code-block.js";
import { A2uiDateTimeInput } from "./catalog/a2ui-date-time-input.js";
import { A2uiDiff } from "./catalog/a2ui-diff.js";
import { A2uiDivider } from "./catalog/a2ui-divider.js";
import { A2uiIcon } from "./catalog/a2ui-icon.js";
import { A2uiImage } from "./catalog/a2ui-image.js";
import { A2uiLayout } from "./catalog/a2ui-layout.js";
import { A2uiList } from "./catalog/a2ui-list.js";
import { A2uiModal } from "./catalog/a2ui-modal.js";
import { A2uiSlider } from "./catalog/a2ui-slider.js";
import { A2uiSwitch } from "./catalog/a2ui-switch.js";
import { A2uiTabs } from "./catalog/a2ui-tabs.js";
import { A2uiText } from "./catalog/a2ui-text.js";
import { A2uiTextField } from "./catalog/a2ui-text-field.js";
import { A2uiVideo } from "./catalog/a2ui-video.js";

interface Props {
  component: Component;
  depth: number;
}

export function A2uiComponent({ component, depth }: Props) {
  return match(component)
    .with({ component: "Text" }, (c) => <A2uiText component={c} />)
    .with({ component: "Image" }, (c) => <A2uiImage component={c} />)
    .with({ component: "Icon" }, (c) => <A2uiIcon component={c} />)
    .with({ component: "Video" }, (c) => <A2uiVideo component={c} />)
    .with({ component: "AudioPlayer" }, (c) => (
      <A2uiAudioPlayer component={c} />
    ))
    .with({ component: P.union("Row", "Column") }, (c) => (
      <A2uiLayout component={c} depth={depth} />
    ))
    .with({ component: "List" }, (c) => (
      <A2uiList component={c} depth={depth} />
    ))
    .with({ component: "Card" }, (c) => (
      <A2uiCard component={c} depth={depth} />
    ))
    .with({ component: "Tabs" }, (c) => (
      <A2uiTabs component={c} depth={depth} />
    ))
    .with({ component: "Modal" }, (c) => (
      <A2uiModal component={c} depth={depth} />
    ))
    .with({ component: "Divider" }, (c) => <A2uiDivider component={c} />)
    .with({ component: "Button" }, (c) => (
      <A2uiButton component={c} depth={depth} />
    ))
    .with({ component: "TextField" }, (c) => <A2uiTextField component={c} />)
    .with({ component: "CheckBox" }, (c) => <A2uiCheckBox component={c} />)
    .with({ component: "ChoicePicker" }, (c) => (
      <A2uiChoicePicker component={c} />
    ))
    .with({ component: "Slider" }, (c) => <A2uiSlider component={c} />)
    .with({ component: "DateTimeInput" }, (c) => (
      <A2uiDateTimeInput component={c} />
    ))
    .with({ component: "Callout" }, (c) => <A2uiCallout component={c} />)
    .with({ component: "Badge" }, (c) => <A2uiBadge component={c} />)
    .with({ component: "CodeBlock" }, (c) => <A2uiCodeBlock component={c} />)
    .with({ component: "Diff" }, (c) => <A2uiDiff component={c} />)
    .with({ component: "Switch" }, (c) => <A2uiSwitch component={c} />)
    .exhaustive();
}
