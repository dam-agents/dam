-- Sidebar order: Sessions are listed by last activity, newest first, and the
-- user no longer drags them, so the stored Session order goes. Agents keep their
-- manual order in sidebar_agent_order.
DROP TABLE "sidebar_session_order" CASCADE;