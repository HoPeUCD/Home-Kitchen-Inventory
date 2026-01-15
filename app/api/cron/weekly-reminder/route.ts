import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { Database } from '@/src/lib/database.types';

// Initialize Supabase admin client
function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
  if (!supabaseServiceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

  return createClient<Database>(supabaseUrl, supabaseServiceKey);
}

// SMTP configuration
function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });
}

// Calculate days until expiration
function daysUntil(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiresAt + 'T00:00:00');
  expiry.setHours(0, 0, 0, 0);
  const diffTime = expiry.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

// Get items expiring soon for a household
async function getExpiringItems(householdId: string) {
  const supabaseAdmin = getSupabaseAdmin();
  
  // Use a single query with joins to fetch all necessary location data
  const { data: itemsData, error: itemsErr } = await supabaseAdmin
    .from('items_v2')
    .select(`
      id, 
      cell_id, 
      name, 
      qty, 
      expires_at,
      room_cells (
        code,
        room_columns (
          name,
          rooms (
            name
          )
        )
      )
    `)
    .eq('household_id', householdId)
    .not('expires_at', 'is', null);

  if (itemsErr || !itemsData) {
    console.error('Error fetching items:', itemsErr);
    return [];
  }

  // Process and filter items
  const expiringItems = itemsData
    .map((item) => {
      const days = daysUntil(item.expires_at);
      
      // Construct location string from joined data
      let location = 'Unknown';
      const cell = item.room_cells;
      if (cell) {
        const column = cell.room_columns;
        const room = column?.rooms;
        
        // Format: "Room Name - Column Name - Cell Code"
        const parts = [];
        if (room?.name) parts.push(room.name);
        if (column?.name) parts.push(column.name);
        if (cell.code) parts.push(cell.code);
        
        if (parts.length > 0) {
          location = parts.join(' - ');
        }
      }

      return { 
        id: item.id,
        name: item.name,
        qty: item.qty,
        expires_at: item.expires_at,
        daysUntil: days,
        location
      };
    })
    .filter((item) => item.daysUntil !== null && item.daysUntil <= 30)
    .sort((a, b) => (a.daysUntil ?? Infinity) - (b.daysUntil ?? Infinity));

  return expiringItems;
}

export async function POST(req: NextRequest) {
  try {
    // Verify authentication (CRON_SECRET)
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 1. Get all profiles with a default household
    // Note: In a real production app with many users, we should paginate this
    // or use a queue system. For now, fetching all is fine for small scale.
    const { data: profiles, error: profilesErr } = await supabaseAdmin
      .from('profiles')
      .select('user_id, default_household_id')
      .not('default_household_id', 'is', null);

    if (profilesErr) throw profilesErr;
    if (!profiles || profiles.length === 0) {
      return NextResponse.json({ message: 'No profiles found' });
    }

    // 2. Get emails for these users
    // We can't join auth.users directly, so we use a loop or a specialized RPC if available.
    // Assuming we have many users, RPC is better, but let's stick to admin API for now 
    // or use the 'get_member_emails' RPC if it supports batch fetching by user IDs.
    // For simplicity here, we'll group by household to avoid duplicate processing.
    
    // Group users by household to send consolidated reports or just process per user?
    // The requirement implies sending to the user about their default household.
    
    const results = [];
    const transporter = createTransporter();

    for (const profile of profiles) {
      if (!profile.default_household_id) continue;

      // Fetch expiring items for this household
      const items = await getExpiringItems(profile.default_household_id);
      
      if (items.length === 0) continue;

      // Get user email
      const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.getUserById(profile.user_id);
      
      if (userErr || !userData.user || !userData.user.email) {
        console.error(`Could not fetch email for user ${profile.user_id}`);
        continue;
      }

      const email = userData.user.email;

      // Compose email
      const itemsHtml = items
        .map(
          (item) => `
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 8px;">${item.name}</td>
          <td style="padding: 8px;">${item.location}</td>
          <td style="padding: 8px; color: ${
            (item.daysUntil ?? 0) < 0 ? 'red' : (item.daysUntil ?? 0) <= 7 ? 'orange' : 'black'
          };">
            ${
              (item.daysUntil ?? 0) < 0
                ? `Expired ${Math.abs(item.daysUntil ?? 0)} days ago`
                : (item.daysUntil ?? 0) === 0
                ? 'Expires today'
                : `Expires in ${item.daysUntil} days`
            }
          </td>
        </tr>
      `
        )
        .join('');

      const html = `
        <div style="font-family: sans-serif; color: #333;">
          <h2>Kitchen Inventory Expiry Reminder</h2>
          <p>You have ${items.length} item(s) expiring soon in your household.</p>
          
          <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
            <thead>
              <tr style="background-color: #f5f5f5; text-align: left;">
                <th style="padding: 8px;">Item</th>
                <th style="padding: 8px;">Location</th>
                <th style="padding: 8px;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
          
          <p style="margin-top: 20px; color: #666; font-size: 12px;">
            This is an automated weekly reminder from your Kitchen Inventory app.
          </p>
        </div>
      `;

      // Send email
      try {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || '"Kitchen Inventory" <noreply@kitchen-inventory.com>',
          to: email,
          subject: `[Kitchen Inventory] ${items.length} Items Expiring Soon`,
          html,
        });
        results.push({ userId: profile.user_id, sent: true });
      } catch (sendErr) {
        console.error(`Failed to send email to ${email}:`, sendErr);
        results.push({ userId: profile.user_id, sent: false, error: sendErr });
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    console.error('Cron job failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
