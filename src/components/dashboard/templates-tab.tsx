"use client";

import { useState, useTransition } from "react";
import { LayoutTemplate, Loader2, Trash2, FilePen, Pencil, Check, X } from "lucide-react";
import { deleteTemplateAction, updateTemplateAction } from "@/actions/posts";
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
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(template.content);
  const [editLink, setEditLink] = useState(template.link_url ?? "");
  const [editError, setEditError] = useState<string | null>(null);

  const preview = template.content.slice(0, 140);
  const hasMore = template.content.length > 140;

  function handleDelete() {
    if (!window.confirm("האם למחוק תבנית זו?")) return;
    startTransition(async () => {
      await deleteTemplateAction(template.id);
    });
  }

  function startEdit() {
    setEditContent(template.content);
    setEditLink(template.link_url ?? "");
    setEditError(null);
    setIsEditing(true);
  }

  function cancelEdit() {
    setIsEditing(false);
    setEditError(null);
  }

  function saveEdit() {
    if (!editContent.trim()) { setEditError("התוכן לא יכול להיות ריק."); return; }
    startTransition(async () => {
      const result = await updateTemplateAction({
        templateId: template.id,
        content: editContent,
        linkUrl: editLink || undefined,
      });
      if (result.error) {
        setEditError(result.error);
      } else {
        setIsEditing(false);
      }
    });
  }

  return (
    <div className={`group bg-white rounded-2xl border border-slate-200/60 shadow-[0_1px_3px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] transition-all duration-300 ease-out overflow-hidden flex flex-col ${
      isPending ? "opacity-50 pointer-events-none" : ""
    } ${isEditing ? "border-amber-200 shadow-[0_4px_20px_rgb(251,191,36,0.08)]" : "hover:-translate-y-0.5"}`}>
      {/* Thumbnail (hidden in edit mode) */}
      {!isEditing && template.image_urls?.[0] && (
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
        {isEditing ? (
          <div className="space-y-3 flex-1">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              dir="auto"
              rows={6}
              className="w-full text-sm text-slate-700 leading-relaxed border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-300 resize-none transition-all"
              placeholder="תוכן התבנית..."
              autoFocus
            />
            <input
              type="url"
              value={editLink}
              onChange={(e) => setEditLink(e.target.value)}
              dir="ltr"
              placeholder="קישור (אופציונלי)"
              className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-300 transition-all font-mono"
            />
            {editError && (
              <p className="text-xs text-red-500">{editError}</p>
            )}
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-600 line-clamp-4 whitespace-pre-line leading-relaxed flex-1" dir="auto">
              {preview}{hasMore ? "..." : ""}
            </p>
            <p className="text-xs text-slate-400 mt-3">
              {new Date(template.created_at).toLocaleDateString("he-IL")}
            </p>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="px-5 py-3.5 bg-slate-50/50 border-t border-slate-100 flex gap-2">
        {isEditing ? (
          <>
            <Button
              size="sm"
              onClick={saveEdit}
              disabled={isPending}
              className="flex-1 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-sm text-xs"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin ms-1" /> : <Check className="h-3.5 w-3.5 ms-1" />}
              שמור שינויים
            </Button>
            <button
              onClick={cancelEdit}
              disabled={isPending}
              className="h-8 w-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all duration-200 shrink-0"
              title="בטל עריכה"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              className="flex-1 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-sm hover:shadow-md transition-all duration-200 text-xs"
              onClick={() => onUseTemplate(template)}
            >
              <FilePen className="h-3.5 w-3.5 ms-1" />
              השתמש בתבנית
            </Button>
            <button
              onClick={startEdit}
              disabled={isPending}
              className="h-8 w-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-all duration-200 shrink-0"
              title="ערוך תבנית"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={handleDelete}
              disabled={isPending}
              className="h-8 w-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all duration-200 shrink-0"
              title="מחק תבנית"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
