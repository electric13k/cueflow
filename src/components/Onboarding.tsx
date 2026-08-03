import { useEffect, useState, type ReactNode } from "react";
import { Keyboard, ListMusic, Monitor, Presentation, SlidersHorizontal, Upload, UserPlus } from "lucide-react";
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, useDisclosure } from "../ui";

const SEEN = "cueflow:onboarded";

type Step = { icon: typeof Upload; title: string; body: ReactNode };
const steps: Step[] = [
  {
    icon: Upload, title: "1. Get media in",
    body: <>Hit <b>Upload</b> in the Library tab to add audio, images or video from your computer. The search bar next to it picks where to look: your own library, the Internet Archive, Wikimedia Commons, Myinstants, or a link you paste. Imports are renamed for you.</>,
  },
  {
    icon: Presentation, title: "2. Add slides",
    body: <><b>New slide</b> makes a blank 16:9 card you can put a title on. Exported slide images drop straight in, and a Google Slides or PowerPoint Online link is embedded as a live deck.</>,
  },
  {
    icon: SlidersHorizontal, title: "3. Shape it",
    body: <>Pick a sound and open <b>Editor</b> to drag across the waveform: cut, paste, merge, silence, mix to mono, balance the channels. Pick an image or video and the same tab becomes a media panel with framing, colour, a caption, and trim for video.</>,
  },
  {
    icon: ListMusic, title: "4. Build a cue deck",
    body: <>In <b>Sequences</b>, make a sequence and add cues to it. Sound and slides share one deck, so audio 1, slide 1, audio 2, slide 2 is a single list you drag into order. Nothing ever autoplays: you step through cues yourself.</>,
  },
  {
    icon: Monitor, title: "5. Run the show",
    body: <><b>Audience display</b> opens the presenter window, drag it onto the projector or mirrored screen. It stays black on sound-only cues and shows the slide or video the moment a visual cue fires, with its transition.</>,
  },
  {
    icon: Keyboard, title: "6. Drive it from the keyboard",
    body: <>Arrows step every cue. <b>A</b> and <b>D</b> step slides only, so the deck moves without cutting the sound underneath, and <b>W</b> / <b>S</b> zoom the stage. Keys work from either window. <b>Keybinds</b> rebinds all of it.</>,
  },
  {
    icon: UserPlus, title: "7. Keep your work",
    body: <>Your library lives in this browser. <b>Sign in</b> from the top bar and your media and sequences save to your account instead, so they follow you to any device.</>,
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
