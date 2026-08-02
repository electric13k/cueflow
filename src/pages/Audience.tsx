import { useEffect } from "react";

// Pure-black window for the mirrored/projected screen: audience sees nothing of the app.
// It is a separate document, so keys pressed here never reach the Studio tab. Forward them to the
// opener so the arrow keys keep driving cues while this window has focus.
export default function Audience() {
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return; // leave browser shortcuts alone
      if (e.key.startsWith("Arrow") || e.key === " ") e.preventDefault(); // no scrolling a black page
      window.opener?.postMessage({ cueflow: "key", key: e.key }, location.origin);
    };
    window.addEventListener("keydown", keys);
    window.focus();
    return () => window.removeEventListener("keydown", keys);
  }, []);
  return <main className="min-h-screen bg-black" />;
}
