import { type ReactNode, memo } from "react";
import { motion } from "framer-motion";
import { useInterfaceStore } from "../store/ui";

export default memo(function Modal({ children, title, onClose }: { children: ReactNode; title: string; onClose?: () => void }) {
  const closeModal = useInterfaceStore((state) => state.closeModal);

  const handleClose = onClose ?? closeModal;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="absolute inset-0 bg-black/70"
        onClick={handleClose}
      />

      {/* Modal Container */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ type: "spring", damping: 25, stiffness: 300, mass: 0.8 }}
        className="relative flex max-h-[82vh] w-full max-w-[920px] flex-col overflow-hidden rounded-[16px] bg-[#121212] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between px-4 py-3">
          <h3 className="text-[11px] font-bold text-[#e0e0e0] uppercase tracking-[0.2em]">{title}</h3>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-[10px] text-[#a0a0a8] transition hover:bg-white/[0.08] hover:text-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div className="grow overflow-auto p-4 pt-0">
          {children}
        </div>
      </motion.div>
    </div>
  );
});
