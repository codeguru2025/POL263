import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppChrome } from "@/components/layout/app-chrome";
import { useBranding } from "@/hooks/use-branding";
import { resolveAssetUrl } from "@/lib/assetUrl";
import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { Loader2, Download, Smartphone, ShieldCheck, RefreshCw } from "lucide-react";
import { Link } from "wouter";

export default function AgentDownload() {
  const { displayName, displayLogo } = useBranding();

  const { data, isLoading, isError, refetch } = useQuery<{ url: string; version: string; updatedAt: string }>({
    queryKey: ["/api/public/agent-app-latest"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/public/agent-app-latest");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    staleTime: 60_000,
  });

  return (
    <AppChrome center>
      <Card className="w-full max-w-lg border-border/50 shadow-lg">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto px-4 py-3 bg-white rounded-2xl flex items-center justify-center mb-6 ring-1 ring-border max-w-full">
            <img
              src={resolveAssetUrl(displayLogo)}
              alt={displayName || "Organization logo"}
              className="h-10 w-auto max-w-[min(280px,85vw)] object-contain object-center"
            />
          </div>
          <CardTitle className="text-2xl font-display">
            Agent App Download
          </CardTitle>
          <p className="text-muted-foreground mt-2">
            Download and install the {displayName} Agent App on your Android device.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <div className="text-center py-4 space-y-3">
              <p className="text-sm text-destructive">Could not load download info. Please try again.</p>
              <Button variant="outline" onClick={() => refetch()} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Retry
              </Button>
            </div>
          ) : data?.url ? (
            <a href={data.url} target="_blank" rel="noopener noreferrer">
              <Button className="w-full h-14 text-lg font-semibold gap-3" size="lg">
                <Download className="h-6 w-6" />
                Download APK v{data.version}
              </Button>
            </a>
          ) : (
            <div className="text-center text-muted-foreground py-4">
              <p>No release available yet. Check back soon.</p>
            </div>
          )}

          <div className="space-y-4 pt-2">
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">
              Installation Instructions
            </h3>
            <div className="space-y-3">
              <div className="flex gap-3 items-start">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">Allow Unknown Sources</p>
                  <p className="text-xs text-muted-foreground">
                    Go to Settings &rarr; Security &rarr; enable "Install from Unknown Sources" for your browser.
                  </p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Download className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">Download the APK</p>
                  <p className="text-xs text-muted-foreground">
                    Tap the download button above. The file will save to your Downloads folder.
                  </p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Smartphone className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">Install</p>
                  <p className="text-xs text-muted-foreground">
                    Open the downloaded file and tap "Install". The app will appear on your home screen.
                  </p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <RefreshCw className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">Updates</p>
                  <p className="text-xs text-muted-foreground">
                    The app updates automatically over-the-air. Major updates will be posted here.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="text-center pt-4 border-t">
            <Link href="/agent/login">
              <Button variant="link" className="text-muted-foreground">
                Already installed? Sign in on the web &rarr;
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </AppChrome>
  );
}
