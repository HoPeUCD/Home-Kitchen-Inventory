"use client";

import React, { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/src/lib/supabase";
import AuthGate from "@/src/components/AuthGate";
import ChoreForm, { ChoreFormData } from "@/src/components/chores/ChoreForm";
import { Database } from "@/src/lib/database.types";

type Chore = Database['public']['Tables']['chores']['Row'];

export default function EditChorePage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  
  const [chore, setChore] = useState<Chore | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      loadChore();
    }
  }, [id]);

  async function loadChore() {
    const { data, error } = await supabase
      .from('chores')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) {
      console.error(error);
      alert("Error loading chore");
      router.push("/chores");
      return;
    }
    
    setChore(data);
    setLoading(false);
  }

  async function handleUpdate(data: ChoreFormData) {
    const { error } = await supabase
      .from('chores')
      .update({
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
      })
      .eq('id', id);

    if (error) {
      alert("Error updating chore: " + error.message);
    } else {
      router.push("/chores");
    }
  }

  if (loading || !chore) return <AuthGate><div className="p-8">Loading...</div></AuthGate>;

  const initialData: Partial<ChoreFormData> = {
    title: chore.title,
    description: chore.description,
    requiredConsumables: chore.required_consumables || undefined,
    zone: chore.zone || "",
    zone_id: chore.zone_id,
    frequencyDays: chore.frequency_days,
    startDate: chore.start_date,
    assignmentStrategy: chore.assignment_strategy,
    fixedAssigneeId: chore.fixed_assignee_id,
    fixedAssigneeIds: chore.fixed_assignee_ids,
    rotationSequence: chore.rotation_sequence,
    rotationIntervalDays: chore.rotation_interval_days || chore.frequency_days,
  };

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
          <h1 className="text-xl font-bold mb-6">Edit Chore Rule</h1>
          <ChoreForm 
            householdId={chore.household_id} 
            initialData={initialData}
            onSubmit={handleUpdate} 
            submitLabel="Save Changes"
          />
        </div>
      </div>
    </AuthGate>
  );
}
