const CATCH_CSS = `
@keyframes catch-wobble {
  0%, 100% { transform: rotate(0deg); }
  14% { transform: rotate(-16deg); }
  30% { transform: rotate(13deg); }
  46% { transform: rotate(-10deg); }
  62% { transform: rotate(7deg); }
  78% { transform: rotate(-3deg); }
}
@keyframes catch-open-top {
  0% { transform: translate(0, 0) rotate(0deg); opacity: 1; }
  40% { transform: translate(-4px, -14px) rotate(-18deg); opacity: 1; }
  100% { transform: translate(-10px, -34px) rotate(-38deg); opacity: 0; }
}
@keyframes catch-open-bottom {
  0% { transform: translate(0, 0); opacity: 1; }
  100% { transform: translate(0, 14px) scale(0.92); opacity: 0; }
}
@keyframes catch-pop {
  0% { transform: scale(0.2); opacity: 0; }
  55% { transform: scale(1.18); opacity: 1; }
  78% { transform: scale(0.95); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes catch-confetti {
  0% { transform: translateY(0) scale(0.4) rotate(0deg); opacity: 1; }
  70% { opacity: 1; }
  100% { transform: translateY(calc(var(--d) * -1)) scale(1) rotate(110deg); opacity: 0; }
}
@keyframes catch-bubble {
  from { transform: translateX(10px) scale(0.96); opacity: 0; }
  to { transform: none; opacity: 1; }
}
@keyframes catch-collect {
  to { transform: translate(28px, 80px) scale(0.2); opacity: 0; }
}
@keyframes dock-reveal {
  from { opacity: 0; transform: translateY(-6px) scale(0.96); }
  to { opacity: 1; transform: none; }
}
@keyframes dock-pulse {
  0% { box-shadow: 0 0 0 0 rgba(69, 137, 255, 0.45); transform: scale(1); }
  30% { transform: scale(1.06); }
  100% { box-shadow: 0 0 0 14px rgba(69, 137, 255, 0); transform: scale(1); }
}
@keyframes dock-enter {
  from { opacity: 0; transform: translateY(8px) scale(0.95); }
  to { opacity: 1; transform: none; }
}
@keyframes dock-exit {
  from { opacity: 1; transform: none; }
  to { opacity: 0; transform: translateY(8px) scale(0.95); }
}
`;

export function CatchStyles() {
  return <style>{CATCH_CSS}</style>;
}
