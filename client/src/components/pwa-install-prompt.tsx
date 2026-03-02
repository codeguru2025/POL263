import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";

let deferredPrompt: any = null;

export function PwaInstallPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const dismissed = sessionStorage.getItem("pwa-dismissed");
    if (dismissed) return;

    const handler = (e: Event) => {
      e.preventDefault();
      deferredPrompt = e;
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === "accepted") setShow(false);
    deferredPrompt = null;
  };

  const dismiss = () => {
    setShow(false);
    sessionStorage.setItem("pwa-dismissed", "1");
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 z-50 bg-card border rounded-xl shadow-2xl p-4 animate-in slide-in-from-bottom-4 fade-in duration-300">
      <button onClick={dismiss} className="absolute top-2 right-2 text-muted-foreground hover:text-foreground">
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Download className="h-5 w-5 text-primary" />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-semibold">Install POL263</p>
          <p className="text-xs text-muted-foreground">Add to your home screen for faster access and offline support.</p>
          <Button size="sm" onClick={install} className="w-full">
            Install App
          </Button>
        </div>
      </div>
    </div>
  );
}
