import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ClaimResponse {
  clientId: string;
  firstName: string;
  securityQuestions: { id: string; question: string }[];
}

export default function ClientClaim() {
  const [step, setStep] = useState(1);
  const [policyNumber, setPolicyNumber] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [clientId, setClientId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [securityQuestions, setSecurityQuestions] = useState<{ id: string; question: string }[]>([]);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [securityQuestionId, setSecurityQuestionId] = useState("");
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const claimMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/client-auth/claim", { activationCode, policyNumber });
      return res.json() as Promise<ClaimResponse>;
    },
    onSuccess: (data) => {
      setClientId(data.clientId);
      setFirstName(data.firstName);
      setSecurityQuestions(data.securityQuestions || []);
      setStep(2);
    },
    onError: (error: Error) => {
      toast({ title: "Verification Failed", description: "Invalid activation code or policy number.", variant: "destructive" });
    },
  });

  const enrollMutation = useMutation({
    mutationFn: async () => {
      const referralCode = sessionStorage.getItem("agent_referral_code") || undefined;
      const res = await apiRequest("POST", "/api/client-auth/enroll", {
        clientId,
        password: newPassword,
        securityQuestionId,
        securityAnswer,
        referralCode,
      });
      return res.json();
    },
    onSuccess: () => {
      setStep(3);
    },
    onError: (error: Error) => {
      toast({ title: "Enrollment Failed", description: error.message.includes("400") ? "Please check your details and try again." : "An error occurred. Please try again.", variant: "destructive" });
    },
  });

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    if (!policyNumber || !activationCode) return;
    claimMutation.mutate();
  };

  const handleEnroll = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords don't match", description: "Please ensure both passwords are identical.", variant: "destructive" });
      return;
    }
    if (newPassword.length < 8) {
      toast({ title: "Password too short", description: "Password must be at least 8 characters.", variant: "destructive" });
      return;
    }
    if (!securityQuestionId || !securityAnswer) {
      toast({ title: "Missing fields", description: "Please select a security question and provide an answer.", variant: "destructive" });
      return;
    }
    enrollMutation.mutate();
  };

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg border-border/50 shadow-lg">
        <CardHeader className="text-center pb-6">
          <div className="mx-auto bg-primary/10 w-16 h-16 rounded-2xl flex items-center justify-center mb-6">
            <img src="/assets/logo.png" alt="Chibikhulu Logo" className="w-10 h-10 rounded-lg" />
          </div>
          <CardTitle className="text-3xl font-display">Claim Your Policy</CardTitle>
          <CardDescription className="text-base mt-2">
            {step === 1 ? "Verify your identity using your policy number and activation code." :
             step === 2 ? `Welcome ${firstName}! Set up your secure password and security question.` :
             "Your account has been successfully set up."}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {step === 1 && (
            <form className="space-y-4 animate-in fade-in slide-in-from-bottom-4" onSubmit={handleVerify}>
              <div className="space-y-2">
                <Label htmlFor="policyNumber">Policy Number</Label>
                <Input
                  id="policyNumber"
                  placeholder="e.g. POL-12345678"
                  value={policyNumber}
                  onChange={(e) => setPolicyNumber(e.target.value)}
                  required
                  data-testid="input-claim-policy-number"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="activationCode">Activation Code</Label>
                <Input
                  id="activationCode"
                  placeholder="Enter the code provided by your agent"
                  value={activationCode}
                  onChange={(e) => setActivationCode(e.target.value)}
                  required
                  data-testid="input-activation-code"
                />
                <p className="text-xs text-muted-foreground">
                  If you don't have an activation code, contact your agent or branch office.
                </p>
              </div>
              <Button
                className="w-full h-11 mt-4"
                type="submit"
                disabled={claimMutation.isPending}
                data-testid="btn-verify-identity"
              >
                {claimMutation.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Verifying...</>
                ) : (
                  <>Verify Identity <ArrowRight className="ml-2 w-4 h-4" /></>
                )}
              </Button>
            </form>
          )}

          {step === 2 && (
            <form className="space-y-4 animate-in fade-in slide-in-from-bottom-4" onSubmit={handleEnroll}>
              <div className="space-y-2">
                <Label htmlFor="newPassword">New Password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  data-testid="input-new-password"
                />
                <p className="text-xs text-muted-foreground">Minimum 8 characters</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  data-testid="input-confirm-password"
                />
              </div>
              <div className="pt-4 border-t space-y-4">
                <div className="space-y-2">
                  <Label>Security Question</Label>
                  <Select value={securityQuestionId} onValueChange={setSecurityQuestionId}>
                    <SelectTrigger data-testid="select-security-question">
                      <SelectValue placeholder="Select a question" />
                    </SelectTrigger>
                    <SelectContent>
                      {securityQuestions.length > 0 ? (
                        securityQuestions.map((q) => (
                          <SelectItem key={q.id} value={q.id}>{q.question}</SelectItem>
                        ))
                      ) : (
                        <>
                          <SelectItem value="q1">What was the name of your first pet?</SelectItem>
                          <SelectItem value="q2">In what city were you born?</SelectItem>
                          <SelectItem value="q3">What is your mother's maiden name?</SelectItem>
                          <SelectItem value="q4">What high school did you attend?</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    This will be used for password resets.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="securityAnswer">Security Answer</Label>
                  <Input
                    id="securityAnswer"
                    type="text"
                    value={securityAnswer}
                    onChange={(e) => setSecurityAnswer(e.target.value)}
                    required
                    data-testid="input-security-answer"
                  />
                </div>
              </div>
              <Button
                className="w-full h-11 mt-4"
                type="submit"
                disabled={enrollMutation.isPending}
                data-testid="btn-complete-setup"
              >
                {enrollMutation.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Setting up...</>
                ) : (
                  "Complete Setup"
                )}
              </Button>
            </form>
          )}

          {step === 3 && (
            <div className="flex flex-col items-center justify-center py-6 text-center animate-in fade-in zoom-in-95">
              <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-4">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold mb-2" data-testid="text-enrollment-success">Account Ready!</h3>
              <p className="text-muted-foreground mb-6">
                Your password and security question have been set. You can now sign in to your client portal.
              </p>
              <Link href="/client/login">
                <Button className="w-full h-11" data-testid="btn-go-to-login">
                  Sign In Now
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
