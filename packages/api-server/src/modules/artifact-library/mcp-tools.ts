import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ARTIFACT_TITLE_MAX_LENGTH,
  artifactInternalLink,
  artifactKindSchema,
  type LibraryArtifact,
} from "api-server-api";

import { securityLog } from "../../core/security-log.js";
import type { ArtifactLibraryServiceImpl } from "./services/artifact-library-service.js";
import type { ArtifactRequestsServiceImpl } from "./services/artifact-requests-service.js";

function withInternalLink(
  artifact: LibraryArtifact,
): LibraryArtifact & { internal_link: string } {
  return { ...artifact, internal_link: artifactInternalLink(artifact.id) };
}

interface ToolContent {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

function json(value: unknown): ToolContent {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function errorResult(text: string): ToolContent {
  return { content: [{ type: "text", text }], isError: true };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function run(fn: () => Promise<ToolContent>): Promise<ToolContent> {
  try {
    return await fn();
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

const folderIdInput = z
  .string()
  .optional()
  .describe('Folder id; pass "" to move the artifact out of its folder.');

export function registerArtifactLibraryTools(
  server: McpServer,
  deps: {
    artifactLibrary: ArtifactLibraryServiceImpl;
    agentId: string;
    attachToExperiment?: (
      artifactId: string,
      experimentId?: string,
    ) => Promise<{ experimentId: string } | null>;
  },
): void {
  const lib = deps.artifactLibrary;

  async function experimentAttachment(
    artifactId: string,
    experimentId?: string,
  ): Promise<Record<string, string>> {
    if (!deps.attachToExperiment) return {};
    try {
      const attached = await deps.attachToExperiment(artifactId, experimentId);
      return attached ? { attached_to_experiment: attached.experimentId } : {};
    } catch (err) {
      return {
        experiment_attach_error:
          err instanceof Error ? err.message : String(err),
      };
    }
  }

  server.tool(
    "create_artifact",
    "Publish an artifact (HTML page, React/JSX component, markdown, code, text, or a binary file) to the platform artifact library and optionally get a public share link. PREFER THIS for sharing work products with humans — artifacts outlive this sandbox, are versioned, and render on a share page (HTML/JSX render live; markdown and code render formatted). Content must be a single self-contained file: anything available only in your sandbox — companion files, installed packages, running services — does not exist for viewers, so inline all resources or reference them via absolute public URLs. Provide `content` inline for text, or `upload_ref` from create_artifact_upload_url for anything big or binary. Set visibility='public' to mint a share link (the unguessable URL is the access control); set `expires_in_hours` only if the platform should permanently delete the artifact after that time. If the page's job is to hand something BACK to you — a form to submit, choices to record, a Refresh button, an answer to work on — set `interactive: true`; a page without it cannot reach you at all, and its only way to return anything is to ask the person to copy text into the chat by hand. The response includes `internal_link` (platform://artifacts/<id>) — paste it into your chat reply as a markdown link, e.g. [My dashboard](platform://artifacts/<id>), and the user sees an inline chip that opens a live preview beside the chat.",
    {
      title: z.string().trim().min(1).max(ARTIFACT_TITLE_MAX_LENGTH),
      content: z
        .string()
        .optional()
        .describe("Inline utf-8 source (up to 2 MB); use upload_ref beyond."),
      upload_ref: z
        .string()
        .optional()
        .describe("Completed direct upload from create_artifact_upload_url."),
      file_name: z.string().optional(),
      type: artifactKindSchema
        .optional()
        .describe("Auto-detected from file name / content when omitted."),
      folder_id: z.string().optional(),
      visibility: z.enum(["private", "public"]).optional(),
      interactive: z
        .boolean()
        .optional()
        .describe(
          "HTML only. Set it whenever the page has to give you something back — otherwise the page can only ask the person to copy text into the chat, and you never see what they did on it. Makes the page able to call back to you: a button on it asks you to do something and the answer lands in the page. The page calls `await platform.ask(action, payload)` — `platform` is already there, needs no setup, and the promise resolves with whatever you pass to answer_artifact_request, or rejects with `{ reason, message }` if the ask is refused. `platform.onState(cb)` reports progress ('sent', 'waking', 'queued', 'running') while you work. Write the page against those two calls and nothing else. Every ask is a full turn of yours, so build the page as many small asks — one per step, each rendering its own answer in place — not one form that submits everything at once and makes the person wait for all of it. In exchange the artifact can NEVER be shared — it stays private to its owner, because you run with their credentials. Settled now and unchangeable: no later version can turn it on or off, so publish a separate artifact if you want a shareable copy. By default the page asks right here, in this conversation, so its questions and answers appear in the chat the person is reading — see `own_session` for a page that has to outlive this chat. Every ask reaches a session that already holds the asks before it, so send only what changed in `payload`: a page that replays its whole history in every ask pays for that history again on every turn.",
        ),
      own_session: z
        .boolean()
        .optional()
        .describe(
          "Interactive pages only. Ask yourself one question: does this page have to keep working after this conversation is over? A dashboard, a poll, a status board, anything somebody opens next month — yes, so set this. Then the page gets a conversation of its own, which starts cold on every ask and knows only what its `brief` says, and it can also refresh itself on a timer. Leave it unset for a page that IS this conversation in another shape — an interview, a decision matrix, a form that collects a spec. Then every ask lands right here: you answer with everything said in this thread, and the person watches the answers arrive in the chat they already have open. Settled now and unchangeable, like `interactive`.",
        ),
      brief: z
        .string()
        .optional()
        .describe(
          "Interactive pages only — standing instructions for your future self, prepended to EVERY request this page ever sends you. Load-bearing for an `own_session` page: the session serving it is NOT this conversation, it starts cold, sees only the request, and remembers nothing you were told here, so write down the job the page is doing, the rules you were given for it, where to get the data, and the shape the page expects back. For a page bound to this conversation it is short insurance instead: the asks land here, but a long thread gets compacted, and the brief outlives that. Up to 8 KB, and replaceable later with update_artifact without publishing a new version.",
        ),
      expires_in_hours: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Artifact lifetime in hours — after expiry (plus a grace week) the artifact is permanently deleted, even if private; omit to keep forever.",
        ),
      experiment_id: z
        .string()
        .optional()
        .describe(
          "Attach the artifact to an experiment RUN you are driving (the id from PLATFORM_EXPERIMENT_ID in the launch instructions) so it shows among that run's artifacts. If you were yourself spawned BY an experiment, leave this unset — attribution to the spawning run is automatic.",
        ),
    },
    ({
      title,
      content,
      upload_ref,
      file_name,
      type,
      folder_id,
      visibility,
      interactive,
      own_session,
      brief,
      expires_in_hours,
      experiment_id,
    }) =>
      run(async () => {
        const artifact = await lib.create(
          {
            title,
            content,
            uploadRef: upload_ref,
            fileName: file_name,
            kind: type,
            folderId: folder_id,
            visibility,
            interactive,
            ownSession: own_session,
            brief,
            expiresInHours: expires_in_hours ?? null,
          },
          { agentId: deps.agentId },
        );
        return json({
          ...withInternalLink(artifact),
          ...(await experimentAttachment(artifact.id, experiment_id)),
        });
      }),
  );

  server.tool(
    "create_artifact_upload_url",
    "PREFERRED way to get artifact bytes into the library when your runtime can make outbound HTTP requests (e.g. curl). Returns a short-lived presigned URL: PUT the raw file bytes to it, then pass the returned upload_ref to create_artifact or update_artifact — this avoids re-emitting file content through tool arguments.",
    { file_name: z.string().min(1) },
    ({ file_name }) =>
      run(async () => {
        const ticket = await lib.createUploadUrl(file_name);
        return json({
          ...ticket,
          instructions: `PUT the raw file as the request body, e.g.: curl -X PUT --data-binary @${file_name} '${ticket.url}' — then pass upload_ref to create_artifact / update_artifact.`,
        });
      }),
  );

  server.tool(
    "create_artifact_download_url",
    "PREFERRED way to get an artifact's bytes INTO your sandbox when your runtime can make outbound HTTP requests (e.g. curl) — works for any artifact in the owner's library, text or binary, any size. Returns a short-lived presigned URL: GET it and save the response to a file. Pass `version` to fetch a past version. (For small text artifacts get_artifact already returns the source inline.)",
    {
      id: z.string().min(1),
      version: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Version to download; omit for the current one."),
    },
    ({ id, version }) =>
      run(async () => {
        let ticket;
        try {
          ticket = await lib.createAgentDownloadUrl(id, version);
        } catch (err) {
          securityLog("warn", "artifact_library.download", {
            category: "resource",
            actor: deps.agentId,
            actorKind: "agent",
            surface: "mcp",
            agentId: deps.agentId,
            target: id,
            result: "failure",
            reason: err instanceof Error ? err.message : String(err),
            detail: { mode: "direct", ...(version ? { version } : {}) },
          });
          throw err;
        }
        securityLog("info", "artifact_library.download", {
          category: "resource",
          actor: deps.agentId,
          actorKind: "agent",
          surface: "mcp",
          agentId: deps.agentId,
          target: id,
          result: "success",
          detail: {
            mode: "direct",
            version: ticket.version,
            sizeBytes: ticket.sizeBytes,
          },
        });
        return json({
          ...ticket,
          instructions: `GET the URL and save the body, e.g.: curl -fL -o ${shellQuote(ticket.fileName)} ${shellQuote(ticket.url)} — the link expires in ${ticket.expiresSeconds}s.`,
        });
      }),
  );

  server.tool(
    "list_artifacts",
    "List artifacts in the owner's library (metadata only). Filter by folder or search by title/file name.",
    {
      folder_id: z.string().optional(),
      search: z.string().optional(),
      mine_only: z
        .boolean()
        .optional()
        .describe("true = only artifacts created by THIS agent."),
    },
    ({ folder_id, search, mine_only }) =>
      run(async () => {
        const artifacts = await lib.list({
          folderId: folder_id,
          search,
          ...(mine_only ? { agentId: deps.agentId } : {}),
        });
        return json(artifacts.map(withInternalLink));
      }),
  );

  server.tool(
    "get_artifact",
    "Get an artifact's metadata and (for text kinds) its full source content. For binary or large artifacts use create_artifact_download_url instead.",
    {
      id: z.string().min(1),
      version: z.number().int().positive().optional(),
    },
    ({ id, version }) =>
      run(async () => {
        const artifact = await lib.get(id);
        if (!artifact) return errorResult(`artifact ${id} not found`);
        const content = await lib.getContent(id, version);
        return json({
          ...withInternalLink(artifact),
          content:
            content && !content.binary && !content.tooLarge
              ? content.content
              : undefined,
          contentOmitted:
            !content || content.binary || content.tooLarge
              ? "binary or too large — call create_artifact_download_url to fetch the bytes into your sandbox"
              : undefined,
        });
      }),
  );

  server.tool(
    "update_artifact",
    "Update an artifact. Passing content or upload_ref publishes a NEW VERSION (the share link stays the same; viewers can flip versions). Other fields edit metadata in place. The artifact's TYPE and whether it is INTERACTIVE are settled at creation and cannot change — not by renaming either — because the share link outlives every revision; publish a new artifact when the new content is a different kind of file.",
    {
      id: z.string().min(1),
      title: z.string().trim().min(1).max(ARTIFACT_TITLE_MAX_LENGTH).optional(),
      content: z.string().optional(),
      upload_ref: z.string().optional(),
      file_name: z
        .string()
        .optional()
        .describe(
          "Renames the artifact — every version downloads under this name. Does not change its type.",
        ),
      folder_id: folderIdInput,
      brief: z
        .string()
        .optional()
        .describe(
          "Replaces the brief, the standing instructions prepended to every request this interactive page sends you. Changing it alone publishes NO new version, so an open page keeps whatever the person typed into it — this is how you steer the page after you learn something new, without reloading it under them.",
        ),
    },
    ({ id, title, content, upload_ref, file_name, folder_id, brief }) =>
      run(async () => {
        const artifact = await lib.update(id, {
          title,
          content,
          uploadRef: upload_ref,
          fileName: file_name,
          folderId: folder_id === "" ? null : folder_id,
          brief,
        });
        return json(withInternalLink(artifact));
      }),
  );

  server.tool(
    "set_artifact_sharing",
    "Control an artifact's sharing: visibility ('public' mints the link, 'private' disables it) and the deletion date (0 removes it). The deletion date is retention, not link lifetime — the platform permanently deletes the artifact on that date, even if it is private. An interactive artifact refuses 'public' — it can call back to you, so it stays private — but its deletion date is still settable.",
    {
      id: z.string().min(1),
      visibility: z.enum(["private", "public"]).optional(),
      expires_in_hours: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Hours from now; 0 removes the deletion date."),
    },
    ({ id, visibility, expires_in_hours }) =>
      run(async () => {
        const artifact = await lib.setSharing(id, {
          visibility,
          ...(expires_in_hours !== undefined
            ? {
                expiresInHours:
                  expires_in_hours === 0 ? null : expires_in_hours,
              }
            : {}),
        });
        return json(artifact);
      }),
  );

  server.tool(
    "delete_artifact",
    "Permanently delete an artifact (all versions; its share link dies).",
    { id: z.string().min(1) },
    ({ id }) =>
      run(async () => {
        await lib.delete(id);
        return json({ deleted: id });
      }),
  );

  server.tool(
    "create_artifact_folder",
    "Create a folder to organize artifacts.",
    { name: z.string().min(1).max(200) },
    ({ name }) => run(async () => json(await lib.createFolder(name))),
  );

  server.tool(
    "list_artifact_folders",
    "List the owner's artifact folders with artifact counts.",
    {},
    () => run(async () => json(await lib.listFolders())),
  );

  server.tool(
    "update_artifact_folder",
    "Rename a folder.",
    {
      id: z.string().min(1),
      name: z.string().min(1).max(200).optional(),
    },
    ({ id, name }) =>
      run(async () => json(await lib.updateFolder(id, { name }))),
  );

  server.tool(
    "delete_artifact_folder",
    "Delete a folder. Artifacts inside are NOT deleted — they become ungrouped.",
    { id: z.string().min(1) },
    ({ id }) =>
      run(async () => {
        await lib.deleteFolder(id);
        return json({ deleted: id });
      }),
  );
}

export function registerArtifactRequestTools(
  server: McpServer,
  deps: {
    artifactRequests: ArtifactRequestsServiceImpl;
    agentId: string;
  },
): void {
  server.tool(
    "answer_artifact_request",
    "Answer one request that came from an interactive page you published. The request id is in the prompt that asked you. `result` is a JSON value the page reads with its own code, so shape it for the page. The page waits until this call lands — finishing your turn answers nothing — and a request takes exactly one answer, so a second call for the same request is refused. You can only answer requests for your own pages.",
    {
      request_id: z.string().min(1),
      result: z
        .unknown()
        .describe("The answer — a JSON value the page's own code reads."),
    },
    ({ request_id, result }) =>
      run(async () => {
        const outcome = await deps.artifactRequests.answer({
          requestId: request_id,
          agentId: deps.agentId,
          result,
        });
        if (!outcome.ok) return errorResult(outcome.error);
        return json({
          answered: outcome.request.id,
          artifact_id: outcome.request.artifactId,
          seq: outcome.request.seq,
        });
      }),
  );
}
