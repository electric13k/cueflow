import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useHref, useNavigate } from "react-router-dom";
import { HeroUIProvider } from "@heroui/react";
import "./styles.css";
import Home from "./pages/Home";
import Studio from "./pages/Studio";
import Audience from "./pages/Audience";

// Bridge HeroUI's href-based components to react-router for client-side navigation.
function Providers({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return <HeroUIProvider navigate={navigate} useHref={useHref}>{children}</HeroUIProvider>;
}

document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Providers>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/studio" element={<Studio />} />
          <Route path="/audience" element={<Audience />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </Providers>
    </BrowserRouter>
  </StrictMode>
);
