import { useEffect, useState } from "react";
import { Cloud, CloudOff, HardDrive } from "lucide-react";
import { Button, Tooltip } from "../ui";
import { toast } from "../lib/toast";
import { describeSync, onSyncState, type SyncState } from "../lib/sync";

/**
 * One place in the chrome that says whether anything is leaving this device.
 *
 * It sits in the shell rather than on a page, because the answer is the same everywhere and an
 * operator should not have to be in the Studio to find it out. It is a button rather than a label so
 * a keyboard can reach the explanation: hover gives the tooltip, pressing it says the same thing in
 * a toast, and the two share one string so they cannot drift apart.
 *
 * `off` is drawn as quietly as the other two are drawn loudly. Running CueFlow with no account is a
 * supported choice, and a warning colour on it would be a nag.
 */
const look: Record<SyncState, { icon: typeof Cloud; className: string }> = {
  off: { icon: HardDrive, className: "text-muted" },
  live: { icon: Cloud, className: "text-emerald-400" },
  down: { icon: CloudOff, className: "text-amber-400" },
};

export default function SyncPill() {
  const [state, setState] = useState<SyncState>("off");
  useEffect(() => onSyncState(setState), []);

  const { label, detail } = describeSync(state);
  const { icon: Icon, className } = look[state];

  return (
    // aria-live, because this changes without anybody pressing anything: the moment it flips to
    // `down` is the moment a screen-reader user needs to know their edits have stopped travelling.
    <div role="status" aria-live="polite" className="ml-auto">
      <Tooltip content={detail} placement="bottom">
        <Button
          size="sm"
          variant="light"
          className={`min-h-11 gap-1.5 font-medium sm:min-h-9 ${className}`}
          startContent={<Icon size={15} aria-hidden />}
          onPress={() => toast(label, detail, state === "down" ? "warn" : "info")}
        >
          {label}
        </Button>
      </Tooltip>
    </div>
  );
}
