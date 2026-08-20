import { useEffect, useMemo, useState } from "react";
import { Command as CommandIcon, Search } from "lucide-react";
import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "../ui";

export type PaletteCommand = {
  id: string;
  label: string;
  hint?: string;
  group?: string;
  disabled?: boolean;
  run: () => void;
};

export default function CommandPalette({ open, onOpen, onClose, commands }: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  commands: PaletteCommand[];
}) {
  const [query, setQuery] = useState("");
  useEffect(() => { if (!open) setQuery(""); }, [open]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
      if (!open && ((event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) || (event.key === "/" && !typing))) {
        event.preventDefault();
        onOpen();
      }
      if (open && event.key === "Escape") { event.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, onOpen, onClose]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return commands.filter(command => !command.disabled && (!term || `${command.label} ${command.hint ?? ""} ${command.group ?? ""}`.toLowerCase().includes(term)));
  }, [commands, query]);

  return (
    <Modal isOpen={open} onOpenChange={value => value ? onOpen() : onClose()}>
      <ModalContent>{close => (
        <>
          <ModalHeader><span className="flex items-center gap-2"><CommandIcon size={17} className="text-accent" />Command palette</span></ModalHeader>
          <ModalBody>
            <Input autoFocus value={query} onValueChange={setQuery} placeholder="Search actions…" startContent={<Search size={15} />} />
            <div className="mt-3 max-h-[52vh] overflow-y-auto rounded-2xl border border-border bg-surface/50 p-1">
              {filtered.length ? filtered.map(command => (
                <button key={command.id} type="button" onClick={() => { command.run(); close(); }} className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                  <span><span className="block font-semibold">{command.label}</span>{command.group && <span className="text-xs text-muted">{command.group}</span>}</span>
                  {command.hint && <kbd className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted">{command.hint}</kbd>}
                </button>
              )) : <p className="px-3 py-8 text-center text-sm text-muted">No matching actions.</p>}
            </div>
          </ModalBody>
          <ModalFooter><Button variant="light" onPress={close}>Close</Button></ModalFooter>
        </>
      )}</ModalContent>
    </Modal>
  );
}
