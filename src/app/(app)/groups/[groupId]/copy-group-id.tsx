"use client";

import * as React from "react";

/**
 * CopyGroupId — displays the group UUID with a one-click copy button.
 * Used on the group detail page to share the join ID with friends.
 */
export function CopyGroupId({ groupId }: { groupId: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(groupId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the text so the user can copy manually
      const el = document.getElementById("group-id-display");
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
    }
  };

  return (
    <div className="flex items-center gap-2">
      <code
        id="group-id-display"
        className="flex-1 rounded bg-white border border-neutral-200 px-3 py-2 text-xs font-mono text-neutral-700 break-all select-all"
      >
        {groupId}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        aria-label="Copy group ID"
        className="inline-flex min-h-touch shrink-0 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
      >
        {copied ? "✓ Copied" : "Copy"}
      </button>
    </div>
  );
}
