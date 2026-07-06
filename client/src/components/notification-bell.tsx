import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

interface UserNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  metadata: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Personal notification inbox — distinct from the "SMS Tools" sidebar item (which manages
 * outbound SMS templates, not this per-user unread feed). Backend already existed
 * (GET /api/notifications, /unread-count, PATCH mark-read routes, SSE stream) with no UI
 * anywhere consuming it.
 */
export function NotificationBell() {
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data } = useQuery<{ notifications: UserNotification[]; unreadCount: number }>({
    queryKey: ["/api/notifications"],
    enabled: isAuthenticated,
    refetchInterval: 60_000, // fallback poll in case the SSE connection drops
  });
  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  // Live delivery via SSE so new notifications show up without waiting for the poll.
  useEffect(() => {
    if (!isAuthenticated) return;
    const es = new EventSource(getApiBase() + "/api/notifications/stream", { withCredentials: true });
    es.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data);
        if (parsed.type === "notification") {
          queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
          toast({ title: parsed.title, description: parsed.body });
        }
      } catch {
        // ignore malformed/keep-alive frames
      }
    };
    return () => es.close();
  }, [isAuthenticated, queryClient, toast]);

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("PATCH", `/api/notifications/${id}/read`); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/notifications"] }),
  });
  const markAllReadMutation = useMutation({
    mutationFn: async () => { await apiRequest("PATCH", "/api/notifications/mark-all-read"); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/notifications"] }),
  });

  if (!isAuthenticated) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Notifications"
          data-testid="button-notification-bell"
          className="relative shrink-0 h-8 w-8 rounded-full flex items-center justify-center hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-h-96 overflow-y-auto p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b sticky top-0 bg-popover z-10">
          <span className="text-sm font-semibold">Notifications</span>
          {unreadCount > 0 && (
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
            >
              Mark all read
            </button>
          )}
        </div>
        {notifications.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">No notifications yet.</div>
        ) : (
          notifications.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => { if (!n.isRead) markReadMutation.mutate(n.id); }}
              className={`w-full text-left px-3 py-2.5 border-b last:border-0 hover:bg-muted/50 transition-colors ${!n.isRead ? "bg-primary/5" : ""}`}
              data-testid={`notification-row-${n.id}`}
            >
              <div className="flex items-start gap-2">
                {!n.isRead && <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" aria-hidden />}
                <div className="min-w-0 flex-1">
                  <p className={`text-sm truncate ${!n.isRead ? "font-semibold" : "font-medium"}`}>{n.title}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{n.body}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(n.createdAt)}</p>
                </div>
              </div>
            </button>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
