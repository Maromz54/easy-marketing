"use client";

import { useTransition } from "react";
import { LayoutTemplate, Loader2, Trash2, FilePen } from "lucide-react";
import { deleteTemplateAction } from "@/actions/posts";
import { Button } from "@/components/ui/button";

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
      <div className="bg-white rounded-2xl border border-dashed border-slate-300/60 py-14 flex flex-col items-center justify-center text-center gap-3">
        <div className="h-14 w-14 rounded-2xl bg-slate-100 flex items-center justify-center">
          <LayoutTemplate className="h-7 w-7 text-slate-400" />
        </div>
        <p className="font-semibold text-slate-700">אין תבניות עדיין</p>
        <p className="text-sm text-slate-400 max-w-xs">
          בעת כתיבת פוסט, לחץ על &quot;שמור כתבנית&quot; כדי לשמור אותו לשימוש חוזר.
        </p>
      </div>
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
    <div className={`group bg-white rounded-2xl border border-slate-200/60 shadow-[0_1px_3px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] hover:-translate-y-0.5 transition-all duration-300 ease-out overflow-hidden flex flex-col ${
      isPending ? "opacity-50 pointer-events-none" : ""
    }`}>
      {/* Thumbnail */}
      {template.image_urls?.[0] && (
        <div className="h-36 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={template.image_urls[0]}
            alt=""
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        </div>
      )}

      {/* Body */}
      <div className="p-5 flex-1 flex flex-col">
        <p className="text-sm text-slate-600 line-clamp-4 whitespace-pre-line leading-relaxed flex-1" dir="auto">
          {preview}{hasMore ? "..." : ""}
        </p>
        <p className="text-xs text-slate-400 mt-3">
          {new Date(template.created_at).toLocaleDateString("he-IL")}
        </p>
      </div>

      {/* Actions */}
      <div className="px-5 py-3.5 bg-slate-50/50 border-t border-slate-100 flex gap-2">
        <Button
          size="sm"
          className="flex-1 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-sm hover:shadow-md transition-all duration-200 text-xs"
          onClick={() => onUseTemplate(template)}
        >
          <FilePen className="h-3.5 w-3.5 ms-1" />
          השתמש בתבנית
        </Button>
        <button
          onClick={handleDelete}
          disabled={isPending}
          className="h-8 w-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all duration-200 shrink-0"
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}
