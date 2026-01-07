-- Add tag and remark columns to items_v2 table

ALTER TABLE items_v2 
ADD COLUMN IF NOT EXISTS tag TEXT,
ADD COLUMN IF NOT EXISTS remark TEXT;

-- Add comments for documentation
COMMENT ON COLUMN items_v2.tag IS 'Optional tag/label for the item (e.g., "Organic", "Frozen")';
COMMENT ON COLUMN items_v2.remark IS 'Optional remark/notes for the item';
