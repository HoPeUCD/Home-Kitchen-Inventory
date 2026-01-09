import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

// Initialize Supabase admin client
function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
  if (!supabaseServiceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

  return createClient(supabaseUrl, supabaseServiceKey);
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
  const { data: itemsData, error: itemsErr } = await supabaseAdmin
    .from('items_v2')
    .select('id, cell_id, name, qty, expires_at')
    .eq('household_id', householdId)
    .not('expires_at', 'is', null);

  if (itemsErr || !itemsData) {
    console.error('Error fetching items:', itemsErr);
    return [];
  }

  const expiringItems = itemsData
    .map((item) => {
      const days = daysUntil(item.expires_at);
      return { ...item, daysUntil: days };
    })
    .filter((item) => item.daysUntil !== null && item.daysUntil <= 30)
    .sort((a, b) => (a.daysUntil ?? Infinity) - (b.daysUntil ?? Infinity));

  const cellIds = [...new Set(expiringItems.map((item) => item.cell_id))];
  
  if (cellIds.length === 0) {
    return [];
  }

  const { data: cellsData, error: cellsErr } = await supabaseAdmin
    .from('room_cells')
    .select('id, column_id, code')
    .in('id', cellIds);

  if (cellsErr || !cellsData) {
    return expiringItems.map((item) => ({ ...item, location: 'Unknown' }));
  }

  const columnIds = [...new Set(cellsData.map((cell) => cell.column_id))];
  const { data: columnsData, error: columnsErr } = await supabaseAdmin
    .from('room_columns')
    .select('id, room_id, name')
    .in('id', columnIds);

  if (columnsErr || !columnsData) {
    return expiringItems.map((item) => {
      const cell = cellsData.find((c) => c.id === item.cell_id);
      return { ...item, location: cell ? `Cell ${cell.code}` : 'Unknown' };
    });
  }

  const roomIds = [...new Set(columnsData.map((col) => col.room_id))];
  const { data: roomsData, error: roomsErr } = await supabaseAdmin
    .from('rooms')
    .select('id, name')
    .in('id', roomIds);

  if (roomsErr || !roomsData) {
    return expiringItems.map((item) => {
      const cell = cellsData.find((c) => c.id === item.cell_id);
      const column = columnsData.find((col) => col.id === cell?.column_id);
      return { ...item, location: column ? `${column.name} / ${cell?.code}` : 'Unknown' };
    });
  }

  const cellToLocation = new Map<string, string>();
  cellsData.forEach((cell) => {
    const column = columnsData.find((col) => col.id === cell.column_id);
    const room = roomsData.find((r) => r.id === column?.room_id);
    if (room && column) {
      cellToLocation.set(cell.id, `${room.name} / ${column.name} / ${cell.code}`);
    } else {
      cellToLocation.set(cell.id, 'Unknown');
    }
  });

  return expiringItems.map((item) => ({
    name: item.name,
    qty: item.qty,
    expires_at: item.expires_at,
    daysUntil: item.daysUntil,
    location: cellToLocation.get(item.cell_id) || 'Unknown',
  }));
}

// Get household members with emails
async function getHouseholdMembers(householdId: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data: membersData, error: membersErr } = await supabaseAdmin
    .from('household_members')
    .select('user_id')
    .eq('household_id', householdId);

  if (membersErr || !membersData) {
    return [];
  }

  const userIds = membersData.map((m) => m.user_id);
  if (userIds.length === 0) {
    return [];
  }

  const { data: emailData, error: emailErr } = await supabaseAdmin.rpc('get_member_emails', {
    p_user_ids: userIds,
  });

  if (emailErr || !emailData) {
    return [];
  }

  return emailData
    .map((row: { user_id: string; email: string | null }) => row.email)
    .filter((email: string | null): email is string => email !== null && email !== '');
}

// Generate email content
function generateEmailContent(householdName: string, items: Array<{ name: string; qty: number | null; expires_at: string; daysUntil: number | null; location: string }>) {
  if (items.length === 0) {
    return {
      subject: `No Expiring Items - ${householdName}`,
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <h2>Kitchen Inventory Reminder</h2>
            <p>Hello,</p>
            <p>This is a weekly reminder for your household: <strong>${householdName}</strong></p>
            <p><strong>Good news!</strong> You have no items expiring in the next 30 days.</p>
            <p>Best regards,<br>Kitchen Inventory System</p>
          </body>
        </html>
      `,
    };
  }

  const itemsList = items
    .map((item) => {
      const status = item.daysUntil === null 
        ? '' 
        : item.daysUntil < 0 
        ? `(Expired ${Math.abs(item.daysUntil)} days ago)` 
        : item.daysUntil === 0 
        ? '(Expires today)' 
        : `(Expires in ${item.daysUntil} days)`;
      
      const qtyText = item.qty !== null ? `Quantity: ${item.qty}` : '';
      return `<li><strong>${item.name}</strong> ${qtyText} - ${item.location} ${status}</li>`;
    })
    .join('');

  return {
    subject: `Expiring Items Reminder - ${householdName}`,
    html: `
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <h2>Kitchen Inventory Reminder</h2>
          <p>Hello,</p>
          <p>This is a weekly reminder for your household: <strong>${householdName}</strong></p>
          <p>The following items are expiring soon (within 30 days) or have already expired:</p>
          <ul style="list-style-type: disc; padding-left: 20px;">
            ${itemsList}
          </ul>
          <p>Please check these items and use them before they expire!</p>
          <p>Best regards,<br>Kitchen Inventory System</p>
        </body>
      </html>
    `,
  };
}

// Send email
async function sendEmail(recipients: string[], subject: string, html: string) {
  const transporter = createTransporter();
  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;

  if (!fromEmail) {
    throw new Error('SMTP_FROM or SMTP_USER environment variable is required');
  }

  await transporter.sendMail({
    from: fromEmail,
    to: recipients.join(', '),
    subject,
    html,
  });
}

// GET endpoint: Called by Vercel Cron (weekly on Sunday at 8 PM)
export async function GET(req: NextRequest) {
  try {
    // Verify cron secret (optional but recommended for security)
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all households
    const supabaseAdmin = getSupabaseAdmin();
    const { data: households, error: householdsError } = await supabaseAdmin
      .from('households')
      .select('id, name');

    if (householdsError || !households) {
      console.error('Error fetching households:', householdsError);
      return NextResponse.json({ error: 'Failed to fetch households' }, { status: 500 });
    }

    const results = [];

    // Process each household
    for (const household of households) {
      try {
        // Get expiring items
        const expiringItems = await getExpiringItems(household.id);

        // Get household members' emails
        const memberEmails = await getHouseholdMembers(household.id);

        if (memberEmails.length === 0) {
          results.push({
            householdId: household.id,
            householdName: household.name,
            status: 'skipped',
            reason: 'No members with email addresses',
            itemsCount: expiringItems.length,
          });
          continue;
        }

        // Generate email content
        const { subject, html } = generateEmailContent(household.name, expiringItems);

        // Send email
        await sendEmail(memberEmails, subject, html);

        results.push({
          householdId: household.id,
          householdName: household.name,
          status: 'success',
          recipients: memberEmails.length,
          itemsCount: expiringItems.length,
        });
      } catch (error: any) {
        console.error(`Error processing household ${household.id}:`, error);
        results.push({
          householdId: household.id,
          householdName: household.name,
          status: 'error',
          error: error.message,
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Weekly reminder processed',
      timestamp: new Date().toISOString(),
      results,
    });
  } catch (error: any) {
    console.error('Error in weekly-reminder cron:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
