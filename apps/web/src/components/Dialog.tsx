import { ReactNode } from "react";
import { Button, Card, Icon } from "./controls";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer: ReactNode;
}

export function Dialog({ open, onClose, title, children, footer }: DialogProps) {
  if (!open) return null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={onClose} />
      <Card style={{ width: "100%", maxWidth: 480, maxHeight: "90vh", overflow: "auto", position: "relative" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{title}</h2>
          <Button variant="quiet" size="sm" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </Button>
        </div>
        {children}
        <div style={{ borderTop: "1px solid var(--color-border)", marginTop: 16, paddingTop: 16, display: "flex", justifyContent: "flex-end" }}>
          {footer}
        </div>
      </Card>
    </div>
  );
}