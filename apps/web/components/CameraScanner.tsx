"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  CameraOff,
  RefreshCw,
  Upload,
  ScanLine,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import Button from "@/components/ui/Button";

type Phase = "idle" | "requesting" | "streaming" | "captured" | "submitting";

export default function CameraScanner({
  games,
}: {
  games: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [game, setGame] = useState(games[0]?.id ?? "pokemon");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [captured, setCaptured] = useState<{ url: string; blob: Blob } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraSupported, setCameraSupported] = useState(true);

  useEffect(() => {
    const supported =
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      (typeof window === "undefined" || window.isSecureContext);
    setCameraSupported(supported);
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => stopStream(), [stopStream]);

  async function startCamera() {
    setError(null);
    setPhase("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setPhase("streaming");
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setError(
        name === "NotAllowedError"
          ? "Camera permission was denied. Allow access or upload a photo instead."
          : "Could not start the camera. Upload a photo instead.",
      );
      setPhase("idle");
    }
  }

  function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        stopStream();
        setCaptured({ url: URL.createObjectURL(blob), blob });
        setPhase("captured");
      },
      "image/jpeg",
      0.92,
    );
  }

  function retake() {
    if (captured) URL.revokeObjectURL(captured.url);
    setCaptured(null);
    setError(null);
    if (cameraSupported) startCamera();
    else setPhase("idle");
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    stopStream();
    setError(null);
    setCaptured({ url: URL.createObjectURL(file), blob: file });
    setPhase("captured");
  }

  async function submit() {
    if (!captured) return;
    setPhase("submitting");
    setError(null);
    try {
      const form = new FormData();
      form.append("image", captured.blob, "card.jpg");
      form.append("game", game);
      const res = await fetch("/api/scan", { method: "POST", body: form });
      if (res.status === 401) {
        setError("Your session expired. Please log in again.");
        setPhase("captured");
        return;
      }
      if (!res.ok) {
        setError("Could not recognize the card. Try again with better lighting.");
        setPhase("captured");
        return;
      }
      const { id } = (await res.json()) as { id: string };
      router.push(`/scan/${id}`);
    } catch {
      setError("Something went wrong. Please try again.");
      setPhase("captured");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Game selector */}
      {games.length > 1 && (
        <div
          role="group"
          aria-label="Choose a game"
          className="mx-auto inline-flex rounded-xl border border-border bg-surface/60 p-1"
        >
          {games.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGame(g.id)}
              aria-pressed={game === g.id}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                game === g.id
                  ? "bg-primary text-primary-fg"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {g.name}
            </button>
          ))}
        </div>
      )}

      {/* Stage */}
      <div className="relative mx-auto aspect-[3/4] w-full max-w-md overflow-hidden rounded-2xl border border-border bg-black/40">
        {/* Live video */}
        <video
          ref={videoRef}
          playsInline
          muted
          className={`h-full w-full object-cover ${phase === "streaming" ? "block" : "hidden"}`}
        />

        {/* Captured still */}
        {captured && phase !== "streaming" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={captured.url}
            alt="Captured card"
            className="h-full w-full object-cover"
          />
        )}

        {/* Idle placeholder */}
        {phase === "idle" && !captured && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div className="flex flex-col items-center gap-3">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/5 text-muted">
                <Camera className="h-7 w-7" aria-hidden />
              </span>
              <p className="text-sm text-muted">
                {cameraSupported
                  ? "Point your camera at a Pokémon card"
                  : "Camera needs a secure (HTTPS) connection"}
              </p>
            </div>
          </div>
        )}

        {phase === "requesting" && (
          <div className="absolute inset-0 grid place-items-center">
            <RefreshCw className="h-7 w-7 animate-spin text-muted" aria-hidden />
          </div>
        )}

        {/* Card-frame guide + scanline while streaming */}
        {phase === "streaming" && (
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/2 top-1/2 aspect-[2.5/3.5] w-[68%] -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 border-primary/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
              <span className="absolute -left-0.5 -top-0.5 h-5 w-5 rounded-tl-xl border-l-2 border-t-2 border-accent" />
              <span className="absolute -right-0.5 -top-0.5 h-5 w-5 rounded-tr-xl border-r-2 border-t-2 border-accent" />
              <span className="absolute -bottom-0.5 -left-0.5 h-5 w-5 rounded-bl-xl border-b-2 border-l-2 border-accent" />
              <span className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-br-xl border-b-2 border-r-2 border-accent" />
              <div className="absolute inset-x-0 top-0 h-12 animate-scanline bg-gradient-to-b from-primary/40 to-transparent" />
            </div>
          </div>
        )}

        {phase === "submitting" && (
          <div className="absolute inset-0 grid place-items-center bg-background/70 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2 text-sm text-foreground">
              <Sparkles className="h-7 w-7 animate-pulse text-accent" aria-hidden />
              Adding to your collection…
            </div>
          </div>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFilePicked}
        className="hidden"
      />

      {error && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-red-300"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {phase === "idle" && (
          <>
            {cameraSupported ? (
              <Button onClick={startCamera} size="lg">
                <Camera className="h-5 w-5" aria-hidden /> Start camera
              </Button>
            ) : (
              <span className="inline-flex items-center gap-2 text-sm text-muted">
                <CameraOff className="h-4 w-4" aria-hidden /> Camera unavailable here
              </span>
            )}
            <Button variant="outline" size="lg" onClick={() => fileRef.current?.click()}>
              <Upload className="h-5 w-5" aria-hidden /> Upload instead
            </Button>
          </>
        )}

        {phase === "streaming" && (
          <Button onClick={capture} size="lg" className="min-w-44">
            <ScanLine className="h-5 w-5" aria-hidden /> Capture
          </Button>
        )}

        {phase === "captured" && (
          <>
            <Button onClick={submit} size="lg" className="min-w-44">
              <Sparkles className="h-5 w-5" aria-hidden /> Add to collection
            </Button>
            <Button variant="outline" size="lg" onClick={retake}>
              <RefreshCw className="h-5 w-5" aria-hidden /> Retake
            </Button>
          </>
        )}

        {phase === "submitting" && (
          <Button size="lg" disabled className="min-w-44">
            <RefreshCw className="h-5 w-5 animate-spin" aria-hidden /> Working…
          </Button>
        )}
      </div>

      <p className="text-center text-xs text-muted">
        Tip: fill the frame, keep the card flat and well-lit. Your photo is only used for
        recognition.
      </p>
    </div>
  );
}
