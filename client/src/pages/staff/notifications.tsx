import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import StaffLayout from "@/components/layout/staff-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Bell, Plus, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

const EVENT_TYPES = [
  "premium_due", "grace_start", "pre_lapse_warning", "activation",
  "reinstatement", "birthday", "anniversary", "payment_receipt",
];

const MERGE_TAGS = [
  "{name}", "{policy_number}", "{premium_amount}", "{outstanding}",
  "{cycle_end}", "{grace_end}", "{payment_link}",
];

export default function StaffNotifications() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);

  const { data: templates = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/notification-templates"] });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/notification-templates", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-templates"] });
      setShowDialog(false);
      toast({ title: "Template created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createMutation.mutate({
      name: fd.get("name"),
      eventType: fd.get("eventType"),
      channel: fd.get("channel"),
      subject: fd.get("subject") || undefined,
      bodyTemplate: fd.get("bodyTemplate"),
    });
  };

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-notifications-title">Notifications</h1>
            <p className="text-muted-foreground">Manage notification templates and delivery</p>
          </div>
          <Dialog open={showDialog} onOpenChange={setShowDialog}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-template"><Plus className="h-4 w-4 mr-2" />New Template</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Create Notification Template</DialogTitle></DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                <div><Label>Name</Label><Input name="name" required data-testid="input-template-name" /></div>
                <div><Label>Event Type</Label>
                  <Select name="eventType" defaultValue="premium_due">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EVENT_TYPES.map(t => (
                        <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Channel</Label>
                  <Select name="channel" defaultValue="in_app">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="in_app">In-App</SelectItem>
                      <SelectItem value="sms">SMS</SelectItem>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Subject</Label><Input name="subject" data-testid="input-template-subject" /></div>
                <div>
                  <Label>Body Template</Label>
                  <Textarea name="bodyTemplate" rows={5} required data-testid="input-template-body" />
                  <p className="text-xs text-muted-foreground mt-1">
                    Available merge tags: {MERGE_TAGS.join(", ")}
                  </p>
                </div>
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-template">
                  {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Create
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Bell className="h-5 w-5" />Templates</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : templates.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No notification templates configured yet</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((t: any) => (
                    <TableRow key={t.id} data-testid={`row-template-${t.id}`}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell><Badge variant="outline">{t.eventType.replace(/_/g, " ")}</Badge></TableCell>
                      <TableCell><Badge variant="secondary">{t.channel}</Badge></TableCell>
                      <TableCell className="text-sm">{t.subject || "—"}</TableCell>
                      <TableCell><Badge variant={t.isActive ? "default" : "secondary"}>{t.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </StaffLayout>
  );
}
