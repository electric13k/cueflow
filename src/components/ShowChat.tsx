import { useEffect, useRef, useState } from "react";
import { Send, Trash2 } from "lucide-react";
import { Button, Input } from "../ui";
import { clearChat, loadChat, onChat, type ChatLine } from "../lib/chat";

const time = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

/**
 * Chat history for one show. Every device already flashes what the others send; this is the same
 * traffic written down, so a line you were looking away for is still there afterwards.
 *
 * Still silent, and still not a channel of its own: sending goes out over the show's existing
 * broadcast through `onSend`, and this panel only keeps what went past.
 */
export default function ShowChat({ show, canSend = true, onSend, className = "" }: {
  show: string;
  canSend?: boolean;
  onSend: (text: string) => void;
  className?: string;
}) {
  const [lines, setLines] = useState<ChatLine[]>(() => loadChat(show));
  const [draft, setDraft] = useState("");
  const foot = useRef<HTMLDivElement>(null);

  useEffect(() => setLines(loadChat(show)), [show]);
  useEffect(() => onChat(id => { if (id === show) setLines(loadChat(show)); }), [show]);
  // The newest line, kept in view, without dragging the page around it.
  useEffect(() => { foot.current?.scrollIntoView({ block: "nearest" }); }, [lines.length]);

  const send = () => { const text = draft.trim(); if (!text) return; onSend(text); setDraft(""); };

  return (
    <div className={`flex min-h-0 flex-col gap-2 ${className}`}>
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted">Messages</h3>
        <span className="text-xs text-muted">{lines.length ? `${lines.length} kept on this device` : "nothing yet"}</span>
        {lines.length > 0 && (
          <Button isIconOnly size="sm" variant="light" className="ml-auto" aria-label="Clear the history on this device"
            onPress={() => { if (confirm("Clear the messages kept on this device? Nobody else's copy changes.")) clearChat(show); }}>
            <Trash2 size={14} />
          </Button>
        )}
      </div>

      <ol className="min-h-24 flex-1 space-y-1.5 overflow-auto pr-1">
        {lines.length === 0 && (
          <li className="text-sm text-muted">
            Nothing has been said yet. A line here flashes on every device in the show and makes no sound.
          </li>
        )}
        {lines.map(line => (
          <li key={line.id} className={line.kind === "event"
            ? "text-xs italic text-muted"
            : "rounded-xl bg-surface/60 px-3 py-2 text-sm"}>
            <span className="mr-2 font-mono text-[11px] uppercase tracking-widest text-muted">{time(line.at)}</span>
            {line.kind === "message" && <span className="mr-2 font-semibold text-accent">{line.from}</span>}
            <span className={line.kind === "message" ? "" : "text-muted"}>{line.text}</span>
          </li>
        ))}
        <div ref={foot} />
      </ol>

      {canSend && (
        <div className="flex gap-2">
          <Input className="flex-1" value={draft} onValueChange={setDraft} placeholder="Say something to the room"
            onKeyDown={e => { if (e.key === "Enter") send(); }} />
          <Button isIconOnly color="primary" aria-label="Send" onPress={send}><Send size={16} /></Button>
        </div>
      )}
    </div>
  );
}
