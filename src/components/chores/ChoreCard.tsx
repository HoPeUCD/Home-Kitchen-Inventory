import { Database } from "@/src/lib/database.types";
import { ChoreOccurrence } from "@/src/lib/chores";
import { cx } from "@/src/lib/utils";
import Link from "next/link";
import { useState } from "react";

type Chore = Database['public']['Tables']['chores']['Row'];
type HouseholdMember = Database['public']['Tables']['household_members']['Row'] & {
  email?: string;
};

interface ChoreCardProps {
  occurrence: ChoreOccurrence;
  chores: Chore[];
  members: HouseholdMember[];
  onComplete?: () => void;
  onUndo?: () => void;
  onSkip?: () => void;
  onStopRule?: () => void;
}

export default function ChoreCard({ 
  occurrence, 
  chores, 
  members,
  onComplete,
  onUndo,
  onSkip,
  onStopRule
}: ChoreCardProps) {
  const chore = chores.find(c => c.id === occurrence.choreId);
  const primaryAssigneeId = (occurrence.assigneeIds && occurrence.assigneeIds.length > 0)
    ? occurrence.assigneeIds[0]
    : null;
  const assignee = primaryAssigneeId
    ? members.find(m => m.user_id === primaryAssigneeId)
    : undefined;
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  
  if (!chore) return null;

  const isInventoryCheck = chore.title.toLowerCase().includes('inventory');
  const isSkipped = occurrence.status === 'skipped';

  return (
    <div className={cx(
      "bg-white p-4 rounded-xl shadow-sm border flex items-center justify-between relative group",
      occurrence.status === 'completed' ? "border-green-200 bg-green-50" : 
      isSkipped ? "border-gray-200 bg-gray-50 opacity-60" : "border-stone-200"
    )}>
      <div className="flex-1">
        <div className="flex items-center gap-2">
           <h3 className={cx("font-medium", (occurrence.status === 'completed' || isSkipped) && "line-through text-gray-500")}>
             {chore.title}
           </h3>
           {chore.zone && <span className="text-xs bg-stone-100 px-2 py-0.5 rounded text-stone-500">{chore.zone}</span>}
           {isSkipped && <span className="text-xs bg-gray-200 px-2 py-0.5 rounded text-gray-500">Skipped</span>}
        </div>
        <div className="text-sm text-gray-500 mt-1 flex gap-3 flex-wrap">
          <span>📅 {occurrence.date.toLocaleDateString()}</span>
          {assignee && (
            <span className="flex items-center gap-1">
              👤 {assignee.email?.split('@')[0] || 'Unknown'}
            </span>
          )}
        </div>
        {occurrence.completion?.notes && (
          <div className="text-xs text-gray-400 mt-1">📝 {occurrence.completion.notes}</div>
        )}
      </div>
      
      <div className="flex gap-2 items-center">
        {isInventoryCheck && occurrence.status !== 'completed' && !isSkipped && (
           <Link href={`/rooms`} className="bg-blue-100 text-blue-700 px-3 py-1 rounded text-sm font-medium hover:bg-blue-200">
             Check Inventory
           </Link>
        )}
        
        {occurrence.status === 'pending' && (
          <button 
            onClick={onComplete}
            className="bg-black text-white px-4 py-1.5 rounded-lg text-sm font-medium active:scale-95 transition-transform"
          >
            Done
          </button>
        )}
        
        {occurrence.status === 'completed' && (
          <button 
            onClick={onUndo}
            className="text-gray-400 text-sm hover:text-red-500 px-2"
          >
            Undo
          </button>
        )}

        {/* More Actions Menu */}
        <div className="relative">
          <button 
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
          </button>
          
          {isMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setIsMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 bg-white border rounded-lg shadow-lg z-20 min-w-[120px] py-1">
                {!isSkipped && occurrence.status !== 'completed' && (
                  <button 
                    onClick={() => { onSkip?.(); setIsMenuOpen(false); }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50"
                  >
                    Skip this one
                  </button>
                )}
                <Link 
                  href={`/chores/${occurrence.choreId}/edit`}
                  className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-50 text-gray-700"
                  onClick={() => setIsMenuOpen(false)}
                >
                  Edit Rule
                </Link>
                {onStopRule && (
                    <button 
                        onClick={() => { onStopRule(); setIsMenuOpen(false); }}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-red-50 text-red-600"
                    >
                        Delete Rule
                    </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
