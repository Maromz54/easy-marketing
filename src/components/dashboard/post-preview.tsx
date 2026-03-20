import { ThumbsUp, MessageCircle, Share2, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface PostPreviewProps {
  content: string;
  imageUrl?: string | null;
}

export function PostPreview({ content, imageUrl }: PostPreviewProps) {
  const isEmpty = !content.trim() && !imageUrl;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          תצוגה מקדימה
        </CardTitle>
      </CardHeader>

      <CardContent className="p-0">
        {isEmpty ? (
          <div className="px-6 pb-6 flex items-center justify-center min-h-[160px] text-center">
            <p className="text-sm text-muted-foreground/50">
              הטקסט ייראה כך בפייסבוק
            </p>
          </div>
        ) : (
          /* Mock Facebook post */
          <div className="border-t">
            {/* Post header */}
            <div className="flex items-center gap-2.5 px-4 pt-4 pb-2">
              {/* Avatar */}
              <div className="h-10 w-10 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
                <span className="text-slate-400 text-sm font-bold">א</span>
              </div>
              {/* Name + meta */}
              <div>
                <p className="text-sm font-semibold leading-tight">פרופיל אישי</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  עכשיו · <Globe className="h-3 w-3" />
                </p>
              </div>
            </div>

            {/* Post text */}
            {content.trim() && (
              <p className="px-4 text-sm leading-relaxed whitespace-pre-wrap break-words">
                {content}
              </p>
            )}

            {/* Post image */}
            {imageUrl && (
              <div className="mt-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl}
                  alt="תצוגה מקדימה של תמונת הפוסט"
                  className="w-full object-cover max-h-80"
                />
              </div>
            )}

            {/* Mock action bar */}
            <div className="px-4 pt-1 pb-1">
              <div className="flex items-center justify-between py-1 border-t border-b text-muted-foreground/60">
                <button className="flex items-center gap-1.5 text-xs py-1.5 px-2 rounded hover:bg-muted/50 transition-colors">
                  <ThumbsUp className="h-4 w-4" />
                  לייק
                </button>
                <button className="flex items-center gap-1.5 text-xs py-1.5 px-2 rounded hover:bg-muted/50 transition-colors">
                  <MessageCircle className="h-4 w-4" />
                  תגובה
                </button>
                <button className="flex items-center gap-1.5 text-xs py-1.5 px-2 rounded hover:bg-muted/50 transition-colors">
                  <Share2 className="h-4 w-4" />
                  שיתוף
                </button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
