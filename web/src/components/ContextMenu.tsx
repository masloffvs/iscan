import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef } from "react";
import { useInterfaceStore } from "../store/ui";

export default function ContextMenu() {
  const contextMenu = useInterfaceStore((state) => state.contextMenu);
  const closeContextMenu = useInterfaceStore((state) => state.closeContextMenu);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) {
        return;
      }

      closeContextMenu();
    };

    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) {
        return;
      }

      closeContextMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeContextMenu();
        return;
      }

      const matchedItem = contextMenu.items.find((item) => item.shortcut === event.key && !item.disabled);
      if (!matchedItem) {
        return;
      }

      event.preventDefault();
      closeContextMenu();
      void matchedItem.onSelect();
    };

    const handleViewportChange = () => {
      closeContextMenu();
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [closeContextMenu, contextMenu]);

  const position = useMemo(() => {
    if (!contextMenu || typeof window === "undefined") {
      return { left: 0, top: 0 };
    }

    return {
      left: Math.max(12, Math.min(contextMenu.x, window.innerWidth - 236)),
      top: Math.max(12, Math.min(contextMenu.y, window.innerHeight - 240)),
    };
  }, [contextMenu]);

  return (
    <AnimatePresence>
      {contextMenu && (
        <div className="pointer-events-none fixed inset-0 z-[220]">
          <motion.div
            ref={menuRef}
            initial={{ opacity: 0, scale: 0.97, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
            className="pointer-events-auto absolute min-w-[220px] rounded-xl bg-[#0f0f12]/96 p-1 shadow-2xl ring-1 ring-white/8 backdrop-blur-md"
            style={position}
          >
            {contextMenu.items.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={item.disabled}
                onClick={() => {
                  closeContextMenu();
                  void item.onSelect();
                }}
                className={[
                  "flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left transition",
                  item.disabled
                    ? "cursor-not-allowed opacity-40"
                    : "cursor-pointer hover:bg-white/[0.06]",
                  item.tone === "danger"
                    ? "text-[#fca5a5]"
                    : item.tone === "accent"
                      ? "text-[#a7c7ff]"
                      : "text-[#e4e4e7]",
                ].join(" ")}
              >
                <span className="text-[11px] font-medium">{item.label}</span>
                {item.shortcut && (
                  <span className="text-[9px] uppercase tracking-[0.14em] text-[#6f6f77]">{item.shortcut}</span>
                )}
              </button>
            ))}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}