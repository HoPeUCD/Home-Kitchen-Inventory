"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/src/lib/supabase";
import { cx } from "@/src/lib/utils";

export interface ChoreFormData {
  title: string;
  zone: string;
  frequencyDays: number;
  startDate: string;
  assignmentStrategy: 'none' | 'fixed' | 'rotation';
  fixedAssigneeId: string | null;
  rotationSequence: string[] | null;
  rotationIntervalDays: number;
}

interface ChoreFormProps {
  householdId: string;
  initialData?: Partial<ChoreFormData>;
  onSubmit: (data: ChoreFormData) => Promise<void>;
  isSubmitting?: boolean;
  submitLabel?: string;
}

export default function ChoreForm({ 
  householdId, 
  initialData, 
  onSubmit, 
  isSubmitting = false, 
  submitLabel = "Save Rule" 
}: ChoreFormProps) {
  const [members, setMembers] = useState<any[]>([]);
  
  // Form State
  const [title, setTitle] = useState(initialData?.title || "");
  const [zone, setZone] = useState(initialData?.zone || "Bathroom");
  const [frequencyDays, setFrequencyDays] = useState(initialData?.frequencyDays || 7);
  const [startDate, setStartDate] = useState(initialData?.startDate || new Date().toISOString().split('T')[0]);
  
  const [assignmentStrategy, setAssignmentStrategy] = useState<'none' | 'fixed' | 'rotation'>(initialData?.assignmentStrategy || 'none');
  const [fixedAssigneeId, setFixedAssigneeId] = useState(initialData?.fixedAssigneeId || "");
  const [rotationSequence, setRotationSequence] = useState<string[]>(initialData?.rotationSequence || []);
  
  // Helper for rotation interval (default to 1 week if not provided, or calculate from days)
  const initialWeeks = initialData?.rotationIntervalDays ? Math.max(1, Math.round(initialData.rotationIntervalDays / 7)) : 1;
  const [rotationIntervalWeeks, setRotationIntervalWeeks] = useState(initialWeeks);
  
  useEffect(() => {
    if (householdId) {
      loadMembers(householdId);
    }
  }, [householdId]);

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

  function toggleRotationMember(userId: string) {
    if (rotationSequence.includes(userId)) {
      setRotationSequence(rotationSequence.filter(id => id !== userId));
    } else {
      setRotationSequence([...rotationSequence, userId]);
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    let finalRotationSequence = rotationSequence;
    let finalRotationInterval = frequencyDays;

    if (assignmentStrategy === 'rotation') {
        finalRotationInterval = rotationIntervalWeeks * 7;
    }

    onSubmit({
      title,
      zone,
      frequencyDays,
      startDate,
      assignmentStrategy,
      fixedAssigneeId: assignmentStrategy === 'fixed' ? fixedAssigneeId : null,
      rotationSequence: assignmentStrategy === 'rotation' ? finalRotationSequence : null,
      rotationIntervalDays: assignmentStrategy === 'rotation' ? finalRotationInterval : frequencyDays,
    });
  };

  return (
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
            value={fixedAssigneeId || ""}
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
            
            <div className="pt-2 border-t mt-2">
               <label className="block text-sm font-medium mb-1">Rotate every X weeks:</label>
               <input 
                 type="number"
                 min="1"
                 className="w-full border rounded-lg px-3 py-2"
                 value={rotationIntervalWeeks}
                 onChange={e => setRotationIntervalWeeks(parseInt(e.target.value))}
               />
               <p className="text-xs text-gray-400 mt-1">
                 The task repeats every {frequencyDays} days, but the person changes every {rotationIntervalWeeks * 7} days.
               </p>
            </div>
          </div>
        )}
      </div>

      <button 
        type="submit" 
        disabled={isSubmitting}
        className="w-full bg-black text-white py-3 rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50"
      >
        {isSubmitting ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}
