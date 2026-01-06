-- Create an RPC function to get member emails for household members
-- This uses SECURITY DEFINER to access auth.users table safely

CREATE OR REPLACE FUNCTION get_member_emails(p_user_ids UUID[])
RETURNS TABLE (user_id UUID, email TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
BEGIN
  -- This function runs with the privileges of the function creator
  -- allowing it to read from auth.users table
  RETURN QUERY
  SELECT 
    u.id::UUID as user_id,
    u.email::TEXT as email
  FROM auth.users u
  WHERE u.id = ANY(p_user_ids);
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_member_emails(UUID[]) TO authenticated;
