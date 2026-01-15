import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { startOfWeek, endOfWeek, differenceInCalendarWeeks } from 'date-fns';
import { Database } from '@/src/lib/database.types';
import { calculateChoreOccurrences, ChoreOccurrence } from '@/src/lib/chores';

// Initialize Supabase admin client
function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
  if (!supabaseServiceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

  return createClient<Database>(supabaseUrl, supabaseServiceKey);
}

type SupabaseAdminClient = ReturnType<typeof getSupabaseAdmin>;

type Chore = Database['public']['Tables']['chores']['Row'];
type ChoreOverride = Database['public']['Tables']['chore_overrides']['Row'];
type ChoreCompletion = Database['public']['Tables']['chore_completions']['Row'];
type ChoreZone = Database['public']['Tables']['chore_zones']['Row'];

type HouseholdMemberInfo = {
  userId: string;
  email: string | null;
};

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

type PendingChoreEmailItem = {
  title: string;
  zoneName: string | null;
  dueDate: string;
  weeksOverdue?: number;
   assigneeIds: string[];
};

async function getHouseholdChoreSummary(
  supabaseAdmin: SupabaseAdminClient,
  householdId: string
): Promise<{ overdue: PendingChoreEmailItem[]; thisWeek: PendingChoreEmailItem[] }> {
  const { data: choresData, error: choresErr } = await supabaseAdmin
    .from('chores')
    .select('*')
    .eq('household_id', householdId)
    .eq('archived', false);

  if (choresErr || !choresData || choresData.length === 0) {
    if (choresErr) {
      console.error('Error fetching chores for household', householdId, choresErr);
    }
    return { overdue: [], thisWeek: [] };
  }

  const choreIds = choresData.map((c) => c.id);

  const { data: overridesData, error: overridesErr } = await supabaseAdmin
    .from('chore_overrides')
    .select('*')
    .in('chore_id', choreIds);

  if (overridesErr) {
    console.error('Error fetching chore overrides for household', householdId, overridesErr);
  }

  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const startOfYearIso = yearStart.toISOString();

  const { data: completionsData, error: completionsErr } = await supabaseAdmin
    .from('chore_completions')
    .select('*')
    .in('chore_id', choreIds)
    .gte('completed_at', startOfYearIso);

  if (completionsErr) {
    console.error('Error fetching chore completions for household', householdId, completionsErr);
  }

  const { data: zonesData, error: zonesErr } = await supabaseAdmin
    .from('chore_zones')
    .select('*')
    .eq('household_id', householdId);

  if (zonesErr) {
    console.error('Error fetching chore zones for household', householdId, zonesErr);
  }

  const overrides = (overridesData || []) as ChoreOverride[];
  const completions = (completionsData || []) as ChoreCompletion[];
  const zones = (zonesData || []) as ChoreZone[];

  const overdue: PendingChoreEmailItem[] = [];
  const thisWeek: PendingChoreEmailItem[] = [];

  (choresData as Chore[]).forEach((chore) => {
    const choreOverrides = overrides.filter((o) => o.chore_id === chore.id);
    const choreCompletions = completions.filter((c) => c.chore_id === chore.id);

    const occurrences: ChoreOccurrence[] = calculateChoreOccurrences(
      chore,
      choreOverrides,
      choreCompletions,
      yearStart,
      weekEnd
    );

    occurrences.forEach((occ: ChoreOccurrence) => {
      if (occ.status === 'skipped' || occ.status === 'completed') return;

      const due = new Date(occ.date);
      const dueDateStr = due.toISOString().split('T')[0];
      const zone = zones.find((z) => z.id === chore.zone_id);
      const zoneName = zone?.name || chore.zone || null;

      if (due < weekStart) {
        const weeksOverdue = differenceInCalendarWeeks(now, due);
        overdue.push({
          title: chore.title,
          zoneName,
          dueDate: dueDateStr,
          weeksOverdue: weeksOverdue > 0 ? weeksOverdue : undefined,
          assigneeIds: occ.assigneeIds || [],
        });
      } else if (due >= weekStart && due <= weekEnd) {
        thisWeek.push({
          title: chore.title,
          zoneName,
          dueDate: dueDateStr,
          assigneeIds: occ.assigneeIds || [],
        });
      }
    });
  });

  const sortByZoneThenTitle = (a: PendingChoreEmailItem, b: PendingChoreEmailItem) => {
    const zoneA = a.zoneName || 'ZZZ';
    const zoneB = b.zoneName || 'ZZZ';
    const zoneCompare = zoneA.localeCompare(zoneB);
    if (zoneCompare !== 0) return zoneCompare;
    return a.title.localeCompare(b.title);
  };

  overdue.sort(sortByZoneThenTitle);
  thisWeek.sort(sortByZoneThenTitle);

  return { overdue, thisWeek };
}

async function getHouseholdMembers(
  supabaseAdmin: SupabaseAdminClient,
  householdId: string
): Promise<HouseholdMemberInfo[]> {
  const { data: membersData, error: membersErr } = await supabaseAdmin
    .from('household_members')
    .select('user_id')
    .eq('household_id', householdId);

  if (membersErr || !membersData) {
    console.error('Error fetching household members for household', householdId, membersErr);
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
    console.error('Error fetching member emails for household', householdId, emailErr);
    return membersData.map((m) => ({
      userId: m.user_id,
      email: null,
    }));
  }

  const emailByUserId = new Map<string, string | null>();
  (emailData as { user_id: string; email: string | null }[]).forEach((row) => {
    emailByUserId.set(row.user_id, row.email);
  });

  return membersData.map((m) => ({
    userId: m.user_id,
    email: emailByUserId.get(m.user_id) ?? null,
  }));
}

