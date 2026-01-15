"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/src/lib/supabase";
import AuthGate from "@/src/components/AuthGate";
import ChoreForm, { ChoreFormData } from "@/src/components/chores/ChoreForm";

const ACTIVE_HOUSEHOLD_KEY = "active_household_id";

export default function NewChorePage() {
  const router = useRouter();
  const [householdId, setHouseholdId] = useState<string | null>(null);
  
  useEffect(() => {
    const hid = localStorage.getItem(ACTIVE_HOUSEHOLD_KEY);
    if (hid) {
      setHouseholdId(hid);
    }
  }, []);

  async function handleCreate(data: ChoreFormData) {
    if (!householdId) return;

    const { error } = await supabase.from('chores').insert({
      household_id: householdId,
      title: data.title,
      description: data.description || null,
      required_consumables: data.requiredConsumables || null,
      zone: data.zone,
      zone_id: data.zone_id,
      frequency_days: data.frequencyDays,
      start_date: data.startDate,
      assignment_strategy: data.assignmentStrategy,
      fixed_assignee_id: data.fixedAssigneeId,
      fixed_assignee_ids: data.fixedAssigneeIds,
      rotation_sequence: data.rotationSequence,
      rotation_interval_days: data.rotationIntervalDays,
    });

    if (error) {
      alert("Error creating chore: " + error.message);
    } else {
      router.push("/chores");
    }
  }

  if (!householdId) return <AuthGate><div className="p-8">Loading...</div></AuthGate>;

  return (
    <AuthGate>
      <div className="min-h-screen bg-[#F7F1E6] p-4 flex items-center justify-center">
        <div className="bg-white p-6 rounded-xl shadow-lg w-full max-w-lg relative">
          <button 
            onClick={() => router.back()}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
          <h1 className="text-xl font-bold mb-6">New Chore Rule</h1>
          <ChoreForm 
            householdId={householdId} 
            onSubmit={handleCreate} 
            submitLabel="Create Rule"
          />
        </div>
      </div>
    </AuthGate>
  );
}
