import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { AppChrome, APP_SHELL_MAX } from "@/components/layout/app-chrome";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <AppChrome center>
      <div className={cn(APP_SHELL_MAX, "px-4")}>
        <Card className="w-full max-w-md mx-auto border-border/70 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex mb-4 gap-2">
              <AlertCircle className="h-8 w-8 text-destructive shrink-0" />
              <h1 className="text-2xl font-bold text-foreground">404 — Page not found</h1>
            </div>

            <p className="mt-4 text-sm text-muted-foreground">
              This page does not exist. Check the address or use the links below to get back.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Link href="/" className="text-sm font-medium text-primary hover:underline">Go to home</Link>
              <Link href="/client/login" className="text-sm font-medium text-primary hover:underline">Client login</Link>
              <Link href="/staff/login" className="text-sm font-medium text-primary hover:underline">Staff login</Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppChrome>
  );
}
