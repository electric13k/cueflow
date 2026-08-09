import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { onAuth } from "../lib/store";

/**
 * Signed out, the app is still the app: the Studio, its library and its sequences all work without
 * an account. What an account buys is a workspace, so the workspace, projects and shows do not
 * render at all without one. Hiding a link is not a gate, it is a suggestion.
 *
 * `null` is "auth has not answered yet", and rendering nothing for that beat is the whole point:
 * redirecting on a pending answer would bounce a signed-in visitor out of their own workspace on
 * every reload.
 */
export function useSignedIn(): boolean | null {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => onAuth(email => setSignedIn(!!email)), []);
  return signedIn;
}

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const signedIn = useSignedIn();
  if (signedIn === null) return null;
  // The Studio is where a signed-out visitor is allowed to be, so that is where they land.
  return signedIn ? <>{children}</> : <Navigate to="/studio" replace />;
}
