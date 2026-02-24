import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, CheckCircle2 } from "lucide-react";

export default function ClientClaim() {
  const [step, setStep] = useState(1);

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg border-border/50 shadow-lg">
        <CardHeader className="text-center pb-6">
          <div className="mx-auto bg-primary/10 w-16 h-16 rounded-2xl flex items-center justify-center mb-6">
            <img src="/assets/logo.png" alt="Logo" className="w-10 h-10 rounded-lg" />
          </div>
          <CardTitle className="text-3xl font-display">Claim Your Policy</CardTitle>
          <CardDescription className="text-base mt-2">
            {step === 1 ? "Verify your identity using your policy number and activation code." : 
             step === 2 ? "Set up your secure password and security question." : 
             "Your account has been successfully set up."}
          </CardDescription>
        </CardHeader>
        
        <CardContent>
          {step === 1 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
              <div className="space-y-2">
                <Label htmlFor="policyNumber">Policy Number</Label>
                <Input id="policyNumber" placeholder="e.g. POL-12345678" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="activationCode">Activation Code</Label>
                <Input id="activationCode" placeholder="Enter the code provided by your agent" />
                <p className="text-xs text-muted-foreground">
                  If you don't have an activation code, you can use a security question verification workflow instead (Admin assisted).
                </p>
              </div>
              <Button className="w-full h-11 mt-4" onClick={() => setStep(2)}>
                Verify Identity <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">New Password</Label>
                <Input id="newPassword" type="password" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input id="confirmPassword" type="password" />
              </div>
              <div className="pt-4 border-t space-y-4">
                <div className="space-y-2">
                  <Label>Security Question</Label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a question" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="q1">What was the name of your first pet?</SelectItem>
                      <SelectItem value="q2">In what city were you born?</SelectItem>
                      <SelectItem value="q3">What is your mother's maiden name?</SelectItem>
                      <SelectItem value="q4">What high school did you attend?</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    This will be used for password resets instead of SMS/Email OTP.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="securityAnswer">Security Answer</Label>
                  <Input id="securityAnswer" type="text" />
                </div>
              </div>
              <Button className="w-full h-11 mt-4" onClick={() => setStep(3)}>
                Complete Setup
              </Button>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col items-center justify-center py-6 text-center animate-in fade-in zoom-in-95">
              <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-4">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold mb-2">Account Ready!</h3>
              <p className="text-muted-foreground mb-6">
                Your password and security question have been set. You can now access your client portal.
              </p>
              <Link href="/client">
                <Button className="w-full h-11">
                  Go to Dashboard
                </Button>
              </Link>
            </div>
          )}
        </CardContent>

        {step < 3 && (
          <CardFooter className="flex flex-col border-t pt-6 gap-4">
            <div className="text-center text-sm text-muted-foreground">
              Already claimed your account?{" "}
              <Link href="/client/login">
                <span className="text-primary font-medium hover:underline cursor-pointer">
                  Sign in here
                </span>
              </Link>
            </div>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}