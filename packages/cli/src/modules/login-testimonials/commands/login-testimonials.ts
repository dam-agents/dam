import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  resolve,
} from "node:path";
import { Command } from "commander";
import { loginTestimonialsSaveInputSchema } from "api-server-api";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { confirm, exitCancelled } from "../../shared/prompt.js";
import { renderTable } from "../../shared/render-table.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { LoginTestimonialsService } from "../services/login-testimonials-service.js";
import {
  testimonialsFileSchema,
  type TestimonialsFile,
} from "./file-format.js";

interface Deps {
  compatService: CompatService;
  configService: ConfigService;
  createService: (host: string) => LoginTestimonialsService;
}

interface CommonOptions {
  server?: string;
  json?: boolean;
}

const PHOTO_PLACEHOLDER = "0".repeat(64);

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

function fail(message: string, code = EXIT_INVALID_INPUT): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(code);
}

function slug(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-") || "photo"
  );
}

function serverOption(command: Command): Command {
  return command.option(
    "--server <url>",
    "override the configured server URL for this call",
  );
}

function buildListCommand(deps: Deps): Command {
  return serverOption(
    new Command("list")
      .description(
        "List the testimonials the login page shows, in order (platform operators only)",
      )
      .option("--json", "emit the testimonials as JSON"),
  ).action(async (opts: CommonOptions) => {
    const host = await resolveActiveHost(deps, opts.server);
    const list = await deps.createService(host).list();
    exitOnServiceError(list, host);
    if (opts.json)
      return writeStdoutAndExit(
        `${JSON.stringify(list.value)}\n`,
        EXIT_SUCCESS,
      );
    if (list.value.length === 0)
      return writeStdoutAndExit(
        "No testimonials: the login page leaves the section out.\n",
        EXIT_SUCCESS,
      );
    return writeStdoutAndExit(
      renderTable([
        ["#", "NAME", "ROLE", "PHOTO", "QUOTE"],
        ...list.value.map((t, i) => [
          String(i + 1),
          t.name,
          t.role,
          t.photoId ? "yes" : "-",
          t.quote.length > 60 ? `${t.quote.slice(0, 57)}...` : t.quote,
        ]),
      ]),
      EXIT_SUCCESS,
    );
  });
}

function buildExportCommand(deps: Deps): Command {
  return serverOption(
    new Command("export")
      .description(
        "Write the testimonials to a JSON file, with each photo as a PNG beside it, for `import` (platform operators only)",
      )
      .argument("<file>", "the JSON file to write"),
  ).action(async (file: string, opts: CommonOptions) => {
    const host = await resolveActiveHost(deps, opts.server);
    const service = deps.createService(host);
    const list = await service.list();
    exitOnServiceError(list, host);
    const path = resolve(file);
    const photoDir = join(
      dirname(path),
      `${basename(path, extname(path))}-photos`,
    );
    const out: TestimonialsFile = { testimonials: [] };
    for (const [i, t] of list.value.entries()) {
      let photo: string | null = null;
      if (t.photoId) {
        await mkdir(photoDir, { recursive: true });
        const name = `${String(i + 1).padStart(2, "0")}-${slug(t.name)}.png`;
        await writeFile(
          join(photoDir, name),
          await service.downloadPhoto(t.photoId),
        );
        photo = join(basename(photoDir), name);
      }
      out.testimonials.push({
        name: t.name,
        role: t.role,
        quote: t.quote,
        photo,
      });
    }
    await writeFile(path, `${JSON.stringify(out, null, 2)}\n`);
    return writeStdoutAndExit(
      `Wrote ${out.testimonials.length} testimonials to ${file}.\n`,
      EXIT_SUCCESS,
    );
  });
}

