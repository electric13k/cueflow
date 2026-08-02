import { useEffect, useState, type ReactNode } from "react";
import { Keyboard, ListMusic, Monitor, SlidersHorizontal, Upload, UserPlus } from "lucide-react";
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, useDisclosure } from "../ui";

const SEEN = "cueflow:onboarded";

type Step = { icon: typeof Upload; title: string; body: ReactNode };
const steps: Step[] = [
  {
    icon: Upload, title: "1. Get sounds in",
    body: <>Hit <b>Upload</b> in the Library tab to add files from your computer, or paste a direct link to an audio file in the import box. Everything you add stays in your library.</>,
  },
  {
    icon: SlidersHorizontal, title: "2. Shape a sound",
    body: <>Pick a sound, open the <b>Editor</b> tab, and drag across the waveform to select a region. From there you can trim it, mix to mono, balance the left and right channels, and set speed, reverb, fades or distortion.</>,
  },
  {
    icon: ListMusic, title: "3. Build a cue deck",
    body: <>In <b>Sequences</b>, make a sequence and add cues to it — like slides in a deck. Nothing ever autoplays: you step through cues with the arrow keys, one press per cue. Turn on <b>Loop sequence</b> to wrap back to the start.</>,
  },
  {
    icon: Monitor, title: "4. Run the show",
    body: <><b>Audience display</b> opens a pure-black window — drag it onto the projector or mirrored screen so the room sees nothing while you drive the board. Start a sequence straight into audience mode from the Sequences tab.</>,
  },
  {
    icon: Keyboard, title: "5. Make the keys yours",
    body: <>Open <b>Keybinds</b> to rebind everything: arrows step cues, and any key you like can nudge reverb, volume or speed live during playback.</>,
  },
  {
    icon: UserPlus, title: "6. Keep your work",
    body: <>Your library lives in this browser. <b>Sign in</b> from the top bar and your sounds and sequences save to your account instead, so they follow you to any device.</>,
  },
];

/** First-run setup guide. Shows once per browser; re-openable from the Studio header. */
export default function Onboarding({ control }: { control: ReturnType<typeof useDisclosure> }) {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!localStorage.getItem(SEEN)) { localStorage.setItem(SEEN, "1"); control.onOpen(); }
  }, []);

  const step = steps[i];
  const last = i === steps.length - 1;
  return (
    <Modal isOpen={control.isOpen} onOpenChange={control.onOpenChange} placement="center" backdrop="blur">
      <ModalContent>{onClose => (<>
        <ModalHeader className="flex items-center gap-2"><step.icon size={18} className="text-accent" />{step.title}</ModalHeader>
        <ModalBody>
          <p className="text-sm leading-relaxed text-muted">{step.body}</p>
          <div className="mt-3 flex gap-1.5">
            {steps.map((s, n) => (
              <button key={s.title} aria-label={s.title} onClick={() => setI(n)}
                className={`h-1.5 flex-1 rounded-full transition-colors ${n === i ? "bg-accent" : "bg-white/15 hover:bg-white/25"}`} />
            ))}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={() => { setI(0); onClose(); }}>{last ? "Close" : "Skip"}</Button>
          {i > 0 && <Button variant="bordered" onPress={() => setI(n => n - 1)}>Back</Button>}
          {!last && <Button color="primary" onPress={() => setI(n => n + 1)}>Next</Button>}
          {last && <Button color="primary" onPress={() => { setI(0); onClose(); }}>Start building</Button>}
        </ModalFooter>
      </>)}</ModalContent>
    </Modal>
  );
}
