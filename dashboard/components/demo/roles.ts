"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";

export type Role = "lender" | "borrower";

const KEY = (r: Role) => `sluice-demo-${r}`;

function read(r: Role): Address | null {
  try {
    return (window.localStorage.getItem(KEY(r)) as Address | null) || null;
  } catch {
    return null;
  }
}

/**
 * Role separation. Each tab records the account that acted in its role (in this browser only), and warns when the
 * connected account is the one that played the other role: a lender and a borrower must be different wallets, or the
 * demo shows one person doing both.
 */
export function useRoles(role: Role, connected: Address | undefined) {
  const other: Role = role === "lender" ? "borrower" : "lender";
  const [otherAddr, setOtherAddr] = useState<Address | null>(null);

  useEffect(() => {
    const sync = () => setOtherAddr(read(other));
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("sluice-roles", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("sluice-roles", sync);
    };
  }, [other]);

  /** Call when this account takes an action in this role. */
  const remember = useCallback(
    (a: Address) => {
      try {
        window.localStorage.setItem(KEY(role), a);
        window.dispatchEvent(new Event("sluice-roles"));
      } catch {
        /* roles just aren't remembered */
      }
    },
    [role],
  );

  const clash = Boolean(connected && otherAddr && connected.toLowerCase() === otherAddr.toLowerCase());
  return { otherAddr, clash, remember };
}
