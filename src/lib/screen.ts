/**
 * Screen access.
 *
 * In a browser tab this is the real thing: getDisplayMedia asks for a window or
 * display, and the returned stream is what the app shows and can sample.
 * The stream is never uploaded; it stays in this process.
 */

import { inTauri } from "./native";

let active: MediaStream | null = null;

/** Whether this window can produce a screen frame at all. */
export function screenCaptureSupported(): boolean {
  return inTauri() || Boolean(navigator.mediaDevices?.getDisplayMedia);
}

/**
 * One frame from the desktop app.
 *
 * A WKWebView window has no getDisplayMedia, so the native side takes the shot
 * and hands back a base64 JPEG. Resolves to a data URL ready to attach.
 */
export async function captureNativeScreen(): Promise<string | null> {
  if (!inTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const encoded = await invoke<string>("screen_capture");
  return encoded ? `data:image/jpeg;base64,${encoded}` : null;
}

export async function acquireScreen(): Promise<MediaStream> {
  if (active) return active;
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
    throw new Error(
      "This window cannot capture the screen. In the desktop app, allow Lantas in System Settings › Privacy & Security › Screen Recording; in a browser, open the app in Chrome or Edge.",
    );
  }
  active = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 4 },
    audio: false,
  });
  active.getVideoTracks().forEach((track) => {
    track.addEventListener("ended", () => {
      active = null;
    });
  });
  return active;
}

export function releaseScreen() {
  active?.getTracks().forEach((track) => track.stop());
  active = null;
}

export function currentScreen() {
  return active;
}

/** One JPEG frame from the stream, used to attach what the agent should see. */
export async function captureFrame(stream: MediaStream, maxWidth = 1280): Promise<string | null> {
  const track = stream.getVideoTracks()[0];
  if (!track || track.readyState === "ended") return null;
  const video = document.createElement("video");
  video.srcObject = new MediaStream([track]);
  video.muted = true;
  video.playsInline = true;

  // A freshly created <video> has no dimensions until metadata lands; drawing
  // before that produces a blank frame, which reads as "I can't see anything".
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    video.addEventListener("loadeddata", done, { once: true });
    video.addEventListener("resize", done, { once: true });
    window.setTimeout(done, 800);
    void video.play().catch(() => {});
  });

  for (let attempt = 0; attempt < 10 && video.videoWidth === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  if (video.videoWidth === 0) return null;
  const scale = Math.min(1, maxWidth / (video.videoWidth || maxWidth));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round((video.videoWidth || maxWidth) * scale);
  canvas.height = Math.round((video.videoHeight || 720) * scale);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}
