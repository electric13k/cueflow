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
import CookieConsent from "./components/CookieConsent";
import SignInPrompt from "./components/SignInPrompt";
import Toaster from "./components/Toaster";
import { applyTheme, getTheme } from "./lib/theme";

/** /legal was one page with two anchors; keep old links working now that it is two pages. */
function LegalRedirect() {
  const { hash } = useLocation();
  return <Navigate to={hash === "#privacy" ? "/privacy" : "/terms"} replace />;
}

applyTheme(getTheme());
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/features" element={<Features />} />
        <Route path="/studio" element={<Studio />} />
        <Route path="/audience" element={<Audience />} />
        <Route path="/tutorial" element={<Tutorial />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/legal" element={<LegalRedirect />} />
        <Route path="*" element={<Home />} />
      </Routes>
      <Toaster />
      <CookieConsent />
      <SignInPrompt />
    </BrowserRouter>
  </StrictMode>
);
