-- Sidebar order: pins are gone, and the sidebar keeps one manual order per
-- list instead. The pin tables already hold the user's drag order, so they are
-- renamed, not dropped: the pinned Agents and Sessions stay at the top of the
-- new order, and items the order does not name yet follow them.
ALTER TABLE "sidebar_agent_pins" RENAME TO "sidebar_agent_order";--> statement-breakpoint
ALTER TABLE "sidebar_session_pins" RENAME TO "sidebar_session_order";--> statement-breakpoint
DROP INDEX "sidebar_agent_pins_agent_idx";--> statement-breakpoint
DROP INDEX "sidebar_session_pins_agent_idx";--> statement-breakpoint
ALTER TABLE "sidebar_agent_order" DROP CONSTRAINT "sidebar_agent_pins_owner_agent_id_pk";--> statement-breakpoint
ALTER TABLE "sidebar_session_order" DROP CONSTRAINT "sidebar_session_pins_owner_agent_id_session_id_pk";--> statement-breakpoint
ALTER TABLE "sidebar_agent_order" ADD CONSTRAINT "sidebar_agent_order_owner_agent_id_pk" PRIMARY KEY("owner","agent_id");--> statement-breakpoint
ALTER TABLE "sidebar_session_order" ADD CONSTRAINT "sidebar_session_order_owner_agent_id_session_id_pk" PRIMARY KEY("owner","agent_id","session_id");--> statement-breakpoint
CREATE INDEX "sidebar_agent_order_agent_idx" ON "sidebar_agent_order" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "sidebar_session_order_agent_idx" ON "sidebar_session_order" USING btree ("agent_id");