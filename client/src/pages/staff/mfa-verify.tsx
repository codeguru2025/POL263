import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiBase, getCsrfToken } from "@/lib/queryClient";
import { Loader2, ShieldCheck, MessageSquare, Smartphone } from "lucide-react";
import { AppChrome } from "@/components/layout/app-chrome";

type AltChannel = { channel: "sms" | "whatsapp"; maskedNumber: string };
type Step = "totp" | "channel-select" | "confirm-number" | "code-entry";

async function postJson(path: string, body: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const csrf = getCsrfToken();
  if (csrf) headers["X-XSRF-TOKEN"] = csrf;
  const res = await fetch(getApiBase() + path, {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

/**
 * Reached via a full-page redirect from GET /api/auth/google/callback when the signing-in staff
 * member has MFA enabled (see beginStaffMfaChallenge, server/auth.ts) — the OAuth login isn't
 * complete yet, just pending on this code. On success the server hands back a redirectUrl (the
 * same destination the non-MFA callback would have redirected to directly) rather than doing the
 * redirect itself, since a fetch() response can't navigate the page.
 *
 * "Try another way" adds an SMS/WhatsApp fallback for anyone who's lost access to their
 * authenticator app: pick a channel → re-type the masked number shown to prove you know it →
 * receive and enter a one-time code. See server/auth.ts's /api/auth/mfa/alt-channels,
 * .../challenge-alt, .../verify-alt-code.
 */
export default function StaffMfaVerify() {
  const [step, setStep] = useState<Step>("totp");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [altChannels, setAltChannels] = useState<AltChannel[] | null>(null);
  const [altChannelsLoading, setAltChannelsLoading] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<AltChannel | null>(null);
  const [confirmNumber, setConfirmNumber] = useState("");
  const [altCode, setAltCode] = useState("");

  const finishLogin = (redirectUrl?: string) => {
    window.location.href = redirectUrl || "/staff";
  };

  const handleTotpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const { ok, data } = await postJson("/api/auth/mfa/verify-login", { code: code.trim() });
      if (!ok) {
        setError(data.message || "Invalid code. Please try again.");
        return;
      }
      finishLogin(data.redirectUrl);
    } catch {
      setError("Connection error. Please check your internet and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const openTryAnotherWay = async () => {
    setError("");
    setAltChannelsLoading(true);
    setStep("channel-select");
    try {
      const res = await fetch(getApiBase() + "/api/auth/mfa/alt-channels", { credentials: "include" });
      const data = await res.json().catch(() => ({ channels: [] }));
      if (!res.ok) {
        setError(data.message || "Couldn't load fallback options.");
        setStep("totp");
        return;
      }
      setAltChannels(data.channels || []);
    } catch {
      setError("Connection error. Please check your internet and try again.");
      setStep("totp");
    } finally {
      setAltChannelsLoading(false);
    }
  };

  const chooseChannel = (ch: AltChannel) => {
    setSelectedChannel(ch);
    setConfirmNumber("");
    setError("");
    setStep("confirm-number");
  };

  const sendAltCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedChannel || !confirmNumber.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const { ok, data } = await postJson("/api/auth/mfa/challenge-alt", {
        channel: selectedChannel.channel,
        confirmedNumber: confirmNumber.trim(),
      });
      if (!ok) {
        setError(data.message || "Couldn't send the code. Please try again.");
        return;
      }
      setAltCode("");
      setStep("code-entry");
    } catch {
      setError("Connection error. Please check your internet and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const verifyAltCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!altCode.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const { ok, data } = await postJson("/api/auth/mfa/verify-alt-code", { code: altCode.trim() });
      if (!ok) {
        setError(data.message || "Invalid code. Please try again.");
        return;
      }
      finishLogin(data.redirectUrl);
    } catch {
      setError("Connection error. Please check your internet and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppChrome center>
      <Card className="w-full max-w-md border-border/50 shadow-lg">
        <CardHeader className="text-center pb-6">
          <div className="mx-auto h-14 w-14 bg-primary/10 text-primary rounded-xl flex items-center justify-center mb-4">
            <ShieldCheck size={28} />
          </div>
          <CardTitle className="text-2xl font-display">Two-factor verification</CardTitle>
          <CardDescription className="text-base mt-2">
            {step === "totp" && "Enter the code from your authenticator app, or one of your backup codes."}
            {step === "channel-select" && "Choose where to receive a verification code."}
            {step === "confirm-number" && selectedChannel && `Confirm your number to receive a code via ${selectedChannel.channel === "sms" ? "SMS" : "WhatsApp"}.`}
            {step === "code-entry" && selectedChannel && `Enter the code sent via ${selectedChannel.channel === "sms" ? "SMS" : "WhatsApp"}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <p className="text-sm text-destructive bg-destructive/10 p-3 rounded text-center" data-testid="text-mfa-verify-error">
              {error}
            </p>
          )}

          {step === "totp" && (
            <form onSubmit={handleTotpSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="mfa-code">Authentication code</Label>
                <Input
                  id="mfa-code"
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  className="h-11 text-center text-lg tracking-widest"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  disabled={submitting}
                  data-testid="input-mfa-code"
                />
              </div>
              <Button type="submit" className="w-full h-11" disabled={submitting || !code.trim()} data-testid="button-mfa-verify">
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Verify
              </Button>
              <div className="text-center">
                <Button
                  type="button"
                  variant="link"
                  className="text-muted-foreground text-xs"
                  onClick={openTryAnotherWay}
                  data-testid="link-mfa-try-another-way"
                >
                  Try another way
                </Button>
              </div>
            </form>
          )}

          {step === "channel-select" && (
            <div className="space-y-3">
              {altChannelsLoading && (
                <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              )}
              {!altChannelsLoading && altChannels?.length === 0 && (
                <p className="text-sm text-muted-foreground text-center">
                  No phone or WhatsApp number is on file for your account. Use your authenticator app or a backup code instead.
                </p>
              )}
              {!altChannelsLoading && altChannels?.map((ch) => (
                <Button
                  key={ch.channel}
                  type="button"
                  variant="outline"
                  className="w-full h-auto py-3 justify-start gap-3"
                  onClick={() => chooseChannel(ch)}
                  data-testid={`button-alt-channel-${ch.channel}`}
                >
                  {ch.channel === "sms" ? <Smartphone className="h-5 w-5 shrink-0" /> : <MessageSquare className="h-5 w-5 shrink-0" />}
                  <span className="text-left">
                    <span className="block font-medium">{ch.channel === "sms" ? "Text message (SMS)" : "WhatsApp"}</span>
                    <span className="block text-xs text-muted-foreground">{ch.maskedNumber}</span>
                  </span>
                </Button>
              ))}
              <div className="text-center pt-1">
                <Button type="button" variant="link" className="text-muted-foreground text-xs" onClick={() => { setStep("totp"); setError(""); }}>
                  Back to authenticator code
                </Button>
              </div>
            </div>
          )}

          {step === "confirm-number" && selectedChannel && (
            <form onSubmit={sendAltCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="confirm-number">
                  Enter your full number ({selectedChannel.maskedNumber}) to confirm
                </Label>
                <Input
                  id="confirm-number"
                  autoFocus
                  inputMode="tel"
                  placeholder="e.g. +263771234567"
                  value={confirmNumber}
                  onChange={(e) => setConfirmNumber(e.target.value)}
                  disabled={submitting}
                  data-testid="input-confirm-number"
                />
              </div>
              <Button type="submit" className="w-full h-11" disabled={submitting || !confirmNumber.trim()} data-testid="button-send-alt-code">
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Send code
              </Button>
              <div className="text-center">
                <Button type="button" variant="link" className="text-muted-foreground text-xs" onClick={() => { setStep("channel-select"); setError(""); }}>
                  Choose a different method
                </Button>
              </div>
            </form>
          )}

          {step === "code-entry" && (
            <form onSubmit={verifyAltCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="alt-code">Verification code</Label>
                <Input
                  id="alt-code"
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  className="h-11 text-center text-lg tracking-widest"
                  value={altCode}
                  onChange={(e) => setAltCode(e.target.value)}
                  disabled={submitting}
                  data-testid="input-alt-code"
                />
              </div>
              <Button type="submit" className="w-full h-11" disabled={submitting || !altCode.trim()} data-testid="button-verify-alt-code">
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Verify
              </Button>
              <div className="text-center">
                <Button type="button" variant="link" className="text-muted-foreground text-xs" onClick={() => { setStep("channel-select"); setError(""); }}>
                  Choose a different method
                </Button>
              </div>
            </form>
          )}

          <div className="text-center pt-2">
            <Link href="/staff/login">
              <Button variant="link" className="text-muted-foreground text-xs" data-testid="link-mfa-back-to-login">
                Not you? Back to login
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </AppChrome>
  );
}
