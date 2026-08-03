import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Mail } from "lucide-react";
import ContactForm from "../components/ContactForm";
import Page from "../components/Page";

const fade = (d = 0) => ({ initial: { opacity: 0, y: 22 }, animate: { opacity: 1, y: 0 }, transition: { duration: .5, delay: d } });

export default function Contact() {
  return (
    <Page width="max-w-3xl">
      <motion.p {...fade()} className="text-[11px] font-semibold uppercase tracking-[.3em] text-accent">Contact</motion.p>
      <motion.h1 {...fade(.05)} className="mt-2 text-4xl font-black tracking-tight sm:text-5xl">Say hello.</motion.h1>
      <motion.p {...fade(.1)} className="mt-4 text-lg text-muted">
        Bug reports, feature ideas, or a request to delete your account and its data. Signed in? The form already knows where to reply.
      </motion.p>

      <motion.div {...fade(.15)} className="glass mt-8 p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-xl font-bold"><Mail size={18} className="text-accent" />Send a message</h2>
        <ContactForm />
      </motion.div>

      <p className="mt-6 text-sm text-muted">
        Data questions are covered in the <Link to="/privacy" className="text-accent underline-offset-2 hover:underline">Privacy Policy</Link>, and what you agree to by using CueFlow is in the <Link to="/terms" className="text-accent underline-offset-2 hover:underline">Terms</Link>.
      </p>
    </Page>
  );
}
