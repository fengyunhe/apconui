import React from "react";

export function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="detail-section">
      <h3 className="detail-section-title">{title}</h3>
      <div className="detail-section-body">{children}</div>
    </div>
  );
}
