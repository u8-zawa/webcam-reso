import * as tf from '@tensorflow/tfjs';

export class Detector {
    /**
     * @param {tf.GraphModel} model  事前にloadGraphModelしたモデル
     * @param {HTMLVideoElement} video  推論ソース
     * @param {CanvasRenderingContext2D} canvasContext  描画用canvasのコンテキスト
     * @param {Object} opts
     * @param {number} opts.inputSize   モデル入力サイズ（例: 300）
     * @param {boolean} opts.useRAF     true: rAF駆動 / false: setTimeout
     * @param {number} opts.intervalMs  setTimeout時の間隔
     */
    constructor(model, video, canvasContext, { inputSize = 300, useRAF = true, intervalMs = 100 } = {}) {
        this.model = model;
        this.video = video;
        this.canvasContext = canvasContext;
        this.inputSize = inputSize;
        this.useRAF = useRAF;
        this.intervalMs = intervalMs;

        this._running = false;
        this._rafId = null;
        this._timerId = null;

        // オフスクリーン描画用（キャプチャ→テンソル化を軽くする）
        this._canvas = document.createElement('canvas');
        this._canvas.width = this.inputSize;
        this._canvas.height = this.inputSize;
        this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });
    }

    isRunning() {
        return this._running;
    }

    start() {
        if (this._running) return;
        this._running = true;

        const loop = async () => {
            if (!this._running) return;
            try {
                await this.inferOnce(); // 1ステップ推論
            } catch (e) {
                console.warn('inferOnce error:', e);
            }
            if (!this._running) return;
            if (this.useRAF) {
                this._rafId = requestAnimationFrame(loop);
            } else {
                this._timerId = setTimeout(loop, this.intervalMs);
            }
        };

        if (this.useRAF) {
            this._rafId = requestAnimationFrame(loop);
        } else {
            this._timerId = setTimeout(loop, this.intervalMs);
        }
    }

    stop() {
        this._running = false;
        if (this._rafId != null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        if (this._timerId != null) {
            clearTimeout(this._timerId);
            this._timerId = null;
        }
    }

    /**
     * 1フレーム分の推論を実施
     * ※ 出力のデコードはモデル依存なのでここではログに留める
     */
    async inferOnce() {
        // 動画が再生可能か確認
        if (!this.video || this.video.readyState < 2) return;

        // 入力前処理：video → 300x300 → int32/float32化
        const input = tf.tidy(() => {
            // Videoを正方形にリサイズしてからモデル入力へ
            this._ctx.drawImage(this.video, 0, 0, this.inputSize, this.inputSize);
            const img = tf.browser.fromPixels(this._canvas);          // [H,W,3] uint8
            // モデルに合わせて型や正規化を調整（例はint32想定）
            // もし浮動小数＋正規化が必要なら: img.toFloat().div(255)
            const batched = img.expandDims(0);                        // [1,H,W,3]
            return batched.toInt();                                   // 例: int32
        });

        let outputs;
        try {
            outputs = await this.model.executeAsync(input);
            const [boxes, scores, classes] = [
                outputs[1].arraySync()[0],
                outputs[4].arraySync()[0],
                outputs[0].arraySync()[0]
            ];

            // バウンディングボックスを描画
            this.drawBoundingBoxes(boxes, scores, classes);
        } finally {
            // メモリ解放：input と outputs（Tensor/Array<Tensor>に対応）
            input.dispose();
            if (outputs != null) {
                if (Array.isArray(outputs)) outputs.forEach(t => t?.dispose?.());
                else outputs.dispose?.();
            }
        }
    }

    /**
     * バウンディングボックスとラベルを描画する
     * @param {Array} boxes - バウンディングボックスの座標配列
     * @param {Array} scores - 信頼度スコアの配列
     * @param {Array} classes - クラスIDの配列
     */
    drawBoundingBoxes(boxes, scores, classes) {
        if (!this.canvasContext) return;

        const ctx = this.canvasContext;
        const canvas = ctx.canvas;
        
        // Canvasをクリア
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 信頼度閾値
        const threshold = 0.7;

        scores.forEach((score, i) => {
            if (score >= threshold) {
                const box = boxes[i];
                const classId = classes[i];
                
                // バウンディングボックスの座標を正規化座標からピクセル座標に変換
                // [ymin, xmin, ymax, xmax] の順序で格納されていると仮定
                const [ymin, xmin, ymax, xmax] = box;
                const x = xmin * canvas.width;
                const y = ymin * canvas.height;
                const width = (xmax - xmin) * canvas.width;
                const height = (ymax - ymin) * canvas.height;

                // バウンディングボックスを描画
                ctx.strokeStyle = '#00ff00';
                ctx.lineWidth = 3;
                ctx.strokeRect(x, y, width, height);

                // ラベルとスコアを描画
                const label = `Class ${Math.round(classId)}: ${(score * 100).toFixed(1)}%`;
                const labelY = y > 20 ? y - 5 : y + height + 20;
                
                ctx.fillStyle = 'rgba(0, 255, 0, 0.8)';
                ctx.fillRect(x, labelY - 20, ctx.measureText(label).width + 10, 25);
                
                ctx.fillStyle = '#000000';
                ctx.font = '14px Arial';
                ctx.fillText(label, x + 5, labelY - 2);

                // デバッグ用ログ
                console.log(`Detection ${i}:`);
                console.log(`  Box: [${ymin.toFixed(3)}, ${xmin.toFixed(3)}, ${ymax.toFixed(3)}, ${xmax.toFixed(3)}]`);
                console.log(`  Score: ${score.toFixed(3)}`);
                console.log(`  Class: ${classId}`);
            }
        });
    }
}