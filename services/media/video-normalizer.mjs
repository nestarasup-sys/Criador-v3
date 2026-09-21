import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";

const STANDARD_CONTAINER = "mp4";
const STANDARD_CODEC = "h264";
const STANDARD_PIXEL_FORMAT = "yuv420p";
const STANDARD_FPS = 30;
const HARDWARE_ENCODERS = ["h264_amf", "h264_nvenc", "h264_qsv"];
let encoderPromise;

function runCommand(command, args, { capture = "stderr" } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      reject(error);
      return;
    }
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => {
      const result = { code, stdout, stderr };
      if (code === 0) resolve(capture === "stdout" ? stdout : result);
      else reject(Object.assign(new Error(stderr.trim().slice(-1400) || `O comando ${command} falhou.`), { code, stdout, stderr }));
    });
  });
}

function parseRate(value) {
  const [numerator, denominator] = String(value || "").split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

function normalizedFormat(formatName) {
  return String(formatName || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function even(value) {
  const number = Math.max(2, Math.floor(Number(value) || 0));
  return number % 2 === 0 ? number : number - 1;
}

export function isCfr30(stream) {
  const average = parseRate(stream?.avg_frame_rate);
  const nominal = parseRate(stream?.r_frame_rate);
  return average !== null && nominal !== null && Math.abs(average - STANDARD_FPS) < 0.001 && Math.abs(nominal - STANDARD_FPS) < 0.001;
}

export function videoMatchesExportProfile(probe) {
  const video = probe?.video;
  const audio = probe?.audio;
  const width = Number(video?.width);
  const height = Number(video?.height);
  const dimensionsFit = Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 1920 && height <= 1080 && width % 2 === 0 && height % 2 === 0;
  const audioFits = !audio || (String(audio.codec_name).toLowerCase() === "aac" && Number(audio.sample_rate) === 48000 && Number(audio.channels) === 2 && Number(audio.bit_rate) >= 120000 && Number(audio.bit_rate) <= 200000);
  return normalizedFormat(probe?.formatName).includes(STANDARD_CONTAINER)
    && String(video?.codec_name).toLowerCase() === STANDARD_CODEC
    && String(video?.pix_fmt).toLowerCase() === STANDARD_PIXEL_FORMAT
    && dimensionsFit
    && isCfr30(video)
    && audioFits;
}

export function buildScaleFilter(width, height) {
  const sourceWidth = even(width);
  const sourceHeight = even(height);
  if (sourceWidth <= 1920 && sourceHeight <= 1080) return "scale=iw-mod(iw\\,2):ih-mod(ih\\,2):flags=lanczos,fps=30";
  return "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,fps=30";
}

export function buildNormalizeArgs(inputPath, outputPath, probe, encoder = "libx264") {
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", inputPath, "-map", "0:v:0"];
  if (probe?.audio) args.push("-map", "0:a:0");
  args.push("-vf", buildScaleFilter(probe?.video?.width, probe?.video?.height), "-r", "30", "-fps_mode", "cfr", "-g", "30", "-keyint_min", "30", "-sc_threshold", "0", "-bf", "0", "-pix_fmt", "yuv420p");
  if (encoder === "h264_nvenc") args.push("-c:v", encoder, "-preset", "p5", "-rc", "vbr", "-cq", "22", "-b:v", "0");
  else if (encoder === "h264_qsv") args.push("-c:v", encoder, "-preset", "medium", "-global_quality", "23");
  else if (encoder === "h264_amf") args.push("-c:v", encoder, "-quality", "quality", "-rc", "cqp", "-qp_i", "22", "-qp_p", "24");
  else args.push("-c:v", "libx264", "-preset", "fast", "-crf", "20");
  if (probe?.audio) args.push("-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "160k", "-shortest");
  args.push("-movflags", "+faststart", outputPath);
  return args;
}

async function availableH264Encoder() {
  if (!encoderPromise) {
    encoderPromise = runCommand(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-encoders"], { capture: "stdout" })
      .then((output) => HARDWARE_ENCODERS.find((encoder) => new RegExp(`\\b${encoder}\\b`).test(output)) || "libx264")
      .catch(() => "libx264");
  }
  return encoderPromise;
}

export async function probeVideoFile(filePath) {
  const output = await runCommand(process.env.FFPROBE_PATH || "ffprobe", [
    "-v", "error", "-show_entries", "format=format_name,duration:stream=index,codec_type,codec_name,pix_fmt,width,height,avg_frame_rate,r_frame_rate,sample_rate,channels,bit_rate",
    "-of", "json", filePath,
  ], { capture: "stdout" });
  const parsed = JSON.parse(output || "{}");
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  return {
    formatName: parsed.format?.format_name || "",
    duration: Number(parsed.format?.duration) || null,
    video: streams.find((stream) => stream.codec_type === "video") || null,
    audio: streams.find((stream) => stream.codec_type === "audio") || null,
  };
}

export async function normalizeVideoFile(inputPath, outputPath, probe) {
  const encoder = await availableH264Encoder();
  const temporaryOutput = `${outputPath}.tmp-${randomBytes(6).toString("hex")}.mp4`;
  let usedEncoder = encoder;
  try {
    try {
      await runCommand(process.env.FFMPEG_PATH || "ffmpeg", buildNormalizeArgs(inputPath, temporaryOutput, probe, encoder));
    } catch (hardwareError) {
      if (encoder === "libx264") throw hardwareError;
      await rm(temporaryOutput, { force: true });
      await runCommand(process.env.FFMPEG_PATH || "ffmpeg", buildNormalizeArgs(inputPath, temporaryOutput, probe, "libx264"));
      usedEncoder = "libx264";
    }
    return { encoder: usedEncoder, outputPath: temporaryOutput };
  } catch (error) {
    await rm(temporaryOutput, { force: true });
    throw error;
  }
}
