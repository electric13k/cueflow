import { lazy, Suspense, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import "./styles.css";
const Home = lazy(() => import("./pages/Home"));
const Features = lazy(() => import("./pages/Features"));
const Studio = lazy(() => import("./pages/Studio"));
const Audience = lazy(() => import("./pages/Audience"));
const Contact = lazy(() => import("./pages/Contact"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Terms = lazy(() => import("./pages/Terms"));
const Cookies = lazy(() => import("./pages/Cookies"));
const Tutorial = lazy(() => import("./pages/Tutorial"));
const Credits = lazy(() => import("./pages/Credits"));
const Script = lazy(() => import("./pages/Script"));
const Account = lazy(() => import("./pages/Account"));
const Settings = lazy(() => import("./pages/Settings"));
const Projects = lazy(() => import("./pages/Projects"));
const Workspace = lazy(() => import("./pages/Workspace"));
const Show = lazy(() => import("./pages/Show"));
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
import { registerCueflowCache } from "./lib/cache";

/** /legal was one page with two anchors; keep old links working now that it is two pages. */
function RouteLoading() {
  return <div className="min-h-dvh bg-background p-6 text-foreground"><div className="mx-auto max-w-7xl animate-pulse rounded-2xl border border-border bg-surface/50 p-8"><div className="h-4 w-24 rounded bg-surface-secondary" /><div className="mt-5 h-10 w-2/3 rounded bg-surface-secondary" /><div className="mt-3 h-4 w-full max-w-xl rounded bg-surface-secondary" /></div></div>;
}

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
registerCueflowCache();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      {/* BASE_URL is "/" everywhere except GitHub Pages, which serves the app from /<repo>/. */}
      <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Suspense fallback={<RouteLoading />}>
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
        <Route path="/show" element={<Show />} />
        <Route path="/account" element={<Account />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/cookies" element={<Cookies />} />
        <Route path="/legal" element={<LegalRedirect />} />
        <Route path="*" element={<Home />} />
      </Routes>
      </Suspense>
      <Toaster />
      <CookieConsent />
      <SignInPrompt />
      <UsernamePrompt />
      <Coach />
        <Tour />
      </BrowserRouter>
    </MotionConfig>
  </StrictMode>
);
