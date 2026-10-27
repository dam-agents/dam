ALTER TABLE "channels" ADD COLUMN "session_pair" jsonb;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "platform_subagent_profile" text;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "platform_subagent_settings" jsonb;--> statement-breakpoint
ALTER TABLE "telegram_conversations" ADD COLUMN "session_pair" jsonb;--> statement-breakpoint
ALTER TABLE "telegram_conversations" ADD COLUMN "platform_subagent_profile" text;--> statement-breakpoint
ALTER TABLE "telegram_conversations" ADD COLUMN "platform_subagent_settings" jsonb;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_platform_subagent_profile_profiles_id_fk" FOREIGN KEY ("platform_subagent_profile") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_conversations" ADD CONSTRAINT "telegram_conversations_platform_subagent_profile_profiles_id_fk" FOREIGN KEY ("platform_subagent_profile") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_session_pair_xor_profile" CHECK ("channels"."profile_id" is null or "channels"."session_pair" is null);--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_platform_subagent_xor_profile" CHECK ("channels"."platform_subagent_profile" is null or "channels"."platform_subagent_settings" is null);--> statement-breakpoint
ALTER TABLE "telegram_conversations" ADD CONSTRAINT "telegram_conversations_session_pair_xor_profile" CHECK ("telegram_conversations"."profile_id" is null or "telegram_conversations"."session_pair" is null);--> statement-breakpoint
ALTER TABLE "telegram_conversations" ADD CONSTRAINT "telegram_conversations_platform_subagent_xor_profile" CHECK ("telegram_conversations"."platform_subagent_profile" is null or "telegram_conversations"."platform_subagent_settings" is null);