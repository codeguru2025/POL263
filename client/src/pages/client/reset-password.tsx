import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KeyRound } from "lucide-react";

export default function ClientResetPassword() {
  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-border/50 shadow-lg">
        <CardHeader className="text-center pb-6">
          <div className="mx-auto bg-primary/20 w-16 h-16 rounded-2xl flex items-center justify-center mb-6 ring-1 ring-primary/30">
            <KeyRound className="w-10 h-10 text-primary" />
          </div>
          <CardTitle className="text-2xl font-display">Reset password</CardTitle>
          <CardDescription className="text-base mt-2">
            To reset your client portal password, please contact your administrator or the agent who manages your policy. They can set a new password for you.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Link href="/client/login">
            <Button variant="default" className="w-full">
              Back to sign in
            </Button>
          </Link>
          <div className="text-center">
            <Link href="/">
              <Button variant="link" className="text-muted-foreground">
                &larr; Back to Home
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
