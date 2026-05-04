import { motion, AnimatePresence } from "framer-motion";
import { useInterfaceStore } from "../store/ui";

export default function Tooltip() {
  const tooltip = useInterfaceStore((state) => state.tooltip);

  return (
    <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[200] pointer-events-none">
      <AnimatePresence>
        {tooltip && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 5, scale: 0.95 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="px-3 py-1.5 bg-[#171717]/90 border border-white/10 rounded-xl shadow-2xl backdrop-blur-md"
          >
            <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#e0e0e0] whitespace-nowrap">
              {tooltip}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
