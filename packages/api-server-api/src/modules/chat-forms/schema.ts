import { z } from "zod";

import { ICON_NAMES } from "./icon-names.js";

export const A2UI_VERSION = "v1.0";

const RESERVED_KEY = /^@([^@]|$)/;

export const DataBinding = z.strictObject({ "@path": z.string() });

export const FunctionCall = z.strictObject({
  "@call": z.string().min(1),
  catalogId: z.string().optional(),
  args: z.record(z.string(), z.unknown()).optional(),
});

const PlainObject = z
  .record(z.string(), z.unknown())
  .refine(
    (value) => !Object.keys(value).some((key) => RESERVED_KEY.test(key)),
    {
      message: "Keys starting with a single @ are reserved for @path and @call",
    },
  );

const Dynamic = z.union([DataBinding, FunctionCall]);
const DynamicString = z.union([z.string(), Dynamic]);
const DynamicNumber = z.union([z.number(), Dynamic]);
const DynamicBoolean = z.union([z.boolean(), Dynamic]);
const DynamicStringList = z.union([z.array(z.string()), Dynamic]);
const DynamicValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  Dynamic,
  PlainObject,
]);

const ComponentId = z.string().min(1);
const ChildList = z.union([
  z.array(ComponentId),
  z.strictObject({ componentId: ComponentId, path: z.string().min(1) }),
]);
const Justify = z.enum([
  "start",
  "center",
  "end",
  "spaceBetween",
  "spaceAround",
  "spaceEvenly",
  "stretch",
]);
const Align = z.enum(["start", "center", "end", "stretch"]);

const Accessibility = z.strictObject({
  label: DynamicString.optional(),
  description: DynamicString.optional(),
  live: z.enum(["off", "polite", "assertive"]).optional(),
  hidden: DynamicBoolean.optional(),
});

const Extensions = z.record(z.string(), z.unknown());

const Common = {
  id: ComponentId,
  catalogId: z.string().optional(),
  accessibility: Accessibility.optional(),
  metadata: z.strictObject({ extensions: Extensions.optional() }).optional(),
  weight: z.number().optional(),
};

const CheckRule = z.strictObject({
  condition: Dynamic,
  message: z.string().optional(),
});

const Checkable = { checks: z.array(CheckRule).optional() };

const Action = z.union([
  z.strictObject({
    event: z.strictObject({
      name: z.string().min(1),
      userMessage: DynamicString.optional(),
      context: z.record(z.string(), DynamicValue).optional(),
    }),
  }),
  z.strictObject({ functionCall: FunctionCall }),
]);

const Text = z.strictObject({
  ...Common,
  component: z.literal("Text"),
  text: DynamicString,
  variant: z.enum(["caption", "body"]).optional(),
});

const Image = z.strictObject({
  ...Common,
  component: z.literal("Image"),
  url: DynamicString,
  description: DynamicString.optional(),
  fit: z.enum(["contain", "cover", "fill", "none", "scaleDown"]).optional(),
  variant: z
    .enum([
      "icon",
      "avatar",
      "smallFeature",
      "mediumFeature",
      "largeFeature",
      "header",
    ])
    .optional(),
});

const Icon = z.strictObject({
  ...Common,
  component: z.literal("Icon"),
  name: z.union([
    z.enum(ICON_NAMES),
    z.strictObject({ svgPath: DynamicString }),
    DataBinding,
  ]),
});

const Video = z.strictObject({
  ...Common,
  component: z.literal("Video"),
  url: DynamicString,
  posterUrl: DynamicString.optional(),
});

const AudioPlayer = z.strictObject({
  ...Common,
  component: z.literal("AudioPlayer"),
  url: DynamicString,
  description: DynamicString.optional(),
});

const Row = z.strictObject({
  ...Common,
  component: z.literal("Row"),
  children: ChildList,
  justify: Justify.optional(),
  align: Align.optional(),
});

const Column = z.strictObject({
  ...Common,
  component: z.literal("Column"),
  children: ChildList,
  justify: Justify.optional(),
  align: Align.optional(),
});

const List = z.strictObject({
  ...Common,
  component: z.literal("List"),
  children: ChildList,
  direction: z.enum(["vertical", "horizontal"]).optional(),
  align: Align.optional(),
});

const Card = z.strictObject({
  ...Common,
  component: z.literal("Card"),
  child: ComponentId,
});

