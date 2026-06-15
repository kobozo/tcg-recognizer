"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import Button from "@/components/ui/Button";

/** Remove a scanned card from the collection, then return to the collection. */
export default function DeleteScanButton({ scanId }: { scanId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (!window.confirm("Remove this card from your collection?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/scan/${scanId}`, { method: "DELETE" });
      if (!res.ok) {
        window.alert(
          res.status === 401
            ? "Your session expired — please log in again."
            : "Couldn't delete the card. Please try again.",
        );
        setBusy(false);
        return;
      }
      router.push("/collection");
      router.refresh();
    } catch {
      window.alert("Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={onDelete} disabled={busy}>
      <Trash2 className="h-4 w-4" aria-hidden /> {busy ? "Removing…" : "Remove"}
    </Button>
  );
}
