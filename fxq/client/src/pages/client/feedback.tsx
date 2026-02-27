/**
 * Client complaints & feedback page: list items and submit new complaint or feedback.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import ClientLayout from "@/components/layout/client-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageSquare, ArrowLeft, Plus, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface FeedbackItem {
  id: string;
  type: string;
  subject: string;
  message: string;
  status: string;
  createdAt: string;
}

export default function ClientFeedback() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: "feedback" as "complaint" | "feedback", subject: "", message: "" });

  const { data: me, isFetched: meFetched, isError: meError } = useQuery<{ client: { id: string } }>({ queryKey: ["/api/client-auth/me"], retry: false });
  const { data: items = [], isLoading } = useQuery<FeedbackItem[]>({
    queryKey: ["/api/client-auth/feedback"],
    enabled: !!me?.client,
  });

  if (meFetched && (meError || !me?.client)) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-lg">
          <CardContent className="pt-6 text-center space-y-4">
            <p className="text-muted-foreground">Please sign in again to access your portal.</p>
            <Button onClick={() => setLocation("/client/login")}>Sign In</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/client-auth/feedback", {
        type: form.type,
        subject: form.subject.trim(),
        message: form.message.trim(),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/client-auth/feedback"] });
      setShowForm(false);
      setForm({ type: "feedback", subject: "", message: "" });
      toast({ title: "Submitted", description: form.type === "complaint" ? "Your complaint has been recorded. We will follow up." : "Thank you for your feedback." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const formatDate = (s: string) => new Date(s).toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const formatStatus = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <ClientLayout clientName="">
      <div className="max-w-2xl mx-auto space-y-6">
        <Button variant="ghost" className="gap-2" onClick={() => setLocation("/client")}>
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Button>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Complaints & feedback
            </CardTitle>
            <Button size="sm" className="gap-2" onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4" />
              New
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-muted-foreground text-sm py-6 text-center">Loading…</p>
            ) : items.length === 0 ? (
              <p className="text-muted-foreground text-sm py-6 text-center">No complaints or feedback yet. Use &quot;New&quot; to submit.</p>
            ) : (
              <ul className="space-y-3">
                {items.map((item) => (
                  <li key={item.id} className="p-4 border rounded-lg">
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <p className="font-medium text-sm capitalize">{item.type}</p>
                        <p className="text-sm mt-1">{item.subject}</p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.message}</p>
                        <p className="text-xs text-muted-foreground mt-2">{formatDate(item.createdAt)} — {formatStatus(item.status)}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {showForm && (
          <Card>
            <CardHeader>
              <CardTitle>Submit complaint or feedback</CardTitle>
              <p className="text-sm text-muted-foreground">Send a complaint or general feedback. We will respond as soon as we can.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v: "complaint" | "feedback") => setForm((p) => ({ ...p, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="complaint">Complaint</SelectItem>
                    <SelectItem value="feedback">Feedback</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Subject</Label>
                <Input value={form.subject} onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))} placeholder="Short subject" maxLength={500} />
              </div>
              <div>
                <Label>Message</Label>
                <Textarea value={form.message} onChange={(e) => setForm((p) => ({ ...p, message: e.target.value }))} placeholder="Your message..." rows={4} maxLength={5000} />
              </div>
              <div className="flex gap-2">
                <Button
                  disabled={!form.subject.trim() || !form.message.trim() || createMutation.isPending}
                  onClick={() => createMutation.mutate()}
                >
                  {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Submit
                </Button>
                <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ClientLayout>
  );
}
