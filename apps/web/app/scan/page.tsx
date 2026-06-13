"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function ScanPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [hasFile, setHasFile] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) {
      setPreview(null);
      setHasFile(false);
      return;
    }
    setHasFile(true);
    setPreview(URL.createObjectURL(file));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Please choose an image first.");
      return;
    }

    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("image", file);

      const res = await fetch("/api/scan", { method: "POST", body: form });

      if (res.status === 401) {
        setError("Your session expired. Please log in again.");
        setSubmitting(false);
        return;
      }
      if (!res.ok) {
        setError("Could not scan the card. Please try again.");
        setSubmitting(false);
        return;
      }

      const { id } = (await res.json()) as { id: string };
      router.push(`/scan/${id}`);
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-12">
      <h1 className="text-2xl font-bold">Scan a card</h1>
      <p className="text-sm text-gray-600">
        Upload a photo of a Pokémon card to identify it.
      </p>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={onFileChange}
          className="block w-full text-sm text-gray-700 file:mr-4 file:rounded file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:font-medium file:text-white hover:file:bg-blue-700"
        />

        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="Selected card preview"
            className="max-h-80 w-full rounded-lg border border-gray-200 object-contain"
          />
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || !hasFile}
          className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Scanning…" : "Scan card"}
        </button>
      </form>
    </main>
  );
}
