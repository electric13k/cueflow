// Thin HeroUI v3 compatibility layer.
//
// v3 replaced flat props with compound components (Modal.Backdrop > Modal.Container > Modal.Dialog,
// Switch.Content > Switch.Control > Switch.Thumb, …) and renamed the brand colour from `primary`
// to `accent`. Rather than spray that composition across ~80 call sites, the app imports these
// wrappers, which keep the old call shape and do the composition once.
import { Children, createContext, isValidElement, use, useCallback, type ReactElement, type ReactNode } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Button as B, Card as C, Input as I, Modal as M, Slider as S, Spinner as Sp,
  Switch as Sw, Tabs as T, Tooltip as Tt, Select as HS, ListBox as HLB, Label as HLabel,
  buttonVariants, cn, useOverlayState,
} from "@heroui/react";

type V2Color = "primary" | "secondary" | "default" | "danger" | "current";
type V2Variant = "solid" | "flat" | "light" | "bordered" | "ghost" | "faded";
type V3Variant = "primary" | "secondary" | "tertiary" | "outline" | "ghost" | "danger" | "danger-soft";

// v2 expressed emphasis as (color, variant); v3 folds both into one `variant`.
function toVariant(color?: V2Color, variant?: V2Variant): V3Variant {
  if (color === "danger") return variant === "solid" || !variant ? "danger" : "danger-soft";
  if (variant === "bordered" || variant === "faded") return "outline";
  if (variant === "light") return "ghost";
  if (variant === "ghost") return "ghost";
  if (variant === "flat") return color === "primary" ? "secondary" : "tertiary";
  return color === "primary" || !color ? "primary" : "secondary";
}

export function Button({
  color, variant, radius, startContent, endContent, isLoading, href, target, children, className, size,
  isIconOnly, as: _as, ...rest
}: {
  color?: V2Color; variant?: V2Variant; radius?: "full" | "lg" | "md" | "sm"; startContent?: ReactNode;
  endContent?: ReactNode; isLoading?: boolean; href?: string; target?: string; children?: ReactNode;
  className?: string; size?: "sm" | "md" | "lg"; isIconOnly?: boolean; isDisabled?: boolean;
  // The press event carries the modifier keys, which the library uses for shift-click range select.
  title?: string; as?: string; id?: string; "aria-label"?: string; "aria-expanded"?: boolean; "aria-controls"?: string; "data-tour"?: string; "data-coach"?: string; onPress?: (e: { shiftKey?: boolean }) => void; type?: "button" | "submit";
}) {
  const navigate = useNavigate();
  const inner = <>{isLoading ? <Sp size="sm" /> : startContent}{children}{endContent}</>;
  const styled = cn(buttonVariants({ variant: toVariant(color, variant), size, isIconOnly }) as string, "cue-button", radius === "full" && "rounded-full", className);
  const cls = cn("cue-button", radius === "full" && "rounded-full", className);
  // External links stay real anchors so target/_blank and middle-click keep working.
  if (href && (/^https?:/.test(href) || target)) {
    return <a {...rest} href={href} target={target} rel={target === "_blank" ? "noreferrer" : undefined} className={styled}>{inner}</a>;
  }
  // `as="label"` wraps a hidden file input, it has to stay a real <label> or the click never
  // reaches the input. A RAC Button would swallow it.
  if (_as === "label") return <label className={cn(styled, "cursor-pointer")}>{inner}</label>;
  const press = href
    // Hash links scroll in place; everything else is an in-app route.
    ? () => (href.startsWith("#") ? document.querySelector(href)?.scrollIntoView({ behavior: "smooth" }) : navigate(href))
    : rest.onPress;
  return (
    <B {...rest} onPress={press} size={size} isIconOnly={isIconOnly} variant={toVariant(color, variant)} className={cls}>
      {inner}
    </B>
  );
}

