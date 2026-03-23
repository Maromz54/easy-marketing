"use client";

import type { Database } from "@/lib/supabase/types";
import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

type DistributionListRow = Database["public"]["Tables"]["distribution_lists"]["Row"];

interface DistributionPanelProps {
  lists: DistributionListRow[];
  selectedIds: string[];
  extraGroupIds: string;
  onChangeIds: (ids: string[]) => void;
  onChangeExtra: (val: string) => void;
}

export function DistributionPanel({
  lists,
  selectedIds,
  extraGroupIds,
  onChangeIds,
  onChangeExtra,
}: DistributionPanelProps) {
  const totalCount = useMemo(() => {
    const fromLists = lists
      .filter((l) => selectedIds.includes(l.id))
      .flatMap((l) => l.group_ids);
    const manual = extraGroupIds
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return new Set([...fromLists, ...manual]).size;
  }, [lists, selectedIds, extraGroupIds]);

  function toggle(id: string) {
    onChangeIds(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id]
    );
  }

  return (
    <div className="rounded-md border border-input bg-muted/30 divide-y divide-border">
      {/* List checkboxes */}
      <div className="px-3 py-2 space-y-2 max-h-44 overflow-y-auto">
        {lists.map((list) => (
          <div key={list.id} className="flex items-center gap-2.5">
            <Checkbox
              id={`dist-${list.id}`}
              checked={selectedIds.includes(list.id)}
              onCheckedChange={() => toggle(list.id)}
            />
            <Label
              htmlFor={`dist-${list.id}`}
              className="flex-1 flex items-center justify-between cursor-pointer text-sm font-normal"
            >
              <span>{list.name}</span>
              <span className="text-xs text-muted-foreground ms-2">
                {list.group_ids.length} קבוצות
              </span>
            </Label>
          </div>
        ))}
      </div>

      {/* Manual group IDs */}
      <div className="px-3 py-2 space-y-1.5">
        <p className="text-xs text-muted-foreground">מזהי קבוצות נוספים (מופרדים בפסיקים)</p>
        <Input
          placeholder="123456789, 987654321"
          dir="ltr"
          className="text-start font-mono text-xs h-8"
          value={extraGroupIds}
          onChange={(e) => onChangeExtra(e.target.value)}
        />
      </div>

      {/* Total count */}
      {totalCount > 0 && (
        <div className="px-3 py-2 text-xs text-purple-700 bg-purple-50/60 font-medium">
          סה&quot;כ: {totalCount} קבוצות ייחודיות נבחרו
        </div>
      )}
    </div>
  );
}
