import { Facebook, Plus, RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Database } from "@/lib/supabase/types";

type FacebookToken = Database["public"]["Tables"]["facebook_tokens"]["Row"];

interface ConnectedPagesProps {
  pages?: FacebookToken[] | null;
  errorMessage?: string | null;
  successMessage?: string | null;
}

export function ConnectedPages({
  pages,
  errorMessage,
  successMessage,
}: ConnectedPagesProps) {
  const safePages = pages ?? [];

  return (
    <section className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Facebook className="h-5 w-5 text-blue-600" />
            דפי פייסבוק מחוברים
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            חבר דף פייסבוק כדי לפרסם ישירות דרך ה-API (אופציונלי — ניתן לפרסם גם דרך תוסף Chrome)
          </p>
        </div>

        {/* Connect / Reconnect — plain <a> for full-page navigation to avoid CORS */}
        <Button asChild variant={safePages.length > 0 ? "outline" : "default"} size="sm">
          <a href="/api/facebook/connect">
            {safePages.length > 0 ? (
              <>
                <RefreshCw className="h-4 w-4 me-1.5" />
                חבר דפים נוספים
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 me-1.5" />
                התחבר לפייסבוק
              </>
            )}
          </a>
        </Button>
      </div>

      {/* OAuth callback messages */}
      {errorMessage && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
      {successMessage && (
        <div className="rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
          ✅ {successMessage}
        </div>
      )}

      {/* Pages list or empty state */}
      {safePages.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 flex flex-col items-center justify-center text-center gap-4">
            <div className="rounded-full bg-blue-50 p-4">
              <Facebook className="h-10 w-10 text-blue-400" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">לא חוברו דפי פייסבוק עדיין</p>
              <p className="text-sm text-muted-foreground max-w-xs">
                אופציונלי: חבר דף פייסבוק לפרסום ישיר דרך ה-API.
                לפרסום בקבוצות עם פרופיל אישי, השתמש בתוסף Chrome.
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <a href="/api/facebook/connect">
                <Facebook className="h-4 w-4 me-1.5" />
                התחבר לפייסבוק (אופציונלי)
              </a>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {safePages.map((page) => (
            <PageCard key={page.id} page={page} />
          ))}
        </div>
      )}
    </section>
  );
}

// ── Individual page card ──────────────────────────────────────────────────────
function PageCard({ page }: { page: FacebookToken }) {
  const isExpiringSoon =
    page.token_expires_at
      ? new Date(page.token_expires_at).getTime() - Date.now() < 7 * 24 * 3600 * 1000
      : false;

  const expiryLabel = page.token_expires_at
    ? `תפוגה: ${new Date(page.token_expires_at).toLocaleDateString("he-IL")}`
    : "ללא תפוגה";

  return (
    <Card className="relative overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-start justify-between gap-2">
          <span className="truncate">{page.page_name ?? `דף ${page.page_id}`}</span>
          <Badge variant={isExpiringSoon ? "destructive" : "success"} className="shrink-0 text-xs">
            {isExpiringSoon ? "פג תוקף בקרוב" : "פעיל"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">
          מזהה דף: <span dir="ltr" className="font-mono">{page.page_id}</span>
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">{expiryLabel}</p>
      </CardContent>
    </Card>
  );
}
