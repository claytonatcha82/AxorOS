# Sales followthrough observability

The executive dashboard activity feed surfaces Sales followthrough lifecycle states from persisted workflow events.

- `sales_followthrough_context_complete`: persisted Sales context passed deterministic assessment.
- `sales_followthrough_context_incomplete`: assessment failed closed because required context was missing.
- `sales_outreach_draft_ready_for_human_review`: governed internal outreach draft exists; no outreach or send authority is granted.

This is observability only. It does not create or trigger a second Sales execution path.