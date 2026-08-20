import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import "./styles.css";
import Home from "./pages/Home";
import Features from "./pages/Features";
import Studio from "./pages/Studio";
import Audience from "./pages/Audience";
import Contact from "./pages/Contact";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import Tutorial from "./pages/Tutorial";
import Credits from "./pages/Credits";
import Script from "./pages/Script";
import Account from "./pages/Account";
import Settings from "./pages/Settings";
import Projects from "./pages/Projects";
import Workspace from "./pages/Workspace";
import Show from "./pages/Show";
import RequireAuth from "./components/RequireAuth";
import UsernamePrompt from "./components/UsernamePrompt";
import Coach from "./components/Coach";
import Tour from "./components/Tour";
import CookieConsent from "./components/CookieConsent";
import SignInPrompt from "./components/SignInPrompt";
import Toaster from "./components/Toaster";
import { applyTheme, getStudioTheme } from "./lib/theme";
import { applyLayout } from "./lib/layout";
import { trackGlassPointer } from "./lib/glass";
import { touchLastSeen } from "./lib/retention";

/** /legal was one page with two anchors; keep old links working now that it is two pages. */
function LegalRedirect() {
  const { hash } = useLocation();
  return <Navigate to={hash === "#privacy" ? "/privacy" : "/terms"} replace />;
}

// Restore the device theme before first paint so the app, its working surfaces, and portal content
// start in the same mode instead of flashing light and then switching.
applyTheme(getStudioTheme());
// Before first paint, so a compact phone never renders one card per row and then snaps to two.
applyLayout();
trackGlassPointer();
// Once per load, and only for a session that exists. This is the clock the retention sweep reads,
// so the thing that must never happen is an active account looking idle to it.
void touchLastSeen();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* BASE_URL is "/" everywhere except GitHub Pages, which serves the app from /<repo>/. */}
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/features" element={<Features />} />
        <Route path="/studio" element={<Studio />} />
        <Route path="/audience" element={<Audience />} />
        <Route path="/tutorial" element={<Tutorial />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/credits" element={<Credits />} />
        <Route path="/script" element={<Script />} />
        {/* An account buys a workspace, not the app. Studio, the library and sequences are open to
            anyone; these three do not render without a session. See plan.md §8. */}
        <Route path="/workspace" element={<RequireAuth><Workspace /></RequireAuth>} />
        <Route path="/projects" element={<RequireAuth><Projects /></RequireAuth>} />
        <Route path="/show" element={<RequireAuth><Show /></RequireAuth>} />
        <Route path="/account" element={<Account />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/legal" element={<LegalRedirect />} />
        <Route path="*" element={<Home />} />
      </Routes>
      <Toaster />
      <CookieConsent />
      <SignInPrompt />
      <UsernamePrompt />
      <Coach />
      <Tour />
    </BrowserRouter>
  </StrictMode>
);
