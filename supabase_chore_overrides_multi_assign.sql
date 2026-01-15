-- Add multi-assignee support for chore_overrides
alter table public.chore_overrides
  add column if not exists new_assignee_ids text[];

