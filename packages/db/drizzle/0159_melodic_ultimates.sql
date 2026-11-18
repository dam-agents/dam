-- A Satellite may be a tool surface or a file tree. A files Satellite offers no
-- tools, and whether its worker was started writable decides whether its mount
-- refuses every change. Both defaults keep every Satellite registered so far a
-- tools one.
ALTER TABLE "satellites" ADD COLUMN "kind" text DEFAULT 'tools' NOT NULL;--> statement-breakpoint
ALTER TABLE "satellites" ADD COLUMN "files_writable" boolean DEFAULT false NOT NULL;