async function readTestimonialsFile(path: string): Promise<TestimonialsFile> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    fail(`cannot read ${path}: ${(e as Error).message}`);
  }
  const parsed = testimonialsFileSchema.safeParse(raw);
  if (!parsed.success)
    fail(
      `${path} is not a testimonials file: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    );
  return parsed.data;
}

function buildImportCommand(deps: Deps): Command {
  return serverOption(
    new Command("import")
      .description(
        "Replace the login page's testimonials with those in a JSON file, uploading each photo (platform operators only)",
      )
      .argument(
        "<file>",
        "JSON: { testimonials: [{ name, role, quote, photo }] }, photo a PNG or JPG path relative to the file",
      )
      .option("--yes", "skip the confirmation prompt")
      .option("--json", "emit the saved testimonials as JSON")
      .addHelpText(
        "after",
        "\nA quote may name the product as {brand}.\n" +
          "Example:\n  dam login-testimonials import testimonials.json\n",
      ),
  ).action(async (file: string, opts: CommonOptions & { yes?: boolean }) => {
    const path = resolve(file);
    const parsed = await readTestimonialsFile(path);
    const checked = loginTestimonialsSaveInputSchema.safeParse({
      testimonials: parsed.testimonials.map((t) => ({
        name: t.name,
        role: t.role,
        quote: t.quote,
        photoId: t.photo ? PHOTO_PLACEHOLDER : null,
      })),
    });
    if (!checked.success) {
      const issue = checked.error.issues[0];
      fail(
        `${issue?.path.join(".") ?? "testimonials"}: ${issue?.message ?? "invalid"}`,
      );
    }
    for (const t of parsed.testimonials)
      if (t.photo && !IMAGE_TYPES[extname(t.photo).toLowerCase()])
        fail(`${t.photo}: a photo must be a .png, .jpg or .jpeg file`);
    const host = await resolveActiveHost(deps, opts.server);
    const service = deps.createService(host);
    const current = await service.list();
    exitOnServiceError(current, host);
    if (!opts.yes) {
      if (process.stdin.isTTY !== true)
        fail(
          "refusing to replace the testimonials without --yes on a non-TTY",
          EXIT_RUNTIME_FAILURE,
        );
      const ok = await confirm(
        `Replace the ${current.value.length} testimonials on ${host} with the ${parsed.testimonials.length} in ${file}?`,
      );
      if (!ok) exitCancelled(opts);
    }
    const testimonials = [];
    for (const t of parsed.testimonials) {
      let photoId: string | null = null;
      if (t.photo) {
        const photoPath = isAbsolute(t.photo)
          ? t.photo
          : join(dirname(path), t.photo);
        const type = IMAGE_TYPES[extname(photoPath).toLowerCase()];
        if (!type)
          fail(`${t.photo}: a photo must be a .png, .jpg or .jpeg file`);
        try {
          const bytes = await readFile(photoPath);
          photoId = await service.uploadPhoto(new Blob([bytes], { type }));
        } catch (e) {
          fail(
            `photo of ${t.name}: ${(e as Error).message}`,
            EXIT_RUNTIME_FAILURE,
          );
        }
      }
      testimonials.push({
        name: t.name,
        role: t.role,
        quote: t.quote,
        photoId,
      });
    }
    const input = loginTestimonialsSaveInputSchema.safeParse({ testimonials });
    if (!input.success) {
      const issue = input.error.issues[0];
      fail(
        `${issue?.path.join(".") ?? "testimonials"}: ${issue?.message ?? "invalid"}`,
      );
    }
    const saved = await service.save(input.data);
    exitOnServiceError(saved, host);
    return writeStdoutAndExit(
      opts.json
        ? `${JSON.stringify(saved.value)}\n`
        : `Saved ${saved.value.length} testimonials. The login page shows them within a minute.\n`,
      EXIT_SUCCESS,
    );
  });
}

export function buildLoginTestimonialsCommands(deps: Deps): Command[] {
  return [
    buildListCommand(deps),
    buildExportCommand(deps),
    buildImportCommand(deps),
  ];
}
