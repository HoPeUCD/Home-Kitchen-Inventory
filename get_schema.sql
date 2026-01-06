-- 1. 查看所有表及其列信息
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('profiles', 'households', 'household_members', 'rooms', 'room_columns', 'room_cells', 'items_v2')
ORDER BY table_name, ordinal_position;

-- 2. 查看外键关系
SELECT
    tc.table_name AS source_table,
    kcu.column_name AS source_column,
    ccu.table_name AS target_table,
    ccu.column_name AS target_column,
    tc.constraint_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name IN ('profiles', 'households', 'household_members', 'rooms', 'room_columns', 'room_cells', 'items_v2')
ORDER BY tc.table_name;

-- 3. 查看主键
SELECT
    tc.table_name,
    kcu.column_name AS primary_key_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
WHERE tc.constraint_type = 'PRIMARY KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name IN ('profiles', 'households', 'household_members', 'rooms', 'room_columns', 'room_cells', 'items_v2')
ORDER BY tc.table_name;

-- 4. 查看 profiles 表的详细结构（特别重要）
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default,
    character_maximum_length
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'profiles'
ORDER BY ordinal_position;

-- 5. 查看示例数据（了解实际数据结构）
-- 注意：这些查询会返回实际数据，如果表很大可能需要限制行数

-- Profiles 示例
SELECT id, user_id, default_household_id, created_at
FROM profiles
LIMIT 5;

-- Households 示例
SELECT id, name, join_code, created_at
FROM households
LIMIT 5;

-- Rooms 示例（查看 household_id 关系）
SELECT r.id, r.name, r.household_id, h.name AS household_name
FROM rooms r
LEFT JOIN households h ON r.household_id = h.id
LIMIT 10;

-- 6. 检查是否有索引（有助于理解查询性能）
SELECT
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('profiles', 'households', 'household_members', 'rooms', 'room_columns', 'room_cells', 'items_v2')
ORDER BY tablename, indexname;