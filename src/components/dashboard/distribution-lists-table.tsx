"use client";

import { useTransition } from "react";
import { Trash2, Loader2, ListChecks, Pencil, Users } from "lucide-react";

import { deleteDistributionListAction } from "@/actions/distribution-lists";
import { Button } from "@/components/ui/button";
import type { Database } from "@/lib/supabase/types";

export type DistributionListRow =
  Database["public"]["Tables"]["distribution_lists"]["Row"];

interface DistributionListsTableProps {
  lists: DistributionListRow[];
  onEdit?: (id: string) => void;
}

export function DistributionListsTable({ lists, onEdit }: DistributionListsTableProps) {
  if (lists.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-dashed border-slate-300/60 py-14 flex flex-col items-center justify-center text-center gap-3">
        <div className="h-14 w-14 rounded-2xl bg-slate-100 flex items-center justify-center">
          <ListChecks className="h-7 w-7 text-slate-400" />
        </div>
        <p className="font-semibold text-slate-700">אין רשימות תפוצה עדיין</p>
        <p className="text-sm text-slate-400 max-w-xs">
          צור רשימה כדי לפרסם לעשרות קבוצות בלחיצה אחת.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold tracking-tight text-slate-900">הרשימות שלי</h3>
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {lists.map((list) => (
          <ListCard key={list.id} list={list} onEdit={onEdit} />
        ))}
      </div>
    </div>
  );
}

function ListCard({ list, onEdit }: { list: DistributionListRow; onEdit?: (id: string) => void }) {
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (!window.confirm(`האם למחוק את הרשימה "${list.name}"?`)) return;
    startTransition(async () => {
      await deleteDistributionListAction(list.id);
    });
  }

  return (
    <div className={`group bg-white rounded-2xl border border-slate-200/60 shadow-[0_1px_3px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] hover:-translate-y-0.5 transition-all duration-300 ease-out overflow-hidden ${
      isPending ? "opacity-50 pointer-events-none" : ""
    }`}>
      <div className="p-5">
        <div className="flex items-start justify-between gap-2 mb-3">
          <h4 className="font-semibold text-slate-900 truncate">{list.name}</h4>
          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <button
              onClick={() => onEdit?.(list.id)}
              className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all duration-200"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={handleDelete}
              className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all duration-200"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm text-slate-500">
          <div className="h-7 w-7 rounded-lg bg-violet-50 flex items-center justify-center">
            <Users className="h-3.5 w-3.5 text-violet-600" />
          </div>
          <span className="tabular-nums font-medium">{list.group_ids.length}</span>
          <span>קבוצות</span>
        </div>

        <p className="mt-2 text-xs text-slate-400 font-mono truncate" dir="ltr">
          {list.group_ids.slice(0, 3).join(", ")}
          {list.group_ids.length > 3 && ` +${list.group_ids.length - 3}`}
        </p>
      </div>

      <div className="px-5 py-3 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between">
        <span className="text-xs text-slate-400">
          {new Date(list.created_at).toLocaleDateString("he-IL")}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit?.(list.id)}
          className="text-xs h-7 px-3 rounded-lg text-blue-600 hover:text-blue-700 hover:bg-blue-50 transition-all duration-200"
        >
          <Pencil className="h-3 w-3 ms-1" />
          ערוך
        </Button>
      </div>
    </div>
  );
}
