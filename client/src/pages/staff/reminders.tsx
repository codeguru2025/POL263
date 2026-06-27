import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Bell, Trash2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

type Reminder = {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: string | null;
  isCompleted: boolean | null;
  createdAt: string;
};

async function apiFetch(url: string, options?: RequestInit) {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
    credentials: "include",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function StaffReminders() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState("");

  const { data: items = [], isLoading } = useQuery<Reminder[]>({
    queryKey: ["/api/reminders"],
    queryFn: () => apiFetch("/api/reminders"),
  });

  const addMutation = useMutation({
    mutationFn: (body: { title: string; description: string; dueDate: string }) =>
      apiFetch("/api/reminders", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reminders"] });
      setTitle("");
      setNote("");
      setDue("");
      toast({ title: "Reminder saved" });
    },
    onError: () => toast({ title: "Failed to save reminder", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/reminders/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/reminders"] }),
    onError: () => toast({ title: "Failed to delete reminder", variant: "destructive" }),
  });

  const add = () => {
    if (!title.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    addMutation.mutate({ title: title.trim(), description: note.trim(), dueDate: due.trim() });
  };

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Reminders"
          description="Personal reminders synced to your account across all devices."
        />
        <CardSection title="New reminder" icon={Bell}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <Textarea className="mt-3 min-h-[80px]" placeholder="Notes (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button className="mt-3" type="button" onClick={add} disabled={addMutation.isPending}>
            {addMutation.isPending ? "Saving…" : "Add reminder"}
          </Button>
        </CardSection>
        <CardSection title="Your list" icon={Bell}>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reminders yet.</p>
          ) : (
            <ul className="space-y-3">
              {items.map((r) => (
                <li key={r.id} className="rounded-lg border p-3 flex gap-3 justify-between items-start">
                  <div className="min-w-0">
                    <p className="font-medium">{r.title}</p>
                    {r.dueDate && <p className="text-xs text-muted-foreground mt-0.5">Due {r.dueDate}</p>}
                    {r.description && <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{r.description}</p>}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => deleteMutation.mutate(r.id)}
                    disabled={deleteMutation.isPending}
                    aria-label="Delete reminder"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardSection>
      </PageShell>
    </StaffLayout>
  );
}
