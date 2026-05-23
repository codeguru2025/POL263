import React, { createContext, useContext, useState, useEffect } from "react";
import * as Network from "expo-network";

interface NetworkState {
  isOnline: boolean;
}

const NetworkContext = createContext<NetworkState>({ isOnline: true });

export function useNetwork() {
  return useContext(NetworkContext);
}

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const state = await Network.getNetworkStateAsync();
        if (mounted) setIsOnline(!!state.isConnected && !!state.isInternetReachable);
      } catch {
        if (mounted) setIsOnline(false);
      }
    };
    check();
    const interval = setInterval(check, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <NetworkContext.Provider value={{ isOnline }}>
      {children}
    </NetworkContext.Provider>
  );
}