function buildChoreRows(
  items: PendingChoreEmailItem[],
  members: HouseholdMemberInfo[],
  recipientEmail: string,
  statusTextBuilder: (item: PendingChoreEmailItem) => string
): string {
  const labelByUserId = new Map<string, string>();
  members.forEach((m) => {
    const label = m.email ? m.email.split('@')[0] : m.userId;
    labelByUserId.set(m.userId, label);
  });

  const selfUserIds = members
    .filter((m) => m.email === recipientEmail)
    .map((m) => m.userId);

  return items
    .map((item) => {
      const assigneeIds = item.assigneeIds || [];
      const assigneeLabels =
        assigneeIds.length > 0
          ? assigneeIds.map((id) => labelByUserId.get(id) || 'Unknown')
          : ['Unassigned'];
      const assigneeText = assigneeLabels.join(', ');
      const isMine =
        selfUserIds.length > 0 && assigneeIds.some((id) => selfUserIds.includes(id));
      const rowStyle = isMine ? 'font-weight: bold;' : '';
      const statusText = statusTextBuilder(item);

      return `
        <tr style="border-bottom: 1px solid #eee; ${rowStyle}">
          <td style="padding: 8px;">${item.title}</td>
          <td style="padding: 8px;">${item.zoneName || ''}</td>
          <td style="padding: 8px;">${assigneeText}</td>
          <td style="padding: 8px;">${statusText}</td>
        </tr>
      `;
    })
    .join('');
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

async function handleCron(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
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

      const items = await getExpiringItems(profile.default_household_id);

      const choreSummary = await getHouseholdChoreSummary(
        supabaseAdmin,
        profile.default_household_id
      );

      const members = await getHouseholdMembers(
        supabaseAdmin,
        profile.default_household_id
      );

      const hasChores =
        choreSummary.overdue.length > 0 || choreSummary.thisWeek.length > 0;

      if (items.length === 0 && !hasChores) continue;

      // Get user email
      const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.getUserById(profile.user_id);
      
      if (userErr || !userData.user || !userData.user.email) {
        console.error(`Could not fetch email for user ${profile.user_id}`);
        continue;
      }

      const email = userData.user.email;

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

      const overdueChoresRows = buildChoreRows(
        choreSummary.overdue,
        members,
        email,
        (item) =>
          item.weeksOverdue && item.weeksOverdue > 0
            ? `Overdue ${item.weeksOverdue} week(s)`
            : 'Overdue'
      );

      const thisWeekChoresRows = buildChoreRows(
        choreSummary.thisWeek,
        members,
        email,
        () => 'This week'
      );

      const choresSection =
        hasChores &&
        `
          <div style="margin-top: 30px;">
            <h3>Chores This Week</h3>
            ${
              choreSummary.overdue.length > 0
                ? `
            <h4 style="margin-top: 10px;">Overdue</h4>
            <table style="width: 100%; border-collapse: collapse; margin-top: 8px;">
              <thead>
                <tr style="background-color: #f5f5f5; text-align: left;">
                  <th style="padding: 8px;">Chore</th>
                  <th style="padding: 8px;">Zone</th>
                  <th style="padding: 8px;">Assignee(s)</th>
                  <th style="padding: 8px;">Status</th>
                </tr>
              </thead>
              <tbody>
                ${overdueChoresRows}
              </tbody>
            </table>
            `
                : ''
            }
            ${
              choreSummary.thisWeek.length > 0
                ? `
            <h4 style="margin-top: 16px;">To Do This Week</h4>
            <table style="width: 100%; border-collapse: collapse; margin-top: 8px;">
              <thead>
                <tr style="background-color: #f5f5f5; text-align: left;">
                  <th style="padding: 8px;">Chore</th>
                  <th style="padding: 8px;">Zone</th>
                  <th style="padding: 8px;">Assignee(s)</th>
                  <th style="padding: 8px;">Status</th>
                </tr>
              </thead>
              <tbody>
                ${thisWeekChoresRows}
              </tbody>
            </table>
            `
                : ''
            }
          </div>
      `;

      const inventorySection =
        items.length > 0
          ? `
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
          `
          : '<p>You have no items expiring in the next 30 days.</p>';

      const html = `
        <div style="font-family: sans-serif; color: #333;">
          <h2>Kitchen Inventory Weekly Reminder</h2>
          ${inventorySection}
          ${choresSection || ''}
          <p style="margin-top: 20px; color: #666; font-size: 12px;">
            This is an automated weekly reminder from your Kitchen Inventory app.
          </p>
        </div>
      `;

      const subjectParts: string[] = [];
      if (items.length > 0) {
        subjectParts.push(`${items.length} Items Expiring Soon`);
      }
      if (hasChores) {
        const choreCount =
          choreSummary.overdue.length + choreSummary.thisWeek.length;
        subjectParts.push(`${choreCount} Chores Pending`);
      }
      const subject =
        subjectParts.length > 0
          ? `[Kitchen Inventory] ${subjectParts.join(' · ')}`
          : '[Kitchen Inventory] Weekly Reminder';

      try {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || '"Kitchen Inventory" <noreply@kitchen-inventory.com>',
          to: email,
          subject,
          html,
        });
        results.push({ userId: profile.user_id, sent: true });
      } catch (sendErr) {
        console.error(`Failed to send email to ${email}:`, sendErr);
        results.push({ userId: profile.user_id, sent: false, error: sendErr });
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error('Cron job failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return handleCron(req);
}

export async function GET(req: NextRequest) {
  return handleCron(req);
}
