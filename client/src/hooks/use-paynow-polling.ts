import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

export interface PaynowInitiateResponse {
  redirectUrl?: string;
  pollUrl?: string;
  message?: string;
  innbucksCode?: string;
  innbucksExpiry?: string;
  omariOtpReference?: string;
  needsOtp?: boolean;
}
export interface PaynowPollResponse {
  status: string;
  paid?: boolean;
  error?: string;
  paynowStatus?: string;
}
export interface PaynowOtpResponse {
  paid?: boolean;
  message?: string;
}

/**
 * Drives the Paynow initiate -> poll -> (optional OTP) -> paid state machine. Generic over which
 * endpoints the caller hits (staff /api/payment-intents/:id/* vs the public /api/pay/:token/*
 * payment-link routes) — pass the three calls in, this owns the waiting/polling/timeout UI state.
 */
export function usePaynowPolling({
  initiate,
  poll,
  submitOtp,
  onPaid,
  pollIntervalMs = 5000,
  timeoutMs = 5 * 60 * 1000,
}: {
  initiate: () => Promise<PaynowInitiateResponse>;
  poll: () => Promise<PaynowPollResponse>;
  submitOtp: (otp: string) => Promise<PaynowOtpResponse>;
  onPaid: () => void;
  pollIntervalMs?: number;
  timeoutMs?: number;
}) {
  const [phase, setPhase] = useState<"idle" | "waiting">("idle");
  const [polling, setPolling] = useState(false);
  const [pollStartTime, setPollStartTime] = useState(0);
  const [pollError, setPollError] = useState<string | null>(null);
  const [innbucksCode, setInnbucksCode] = useState("");
  const [innbucksExpiry, setInnbucksExpiry] = useState("");
  const [needsOtp, setNeedsOtp] = useState(false);
  const [otpRef, setOtpRef] = useState("");
  const [otp, setOtp] = useState("");
  const [failed, setFailed] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setPolling(false);
    setPollStartTime(0);
    setPollError(null);
    setInnbucksCode("");
    setInnbucksExpiry("");
    setNeedsOtp(false);
    setOtpRef("");
    setOtp("");
    setFailed(null);
  }, []);

  const initiateMutation = useMutation({
    mutationFn: initiate,
    onSuccess: (data) => {
      if (data.message) {
        setFailed(data.message);
        return;
      }
      setPhase("waiting");
      setPollStartTime(Date.now());
      setPollError(null);
      if (data.innbucksCode) {
        setInnbucksCode(data.innbucksCode);
        setInnbucksExpiry(data.innbucksExpiry || "");
        setPolling(true);
        return;
      }
      if (data.needsOtp) {
        setNeedsOtp(true);
        setOtpRef(data.omariOtpReference || "");
        return;
      }
      if (data.redirectUrl) {
        window.open(data.redirectUrl, "_blank");
        setPolling(true);
        return;
      }
      setPolling(true);
    },
    onError: (e: Error) => setFailed(e.message),
  });

  const otpMutation = useMutation({
    mutationFn: () => submitOtp(otp),
    onSuccess: (data) => {
      if (data.message) {
        setFailed(data.message);
        return;
      }
      if (data.paid) {
        onPaid();
        return;
      }
      setPolling(true);
      setNeedsOtp(false);
    },
    onError: (e: Error) => setFailed(e.message),
  });

  const { data: pollData } = useQuery({
    queryKey: ["paynow-poll", pollStartTime],
    queryFn: poll,
    enabled: polling,
    refetchInterval: pollIntervalMs,
  });

  useEffect(() => {
    if (!pollData) return;
    if (pollData.paid || pollData.status === "paid") {
      setPolling(false);
      setPollError(null);
      onPaid();
      return;
    }
    if (pollData.status === "failed") {
      setPolling(false);
      setFailed("The payment was declined or cancelled.");
      return;
    }
    if (pollData.error) setPollError(pollData.error);
    if (pollStartTime && Date.now() - pollStartTime > timeoutMs) {
      setPolling(false);
      setPollError("Payment confirmation timed out. If the money was deducted, it will still be recorded once the gateway confirms — check back shortly.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollData]);

  return {
    phase,
    polling,
    pollError,
    innbucksCode,
    innbucksExpiry,
    needsOtp,
    otpRef,
    otp,
    setOtp,
    failed,
    initiate: initiateMutation.mutate,
    initiating: initiateMutation.isPending,
    submitOtp: otpMutation.mutate,
    submittingOtp: otpMutation.isPending,
    reset,
  };
}
