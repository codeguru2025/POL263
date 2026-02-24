import StaffLayout from "@/components/layout/staff-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Building2, Wallet, Activity } from "lucide-react";

export default function StaffDashboard() {
  const stats = [
    { title: "Total Properties", value: "124", icon: Building2, trend: "+4% this month" },
    { title: "Active Tenants", value: "892", icon: Users, trend: "+12% this month" },
    { title: "Revenue (MTD)", value: "$142,300", icon: Wallet, trend: "+8% this month" },
    { title: "Open Maintenance", value: "18", icon: Activity, trend: "-2 from yesterday" },
  ];

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-display font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of your current tenant context.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((stat) => (
            <Card key={stat.title} className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </CardTitle>
                <stat.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-display" data-testid={`stat-${stat.title.toLowerCase().replace(/\s+/g, '-')}`}>
                  {stat.value}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {stat.trend}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="font-display">Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-4 border-b last:border-0 pb-4 last:pb-0">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                      <Activity className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Lease Agreement Updated</p>
                      <p className="text-xs text-muted-foreground">Unit 4B, Sunrise Apartments - 2 hours ago</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="font-display">Security Context</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Current User</span>
                  <span className="font-medium">ausiziba@gmail.com</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Assigned Role</span>
                  <span className="font-medium inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-primary/10 text-primary">Superuser</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Tenant Scoping</span>
                  <span className="font-medium">Acme Corp (ID: org_123)</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-muted-foreground">Branch Scoping</span>
                  <span className="font-medium">HQ - New York (ID: br_456)</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </StaffLayout>
  );
}