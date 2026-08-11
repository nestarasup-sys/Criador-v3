export type EditorExportProfileId = "final" | "quick";

export type EditorExportProfile = { id: EditorExportProfileId; label: string; width: number; height: number; fps: number; videoCodec: string; audioCodec: string };

export const EDITOR_EXPORT_PROFILES: Record<EditorExportProfileId, EditorExportProfile> = {
  final: { id: "final", label: "Final · 1920×1080 · 30 FPS", width: 1920, height: 1080, fps: 30, videoCodec: "libx264", audioCodec: "aac" },
  quick: { id: "quick", label: "Rápido · 1280×720 · 15 FPS", width: 1280, height: 720, fps: 15, videoCodec: "libx264", audioCodec: "aac" },
};

export function exportProfile(id: string): EditorExportProfile { return EDITOR_EXPORT_PROFILES[id === "quick" ? "quick" : "final"]; }

export function validateMediaDuration(duration: unknown) {
  return typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : undefined;
}

export function buildFfmpegArguments(profile: EditorExportProfile, inputPattern: string, outputPath: string, withAudio = true) {
  return ["-y", "-framerate", String(profile.fps), "-i", inputPattern, ...(withAudio ? ["-i", "audio.wav"] : []), "-c:v", profile.videoCodec, "-pix_fmt", "yuv420p", ...(withAudio ? ["-c:a", profile.audioCodec, "-shortest"] : []), outputPath];
}
