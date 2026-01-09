import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function GET(req: NextRequest) {
  try {
    // Check if there's an auth token in the request
    const authHeader = req.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ authenticated: false }, { status: 200 });
    }

    // Verify the token using Supabase
    const token = authHeader.substring(7);
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return NextResponse.json({ authenticated: false }, { status: 200 });
    }

    return NextResponse.json({ 
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
      }
    }, { status: 200 });
  } catch (error) {
    // Return unauthenticated on any error
    return NextResponse.json({ authenticated: false }, { status: 200 });
  }
}
