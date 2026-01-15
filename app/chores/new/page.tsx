"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/src/lib/supabase";
import AuthGate from "@/src/components/AuthGate";
import { cx } from "@/src/lib/utils";

const ACTIVE_HOUSEHOLD_KEY = "active_household_id";

export default function NewChorePage() {
  const router = useRouter();
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  
  // Form State
  const [title, setTitle] = useState("");
  const [zone, setZone] = useState("Bathroom");
  const [frequencyDays, setFrequencyDays] = useState(7);
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  
  const [assignmentStrategy, setAssignmentStrategy] = useState<'none' | 'fixed' | 'rotation'>('none');
  const [fixedAssigneeId, setFixedAssigneeId] = useState("");
  const [rotationSequence, setRotationSequence] = useState<string[]>([]);
  const [rotationIntervalWeeks, setRotationIntervalWeeks] = useState(1); // Helper for input
  
  useEffect(() => {
    const hid = localStorage.getItem(ACTIVE_HOUSEHOLD_KEY);
    if (hid) {
      setHouseholdId(hid);
      loadMembers(hid);
    }
  }, []);

  async function loadMembers(hid: string) {
    const { data } = await supabase.from('household_members').select('*').eq('household_id', hid);
    if (data) {
        // Fetch emails for display
        const userIds = data.map(m => m.user_id);
        const { data: emailData } = await (supabase as any).rpc('get_member_emails', { p_user_ids: userIds });
        
        const enriched = data.map(m => ({
            ...m,
            email: emailData?.find((e: any) => e.user_id === m.user_id)?.email
        }));
        setMembers(enriched);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!householdId) return;

    // Construct rotation sequence based on selection
    // Simple UI: Select users involved in rotation, order them?
    // For now, if rotation is selected, we use the `rotationSequence` state which we will populate in UI
    
    let finalRotationSequence = rotationSequence;
    let finalRotationInterval = frequencyDays; // Default to task frequency

    if (assignmentStrategy === 'rotation') {
        // If user wants "Every 2 weeks switch", and task is weekly:
        // Task Freq = 7. Rotation Interval = 14.
        finalRotationInterval = rotationIntervalWeeks * 7;
    }

    const { error } = await supabase.from('chores').insert({
      household_id: householdId,
      title,
      zone,
      frequency_days: frequencyDays,
      start_date: startDate,
      assignment_strategy: assignmentStrategy,
      fixed_assignee_id: assignmentStrategy === 'fixed' ? fixedAssigneeId : null,
      rotation_sequence: assignmentStrategy === 'rotation' ? finalRotationSequence : null,
      rotation_interval_days: assignmentStrategy === 'rotation' ? finalRotationInterval : frequencyDays,
    });

    if (error) {
      alert("Error creating chore: " + error.message);
    } else {
      router.push("/chores");
    }
  }

  function toggleRotationMember(userId: string) {
    if (rotationSequence.includes(userId)) {
      setRotationSequence(rotationSequence.filter(id => id !== userId));
    } else {
      setRotationSequence([...rotationSequence, userId]);
    }
  }

  if (!householdId) return <AuthGate><div className="p-8">Loading...</div></AuthGate>;

  return (
    <AuthGate>
      <div className="min-h-screen bg-[#F7F1E6] p-4 flex items-center justify-center">
        <div className="bg-white p-6 rounded-xl shadow-lg w-full max-w-lg">
          <h1 className="text-xl font-bold mb-6">New Chore Rule</h1>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium mb-1">Task Name</label>
              <input 
                required
                className="w-full border rounded-lg px-3 py-2"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Clean Toilet"
              />
            </div>

            {/* Zone */}
            <div>
              <label className="block text-sm font-medium mb-1">Zone</label>
              <input 
                className="w-full border rounded-lg px-3 py-2"
                value={zone}
                onChange={e => setZone(e.target.value)}
                placeholder="e.g. Bathroom"
              />
            </div>

            {/* Frequency */}
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium mb-1">Frequency (Days)</label>
                <input 
                  type="number"
                  required
                  min="1"
                  className="w-full border rounded-lg px-3 py-2"
                  value={frequencyDays}
                  onChange={e => setFrequencyDays(parseInt(e.target.value))}
                />
              </div>
              <div className="flex-1">
                 <label className="block text-sm font-medium mb-1">Start Date</label>
                 <input 
                   type="date"
                   required
                   className="w-full border rounded-lg px-3 py-2"
                   value={startDate}
                   onChange={e => setStartDate(e.target.value)}
                 />
              </div>
            </div>

            {/* Assignment Strategy */}
            <div>
              <label className="block text-sm font-medium mb-1">Who does it?</label>
              <div className="flex gap-2 mb-2">
                {(['none', 'fixed', 'rotation'] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setAssignmentStrategy(mode)}
                    className={cx(
                      "px-3 py-1 rounded-full text-sm border capitalize",
                      assignmentStrategy === mode ? "bg-black text-white border-black" : "bg-white text-gray-700"
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              {assignmentStrategy === 'fixed' && (
                <select 
                  className="w-full border rounded-lg px-3 py-2"
                  value={fixedAssigneeId}
                  onChange={e => setFixedAssigneeId(e.target.value)}
                  required
                >
                  <option value="">Select a member...</option>
                  {members.map(m => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.email || m.user_id}
                    </option>
                  ))}
                </select>
              )}

              {assignmentStrategy === 'rotation' && (
                <div className="p-3 bg-stone-50 rounded-lg border space-y-3">
                  <p className="text-sm text-gray-500">Select members in rotation order:</p>
                  <div className="space-y-2">
                    {members.map(m => (
                      <label key={m.user_id} className="flex items-center gap-2 text-sm">
                        <input 
                          type="checkbox"
                          checked={rotationSequence.includes(m.user_id)}
                          onChange={() => toggleRotationMember(m.user_id)}
                        />
                        {m.email || m.user_id} 
                        {rotationSequence.includes(m.user_id) && 
                           <span className="text-xs text-blue-600 font-mono">
                             (Order: {rotationSequence.indexOf(m.user_id) + 1})
                           </span>
                        }
                      </label>
                    ))}
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-1 mt-2">Switch every N weeks</label>
                    <input 
                      type="number"
                      min="1"
                      className="w-20 border rounded-lg px-2 py-1"
                      value={rotationIntervalWeeks}
                      onChange={e => setRotationIntervalWeeks(parseInt(e.target.value))}
                    />
                    <span className="text-xs text-gray-500 ml-2">
                      (Person A does {rotationIntervalWeeks} weeks, then Person B...)
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-4 flex gap-3">
              <button 
                type="button" 
                onClick={() => router.back()}
                className="flex-1 py-2 rounded-lg border hover:bg-gray-50"
              >
                Cancel
              </button>
              <button 
                type="submit"
                className="flex-1 py-2 rounded-lg bg-black text-white font-medium hover:bg-gray-800"
              >
                Create Rule
              </button>
            </div>
          </form>
        </div>
      </div>
    </AuthGate>
  );
}
