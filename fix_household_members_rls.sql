-- Fix RLS policy for household_members to allow users to see all members of their households
-- This avoids infinite recursion by using a security definer function

-- Step 1: Drop the existing problematic policy if it exists
DROP POLICY IF EXISTS "Users can view all members of their households" ON household_members;

-- Step 2: Create a security definer function to check household membership
-- This function runs with the privileges of the function creator, bypassing RLS
-- This avoids the infinite recursion issue
CREATE OR REPLACE FUNCTION user_belongs_to_household(p_household_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM household_members
    WHERE household_id = p_household_id
      AND user_id = auth.uid()
  );
END;
$$;

-- Step 3: Create the RLS policy using the function (avoids recursion)
CREATE POLICY "Users can view all members of their households"
ON household_members FOR SELECT
USING (user_belongs_to_household(household_id));

-- Note: If you still get recursion errors, try this alternative approach:
-- The key is that the function uses SECURITY DEFINER, which means it runs
-- with the privileges of the function creator (typically the postgres superuser),
-- bypassing RLS checks and avoiding recursion.
