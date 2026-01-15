"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/src/lib/supabase";
import { Database } from "@/src/lib/database.types";
import { calculateChoreOccurrences, ChoreOccurrence } from "@/src/lib/chores";
import AuthGate from "@/src/components/AuthGate";
import Link from "next/link";
import ChoreCard from "@/src/components/chores/ChoreCard";

type Chore = Database['public']['Tables']['chores']['Row'];
type ChoreOverride = Database['public']['Tables']['chore_overrides']['Row'];
type ChoreCompletion = Database['public']['Tables']['chore_completions']['Row'];
type HouseholdMember = Database['public']['Tables']['household_members']['Row'] & {
  email?: string; // We might fetch this separately
};

const ACTIVE_HOUSEHOLD_KEY = "active_household_id";

export default function ChoresPage() {
  const [session, setSession] = useState<any>(null);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [chores, setChores] = useState<Chore[]>([]);
  const [overrides, setOverrides] = useState<ChoreOverride[]>([]);
  const [completions, setCompletions] = useState<ChoreCompletion[]>([]);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  
  // Date Range State (default to next 4 weeks)
  const [startDate, setStartDate] = useState<Date>(new Date());
  const [weeksToShow, setWeeksToShow] = useState(4);

  // Computed Schedule
  const schedule = useMemo(() => {
    if (!startDate || !householdId) return [];
    
    const rangeStart = new Date(startDate);
    rangeStart.setHours(0,0,0,0);
    
    const rangeEnd = new Date(rangeStart);
    rangeEnd.setDate(rangeEnd.getDate() + weeksToShow * 7);
    
    let allOccurrences: ChoreOccurrence[] = [];
    
    chores.forEach(chore => {
      const choreOverrides = overrides.filter(o => o.chore_id === chore.id);
      const choreCompletions = completions.filter(c => c.chore_id === chore.id);
      
      const occurrences = calculateChoreOccurrences(
        chore,
        choreOverrides,
        choreCompletions,
        rangeStart,
        rangeEnd
      );
      allOccurrences = allOccurrences.concat(occurrences);
    });
    
    // Sort by date
    return allOccurrences.sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [chores, overrides, completions, startDate, weeksToShow, householdId]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      const savedHid = localStorage.getItem(ACTIVE_HOUSEHOLD_KEY);
      if (savedHid) setHouseholdId(savedHid);
    });
  }, []);

  useEffect(() => {
    if (householdId) {
      loadData();
    }
  }, [householdId]);

  async function loadData() {
    if (!householdId) return;
    setLoading(true);
    
    // Fetch Chores (All, including ended ones, so we can see history if needed)
    // We filter `archived` only if we want to support "soft delete".
    // Let's assume `archived` means "deleted/hidden".
    const { data: choresData } = await supabase
      .from('chores')
      .select('*')
      .eq('household_id', householdId)
      .eq('archived', false);
      
    // Fetch Overrides
    const { data: overridesData } = await supabase
      .from('chore_overrides')
      .select('*, chores!inner(household_id)')
      .eq('chores.household_id', householdId);

    // Fetch Completions (Last 3 months?)
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    
    const { data: completionsData } = await supabase
      .from('chore_completions')
      .select('*, chores!inner(household_id)')
      .eq('chores.household_id', householdId)
      .gte('completed_at', threeMonthsAgo.toISOString());
      
    // Fetch Members
    const { data: membersData } = await supabase
      .from('household_members')
      .select('*')
      .eq('household_id', householdId);

    // Fetch Emails (Optional, for display name)
    let enrichedMembers: HouseholdMember[] = membersData || [];
    if (membersData && membersData.length > 0) {
       const userIds = membersData.map(m => m.user_id);
       const { data: emailData } = await (supabase as any).rpc('get_member_emails', { p_user_ids: userIds });
       if (emailData) {
         enrichedMembers = membersData.map(m => {
           const emailEntry = emailData.find((e: any) => e.user_id === m.user_id);
           return { ...m, email: emailEntry?.email };
         });
       }
    }

    if (choresData) setChores(choresData);
    if (overridesData) setOverrides(overridesData as any);
    if (completionsData) setCompletions(completionsData as any);
    setMembers(enrichedMembers);
    
    setLoading(false);
  }

  // Actions
  async function markComplete(occurrence: ChoreOccurrence) {
    if (!session?.user || !householdId) return;
    
    const note = window.prompt("Add a note (optional):");
    
    const { error } = await supabase.from('chore_completions').insert({
      chore_id: occurrence.choreId,
      completed_by: session.user.id,
      notes: note || null,
      completed_at: new Date().toISOString()
    });
    
    if (!error) {
      loadData();
    } else {
      alert("Failed to complete task");
    }
  }

  async function undoComplete(completionId: string) {
    if (!confirm("Undo completion?")) return;
    const { error } = await supabase.from('chore_completions').delete().eq('id', completionId);
    if (!error) loadData();
  }

  async function skipChore(occurrence: ChoreOccurrence) {
    if (!session?.user || !householdId) return;
    if (!confirm("Skip this occurrence?")) return;
    
    // Create an override
    const { error } = await supabase.from('chore_overrides').insert({
      chore_id: occurrence.choreId,
      original_date: occurrence.originalDate.toISOString().split('T')[0],
      is_skipped: true
    });
    
    if (!error) loadData();
    else alert("Failed to skip");
  }

  async function stopRule(occurrence: ChoreOccurrence) {
    if (!confirm("Stop this recurring rule? Future occurrences will be removed.")) return;
    
    const { error } = await supabase.from('chores').update({
        end_date: new Date().toISOString().split('T')[0]
    }).eq('id', occurrence.choreId);
    
    if (!error) loadData();
    else alert("Failed to stop rule");
  }

  if (!householdId) {
     return (
        <AuthGate>
            <div className="p-8">Please select a household in the Dashboard first.</div>
        </AuthGate>
     );
  }

  return (
    <AuthGate onAuthed={setSession}>
      <div className="min-h-screen bg-[#F7F1E6] p-4 pb-24">
        <div className="max-w-4xl mx-auto">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold">Household Chores</h1>
            <Link href="/chores/new" className="bg-black text-white px-4 py-2 rounded-lg text-sm">
              + New Rule
            </Link>
          </div>

        {loading ? (
          <div>Loading schedule...</div>
        ) : (
          <div className="space-y-8">
            {/* Today / Overdue Section */}
            <section>
              <h2 className="text-lg font-semibold mb-4 text-red-600">Due Now / Overdue</h2>
              <div className="grid gap-3">
                {schedule
                  .filter(o => o.status === 'pending' && o.date <= new Date())
                  .map(o => (
                    <ChoreCard 
                      key={`${o.choreId}-${o.date.toISOString()}`} 
                      occurrence={o} 
                      chores={chores}
                      members={members}
                      onComplete={() => markComplete(o)}
                      onSkip={() => skipChore(o)}
                      onStopRule={() => stopRule(o)}
                    />
                  ))}
                 {schedule.filter(o => o.status === 'pending' && o.date <= new Date()).length === 0 && (
                   <div className="text-gray-500 italic">No overdue tasks! Great job.</div>
                 )}
              </div>
            </section>

            {/* Upcoming Section */}
            <section>
              <h2 className="text-lg font-semibold mb-4">Upcoming</h2>
              <div className="grid gap-3">
                {schedule
                  .filter(o => o.status === 'pending' && o.date > new Date())
                  .slice(0, 10) // Show next 10
                  .map(o => (
                    <ChoreCard 
                      key={`${o.choreId}-${o.date.toISOString()}`} 
                      occurrence={o} 
                      chores={chores}
                      members={members}
                      onComplete={() => markComplete(o)}
                      onSkip={() => skipChore(o)}
                      onStopRule={() => stopRule(o)}
                    />
                  ))}
              </div>
            </section>
            
            {/* Completed Recently */}
            <section>
               <h2 className="text-lg font-semibold mb-4 text-green-700">Completed (This Period)</h2>
               <div className="grid gap-3 opacity-75">
                 {schedule
                   .filter(o => o.status === 'completed' || o.status === 'skipped')
                   .map(o => (
                     <ChoreCard 
                       key={`${o.choreId}-${o.date.toISOString()}`} 
                       occurrence={o} 
                       chores={chores}
                       members={members}
                       onUndo={() => o.completion && undoComplete(o.completion.id)}
                       // No skip/stop on completed/skipped items for now
                     />
                   ))}
               </div>
            </section>
          </div>
        )}
      </div>
    </div>
    </AuthGate>
  );
}
