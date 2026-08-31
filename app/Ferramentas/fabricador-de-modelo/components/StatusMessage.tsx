import type { ReactNode } from "react";
import styles from "../../ferramentas.module.css";

export function StatusMessage({ children, tone = "" }: { children: ReactNode; tone?: "" | "error" | "ok" }) { return <div className={`${styles.status} ${tone ? styles[tone] : ""}`} role="status">{children}</div>; }