const Tabs = z.strictObject({
  ...Common,
  component: z.literal("Tabs"),
  tabs: z
    .array(z.strictObject({ title: DynamicString, child: ComponentId }))
    .min(1),
});

const Modal = z.strictObject({
  ...Common,
  component: z.literal("Modal"),
  trigger: ComponentId,
  content: ComponentId,
});

const Divider = z.strictObject({
  ...Common,
  component: z.literal("Divider"),
  axis: z.enum(["horizontal", "vertical"]).optional(),
});

const Button = z.strictObject({
  ...Common,
  ...Checkable,
  component: z.literal("Button"),
  child: ComponentId,
  variant: z.enum(["default", "primary", "borderless"]).optional(),
  action: Action,
});

const TextField = z.strictObject({
  ...Common,
  ...Checkable,
  component: z.literal("TextField"),
  label: DynamicString,
  value: DynamicString.optional(),
  placeholder: DynamicString.optional(),
  variant: z.enum(["longText", "number", "shortText", "obscured"]).optional(),
});

const CheckBox = z.strictObject({
  ...Common,
  ...Checkable,
  component: z.literal("CheckBox"),
  label: DynamicString,
  value: DynamicBoolean,
});

const ChoicePicker = z.strictObject({
  ...Common,
  ...Checkable,
  component: z.literal("ChoicePicker"),
  label: DynamicString.optional(),
  variant: z.enum(["multipleSelection", "mutuallyExclusive"]).optional(),
  options: z.array(z.strictObject({ label: DynamicString, value: z.string() })),
  value: DynamicStringList,
  displayStyle: z.enum(["checkbox", "chips"]).optional(),
  filterable: z.boolean().optional(),
});

const Slider = z.strictObject({
  ...Common,
  ...Checkable,
  component: z.literal("Slider"),
  label: DynamicString.optional(),
  min: z.number().optional(),
  max: z.number(),
  value: DynamicNumber,
  steps: z.number().int().min(1).optional(),
});

const DateTimeInput = z.strictObject({
  ...Common,
  ...Checkable,
  component: z.literal("DateTimeInput"),
  label: DynamicString.optional(),
  value: DynamicString,
  enableDate: z.boolean().optional(),
  enableTime: z.boolean().optional(),
  min: DynamicString.optional(),
  max: DynamicString.optional(),
});

const Tone = z.enum(["neutral", "info", "success", "warning", "danger"]);
const DynamicTone = z.union([Tone, Dynamic]);

const Callout = z.strictObject({
  ...Common,
  component: z.literal("Callout"),
  title: DynamicString.optional(),
  text: DynamicString,
  tone: DynamicTone.optional(),
});

const Badge = z.strictObject({
  ...Common,
  component: z.literal("Badge"),
  text: DynamicString,
  tone: DynamicTone.optional(),
});

const CodeBlock = z.strictObject({
  ...Common,
  component: z.literal("CodeBlock"),
  code: DynamicString,
  language: z.string().optional(),
});

const Diff = z.strictObject({
  ...Common,
  component: z.literal("Diff"),
  title: DynamicString.optional(),
  diff: DynamicString,
});

const Switch = z.strictObject({
  ...Common,
  ...Checkable,
  component: z.literal("Switch"),
  label: DynamicString,
  description: DynamicString.optional(),
  value: DynamicBoolean,
});

export const A2uiComponent = z.discriminatedUnion("component", [
  Text,
  Image,
  Icon,
  Video,
  AudioPlayer,
  Row,
  Column,
  List,
  Card,
  Tabs,
  Modal,
  Divider,
  Button,
  TextField,
  CheckBox,
  ChoicePicker,
  Slider,
  DateTimeInput,
  Callout,
  Badge,
  CodeBlock,
  Diff,
  Switch,
]);

const Version = z.literal(A2UI_VERSION);
const SurfaceId = z.string().min(1);

const CreateSurfaceMessage = z.strictObject({
  version: Version,
  createSurface: z.strictObject({
    surfaceId: SurfaceId,
    catalogId: z.string().optional(),
    sendDataModel: z.boolean().optional(),
    components: z.array(z.unknown()).min(1).optional(),
    dataModel: z.record(z.string(), z.unknown()).optional(),
    metadata: z.strictObject({ extensions: Extensions.optional() }).optional(),
  }),
});

