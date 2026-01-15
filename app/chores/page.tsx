"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/src/lib/supabase";
import { Database } from "@/src/lib/database.types";
import AuthGate from "@/src/components/AuthGate";
import Link from "next/link";
import ZoneManager from "@/src/components/chores/ZoneManager";
import ChoreMatrix from "@/src/components/chores/ChoreMatrix";
import CurrentWeekView from "@/src/components/chores/CurrentWeekView";
import { cx } from "@/src/lib/utils";
import Modal from "@/src/components/ui/Modal";
import ConfirmModal from "@/src/components/ui/ConfirmModal";
import ChoreForm, { ChoreFormData } from "@/src/components/chores/ChoreForm";

type Chore = Database['public']['Tables']['chores']['Row'];
type ChoreCompletion = Database['public']['Tables']['chore_completions']['Row'];
type Zone = Database['public']['Tables']['chore_zones']['Row'];
type HouseholdMember = Database['public']['Tables']['household_members']['Row'] & {
  email?: string;
};

const ACTIVE_HOUSEHOLD_KEY = "active_household_id";

export default function ChoresPage() {
  const [session, setSession] = useState<any>(null);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [zones, setZones] = useState<Zone[]>([]);
  const [chores, setChores] = useState<Chore[]>([]);
  const [overrides, setOverrides] = useState<any[]>([]);
  const [completions, setCompletions] = useState<ChoreCompletion[]>([]);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  
  const [isZoneManagerOpen, setIsZoneManagerOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'current' | 'matrix'>('current');
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [editingChoreId, setEditingChoreId] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [choreToDeleteId, setChoreToDeleteId] = useState<string | null>(null);

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

  useEffect(() => {
    if (zones.length > 0 && !selectedZoneId) {
      setSelectedZoneId(zones[0].id);
    }
  }, [zones, selectedZoneId]);

  async function loadData() {
    if (!householdId) return;
    setLoading(true);
    
    const { data: zonesData } = await supabase
      .from('chore_zones')
      .select('*')
      .eq('household_id', householdId)
      .order('name');

    const { data: choresData } = await supabase
      .from('chores')
      .select('*')
      .eq('household_id', householdId)
      .eq('archived', false);

    const { data: overridesData } = await supabase
      .from('chore_overrides')
      .select('*, chores!inner(household_id)')
      .eq('chores.household_id', householdId);
      
    const startOfYear = new Date(new Date().getFullYear(), 0, 1).toISOString();
    const { data: completionsData } = await supabase
      .from('chore_completions')
      .select('*, chores!inner(household_id)')
      .eq('chores.household_id', householdId)
      .gte('completed_at', startOfYear);
      
    const { data: membersData } = await supabase
      .from('household_members')
      .select('*')
      .eq('household_id', householdId);

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

    setZones(zonesData || []);
    setChores(choresData || []);
    setOverrides(overridesData || []);
    setCompletions(completionsData as any || []);
    setMembers(enrichedMembers);
    setLoading(false);
  }

  const choresByZone = useMemo(() => {
    const grouped: Record<string, Chore[]> = {};
    const noZoneChores: Chore[] = [];

    chores.forEach(chore => {
      if (chore.zone_id) {
        if (!grouped[chore.zone_id]) grouped[chore.zone_id] = [];
        grouped[chore.zone_id].push(chore);
      } else if (chore.zone) {
        noZoneChores.push(chore);
      } else {
        noZoneChores.push(chore);
      }
    });

    return { grouped, noZoneChores };
  }, [chores, zones]);

  const editingChore = useMemo(
    () => chores.find(c => c.id === editingChoreId) || null,
    [chores, editingChoreId]
  );

  function handleOpenEdit(choreId: string) {
    setEditingChoreId(choreId);
  }

  function handleCloseEdit() {
    setEditingChoreId(null);
  }

  async function handleUpdateChore(data: ChoreFormData) {
    if (!editingChoreId) return;
    setIsSavingEdit(true);
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
      .eq('id', editingChoreId);

    if (error) {
      alert("Error updating chore: " + error.message);
    } else {
      setEditingChoreId(null);
      await loadData();
    }
    setIsSavingEdit(false);
  }

  async function handleDeleteChore() {
    if (!choreToDeleteId) return;
    const { error } = await supabase
      .from('chores')
      .update({ archived: true })
      .eq('id', choreToDeleteId);

    if (error) {
      alert("Error deleting chore: " + error.message);
    } else {
      setChoreToDeleteId(null);
      setEditingChoreId(null);
      await loadData();
    }
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
        <div className="max-w-[95vw] mx-auto">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-3">
              <Link
                href="/rooms"
                className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
              >
                <span>←</span>
                <span>Back to household</span>
              </Link>
              <h1 className="text-2xl font-bold">Chore Overview</h1>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setIsZoneManagerOpen(true)}
                className="bg-white border border-black/10 px-4 py-2 rounded-lg text-sm hover:bg-gray-50"
              >
                Manage Zones
              </button>
              <Link href="/chores/new" className="bg-white border border-black/10 px-4 py-2 rounded-lg text-sm hover:bg-gray-50">
                + New Rule
              </Link>
            </div>
          </div>

          <div className="flex gap-6 mb-8 border-b border-black/10">
            <button 
              className={cx("pb-3 px-1 font-medium text-sm transition-colors relative", viewMode === 'current' ? "text-black" : "text-gray-400 hover:text-gray-600")}
              onClick={() => setViewMode('current')}
            >
              This Week
              {viewMode === 'current' && <span className="absolute bottom-0 left-0 w-full h-0.5 bg-black rounded-t-full"></span>}
            </button>
            <button 
              className={cx("pb-3 px-1 font-medium text-sm transition-colors relative", viewMode === 'matrix' ? "text-black" : "text-gray-400 hover:text-gray-600")}
              onClick={() => setViewMode('matrix')}
            >
              Annual Matrix
              {viewMode === 'matrix' && <span className="absolute bottom-0 left-0 w-full h-0.5 bg-black rounded-t-full"></span>}
            </button>
          </div>

          {loading ? (
            <div>Loading...</div>
          ) : (
            <div className="space-y-8">
              {viewMode === 'current' ? (
                <CurrentWeekView 
                  chores={chores}
                  completions={completions}
                  overrides={overrides}
                  members={members}
                  zones={zones}
                  onUpdate={loadData}
                />
              ) : (
                <div className="space-y-6">
                  <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                    {zones.map(zone => (
                      <button
                        key={zone.id}
                        onClick={() => setSelectedZoneId(zone.id)}
                        className={cx(
                          "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors",
                          selectedZoneId === zone.id 
                            ? "bg-black text-white" 
                            : "bg-white border border-black/5 text-gray-600 hover:bg-gray-50"
                        )}
                      >
                        {zone.name}
                      </button>
                    ))}
                    {choresByZone.noZoneChores.length > 0 && (
                      <button
                        onClick={() => setSelectedZoneId('uncategorized')}
                        className={cx(
                          "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors",
                          selectedZoneId === 'uncategorized'
                            ? "bg-black text-white" 
                            : "bg-white border border-black/5 text-gray-600 hover:bg-gray-50"
                        )}
                      >
                        Uncategorized
                      </button>
                    )}
                  </div>

                  {selectedZoneId && (
                    <div className="bg-white rounded-2xl p-1 shadow-sm border border-black/5">
                      {selectedZoneId === 'uncategorized' ? (
                        <ChoreMatrix
                          zoneName="Uncategorized"
                          chores={choresByZone.noZoneChores}
                          completions={completions}
                          overrides={overrides}
                          members={members}
                          onUpdate={loadData}
                          onEditChore={handleOpenEdit}
                        />
                      ) : (
                        zones.map(zone => {
                          if (zone.id !== selectedZoneId) return null;
                          const zoneChores = choresByZone.grouped[zone.id] || [];
                          return (
                            <ChoreMatrix
                              key={zone.id}
                              zoneName={zone.name}
                              chores={zoneChores}
                              completions={completions}
                              overrides={overrides}
                              members={members}
                              onUpdate={loadData}
                              onEditChore={handleOpenEdit}
                            />
                          );
                        })
                      )}
                    </div>
                  )}

                  {!selectedZoneId && zones.length === 0 && (
                     <div className="text-center py-10 text-gray-400">
                        No zones created. Go to "Manage Zones" to create one.
                     </div>
                  )}
                </div>
              )}
            </div>
          )}

          <ZoneManager
            householdId={householdId}
            isOpen={isZoneManagerOpen}
            onClose={() => setIsZoneManagerOpen(false)}
            onUpdate={loadData}
          />

          {editingChore && (
            <Modal
              open={!!editingChore}
              title="Edit Chore Rule"
              onClose={handleCloseEdit}
              widthClass="max-w-lg"
            >
              <ChoreForm
                householdId={editingChore.household_id}
                initialData={{
                  title: editingChore.title,
                  description: editingChore.description,
                  requiredConsumables: editingChore.required_consumables || undefined,
                  zone: editingChore.zone || "",
                  zone_id: editingChore.zone_id,
                  frequencyDays: editingChore.frequency_days,
                  startDate: editingChore.start_date,
                  assignmentStrategy: editingChore.assignment_strategy,
                  fixedAssigneeId: editingChore.fixed_assignee_id,
                  fixedAssigneeIds: editingChore.fixed_assignee_ids,
                  rotationSequence: editingChore.rotation_sequence,
                  rotationIntervalDays: editingChore.rotation_interval_days || editingChore.frequency_days,
                }}
                onSubmit={handleUpdateChore}
                onDelete={() => setChoreToDeleteId(editingChore.id)}
                isSubmitting={isSavingEdit}
                submitLabel="Save Changes"
              />
            </Modal>
          )}

          <ConfirmModal
            open={!!choreToDeleteId}
            title="Delete Chore Rule"
            description="Are you sure you want to delete this chore? The rule will be archived."
            onConfirm={handleDeleteChore}
            onCancel={() => setChoreToDeleteId(null)}
            destructive
          />
        </div>
      </div>
    </AuthGate>
  );
}
