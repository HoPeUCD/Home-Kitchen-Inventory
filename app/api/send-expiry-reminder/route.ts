import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { startOfWeek, endOfWeek, differenceInCalendarWeeks } from 'date-fns';
import { Database } from '@/src/lib/database.types';
import { calculateChoreOccurrences, ChoreOccurrence } from '@/src/lib/chores';

// Initialize Supabase admin client (using service role key for server-side operations)
function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
  if (!supabaseServiceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

  return createClient(supabaseUrl, supabaseServiceKey);
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

// SMTP configuration from environment variables
function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
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

// Get items expiring soon (within next 30 days or already expired)
async function getExpiringItems(householdId: string) {
  const supabaseAdmin = getSupabaseAdmin();
  // Get all items for this household
  const { data: itemsData, error: itemsErr } = await supabaseAdmin
    .from('items_v2')
    .select('id, cell_id, name, qty, expires_at')
    .eq('household_id', householdId)
    .not('expires_at', 'is', null);

  if (itemsErr || !itemsData) {
    console.error('Error fetching items:', itemsErr);
    return [];
  }

  // Filter items expiring within 30 days or already expired
  const expiringItems = itemsData
    .map((item) => {
      const days = daysUntil(item.expires_at);
      return { ...item, daysUntil: days };
    })
    .filter((item) => item.daysUntil !== null && item.daysUntil <= 30)
    .sort((a, b) => (a.daysUntil ?? Infinity) - (b.daysUntil ?? Infinity));

  // Get location information for each item
  const cellIds = [...new Set(expiringItems.map((item) => item.cell_id))];
  
  if (cellIds.length === 0) {
    return [];
  }

  // Get all cells
  const { data: cellsData, error: cellsErr } = await supabaseAdmin
    .from('room_cells')
    .select('id, column_id, code')
    .in('id', cellIds);

  if (cellsErr || !cellsData) {
    console.error('Error fetching cells:', cellsErr);
    return expiringItems.map((item) => ({ ...item, location: 'Unknown' }));
  }

  const columnIds = [...new Set(cellsData.map((cell) => cell.column_id))];
  const { data: columnsData, error: columnsErr } = await supabaseAdmin
    .from('room_columns')
    .select('id, room_id, name')
    .in('id', columnIds);

  if (columnsErr || !columnsData) {
    console.error('Error fetching columns:', columnsErr);
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
    console.error('Error fetching rooms:', roomsErr);
    return expiringItems.map((item) => {
      const cell = cellsData.find((c) => c.id === item.cell_id);
      const column = columnsData.find((col) => col.id === cell?.column_id);
      return { ...item, location: column ? `${column.name} / ${cell?.code}` : 'Unknown' };
    });
  }

  // Build location map
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

// Get all members of a household with their emails
async function getHouseholdMembers(householdId: string): Promise<HouseholdMemberInfo[]> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data: membersData, error: membersErr } = await supabaseAdmin
    .from('household_members')
    .select('user_id')
    .eq('household_id', householdId);

  if (membersErr || !membersData) {
    console.error('Error fetching household members:', membersErr);
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
    console.error('Error fetching member emails:', emailErr);
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

function buildChoreRowsForMember(
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

function generateEmailContent(
  householdName: string,
  items: Array<{ name: string; qty: number | null; expires_at: string; daysUntil: number | null; location: string }>,
  choreSummary: { overdue: PendingChoreEmailItem[]; thisWeek: PendingChoreEmailItem[] },
  members: HouseholdMemberInfo[],
  recipientEmail: string
) {
  const hasItems = items.length > 0;
  const hasChores =
    choreSummary.overdue.length > 0 || choreSummary.thisWeek.length > 0;

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

  const overdueChoresRows = buildChoreRowsForMember(
    choreSummary.overdue,
    members,
    recipientEmail,
    (item) =>
      item.weeksOverdue && item.weeksOverdue > 0
        ? `Overdue ${item.weeksOverdue} week(s)`
        : 'Overdue'
  );

  const thisWeekChoresRows = buildChoreRowsForMember(
    choreSummary.thisWeek,
    members,
    recipientEmail,
    () => 'This week'
  );

  const subjectParts: string[] = [];
  if (hasItems) subjectParts.push('Expiring Items');
  if (hasChores) subjectParts.push('Chores');
  const subjectBase =
    subjectParts.length > 0
      ? subjectParts.join(' + ')
      : 'Kitchen Inventory Reminder';

  const subject = `${subjectBase} - ${householdName}`;

  const inventorySection = hasItems
    ? `
      <p>The following items are expiring soon (within 30 days) or have already expired:</p>
      <ul style="list-style-type: disc; padding-left: 20px; margin-bottom: 16px;">
        ${itemsList}
      </ul>
    `
    : '<p>You have no items expiring in the next 30 days.</p>';

  const choresSection = hasChores
    ? `
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
    `
    : '';

  const html = `
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <h2>Kitchen Inventory Reminder</h2>
          <p>Hello,</p>
          <p>This is a reminder for your household: <strong>${householdName}</strong></p>
          ${inventorySection}
          ${choresSection}
          <p>Best regards,<br>Kitchen Inventory System</p>
        </body>
      </html>
    `;

  return { subject, html };
}

// Send email to a list of recipients
async function sendEmail(recipients: string[], subject: string, html: string) {
  const transporter = createTransporter();
  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;

  if (!fromEmail) {
    throw new Error('SMTP_FROM or SMTP_USER environment variable is required');
  }

  try {
    const result = await transporter.sendMail({
      from: fromEmail,
      to: recipients.join(', '),
      subject,
      html,
    });
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('Error sending email:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to send email: ${message}`);
  }
}

// POST endpoint: Send expiry reminder for a specific household (manual trigger)
export async function POST(req: NextRequest) {
  try {
    // Check authentication
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const token = authHeader.substring(7);
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { householdId } = await req.json();

    if (!householdId) {
      return NextResponse.json({ error: 'householdId is required' }, { status: 400 });
    }

    // Verify user is a member of this household
    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('household_members')
      .select('household_id')
      .eq('household_id', householdId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (membershipError || !membership) {
      return NextResponse.json({ error: 'You are not a member of this household' }, { status: 403 });
    }

    // Get household name
    const { data: household, error: householdError } = await supabaseAdmin
      .from('households')
      .select('name')
      .eq('id', householdId)
      .maybeSingle();

    if (householdError || !household) {
      return NextResponse.json({ error: 'Household not found' }, { status: 404 });
    }

    const expiringItems = await getExpiringItems(householdId);

    const choreSummary = await getHouseholdChoreSummary(
      supabaseAdmin as SupabaseAdminClient,
      householdId
    );

    const members = await getHouseholdMembers(householdId);
    const memberEmails = members
      .filter((m) => m.email)
      .map((m) => m.email as string);

    if (memberEmails.length === 0) {
      const overdueChoresCount = choreSummary.overdue.length;
      const thisWeekChoresCount = choreSummary.thisWeek.length;
      return NextResponse.json(
        { 
          error: 'No members with email addresses found for this household',
          itemsCount: expiringItems.length,
          overdueChoresCount,
          thisWeekChoresCount,
        }, 
        { status: 400 }
      );
    }

    for (const member of members) {
      if (!member.email) continue;

      const { subject, html } = generateEmailContent(
        household.name,
        expiringItems,
        choreSummary,
        members,
        member.email
      );

      await sendEmail([member.email], subject, html);
    }

    return NextResponse.json({
      success: true,
      message: 'Expiry reminder sent successfully',
      recipients: memberEmails.length,
      itemsCount: expiringItems.length,
      overdueChoresCount: choreSummary.overdue.length,
      thisWeekChoresCount: choreSummary.thisWeek.length,
    });
  } catch (error) {
    console.error('Error in send-expiry-reminder:', error);
    const message =
      error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
