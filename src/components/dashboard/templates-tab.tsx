"use client";

import { useTransition } from "react";
import { LayoutTemplate, Loader2, Trash2, FilePen } from "lucide-react";
import { deleteTemplateAction } from "@/actions/posts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";

export interface TemplateRow {
  id: string;
  content: string;
  image_urls: string[];
  link_url: string | null;
  created_at: string;
}

interface TemplatesTabProps {
  templates: TemplateRow[];
  onUseTemplate: (t: TemplateRow) => void;
}

export function TemplatesTab({ templates, onUseTemplate }: TemplatesTabProps) {
  if (templates.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-14 flex flex-col items-center justify-center text-center gap-3">
          <LayoutTemplate className="h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium">אין תבניות עדיין</p>
          <p className="text-sm text-muted-foreground max-w-xs">
            בעת כתיבת פוסט, לחץ על "שמור כתבנית" כדי לשמור אותו לשימוש חוזר.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {templates.map((t) => (
        <TemplateCard key={t.id} template={t} onUseTemplate={onUseTemplate} />
      ))}
    </div>
  );
}

function TemplateCard({
  template,
  onUseTemplate,
}: {
  template: TemplateRow;
  onUseTemplate: (t: TemplateRow) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const preview = template.content.slice(0, 140);
  const hasMore = template.content.length > 140;

  function handleDelete() {
    if (!window.confirm("האם למחוק תבנית זו?")) return;
    startTransition(async () => {
      await deleteTemplateAction(template.id);
    });
  }

  return (
    <Card className={isPending ? "opacity-50" : ""}>
      {/* Thumbnail */}
      {template.image_urls?.[0] && (
        <div className="h-32 overflow-hidden rounded-t-lg">
          <img
            src={template.image_urls[0]}
            alt=""
            className="w-full h-full object-cover"
          />
        </div>
      )}

      <CardContent className="pt-4 pb-2">
        <p className="text-sm text-muted-foreground line-clamp-4 whitespace-pre-line" dir="auto">
          {preview}{hasMore ? "…" : ""}
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          {new Date(template.created_at).toLocaleDateString("he-IL")}
        </p>
      </CardContent>

      <CardFooter className="pt-0 gap-2">
        <Button
          size="sm"
          className="flex-1"
          onClick={() => onUseTemplate(template)}
        >
          <FilePen className="h-3.5 w-3.5 ms-1" />
          השתמש בתבנית
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleDelete}
          disabled={isPending}
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      </CardFooter>
    </Card>
  );
}
