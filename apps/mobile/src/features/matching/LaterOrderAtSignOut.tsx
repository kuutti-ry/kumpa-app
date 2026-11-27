import { useEffect } from "react";
import { useSession } from "@/features/identity";
import { forgetLaterOrder } from "./later-order";

/**
 * The order a person gave their Later list goes with them (ADR-064 §6): it is
 * forgotten whenever this phone signs out, and at a start that finds it signed
 * out, so that whoever signs in here next starts with none. Mounted once in the
 * root layout under the session, as the push is.
 */
export function LaterOrderAtSignOut() {
  const { status } = useSession();
  useEffect(() => {
    if (status === "signed-out") void forgetLaterOrder();
  }, [status]);
  return null;
}
