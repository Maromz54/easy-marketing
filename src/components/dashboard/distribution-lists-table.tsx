"use client";

import { useTransition } from "react";
import { Trash2, Loader2, ListChecks, Pencil } from "lucide-react";

import { deleteDistributionListAction } from "@/actions/distribution-lists";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
      <Card className="border-dashed">
        <CardContent className="py-10 flex flex-col items-center justify-center text-center gap-3">
          <ListChecks className="h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium">אין רשימות תפוצה עדיין</p>
          <p className="text-sm text-muted-foreground max-w-xs">
            צור רשימה כדי לפרסם לעשרות קבוצות בלחיצה אחת.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">הרשימות שלי</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>שם הרשימה</TableHead>
              <TableHead>קבוצות</TableHead>
              <TableHead>מזהי קבוצות</TableHead>
              <TableHead>תאריך יצירה</TableHead>
              <TableHead className="w-[100px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lists.map((list) => (
              <ListRow key={list.id} list={list} onEdit={onEdit} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ListRow({ list, onEdit }: { list: DistributionListRow; onEdit?: (id: string) => void }) {
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (!window.confirm(`האם למחוק את הרשימה "${list.name}"?`)) return;
    startTransition(async () => {
      await deleteDistributionListAction(list.id);
    });
  }

  const groupIdPreview = list.group_ids.slice(0, 3).join(", ");
  const overflow = list.group_ids.length > 3 ? ` +${list.group_ids.length - 3}` : "";

  return (
    <TableRow className={isPending ? "opacity-50" : ""}>
      <TableCell className="font-medium">{list.name}</TableCell>
      <TableCell>
        <Badge variant="secondary">{list.group_ids.length}</Badge>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground font-mono max-w-[200px] truncate" dir="ltr">
        {groupIdPreview}{overflow}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {new Date(list.created_at).toLocaleDateString("he-IL")}
      </TableCell>
      <TableCell>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit?.(list.id)}
            disabled={isPending}
          >
            <Pencil className="h-4 w-4" />
            <span className="sr-only">ערוך</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={isPending}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            <span className="sr-only">מחק</span>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
