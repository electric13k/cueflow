import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HeroUIProvider } from "@heroui/react";
import "./styles.css";
import App from "./App";
document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")!).render(<StrictMode><HeroUIProvider><App /></HeroUIProvider></StrictMode>);
