import assert from "node:assert/strict";
import test from "node:test";
import { buildNormalizeArgs, buildScaleFilter, isCfr30, videoMatchesExportProfile } from "../services/media/video-normalizer.mjs";

const compatibleVideo = {
  formatName: "mov,mp4,m4a,3gp,3g2,mj2",
  video: { codec_name: "h264", pix_fmt: "yuv420p", width: 1920, height: 1080, avg_frame_rate: "30/1", r_frame_rate: "30/1" },
  audio: { codec_name: "aac", sample_rate: "48000", channels: 2, bit_rate: "160000" },
};

test("reconhece um vídeo já compatível com o perfil do Editor", () => {
  assert.equal(isCfr30(compatibleVideo.video), true);
  assert.equal(videoMatchesExportProfile(compatibleVideo), true);
  assert.equal(videoMatchesExportProfile({ ...compatibleVideo, video: { ...compatibleVideo.video, codec_name: "hevc" } }), false);
  assert.equal(videoMatchesExportProfile({ ...compatibleVideo, video: { ...compatibleVideo.video, avg_frame_rate: "60/1" } }), false);
  assert.equal(videoMatchesExportProfile({ ...compatibleVideo, audio: null }), true);
});

test("limita resolução sem upscale e preserva proporção pelo filtro", () => {
  assert.match(buildScaleFilter(3840, 2160), /min\(1920,iw\)/);
  assert.match(buildScaleFilter(1280, 720), /fps=30/);
  assert.match(buildScaleFilter(1279, 719), /mod\(iw/);
});

test("monta conversão CFR com seek previsível e áudio opcional", () => {
  const argsWithAudio = buildNormalizeArgs("entrada.webm", "saida.mp4", compatibleVideo, "libx264");
  assert.deepEqual(argsWithAudio.slice(-3), ["-movflags", "+faststart", "saida.mp4"]);
  assert.ok(argsWithAudio.includes("-g") && argsWithAudio.includes("30"));
  assert.ok(argsWithAudio.includes("-bf") && argsWithAudio.includes("0"));
  assert.ok(argsWithAudio.includes("-c:a") && argsWithAudio.includes("aac"));
  const argsCopyAudio = buildNormalizeArgs("entrada.mp4", "saida.mp4", compatibleVideo, "libx264", { audioMode: "copy" });
  assert.ok(argsCopyAudio.includes("-c:a") && argsCopyAudio.includes("copy"));
  const argsWithoutAudio = buildNormalizeArgs("entrada.mkv", "saida.mp4", { ...compatibleVideo, audio: null }, "libx264");
  assert.equal(argsWithoutAudio.includes("-c:a"), false);
  assert.ok(argsWithoutAudio.includes("-an"));
});

test("oferece tentativa tolerante para áudio corrompido sem alterar o perfil do vídeo", () => {
  const args = buildNormalizeArgs("entrada-corrompida.mp4", "saida.mp4", compatibleVideo, "libx264", { tolerateCorruptAudio: true });
  assert.ok(args.includes("-fflags") && args.includes("+discardcorrupt"));
  assert.ok(args.includes("-err_detect") && args.includes("ignore_err"));
  assert.ok(args.includes("-c:a") && args.includes("aac"));
});
