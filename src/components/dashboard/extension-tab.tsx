"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Chrome, Puzzle, AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";

interface ExtensionTabProps {
  appUrl: string;
}

export function ExtensionTab({ appUrl }: ExtensionTabProps) {
  const steps = [
    {
      n: "1",
      title: "הורד את קוד התוסף",
      body: (
        <>
          תיקיית התוסף נמצאת בשורש הפרויקט:{" "}
          <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">
            facebook-poster-ext/
          </code>
          . ודא שהיא נמצאת במחשב שלך (לאחר git clone).
        </>
      ),
    },
    {
      n: "2",
      title: "פתח את Chrome Extensions",
      body: (
        <>
          פתח Chrome ועבור לכתובת{" "}
          <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">
            chrome://extensions
          </code>
          . הפעל את <strong>מצב מפתח</strong> (Developer Mode) בפינה הימנית העליונה.
        </>
      ),
    },
    {
      n: "3",
      title: 'לחץ "טען תוסף לא ארוז"',
      body: (
        <>
          לחץ על <strong>Load unpacked</strong> ובחר את תיקיית{" "}
          <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">
            facebook-poster-ext/
          </code>
          . אייקון EasyMarketing יופיע בסרגל הכלים.
        </>
      ),
    },
    {
      n: "4",
      title: "הגדר את התוסף",
      body: (
        <>
          לחץ על אייקון התוסף בסרגל הכלים. הזן את כתובת האפליקציה ואת המפתח
          הסודי (EXTENSION_SECRET) ולחץ <strong>שמור הגדרות</strong>.
        </>
      ),
    },
    {
      n: "5",
      title: "וודא שאתה מחובר לפייסבוק",
      body: "התוסף פועל באמצעות הסשן הפעיל שלך בדפדפן. ודא שאתה מחובר לחשבון הפייסבוק הרצוי.",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Puzzle className="h-5 w-5 text-primary" />
          חיבור תוסף Chrome
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          התוסף מפרסם פוסטים בקבוצות פייסבוק ישירות דרך הדפדפן שלך, ללא צורך ב-Graph API.
        </p>
      </div>

      {/* Warning */}
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="flex gap-3 pt-5 pb-5">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1 text-sm text-amber-800">
            <p className="font-semibold">שים לב — סלקטורים עלולים להשתנות</p>
            <p>
              התוסף מתבסס על מבנה ה-DOM של פייסבוק. פייסבוק משנה את האתר שלה
              לעיתים תכופות. אם הפרסום מפסיק לעבוד, יש לעדכן את הסלקטורים
              ב-<code className="bg-amber-100 px-1 rounded font-mono text-xs">background.js</code>{" "}
              (פונקציה <code className="bg-amber-100 px-1 rounded font-mono text-xs">postToFacebookGroup</code>).
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Connection values */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Chrome className="h-4 w-4" />
            ערכי חיבור לתוסף
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                API URL
              </p>
              <code className="block bg-muted rounded px-3 py-2 text-sm font-mono break-all">
                {appUrl}
              </code>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Extension Secret
              </p>
              <code className="block bg-muted rounded px-3 py-2 text-sm font-mono text-muted-foreground">
                ← ראה משתני סביבה (EXTENSION_SECRET)
              </code>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            * הסוד הסודי מוגדר ב-Vercel Dashboard → Settings → Environment Variables.
            אל תשתף אותו עם אף אחד.
          </p>
        </CardContent>
      </Card>

      {/* Installation steps */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">שלבי התקנה</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-5">
            {steps.map((step) => (
              <li key={step.n} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
                  {step.n}
                </span>
                <div className="pt-0.5 text-sm leading-relaxed">
                  <p className="font-semibold mb-0.5">{step.title}</p>
                  <p className="text-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {/* How it works */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">איך זה עובד</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground leading-relaxed">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
            <p>
              <strong className="text-foreground">כל דקה</strong> — התוסף שולח בקשה ל-
              <code className="bg-muted px-1 rounded font-mono text-xs">/api/extension/pending</code>{" "}
              ומקבל את הפוסט הממתין הבא.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
            <p>
              <strong className="text-foreground">פתיחת טאב</strong> — התוסף פותח טאב בלתי-פעיל
              (ברקע) לדף הקבוצה ב-
              <code className="bg-muted px-1 rounded font-mono text-xs">
                facebook.com/groups/&#123;target_id&#125;
              </code>
              .
            </p>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
            <p>
              <strong className="text-foreground">DOM Automation</strong> — סקריפט מוזרק
              לדף ומדמה כתיבה ולחיצה על "פרסם" באמצעות חשבונך הפעיל.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
            <p>
              <strong className="text-foreground">עדכון סטטוס</strong> — הפוסט מסומן כ-
              <Badge variant="outline" className="text-green-700 border-green-300 text-xs mx-0.5">
                פורסם
              </Badge>{" "}
              או{" "}
              <Badge variant="outline" className="text-red-700 border-red-300 text-xs mx-0.5">
                נכשל
              </Badge>{" "}
              בטבלת הפוסטים.
            </p>
          </div>
          <div className="flex items-start gap-2 pt-1 border-t">
            <ExternalLink className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
            <p>
              <strong className="text-foreground">דרישת מקדם:</strong> הפוסטים לקבוצות
              חייבים לכלול <strong>מזהה יעד (Target ID)</strong> — מזהה הקבוצה בפייסבוק.
              הזן אותו בשדה "מזהה יעד" בעת יצירת הפוסט.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
