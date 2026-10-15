import { match, P } from "ts-pattern";
import type { z } from "zod";

import { A2UI_CHAT_EXTENSION_ID } from "./capabilities.js";
import { catalogFor, SUPPORTED_CATALOG_IDS } from "./catalogs.js";
import { deleteAt, getAt, setAt } from "./data-model.js";
import { MAX_DEPTH, MAX_RENDERED_NODES, MAX_TEMPLATE_ITEMS } from "./limits.js";
import { parsePartialJson } from "./partial-json.js";
import {
  A2UI_VERSION,
  type A2uiComponent,
  A2uiComponent as ComponentSchema,
  type A2uiMessage,
  type A2uiMessageKind,
  ChatExtension,
  type FunctionCall,
  MESSAGE_SCHEMAS,
} from "./schema.js";
import {
  A2uiExpressionError,
  absolutePath,
  isCall,
  isRecord,
} from "./values.js";

export interface BlockInput {
  key: string;
  messageId: string;
  source: string;
  closed: boolean;
}

export interface RendererError {
  code: string;
  message: string;
  surfaceId?: string;
  path?: string;
}

export interface FunctionResponse {
  functionCallId: string;
  value?: unknown;
  error?: { code: string; message: string };
}

export interface FunctionCallOutcome {
  name: string;
  response: FunctionResponse;
}

export interface SurfaceState {
  id: string;
  catalogId: string | undefined;
  sendDataModel: boolean;
  components: ReadonlyMap<string, A2uiComponent>;
  dataModel: unknown;
  lockComposer: boolean;
  assumed: boolean;
  version: number;
  ownerKey: string;
  lastTouchKey: string;
  lastTouchMessageId: string;
  deleted: boolean;
  streaming: boolean;
}

export interface BlockOutcome {
  messageId: string;
  owned: string[];
  touched: string[];
  closed: string[];
  errors: RendererError[];
  functionCalls: FunctionCallOutcome[];
  streaming: boolean;
}

export interface A2uiConversation {
  surfaces: ReadonlyMap<string, SurfaceState>;
  blocks: ReadonlyMap<string, BlockOutcome>;
}

export interface ConversationOptions {
  callFunction: (call: FunctionCall) => unknown;
  assumeEarlierSurfaces?: boolean;
}

interface Draft extends Omit<SurfaceState, "components"> {
  components: Map<string, A2uiComponent>;
}

const LEADING_FENCE = /^\s*```[a-zA-Z-]*\s*/;
const MESSAGE_KINDS = Object.keys(MESSAGE_SCHEMAS) as A2uiMessageKind[];

function pointer(segments: readonly PropertyKey[]): string {
  return `/${segments.map(String).join("/")}`;
}

function issueError(
  error: z.ZodError,
  prefix: readonly PropertyKey[],
  surfaceId?: string,
): RendererError {
  const issue = error.issues[0];
  const path = pointer([...prefix, ...(issue?.path ?? [])]);
  return {
    code: "VALIDATION_FAILED",
    message: `${issue?.message ?? "Invalid value"} (at ${path})`,
    path,
    ...(surfaceId === undefined ? {} : { surfaceId }),
  };
}

function withoutTrailingFence(source: string): string {
  const trimmed = source.trimEnd();
  return trimmed.endsWith("```") ? trimmed.slice(0, -3) : source;
}

