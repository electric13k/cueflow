import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./styles.css";
import Home from "./pages/Home";
import Studio from "./pages/Studio";
import Audience from "./pages/Audience";
import Legal from "./pages/Legal";
import Tutorial from "./pages/Tutorial";
import CookieConsent from "./components/CookieConsent";
import SignInPrompt from "./components/SignInPrompt";
import Toaster from "./components/Toaster";
import { applyTheme, getTheme } from "./lib/theme";

applyTheme(getTheme());
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/studio" element={<Studio />} />
        <Route path="/audience" element={<Audience />} />
        <Route path="/legal" element={<Legal />} />
        <Route path="/tutorial" element={<Tutorial />} />
        <Route path="*" element={<Home />} />
      </Routes>
      <Toaster />
      <CookieConsent />
      <SignInPrompt />
    </BrowserRouter>
  </StrictMode>
);