export function Card({ isPressable, onPress, className, children, "data-tour": dataTour, ...rest }: { isPressable?: boolean; onPress?: () => void; className?: string; children?: ReactNode; "data-tour"?: string }) {
  return (
    <C
      {...rest}
      {...(dataTour ? { "data-tour": dataTour } : {})}
      className={cn(isPressable && "cue-pressable cursor-pointer text-left", className)}
      {...(isPressable ? { role: "button", tabIndex: 0, onClick: (e: React.MouseEvent) => { if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return; onPress?.(); }, onKeyDown: (e: React.KeyboardEvent) => { if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPress?.(); } } } : {})}
    >
      {children}
    </C>
  );
}
export const CardBody = C.Content;

export function Input({ label, value, onValueChange, className, startContent, size: _size, ...rest }: {
  label?: string; value?: string; onValueChange?: (v: string) => void; className?: string; startContent?: ReactNode;
  type?: string; placeholder?: string; autoComplete?: string; autoFocus?: boolean;
  size?: "sm" | "md" | "lg"; // v2 sizing; v3's Input `size` is the HTML numeric attribute, so it is dropped
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className={cn("block", className)}>
      {label && <span className="mb-1 block text-sm text-muted">{label}</span>}
      <span className="relative block">
        {startContent && <span className="pointer-events-none absolute inset-y-0 left-3 z-10 flex items-center text-muted">{startContent}</span>}
        <I {...rest} className={cn(startContent && "pl-9")} fullWidth value={value} onChange={e => onValueChange?.(e.target.value)} />
      </span>
    </label>
  );
}

export const Spinner = ({ size, color }: { size?: "sm" | "md" | "lg"; color?: string }) => <Sp size={size} {...(color && color !== "current" ? { color: color as never } : {})} />;

export function Switch({ isSelected, onValueChange, size, children, className }: { isSelected?: boolean; onValueChange?: (v: boolean) => void; size?: "sm" | "md" | "lg"; children?: ReactNode; className?: string }) {
  return (
    <Sw isSelected={isSelected} onChange={onValueChange} size={size} className={className}>
      <Sw.Content>
        <Sw.Control><Sw.Thumb /></Sw.Control>
        {children}
      </Sw.Content>
    </Sw>
  );
}

export function Slider({ label, getValue, value, className, ...rest }: {
  label?: ReactNode; getValue?: (v: number) => string; value?: number; className?: string;
  minValue?: number; maxValue?: number; step?: number; isDisabled?: boolean; size?: "sm" | "md" | "lg";
  color?: string; onChange?: (v: number) => void; "aria-label"?: string;
}) {
  // v2's `size`/`color` are gone in v3, the theme drives both now.
  const { size: _size, color: _color, ...sliderProps } = rest as Record<string, unknown>;
  return (
    <S {...sliderProps} value={value} className={cn("w-full", className)}>
      {(label || getValue) && (
        <div className="mb-1 flex items-center justify-between text-xs text-muted">
          <span>{label}</span>
          <span className="tabular-nums">{getValue && value !== undefined ? getValue(value) : value}</span>
        </div>
      )}
      <S.Track><S.Fill /><S.Thumb /></S.Track>
    </S>
  );
}

export type SelectOption = { value: string; label: ReactNode; textValue?: string };

export function Select({ value, options, onChange, label, className, size = "md", isDisabled, "aria-label": ariaLabel, "data-coach": dataCoach }: {
  value: string;
  options: SelectOption[];
  onChange?: (value: string) => void;
  label?: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg";
  isDisabled?: boolean;
  "aria-label"?: string;
  "data-coach"?: string;
}) {
  const selected = options.find(option => option.value === value);
  return (
    <div className={cn("cue-select", className)}>
      <HS.Root selectedKey={value || null} onSelectionChange={key => onChange?.(key == null ? "" : String(key))} isDisabled={isDisabled} aria-label={label ? undefined : ariaLabel} data-coach={dataCoach}>
        {label && <HLabel className="cue-select__label">{label}</HLabel>}
        <HS.Trigger className={cn("cue-select__trigger", size === "sm" ? "cue-select__trigger--sm" : size === "lg" ? "cue-select__trigger--lg" : undefined)}>
          <HS.Value>{selected?.label ?? options[0]?.label}</HS.Value>
          <HS.Indicator className="cue-select__indicator" />
        </HS.Trigger>
        <HS.Popover className="cue-select__popover">
          <HLB className="cue-select__list">
            {options.map(option => (
              <HLB.Item key={option.value || "__empty"} id={option.value} textValue={option.textValue ?? (typeof option.label === "string" ? option.label : option.value)} className="cue-select__item">
                {option.label}
                <HLB.ItemIndicator className="cue-select__item-indicator" />
              </HLB.Item>
            ))}
          </HLB>
        </HS.Popover>
      </HS.Root>
    </div>
  );
}

