import ClientLayout from "@/components/layout/client-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, AlertCircle, CheckCircle2 } from "lucide-react";

export default function ClientDashboard() {
  return (
    <ClientLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-display font-bold">Welcome back, Jane!</h1>
          <p className="text-muted-foreground mt-1">Here is a quick overview of your current property status.</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <Card className="md:col-span-2 border-primary/20 bg-primary/5 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                Current Lease Active
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Property</p>
                  <p className="font-medium">Sunrise Apartments, Unit 4B</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Lease Ends</p>
                  <p className="font-medium">October 31, 2024</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-amber-500" />
                Next Payment
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-display font-bold">$1,450.00</p>
              <p className="text-sm text-muted-foreground mt-1">Due in 14 days</p>
              <Button className="w-full mt-4" size="sm">Pay Now</Button>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Recent Documents</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { title: "Signed Lease Agreement 2023", date: "Oct 1, 2023" },
                { title: "Move-in Condition Report", date: "Oct 1, 2023" },
                { title: "Pet Addendum", date: "Oct 5, 2023" }
              ].map((doc, i) => (
                <div key={i} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/10 text-primary rounded-md">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{doc.title}</p>
                      <p className="text-xs text-muted-foreground">{doc.date}</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm">Download</Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </ClientLayout>
  );
}