const UpdateComponentsMessage = z.strictObject({
  version: Version,
  updateComponents: z.strictObject({
    surfaceId: SurfaceId,
    components: z.array(z.unknown()).min(1),
  }),
});

const UpdateDataModelMessage = z.strictObject({
  version: Version,
  updateDataModel: z.strictObject({
    surfaceId: SurfaceId,
    path: z.string().optional(),
    value: z.unknown().refine((value) => value !== undefined, {
      message: "value is required; use null to delete",
    }),
  }),
});

const DeleteSurfaceMessage = z.strictObject({
  version: Version,
  deleteSurface: z.strictObject({ surfaceId: SurfaceId }),
});

const CallRendererFunctionMessage = z.strictObject({
  version: Version,
  callRendererFunction: z.strictObject({
    functionCallId: z.string().min(1),
    callFunction: FunctionCall,
  }),
});

const AgentFunctionResponseMessage = z.strictObject({
  version: Version,
  agentFunctionResponse: z.strictObject({
    functionCallId: z.string().min(1),
    value: z.unknown().optional(),
    error: z.strictObject({ code: z.string(), message: z.string() }).optional(),
  }),
});

export const ChatExtension = z.strictObject({
  lockComposer: z.boolean().optional(),
});

export const MESSAGE_SCHEMAS = {
  createSurface: CreateSurfaceMessage,
  updateComponents: UpdateComponentsMessage,
  updateDataModel: UpdateDataModelMessage,
  deleteSurface: DeleteSurfaceMessage,
  callRendererFunction: CallRendererFunctionMessage,
  agentFunctionResponse: AgentFunctionResponseMessage,
} as const;

export type A2uiMessageKind = keyof typeof MESSAGE_SCHEMAS;
export type A2uiMessage = z.infer<(typeof MESSAGE_SCHEMAS)[A2uiMessageKind]>;
export type DataBinding = z.infer<typeof DataBinding>;
export type FunctionCall = z.infer<typeof FunctionCall>;
export type DynamicString = z.infer<typeof DynamicString>;
export type DynamicNumber = z.infer<typeof DynamicNumber>;
export type DynamicBoolean = z.infer<typeof DynamicBoolean>;
export type DynamicStringList = z.infer<typeof DynamicStringList>;
export type DynamicValue = z.infer<typeof DynamicValue>;
export type ChildList = z.infer<typeof ChildList>;
export type Justify = z.infer<typeof Justify>;
export type Align = z.infer<typeof Align>;
export type Tone = z.infer<typeof Tone>;
export type DynamicTone = z.infer<typeof DynamicTone>;
export const TONES: readonly Tone[] = Tone.options;
export type Accessibility = z.infer<typeof Accessibility>;
export type CheckRule = z.infer<typeof CheckRule>;
export type Action = z.infer<typeof Action>;
export type A2uiComponent = z.infer<typeof A2uiComponent>;
export type ComponentType = A2uiComponent["component"];
export type TextComponent = z.infer<typeof Text>;
export type ImageComponent = z.infer<typeof Image>;
export type IconComponent = z.infer<typeof Icon>;
export type VideoComponent = z.infer<typeof Video>;
export type AudioPlayerComponent = z.infer<typeof AudioPlayer>;
export type LayoutComponent = z.infer<typeof Row> | z.infer<typeof Column>;
export type ListComponent = z.infer<typeof List>;
export type CardComponent = z.infer<typeof Card>;
export type TabsComponent = z.infer<typeof Tabs>;
export type ModalComponent = z.infer<typeof Modal>;
export type DividerComponent = z.infer<typeof Divider>;
export type ButtonComponent = z.infer<typeof Button>;
export type TextFieldComponent = z.infer<typeof TextField>;
export type CheckBoxComponent = z.infer<typeof CheckBox>;
export type ChoicePickerComponent = z.infer<typeof ChoicePicker>;
export type SliderComponent = z.infer<typeof Slider>;
export type DateTimeInputComponent = z.infer<typeof DateTimeInput>;
export type CalloutComponent = z.infer<typeof Callout>;
export type BadgeComponent = z.infer<typeof Badge>;
export type CodeBlockComponent = z.infer<typeof CodeBlock>;
export type DiffComponent = z.infer<typeof Diff>;
export type SwitchComponent = z.infer<typeof Switch>;
