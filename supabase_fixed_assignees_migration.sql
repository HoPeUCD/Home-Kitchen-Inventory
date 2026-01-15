-- Add fixed_assignee_ids to chores table
ALTER TABLE public.chores ADD COLUMN IF NOT EXISTS fixed_assignee_ids uuid[];

-- Migrate existing fixed_assignee_id to fixed_assignee_ids
UPDATE public.chores 
SET fixed_assignee_ids = ARRAY[fixed_assignee_id] 
WHERE fixed_assignee_id IS NOT NULL AND fixed_assignee_ids IS NULL;
