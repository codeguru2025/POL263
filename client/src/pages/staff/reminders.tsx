import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";
import { Bell, Trash2 } from "lucide-react";

const STORAGE_KEY = "pol263-staff-reminders";

type Reminder = { id: string; title: string; note: string; due: string };

function loadReminders(): Reminder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveReminders(items: Reminder[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export default function StaffReminders() {
  const { toast } = useToast();
  const [items, setItems] = useState<Reminder[]>([]);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState("");

  useEffect(() => {
    setItems(loadReminders());
  }, []);

  const persist = (next: Reminder[]) => {
    setItems(next);
    saveReminders(next);
  };

  const add = () => {
    if (!title.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    const row: Reminder = {
      id: crypto.randomUUID(),
      title: title.trim(),
      note: note.trim(),
      due: due.trim(),
    };
    persist([row, ...items]);
    setTitle("");
    setNote("");
    setDue("");
    toast({ title: "Reminder saved", description: "Stored on this device only." });
  };

  const remove = (id: string) => {
    persist(items.filter((r) => r.id !== id));
  };

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Reminders"
          description="Personal reminders stored in this browser. A lightweight stand-in until server-backed reminders exist."
        />
        <CardSection title="New reminder" icon={Bell}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <Textarea className="mt-3 min-h-[80px]" placeholder="Notes (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button className="mt-3" type="button" onClick={add}>
            Add reminder
          </Button>
        </CardSection>
        <CardSection title="Your list" icon={Bell}>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reminders yet.</p>
          ) : (
            <ul className="space-y-3">
              {items.map((r) => (
                <li key={r.id} className="rounded-lg border p-3 flex gap-3 justify-between items-start">
                  <div className="min-w-0">
                    <p className="font-medium">{r.title}</p>
                    {r.due && <p className="text-xs text-muted-foreground mt-0.5">Due {r.due}</p>}
                    {r.note && <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{r.note}</p>}
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={() => remove(r.id)} aria-label="Delete reminder">
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
