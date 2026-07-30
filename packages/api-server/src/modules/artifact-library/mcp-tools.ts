import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  artifactInternalLink,
  artifactKindSchema,
  type LibraryArtifact,
} from "api-server-api";

import { securityLog } from "../../core/security-log.js";
import type { ArtifactLibraryServiceImpl } from "./services/artifact-library-service.js";

/** Internal link the platform UI renders as an inline preview chip that
 *  opens the artifact beside the chat. */
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

/** For rendering a file name into an example shell command only — the real
 *  name travels as a field. Restricted to a shell-safe subset so an artifact
 *  named by another publisher can never break out of the example's quoting. */
function shellSafeFileName(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, "_");
  return safe.length > 0 ? safe : "artifact";
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

/** Registers the artifact-library tools on the per-agent platform MCP server.
 *  `agentId` is the network-verified caller — creations are attributed to it;
 *  the service is already owner-scoped, so the agent can only ever touch its
 *  owner's library. */
export function registerArtifactLibraryTools(
  server: McpServer,
  deps: {
    artifactLibrary: ArtifactLibraryServiceImpl;
    agentId: string;
    /** Attach a fresh artifact to an experiment run: explicit id from the
     *  driver's monitoring harness, or auto-attribution when the calling
     *  agent is itself an invocation target (experimentId omitted). Returns
     *  where it landed, or null when there is nothing to attach to. */
    attachToExperiment?: (
      artifactId: string,
      experimentId?: string,
    ) => Promise<{ experimentId: string } | null>;
  },
): void {
  const lib = deps.artifactLibrary;

  /** Best-effort experiment attach after a successful publish: the artifact
   *  exists either way, so attach problems report as a field on the result
   *  instead of failing the tool (which would invite duplicate publishes). */
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
    "Publish an artifact (HTML page, React/JSX component, markdown, code, text, or a binary file) to the platform artifact library and optionally get a public share link. PREFER THIS for sharing work products with humans — artifacts outlive this sandbox, are versioned, and render on a share page (HTML/JSX render live; markdown and code render formatted). Content must be a single self-contained file: anything available only in your sandbox — companion files, installed packages, running services — does not exist for viewers, so inline all resources or reference them via absolute public URLs. Provide `content` inline for text, or `upload_ref` from create_artifact_upload_url for anything big or binary. Set visibility='public' to mint a share link (the unguessable URL is the access control); add an expiry to bound its lifetime. The response includes `internal_link` (platform://artifacts/<id>) — paste it into your chat reply as a markdown link, e.g. [My dashboard](platform://artifacts/<id>), and the user sees an inline chip that opens a live preview beside the chat.",
    {
      title: z.string().min(1).max(300),
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
        const ticket = await lib.createAgentDownloadUrl(id, version);
        // Mirrors the browser download route's audit line — a presigned link
        // is a bearer capability to the bytes.
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
          instructions: `GET the URL and save the body, e.g.: curl -fL -o '${shellSafeFileName(ticket.fileName)}' '${ticket.url}' — the link expires in ${ticket.expiresSeconds}s.`,
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
    "Update an artifact. Passing content or upload_ref publishes a NEW VERSION (the share link stays the same; viewers can flip versions). Other fields edit metadata in place.",
    {
      id: z.string().min(1),
      title: z.string().min(1).max(300).optional(),
      content: z.string().optional(),
      upload_ref: z.string().optional(),
      file_name: z.string().optional(),
      type: artifactKindSchema.optional(),
      folder_id: folderIdInput,
    },
    ({ id, title, content, upload_ref, file_name, type, folder_id }) =>
      run(async () => {
        const artifact = await lib.update(id, {
          title,
          content,
          uploadRef: upload_ref,
          fileName: file_name,
          kind: type,
          folderId: folder_id === "" ? null : folder_id,
        });
        return json(withInternalLink(artifact));
      }),
  );

  server.tool(
    "set_artifact_sharing",
    "Control an artifact's sharing: visibility ('public' mints the link, 'private' disables it) and expiry (0 removes it). Expiry is retention, not link lifetime — an expired artifact is permanently deleted even if private.",
    {
      id: z.string().min(1),
      visibility: z.enum(["private", "public"]).optional(),
      expires_in_hours: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Hours from now; 0 removes the expiry."),
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