function readMessages(block: BlockInput): {
  raw: unknown[];
  error?: RendererError;
} {
  const source = withoutTrailingFence(block.source.replace(LEADING_FENCE, ""));
  if (!block.closed) {
    const partial = parsePartialJson(source);
    if (partial === undefined) return { raw: [] };
    return { raw: Array.isArray(partial) ? partial : [partial] };
  }
  try {
    const parsed: unknown = JSON.parse(source);
    return { raw: Array.isArray(parsed) ? parsed : [parsed] };
  } catch (error) {
    return {
      raw: [],
      error: {
        code: "VALIDATION_FAILED",
        path: "/",
        message: `Not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
}

function messageKind(raw: unknown): A2uiMessageKind | undefined {
  if (!isRecord(raw)) return undefined;
  return MESSAGE_KINDS.find((kind) => kind in raw);
}

class ConversationBuilder {
  readonly surfaces = new Map<string, Draft>();
  readonly blocks = new Map<string, BlockOutcome>();
  private outcome!: BlockOutcome;
  private block!: BlockInput;

  constructor(private readonly options: ConversationOptions) {}

  addBlock(block: BlockInput) {
    this.block = block;
    this.outcome = {
      messageId: block.messageId,
      owned: [],
      touched: [],
      closed: [],
      errors: [],
      functionCalls: [],
      streaming: !block.closed,
    };
    this.blocks.set(block.key, this.outcome);
    const { raw, error } = readMessages(block);
    if (error) this.outcome.errors.push(error);
    raw.forEach((message, index) => this.addMessage(message, index));
  }

  private report(error: RendererError) {
    if (this.block.closed) this.outcome.errors.push(error);
  }

  private addMessage(raw: unknown, index: number) {
    if (
      isRecord(raw) &&
      raw.version !== undefined &&
      raw.version !== A2UI_VERSION
    ) {
      this.report({
        code: "VALIDATION_FAILED",
        path: pointer([index, "version"]),
        message: `A2UI version "${String(raw.version)}" is not supported; send "${A2UI_VERSION}" messages.`,
      });
      return;
    }
    const kind = messageKind(raw);
    if (!kind) {
      this.report({
        code: "VALIDATION_FAILED",
        path: pointer([index]),
        message: `Message ${index} is none of ${MESSAGE_KINDS.join(", ")}.`,
      });
      return;
    }
    const parsed = MESSAGE_SCHEMAS[kind].safeParse(raw);
    if (!parsed.success) {
      this.report(issueError(parsed.error, [index]));
      return;
    }
    this.apply(parsed.data, index);
  }

  private components(
    list: readonly unknown[] | undefined,
    prefix: readonly PropertyKey[],
    surfaceId: string,
  ): A2uiComponent[] {
    return (list ?? []).flatMap((raw, position) => {
      const parsed = ComponentSchema.safeParse(raw);
      if (parsed.success) return [parsed.data];
      this.report(issueError(parsed.error, [...prefix, position], surfaceId));
      return [];
    });
  }

  private touch(draft: Draft) {
    draft.version += 1;
    draft.lastTouchKey = this.block.key;
    draft.lastTouchMessageId = this.block.messageId;
    draft.streaming = !this.block.closed;
    if (
      draft.ownerKey !== this.block.key &&
      !this.outcome.touched.includes(draft.id)
    )
      this.outcome.touched.push(draft.id);
  }

  private existing(surfaceId: string, index: number): Draft | undefined {
    const draft = this.surfaces.get(surfaceId);
    if (draft && !draft.deleted) return draft;
    if (!draft && this.options.assumeEarlierSurfaces)
      return this.draft(surfaceId, undefined, true);
    this.report({
      code: "SURFACE_NOT_FOUND",
      surfaceId,
      message: `Surface "${surfaceId}" does not exist; send createSurface first (message ${index}).`,
    });
    return undefined;
  }

  private apply(message: A2uiMessage, index: number) {
    if ("createSurface" in message)
      return this.create(message.createSurface, index);
    if ("updateComponents" in message) {
      const { surfaceId, components } = message.updateComponents;
      const draft = this.existing(surfaceId, index);
      if (!draft) return;
      for (const component of this.components(
        components,
        [index, "updateComponents", "components"],
        surfaceId,
      ))
        draft.components.set(component.id, component);
      this.touch(draft);
      return;
    }
    if ("updateDataModel" in message) {
      const { surfaceId, path = "/", value } = message.updateDataModel;
      const draft = this.existing(surfaceId, index);
      if (!draft) return;
      draft.dataModel =
        value === null
          ? deleteAt(draft.dataModel, path)
          : setAt(draft.dataModel, path, value);
      this.touch(draft);
      return;
    }
    if ("deleteSurface" in message) {
      const draft = this.existing(message.deleteSurface.surfaceId, index);
      if (!draft) return;
      draft.deleted = true;
      this.touch(draft);
      this.outcome.closed.push(draft.id);
      return;
    }
    if ("callRendererFunction" in message) {
      if (this.block.closed)
        this.callRendererFunction(message.callRendererFunction);
    }
  }

  private create(
    payload: Extract<A2uiMessage, { createSurface: unknown }>["createSurface"],
    index: number,
  ) {
    const { surfaceId, catalogId } = payload;
    const previous = this.surfaces.get(surfaceId);
    if (previous && !previous.deleted) {
      this.report({
        code: "INTEGRITY_ERROR",
        surfaceId,
        message: `Surface "${surfaceId}" already exists; delete it first or update it with updateComponents and updateDataModel.`,
      });
      return;
    }
    if (catalogId !== undefined && !catalogFor(catalogId))
      this.report({
        code: "VALIDATION_FAILED",
        surfaceId,
        path: pointer([index, "createSurface", "catalogId"]),
        message: `Catalog "${catalogId}" is not supported. Supported catalogs: ${SUPPORTED_CATALOG_IDS.join(", ")}.`,
      });
    const draft = this.draft(surfaceId, catalogId, false);
    draft.sendDataModel = payload.sendDataModel ?? false;
    draft.dataModel = payload.dataModel ?? {};
    draft.lockComposer = this.lockComposer(payload.metadata, index, surfaceId);
    for (const component of this.components(
      payload.components,
      [index, "createSurface", "components"],
      surfaceId,
    ))
      draft.components.set(component.id, component);
    this.outcome.owned.push(surfaceId);
  }

  private draft(
    surfaceId: string,
    catalogId: string | undefined,
    assumed: boolean,
  ): Draft {
    const draft: Draft = {
      id: surfaceId,
      catalogId,
      sendDataModel: false,
      components: new Map(),
      dataModel: {},
      lockComposer: false,
      assumed,
      version: 0,
      ownerKey: this.block.key,
      lastTouchKey: this.block.key,
      lastTouchMessageId: this.block.messageId,
      deleted: false,
      streaming: !this.block.closed,
    };
    this.surfaces.set(surfaceId, draft);
    return draft;
  }

  private lockComposer(
    metadata: { extensions?: Record<string, unknown> } | undefined,
    index: number,
    surfaceId: string,
  ): boolean {
    const extension = metadata?.extensions?.[A2UI_CHAT_EXTENSION_ID];
    if (extension === undefined) return false;
    const parsed = ChatExtension.safeParse(extension);
    if (parsed.success) return parsed.data.lockComposer ?? false;
    this.report(
      issueError(
        parsed.error,
        [
          index,
          "createSurface",
          "metadata",
          "extensions",
          A2UI_CHAT_EXTENSION_ID,
        ],
        surfaceId,
      ),
    );
    return false;
  }

  private callRendererFunction({
    functionCallId,
    callFunction: call,
  }: {
    functionCallId: string;
    callFunction: FunctionCall;
  }) {
    const name = call["@call"];
    const reject = (message: string): FunctionCallOutcome => ({
      name,
      response: {
        functionCallId,
        error: { code: "INVALID_FUNCTION_CALL", message },
      },
    });
    const definition = catalogFor(call.catalogId)?.functions[name];
    let outcome: FunctionCallOutcome;
    if (call.catalogId === undefined)
      outcome = reject("callRendererFunction needs a catalogId.");
    else if (!definition)
      outcome = reject(
        `Function "${name}" is not in catalog "${call.catalogId}".`,
      );
    else if (definition.allowedCallers === "rendererOnly")
      outcome = reject(
        `Function "${name}" cannot be called by the agent (allowedCallers is rendererOnly).`,
      );
    else if (definition.requiresUserActivation)
      outcome = reject(`Function "${name}" needs a user action.`);
    else {
      try {
        const value = this.options.callFunction(call);
        outcome = { name, response: { functionCallId, value: value ?? null } };
      } catch (error) {
        outcome = {
          name,
          response: {
            functionCallId,
            error: {
              code:
                error instanceof A2uiExpressionError
                  ? error.code
                  : "EXECUTION_ERROR",
              message: error instanceof Error ? error.message : String(error),
            },
          },
        };
      }
    }
    this.outcome.functionCalls.push(outcome);
  }
}

function childIds(component: A2uiComponent): string[] {
  return match(component)
    .with({ component: P.union("Row", "Column", "List") }, (c) =>
      Array.isArray(c.children) ? c.children : [c.children.componentId],
    )
    .with({ component: P.union("Card", "Button") }, (c) => [c.child])
    .with({ component: "Tabs" }, (c) => c.tabs.map((tab) => tab.child))
    .with({ component: "Modal" }, (c) => [c.trigger, c.content])
    .with(
      {
        component: P.union(
          "Text",
          "Image",
          "Icon",
          "Video",
          "AudioPlayer",
          "Divider",
          "TextField",
          "CheckBox",
          "ChoicePicker",
          "Slider",
          "DateTimeInput",
          "Callout",
          "Badge",
          "CodeBlock",
          "Diff",
          "Switch",
        ),
      },
      () => [],
    )
    .exhaustive();
}

function walkRendered(
  surface: Pick<SurfaceState, "components">,
  dataModel: unknown,
  limit: number,
  onNode: (component: A2uiComponent) => void,
): number {
  let count = 0;
  const visit = (id: string, depth: number, scope: string) => {
    if (count > limit || depth > MAX_DEPTH) return;
    const component = surface.components.get(id);
    if (!component) return;
    count += 1;
    onNode(component);
    if ("children" in component && !Array.isArray(component.children)) {
      const listPath = absolutePath(component.children.path, scope);
      const items = getAt(dataModel, listPath);
      if (!Array.isArray(items)) return;
      const shown = Math.min(items.length, MAX_TEMPLATE_ITEMS);
      for (let index = 0; index < shown; index += 1)
        visit(
          component.children.componentId,
          depth + 1,
          `${listPath}/${index}`,
        );
      return;
    }
    for (const child of childIds(component)) visit(child, depth + 1, scope);
  };
  visit("root", 0, "");
  return count;
}

// UNIT_BOUNDARY_DESCRIPTION: counts the nodes a surface renders from "root", template items included, and stops past the limit, so a shared child id or nested templates cannot make the count itself explode.
export function renderedNodeCount(
  surface: Pick<SurfaceState, "components">,
  dataModel: unknown,
  limit: number,
): number {
  return walkRendered(surface, dataModel, limit, () => {});
}

function structureErrors(surface: Draft): string[] {
  const errors: string[] = [];
  const parentOf = new Map<string, string>();
  for (const component of surface.components.values())
    for (const child of childIds(component)) {
      if (parentOf.has(child))
        errors.push(
          `Component "${child}" has more than one parent; each component appears once in the tree.`,
        );
      else parentOf.set(child, component.id);
    }
  if (parentOf.has("root"))
    errors.push(`Component "root" must not be a child of another component.`);
  for (const id of surface.components.keys()) {
    let current = parentOf.get(id);
    for (let steps = 0; current !== undefined && current !== id; steps += 1)
      current =
        steps < surface.components.size ? parentOf.get(current) : undefined;
    if (current === id) {
      errors.push(
        `Component "${id}" is its own ancestor; children must form a tree.`,
      );
      break;
    }
  }
  if (
    renderedNodeCount(surface, surface.dataModel, MAX_RENDERED_NODES) >
    MAX_RENDERED_NODES
  )
    errors.push(
      `Surface "${surface.id}" renders more than ${MAX_RENDERED_NODES} components; shorten its lists.`,
    );
  return [...new Set(errors)];
}

function functionCalls(value: unknown): FunctionCall[] {
  if (Array.isArray(value)) return value.flatMap(functionCalls);
  if (!isRecord(value)) return [];
  const nested = Object.values(value).flatMap(functionCalls);
  return isCall(value) ? [value, ...nested] : nested;
}

export function componentCatalogId(
  component: A2uiComponent,
  surface: Pick<SurfaceState, "catalogId">,
): string | undefined {
  return component.catalogId ?? surface.catalogId;
}

export function resolvesInCatalog(
  component: A2uiComponent,
  surface: Pick<SurfaceState, "catalogId">,
): boolean {
  return (
    catalogFor(componentCatalogId(component, surface))?.components.has(
      component.component,
    ) ?? false
  );
}

function rendersEventButton(surface: Draft): boolean {
  let found = false;
  walkRendered(surface, surface.dataModel, MAX_RENDERED_NODES, (component) => {
    if (component.component === "Button" && "event" in component.action)
      found = true;
  });
  return found;
}

function surfaceErrors(surface: Draft): RendererError[] {
  const errors: RendererError[] = [];
  if (surface.assumed) return errors;
  const add = (message: string, path?: string) =>
    errors.push({
      code: "VALIDATION_FAILED",
      surfaceId: surface.id,
      message,
      ...(path === undefined ? {} : { path }),
    });
  if (!surface.components.has("root"))
    add(`Surface "${surface.id}" has no component with id "root".`);
  for (const message of structureErrors(surface)) add(message);
  if (surface.lockComposer && !rendersEventButton(surface))
    add(
      `Surface "${surface.id}" locks the composer but renders no Button with an event action, so the user could not answer.`,
    );
  for (const component of surface.components.values()) {
    const catalogId = componentCatalogId(component, surface);
    if (catalogId === undefined)
      add(
        `Component "${component.id}" has no catalogId and the surface has no default catalogId.`,
        `/components/${component.id}`,
      );
    else if (!resolvesInCatalog(component, surface))
      add(
        `Component "${component.id}" (${component.component}) is not in catalog "${catalogId}".`,
        `/components/${component.id}/component`,
      );
    for (const child of childIds(component))
      if (!surface.components.has(child))
        add(
          `Component "${component.id}" refers to missing component "${child}".`,
          `/components/${component.id}`,
        );
    for (const call of functionCalls(component)) {
      const name = call["@call"];
      if (name === "@index") continue;
      const functionCatalog = call.catalogId ?? catalogId;
      if (!catalogFor(functionCatalog)?.functions[name])
        add(
          `Component "${component.id}" calls "${name}", which is not in catalog "${functionCatalog ?? "(none)"}".`,
          `/components/${component.id}`,
        );
    }
  }
  return errors;
}

export function buildConversation(
  blocks: readonly BlockInput[],
  options: ConversationOptions,
): A2uiConversation {
  const builder = new ConversationBuilder(options);
  for (const block of blocks) builder.addBlock(block);
  for (const surface of builder.surfaces.values()) {
    if (surface.deleted || surface.streaming) continue;
    builder.blocks
      .get(surface.lastTouchKey)
      ?.errors.push(...surfaceErrors(surface));
  }
  return { surfaces: builder.surfaces, blocks: builder.blocks };
}
