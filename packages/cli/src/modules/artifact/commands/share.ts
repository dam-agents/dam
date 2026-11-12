import { Command } from "commander";
import {
  viewerEmailSchema,
  type ArtifactSharingInput,
  type ArtifactVisibility,
  type LibraryArtifact,
} from "api-server-api";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { ArtifactService } from "../services/artifact-service.js";

interface ShareOptions {
  add: string[];
  remove: string[];
  private?: boolean;
  server?: string;
  json?: boolean;
}

function fail(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(EXIT_INVALID_INPUT);
}

function emailsOf(values: string[], flag: string): string[] {
  return values.map((value) => {
    const email = viewerEmailSchema.safeParse(value);
    if (!email.success) fail(`${flag} takes an email address, not "${value}"`);
    return email.data;
  });
}

function sharingOf(opts: ShareOptions): ArtifactSharingInput | null {
  if (opts.private && opts.add.length > 0)
    fail("--private cannot be used with --add");
  const add = emailsOf(opts.add, "--add");
  const remove = emailsOf(opts.remove, "--remove");
  if (!opts.private && add.length === 0 && remove.length === 0) return null;
  return {
    ...(opts.private
      ? { visibility: "private" as const }
      : add.length > 0
        ? { visibility: "restricted" as const }
        : {}),
    ...(add.length > 0 ? { addViewers: add } : {}),
    ...(remove.length > 0 ? { removeViewers: remove } : {}),
  };
}

const LEVEL: Record<ArtifactVisibility, (shareUrl: string | null) => string> = {
  private: () => "private: only you can open it, in the app",
  restricted: (shareUrl) =>
    `restricted: only you and its viewers can open ${shareUrl}`,
  public: (shareUrl) => `public: anyone with ${shareUrl} can open it`,
};

function renderSharing(artifact: LibraryArtifact): string {
  const level = LEVEL[artifact.visibility](artifact.shareUrl);
  const viewers =
    artifact.viewers.length === 0
      ? "No viewers.\n"
      : `Viewers:\n${artifact.viewers.map((email) => `  ${email}\n`).join("")}`;
  return `${artifact.title} is ${level}.\n${viewers}`;
}

export function buildShareCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createArtifactService: (host: string) => ArtifactService;
}): Command {
  return new Command("share")
    .description(
      "Show who can open an artifact, or share it with named people by email and change who is on the list. Without flags it only shows",
    )
    .argument("<artifact-id>", "the artifact's id")
    .option(
      "--add <email>",
      "give this person access, by email; makes the artifact restricted to its viewers (repeatable)",
      (v: string, acc: string[]) => [...acc, v],
      [] as string[],
    )
    .option(
      "--remove <email>",
      "take this person off the viewer list (repeatable)",
      (v: string, acc: string[]) => [...acc, v],
      [] as string[],
    )
    .option("--private", "make the artifact private: only you, in the app")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the artifact's sharing as JSON")
    .addHelpText(
      "after",
      "\nAn interactive page's viewers can send its agent prompts, so you add them in the web app's Share dialog; here you can only remove them or make the page private.\n" +
        "\nExamples:\n" +
        "  dam artifact share 3f2a9c --add ada@example.com --add bob@example.com\n" +
        "  dam artifact share 3f2a9c --remove bob@example.com\n" +
        "  dam artifact share 3f2a9c\n",
    )
    .action(async (id: string, opts: ShareOptions) => {
      const sharing = sharingOf(opts);
      const host = await resolveActiveHost(deps, opts.server);
      const service = deps.createArtifactService(host);
      const result = await (sharing === null
        ? service.get(id)
        : service.setSharing(id, sharing));
      exitOnServiceError(result, host);
      const artifact = result.value;
      if (opts.json) {
        const { title, visibility, shareUrl, viewers } = artifact;
        return writeStdoutAndExit(
          `${JSON.stringify({ id: artifact.id, title, visibility, shareUrl, viewers })}\n`,
          EXIT_SUCCESS,
        );
      }
      return writeStdoutAndExit(renderSharing(artifact), EXIT_SUCCESS);
    });
}
