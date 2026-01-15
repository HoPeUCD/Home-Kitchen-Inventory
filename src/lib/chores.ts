import { Database } from './database.types';

type Chore = Database['public']['Tables']['chores']['Row'];
type ChoreOverride = Database['public']['Tables']['chore_overrides']['Row'];
type ChoreCompletion = Database['public']['Tables']['chore_completions']['Row'];

export interface ChoreOccurrence {
  choreId: string;
  date: Date; // The effective due date (original or rescheduled)
  originalDate: Date; // The calculated recurrence date (key for overrides)
  assigneeId: string | null;
  status: 'pending' | 'completed' | 'skipped';
  completion?: ChoreCompletion;
  override?: ChoreOverride;
}

export function calculateChoreOccurrences(
  chore: Chore,
  overrides: ChoreOverride[],
  completions: ChoreCompletion[],
  rangeStart: Date,
  rangeEnd: Date
): ChoreOccurrence[] {
  const occurrences: ChoreOccurrence[] = [];
  const start = new Date(chore.start_date);
  
  // Normalize dates to midnight for consistent comparison
  const normalize = (d: Date) => {
    const newD = new Date(d);
    newD.setHours(0, 0, 0, 0);
    return newD;
  };

  const rangeStartNorm = normalize(rangeStart);
  const rangeEndNorm = normalize(rangeEnd);
  const choreStartNorm = normalize(start);

  // If frequency is invalid, return empty
  if (chore.frequency_days <= 0) return [];

  // Calculate the first occurrence on or after rangeStart
  // Formula: start + n * freq >= rangeStart
  // n * freq >= rangeStart - start
  // n >= (rangeStart - start) / freq
  const diffTime = rangeStartNorm.getTime() - choreStartNorm.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  let n = 0;
  if (diffDays > 0) {
    n = Math.ceil(diffDays / chore.frequency_days);
  }

  // Safety break to prevent infinite loops
  let safetyCounter = 0;
  const MAX_OCCURRENCES = 365; // Limit to 1 year of daily tasks at once

  while (safetyCounter < MAX_OCCURRENCES) {
    const originalDate = new Date(choreStartNorm.getTime() + n * chore.frequency_days * 24 * 60 * 60 * 1000);
    
    // If we've passed the end range, stop
    if (originalDate > rangeEndNorm) break;
    
    // If the chore has an end date and we passed it, stop
    if (chore.end_date) {
      const choreEnd = normalize(new Date(chore.end_date));
      if (originalDate > choreEnd) break;
    }

    // Check for overrides for this specific date
    // Overrides are keyed by 'original_date' (string YYYY-MM-DD)
    const originalDateStr = originalDate.toISOString().split('T')[0];
    const override = overrides.find(o => o.original_date === originalDateStr);

    // Handle skip
    if (override?.is_skipped) {
      occurrences.push({
        choreId: chore.id,
        date: originalDate,
        originalDate: originalDate,
        assigneeId: null,
        status: 'skipped',
        override
      });
      n++;
      safetyCounter++;
      continue;
    }

    // Determine effective date (rescheduled or original)
    let effectiveDate = originalDate;
    if (override?.new_date) {
      effectiveDate = new Date(override.new_date);
      effectiveDate.setHours(0,0,0,0);
    }

    // Determine Assignee
    let assigneeId: string | null = null;

    if (override?.new_assignee_id) {
      assigneeId = override.new_assignee_id;
    } else {
      // Default assignment logic
      if (chore.assignment_strategy === 'fixed') {
        assigneeId = chore.fixed_assignee_id;
      } else if (chore.assignment_strategy === 'rotation' && chore.rotation_sequence && chore.rotation_sequence.length > 0) {
        // Rotation logic
        // Calculate days since start to the ORIGINAL date (not rescheduled)
        // Rotation is based on the rigid schedule, not the flexible execution
        const daysSinceStart = Math.floor((originalDate.getTime() - choreStartNorm.getTime()) / (1000 * 60 * 60 * 24));
        
        // Ensure rotation_interval_days is valid
        const interval = chore.rotation_interval_days || chore.frequency_days;
        
        const rotationIndex = Math.floor(daysSinceStart / interval);
        const sequenceIndex = rotationIndex % chore.rotation_sequence.length;
        
        assigneeId = chore.rotation_sequence[sequenceIndex];
      }
    }

    // Check for completion
    // We match completions by comparing the chore_id. 
    // Usually completion is linked to a specific occurrence? 
    // Current schema: chore_completions(chore_id, completed_at). 
    // It doesn't strictly link to a specific scheduled "slot".
    // LOGIC: A completion "counts" for this occurrence if it happened 
    // within a reasonable window of the due date?
    // OR: We simply list the occurrences and see if there's a completion "close enough".
    // SIMPLE APPROACH for V1:
    // Find a completion that occurred ON or AFTER the previous occurrence, and BEFORE the next occurrence?
    // Let's refine: A completion counts for the NEAREST due date.
    // Actually, for "Check off" lists, we usually check if there is a completion record *associated* with this slot.
    // Since we don't have a slot ID, we can use the date window.
    // Window: [EffectiveDate - Frequency/2, EffectiveDate + Frequency/2] ?
    // Better: Match completions by date. If I cleaned it on Jan 4, and due date was Jan 4, it matches.
    // If I cleaned it on Jan 5, it likely matches Jan 4 task.
    
    // Let's look for any completion that hasn't been "consumed" by a previous occurrence.
    // This requires iterating chronologically.
    // BUT for a stateless "get occurrences" view, we might just look for a completion 
    // roughly around the due date (e.g., +/- 3 days for weekly).
    
    // Let's try: Find completion between (Due Date - Interval) and (Due Date + Interval).
    // And take the closest one?
    // This is tricky.
    // SIMPLIFIED:
    // User manually marks a SPECIFIC occurrence as done.
    // When they do, we should ideally store the `scheduled_date` in `chore_completions`?
    // Current schema doesn't have `scheduled_date` in completions.
    // RECOMMENDATION: Add `scheduled_for` date to `chore_completions` to make this mapping explicit.
    // Otherwise, "I cleaned the toilet on Monday" (scheduled Tuesday) - does it count for this week? Yes.
    // "I cleaned it twice this week" - counts for next week? No.
    
    // For now, let's use a "fuzzy match":
    // A completion matches this occurrence if it is within [Due Date - Freq, Due Date + Freq)
    // AND it is the closest completion to this date.
    
    // Let's find completions in range [effectiveDate - freq_days, effectiveDate + freq_days]
    // This is purely visual status.
    
    // Actually, simpler logic for UI:
    // Status is 'completed' if there is a completion record with `completed_at` matching the day?
    // No, users might complete late.
    
    // Let's defer strict matching. For now, we return 'pending'. 
    // The UI can fetch completions separately and overlay them, 
    // or we assume completions are rare enough to just list them.
    
    // WAIT, to color the box green (like Excel), we need to know if it's done.
    // Let's assume we pass in relevant completions.
    // We find the FIRST completion that is AFTER (Due Date - EarlyWindow) and NOT assigned to previous task.
    // This stateful logic is hard in a pure function.
    
    // REVISED STRATEGY:
    // We filter completions that are strictly *after* the (Previous Occurrence Due Date).
    // And take the first one.
    
    const prevOccurrenceDate = new Date(originalDate.getTime() - chore.frequency_days * 24 * 60 * 60 * 1000);
    const nextOccurrenceDate = new Date(originalDate.getTime() + chore.frequency_days * 24 * 60 * 60 * 1000);
    
    // Search window: strictly after previous due date, up to next due date (exclusive)
    // Actually, users might do it early.
    // Let's just look for a completion in [Due - Freq/2, Due + Freq/2]
    
    const windowStart = new Date(effectiveDate.getTime() - (chore.frequency_days * 24 * 60 * 60 * 1000) / 2);
    const windowEnd = new Date(effectiveDate.getTime() + (chore.frequency_days * 24 * 60 * 60 * 1000) / 2);
    
    const matchedCompletion = completions.find(c => {
      const cDate = new Date(c.completed_at);
      return cDate >= windowStart && cDate < windowEnd;
    });

    occurrences.push({
      choreId: chore.id,
      date: effectiveDate,
      originalDate: originalDate,
      assigneeId,
      status: matchedCompletion ? 'completed' : 'pending',
      completion: matchedCompletion,
      override
    });

    n++;
    safetyCounter++;
  }

  return occurrences;
}
