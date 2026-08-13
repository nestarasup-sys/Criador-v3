import type { SVGProps } from "react";
import styles from "../studio.module.css";

export type StudioGlyphName =
  | "back" | "save" | "undo" | "redo" | "background" | "objects" | "narrator"
  | "speech" | "thought" | "print" | "folder" | "view" | "lock" | "compact"
  | "expand" | "add" | "close" | "outfit" | "flip" | "center" | "reset"
  | "zoomIn" | "zoomOut" | "up" | "down" | "left" | "right";

type Props = SVGProps<SVGSVGElement> & { name: StudioGlyphName; label?: string };

export function StudioGlyph({ name, label, ...props }: Props) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const content = (() => {
    switch (name) {
      case "back": return <><path d="M19 12H5" {...common}/><path d="m11 6-6 6 6 6" {...common}/></>;
      case "save": return <><path d="M5 4h11l3 3v13H5z" {...common}/><path d="M8 4v6h7V4M8 20v-6h8v6" {...common}/><path d="m9 17 2 2 4-4" {...common}/></>;
      case "undo": return <><path d="M9 8H4l5-5" {...common}/><path d="M4 8c5-5 13-2 13 4 0 4-3 7-7 7" {...common}/></>;
      case "redo": return <><path d="M15 8h5l-5-5" {...common}/><path d="M20 8c-5-5-13-2-13 4 0 4 3 7 7 7" {...common}/></>;
      case "background": return <><rect x="3" y="4" width="18" height="16" rx="3" {...common}/><circle cx="8" cy="9" r="1.4" fill="currentColor" stroke="none"/><path d="m4 17 5-5 3 3 3-4 5 6" {...common}/></>;
      case "objects": return <><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7z" {...common}/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" {...common}/></>;
      case "narrator": return <><path d="M6 4h12a2 2 0 0 1 2 2v12H4V6a2 2 0 0 1 2-2Z" {...common}/><path d="M8 8h8M8 12h8M8 16h5" {...common}/></>;
      case "speech": return <path d="M20 11a7 7 0 0 1-7 7H8l-4 3 1.4-4.2A7 7 0 1 1 20 11Z" {...common}/>;
      case "thought": return <><path d="M18.5 14.5a5.5 5.5 0 1 0-9.8-4A4.5 4.5 0 1 0 9 19h4" {...common}/><circle cx="16.5" cy="19" r="1.2" fill="currentColor" stroke="none"/><circle cx="19.5" cy="21" r=".8" fill="currentColor" stroke="none"/></>;
      case "print": return <><path d="M7 9V4h10v5M7 17H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2" {...common}/><path d="M7 14h10v6H7z" {...common}/><path d="M17 12h.01" {...common}/></>;
      case "folder": return <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" {...common}/>;
      case "view": return <><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" {...common}/><path d="M8 12h8M12 8v8" {...common}/></>;
      case "lock": return <><rect x="5" y="10" width="14" height="10" rx="2" {...common}/><path d="M8 10V7a4 4 0 0 1 8 0v3" {...common}/><path d="M12 14v3" {...common}/></>;
      case "compact": return <><path d="m8 6-4 4 4 4M16 6l4 4-4 4" {...common}/><path d="M4 10h16" {...common}/></>;
      case "expand": return <><path d="m8 3-5 5M16 3l5 5M3 16l5 5M21 16l-5 5" {...common}/><path d="M3 8h5V3M16 3v5h5M8 21v-5H3M21 16h-5v5" {...common}/></>;
      case "add": return <><circle cx="12" cy="12" r="8.5" {...common}/><path d="M12 8v8M8 12h8" {...common}/></>;
      case "close": return <><circle cx="12" cy="12" r="8.5" {...common}/><path d="m9 9 6 6M15 9l-6 6" {...common}/></>;
      case "outfit": return <><path d="m8 4 4 3 4-3 3 3-2 3v10H7V10L5 7z" {...common}/><path d="M9 14h6M10 10h4" {...common}/></>;
      case "flip": return <><path d="M8 5 3 12l5 7M16 5l5 7-5 7" {...common}/><path d="M3 12h18" {...common}/></>;
      case "center": return <><circle cx="12" cy="12" r="7" {...common}/><circle cx="12" cy="12" r="2" {...common}/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" {...common}/></>;
      case "reset": return <><path d="M5 9a7 7 0 1 1 1 8" {...common}/><path d="M5 4v5h5" {...common}/></>;
      case "zoomIn": return <><circle cx="10.5" cy="10.5" r="6.5" {...common}/><path d="m16 16 5 5M10.5 7.5v6M7.5 10.5h6" {...common}/></>;
      case "zoomOut": return <><circle cx="10.5" cy="10.5" r="6.5" {...common}/><path d="m16 16 5 5M7.5 10.5h6" {...common}/></>;
      case "up": return <path d="m5 14 7-7 7 7" {...common}/>;
      case "down": return <path d="m5 10 7 7 7-7" {...common}/>;
      case "left": return <path d="m14 5-7 7 7 7" {...common}/>;
      case "right": return <path d="m10 5 7 7-7 7" {...common}/>;
    }
  })();
  return <svg className={styles.studioGlyph} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden={label ? undefined : true} aria-label={label} role={label ? "img" : undefined} {...props}>{content}</svg>;
}
