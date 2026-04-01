"use client";

import { useTransition } from "react";
import { ExternalLink, Link2, MousePointerClick, Trash2, Loader2 } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteLinkAction } from "@/actions/links";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface LinkWithCount {
  id: string;
  slug: string;
  destination: string;
  label: string | null;
  created_at: string;
  clickCount: number;
}

interface LinksTableProps {
  links: LinkWithCount[];
  appUrl: string;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function LinksTable({ links, appUrl }: LinksTableProps) {
  const totalClicks = links.reduce((sum, l) => sum + l.clickCount, 0);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">הקישורים שלי</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          כל הקישורים הפעילים עם נתוני קליקים בזמן אמת
        </p>
      </div>

      {links.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-14 flex flex-col items-center justify-center text-center gap-3">
            <Link2 className="h-10 w-10 text-muted-foreground/30" />
            <p className="font-medium text-muted-foreground">לא נוצרו קישורים עדיין</p>
            <p className="text-sm text-muted-foreground/60">
              השתמש בטופס מעל כדי ליצור את הקישור הראשון שלך
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-0 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {links.length} קישורים
            </CardTitle>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MousePointerClick className="h-4 w-4" />
              <span>
                סה&quot;כ{" "}
                <span className="font-semibold text-foreground">
                  {totalClicks.toLocaleString("he-IL")}
                </span>{" "}
                קליקים
              </span>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>שם / קישור קצר</TableHead>
                  <TableHead>כתובת יעד</TableHead>
                  <TableHead className="text-center">קליקים</TableHead>
                  <TableHead>נוצר בתאריך</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {links.map((link) => (
                  <LinkTableRow key={link.id} link={link} appUrl={appUrl} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

// ── Single row ─────────────────────────────────────────────────────────────────
function LinkTableRow({
  link,
  appUrl,
}: {
  link: LinkWithCount;
  appUrl: string;
}) {
  const [isPending, startTransition] = useTransition();
  const shortUrl = `${appUrl}/r/${link.slug}`;

  const createdDate = new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(link.created_at));

  // Truncate destination for display
  const displayDestination =
    link.destination.length > 45
      ? link.destination.slice(0, 45) + "…"
      : link.destination;

  function handleDelete() {
    if (!window.confirm("האם למחוק קישור זה? פעולה זו אינה הפיכה.")) return;
    startTransition(async () => {
      await deleteLinkAction(link.id);
    });
  }

  return (
    <TableRow className={isPending ? "opacity-50" : ""}>
      {/* Label + short URL */}
      <TableCell className="align-top">
        {link.label && (
          <p className="font-medium text-sm mb-0.5">{link.label}</p>
        )}
        <a
          href={shortUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-mono"
          dir="ltr"
        >
          {shortUrl}
          <ExternalLink className="h-3 w-3 shrink-0" />
        </a>
      </TableCell>

      {/* Destination */}
      <TableCell>
        <a
          href={link.destination}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-muted-foreground hover:text-foreground hover:underline truncate block max-w-[220px]"
          dir="ltr"
          title={link.destination}
        >
          {displayDestination}
        </a>
      </TableCell>

      {/* Click count */}
      <TableCell className="text-center">
        <Badge
          variant={link.clickCount > 0 ? "default" : "outline"}
          className="tabular-nums"
        >
          {link.clickCount.toLocaleString("he-IL")}
        </Badge>
      </TableCell>

      {/* Created date */}
      <TableCell className="text-sm text-muted-foreground whitespace-nowrap" dir="ltr">
        {createdDate}
      </TableCell>

      {/* Delete */}
      <TableCell>
        <button
          onClick={handleDelete}
          disabled={isPending}
          aria-label="מחק קישור"
          className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </button>
      </TableCell>
    </TableRow>
  );
}