export function Tooltip({ content, children, isDisabled, placement }: { content?: ReactNode; children: ReactElement; isDisabled?: boolean; placement?: "top" | "bottom" | "left" | "right" }) {
  if (isDisabled || !content) return children;
  return (
    <Tt>
      <Tt.Trigger className="contents">{children}</Tt.Trigger>
      <Tt.Content placement={placement}>{content}</Tt.Content>
    </Tt>
  );
}

// v2 nested content inside <Tab>; v3 wants a TabList and sibling TabPanels, so split them here.
export function Tab({ children }: { id: string; title: ReactNode; children?: ReactNode }) { return <>{children}</>; }

export function Tabs({ selectedKey, onSelectionChange, children, classNames, className }: {
  selectedKey?: string; onSelectionChange?: (k: string) => void; children: ReactNode;
  classNames?: { tabList?: string }; className?: string;
}) {
  const tabs = Children.toArray(children).filter(isValidElement) as ReactElement<{ id: string; title: ReactNode; children?: ReactNode }>[];
  return (
    <T selectedKey={selectedKey} onSelectionChange={k => onSelectionChange?.(String(k))} className={className}>
      <T.List className={classNames?.tabList}>
        {tabs.map(t => <T.Tab key={t.props.id} id={t.props.id}>{t.props.title}</T.Tab>)}
      </T.List>
      {tabs.map(t => <T.Panel key={t.props.id} id={t.props.id}>{t.props.children}</T.Panel>)}
    </T>
  );
}

export const useDisclosure = () => {
  const s = useOverlayState();
  return { isOpen: s.isOpen, onOpen: s.open, onClose: s.close, onOpenChange: s.setOpen };
};

// RAC's own `close` (the Dialog render prop, Escape, backdrop click) does not reach a Modal that
// is controlled from outside HeroUI, so closing is driven off our own onOpenChange instead and
// handed down by context.
const CloseCtx = createContext<() => void>(() => {});

export function Modal({ isOpen, onOpenChange, children }: { isOpen?: boolean; onOpenChange?: (v: boolean) => void; children?: ReactNode; placement?: string; backdrop?: string; scrollBehavior?: string }) {
  const close = useCallback(() => onOpenChange?.(false), [onOpenChange]);
  // Unmount the contents ourselves instead of leaving it to RAC's exit animation: RAC waits for
  // `animationend` on the backdrop, and a modal that closes while the tab is not painting (or the
  // animation is otherwise never ticked) stays on screen forever.
  return <CloseCtx value={close}><M isOpen={isOpen} onOpenChange={onOpenChange}>{isOpen ? children : null}</M></CloseCtx>;
}

export function ModalContent({ children }: { children: ReactNode | ((close: () => void) => ReactNode) }) {
  const close = use(CloseCtx);
  return (
    <M.Backdrop onClick={close}>
      <M.Container placement="center">
        {/* Stop backdrop dismissal from firing when the click lands inside the dialog. */}
        <M.Dialog onClick={(e: React.MouseEvent) => e.stopPropagation()}>
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
          >
            {typeof children === "function" ? children(close) : children}
          </motion.div>
        </M.Dialog>
      </M.Container>
    </M.Backdrop>
  );
}

export const ModalHeader = M.Header;
export const ModalBody = M.Body;
export const ModalFooter = M.Footer;
