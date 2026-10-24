"use client";

import { useEffect, useState } from "react";
import { Check, CircleAlert } from "lucide-react";

export function AutoDismissNotice({
  message,
  variant,
}: {
  message: string;
  variant: "error" | "success";
}) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timeout = window.setTimeout(() => setVisible(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  if (!message || !visible) return null;

  return (
    <div
      key={`${variant}:${message}`}
      className={`notice notice-${variant} toast-notice`}
      role={variant === "error" ? "alert" : "status"}
    >
      {variant === "error" ? <CircleAlert size={16} /> : <Check size={16} />}
      <span>{message}</span>
    </div>
  );
}
