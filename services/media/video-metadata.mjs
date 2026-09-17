import { spawn } from "node:child_process";

/**
 * Reads container duration without loading the video into memory.
 * ffprobe is optional because the app must still work on machines that do not
 * have FFmpeg installed; callers can keep the duration unknown in that case.
 */
export function probeVideoDuration(filePath) {
  return new Promise((resolve) => {
    const command = process.env.FFPROBE_PATH || "ffprobe";
    let output = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let child;
    try {
      child = spawn(command, [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        filePath,
      ], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      finish(null);
      return;
    }
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.once("error", () => finish(null));
    child.once("close", (code) => {
      const duration = Number(output.trim());
      finish(code === 0 && Number.isFinite(duration) && duration > 0 ? duration : null);
    });
  });
}
