-- The Getting Started checklist is per user. A user unlocks one avatar
-- character for each checklist task they finish. A row is kept after the
-- thing that unlocked it is deleted, so an avatar never locks again.
-- An unlock stays marked new in the avatar picker until the user picks it.
CREATE TABLE "avatar_unlocks" (
	"owner" text NOT NULL,
	"task" text NOT NULL,
	"character" text NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone,
	"picked_at" timestamp with time zone,
	CONSTRAINT "avatar_unlocks_owner_task_pk" PRIMARY KEY("owner","task")
);
--> statement-breakpoint
CREATE TABLE "getting_started_checklists" (
	"owner" text PRIMARY KEY NOT NULL,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "avatar_unlocks" ADD CONSTRAINT "avatar_unlocks_owner_getting_started_checklists_owner_fk" FOREIGN KEY ("owner") REFERENCES "public"."getting_started_checklists"("owner") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "avatar_unlocks_owner_character_idx" ON "avatar_unlocks" USING btree ("owner","character");