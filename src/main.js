import * as tf from '@tensorflow/tfjs';
import { Detector } from './detect.js';

const resolutions = {
  "3840x2160": { width: 3840, height: 2160 },
  "2880x1620": { width: 2880, height: 1620 },
  "1920x1080": { width: 1920, height: 1080 },
};

const els = {
  video: document.getElementById("video"),
  canvas: document.getElementById("canvas"),
  resolution: document.getElementById("resolution"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  status: document.getElementById("status"),
};

let stream = null;
let facing = "environment"; // モバイルは背面優先（環境により前面になる場合あり）

function log(msg) {
  els.status.textContent = msg;
  console.log("[status]", msg);
}

function currentTargetSize() {
  const key = els.resolution.value;
  return resolutions[key];
}

function constraintFor({ width, height }) {
  // iOS/Safari 対策として exact は避け、まず ideal を使う。
  // applyConstraints 失敗時だけ exact でリトライ or 再取得。
  return {
    audio: false,
    video: {
      facingMode: { ideal: facing },
      width: { ideal: width },
      height: { ideal: height },
      frameRate: { ideal: 30 },
      resizeMode: "none", // downscale 回避のヒント（対応ブラウザのみ）
    },
  };
}

async function startStream() {
  stopStream();

  const size = currentTargetSize();
  const constraints = constraintFor(size);

  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    console.warn("ideal constraints failed, fallback to no-size:", e);
    // 端末がピッタリ対応していない等で失敗した場合はサイズ指定なしで再試行
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: facing } },
    });
  }

  els.video.srcObject = stream;

  // iOS Safari 対策：メタデータ読み込み後に play()
  await new Promise((r) => {
    if (els.video.readyState >= 1) return r();
    els.video.onloadedmetadata = () => r();
  });
  try {
    await els.video.play();
  } catch (e) {
    console.warn("video.play() was blocked, needs user gesture.", e);
  }

  await updateInfo();
}

async function applyResolution() {
  if (!stream) return startStream();

  const track = stream.getVideoTracks()[0];
  const { width, height } = currentTargetSize();

  try {
    await track.applyConstraints({
      width: { ideal: width },
      height: { ideal: height },
      frameRate: { ideal: 30 },
    });
  } catch (e1) {
    console.warn("applyConstraints(ideal) failed, retry exact:", e1);
    try {
      await track.applyConstraints({
        width: { exact: width },
        height: { exact: height },
      });
    } catch (e2) {
      console.warn("applyConstraints(exact) failed, restart stream:", e2);
      // どうしても合わない端末は再取得
      return startStream();
    }
  }

  await updateInfo();
}

function stopStream() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
}

async function updateInfo() {
  const track = stream?.getVideoTracks()[0];
  if (!track) {
    log("Stopped.");
    return;
  }
  const settings = track.getSettings();
  log(
    `Actual: ${settings.width}×${settings.height} @${settings.frameRate || "?"}fps  |  facingMode=${settings.facingMode || facing}`
  );
  
  // Canvasのサイズをビデオのサイズに合わせて調整
  updateCanvasSize();
}

function updateCanvasSize() {
  if (!els.video || !els.canvas) return;
  
  const videoRect = els.video.getBoundingClientRect();
  els.canvas.width = videoRect.width;
  els.canvas.height = videoRect.height;
  els.canvas.style.width = videoRect.width + 'px';
  els.canvas.style.height = videoRect.height + 'px';
}

els.startBtn.addEventListener("click", startStream);
els.stopBtn.addEventListener("click", () => {
  stopStream();
  log("Stopped.");
});
els.resolution.addEventListener("change", applyResolution);

// 画面回転時は情報だけ更新（再取得は不要）
window.addEventListener("orientationchange", () => {
  updateInfo();
});

// ウィンドウサイズ変更時にCanvasサイズを調整
window.addEventListener("resize", updateCanvasSize);

// ページ離脱時に解放
window.addEventListener("pagehide", stopStream);

let model = null;
let detector = null;

async function initModel() {
  await tf.setBackend('webgl');  // 必要に応じて 'wasm' 等
  await tf.ready();
  model = await tf.loadGraphModel('/model/model.json');

  // ウォームアップ（モデルに合わせてサイズを調整）
  const warm = tf.ones([1, 300, 300, 3], 'int32'); // 例: 300x300
  const out = await model.executeAsync(warm);
  warm.dispose();
  if (Array.isArray(out)) out.forEach(t => t?.dispose?.());
  else out?.dispose?.();

  console.log('Model ready.');
}

// 推論トグルのハンドラ
function attachInferenceToggle() {
  const toggle = document.getElementById('inferToggle');
  toggle.addEventListener('change', () => {
    if (!model || !els.video.srcObject) {
      console.warn('model or stream not ready.');
      toggle.checked = false;
      return;
    }
    if (toggle.checked) {
      if (!detector) {
        detector = new Detector(model, els.video, els.canvas.getContext('2d'), {
          inputSize: 300,    // モデルに合わせる
          useRAF: true,      // rAF駆動（UI描画と同期）
          intervalMs: 100,   // setTimeout駆動時の間隔（useRAF:falseの時）
        });
      }
      detector.start();
      console.log('inference started');
    } else {
      detector?.stop();
      console.log('inference stopped');
    }
  });
}

(async () => {
  await initModel();
  attachInferenceToggle();
})();
