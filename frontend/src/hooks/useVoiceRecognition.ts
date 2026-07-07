import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * 语音识别 Hook
 *
 * 设计参照 test.html 的成功实现：WS 先连接 → onopen 后取麦克风 →
 * AudioContext(16kHz) + ScriptProcessor(4096,1,1) → onaudioprocess 里
 * 把 Float32 转 PCM16 直接 ws.send。收到 is_final/complete 即为最终结果。
 *
 * 单文件、零子模块、无静音检测/会话令牌等额外抽象，行为与 test.html 对齐。
 */

/** 语音识别 WebSocket 服务地址（与 test.html 一致） */
const VOICE_WS_URL = `wss://${location.host}/ws-voice`;

/** 采样率：服务端要求 16kHz 单声道 */
const SAMPLE_RATE = 16000;

/** ScriptProcessor 缓冲区大小（样本数），4096 → 256ms@16kHz，与 test.html 一致 */
const BUFFER_SIZE = 4096;

/** 手动停止后等待服务端返回最终结果的最长时间 (ms) */
const STOP_WAIT = 2000;

export type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'error';

export interface UseVoiceRecognitionOptions {
  /** 识别结果回调。isFinal=false 为实时增量，isFinal=true 为最终结果 */
  onResult?: (text: string, isFinal: boolean) => void;
}

const LOG = (...args: unknown[]) => console.log('[Voice]', ...args);

export function useVoiceRecognition({ onResult }: UseVoiceRecognitionOptions) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [interimText, setInterimText] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const accumulatedRef = useRef('');
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  /** 释放音频采集资源（不影响 WS） */
  const releaseAudio = useCallback(() => {
    try { processorRef.current?.disconnect(); } catch { /* noop */ }
    try { sourceRef.current?.disconnect(); } catch { /* noop */ }
    try { gainRef.current?.disconnect(); } catch { /* noop */ }
    processorRef.current = null;
    sourceRef.current = null;
    gainRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    if (ctxRef.current) {
      ctxRef.current.close().catch(() => { /* 已关闭则忽略 */ });
      ctxRef.current = null;
    }
  }, []);

  /** 关闭 WS 并清空引用 */
  const closeWs = useCallback(() => {
    const ws = wsRef.current;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try { ws.close(); } catch { /* noop */ }
      wsRef.current = null;
    }
  }, []);

  /** 开始录音 */
  const start = useCallback(async () => {
    // 关闭可能残留的旧连接与音频资源，确保干净起步
    closeWs();
    releaseAudio();

    accumulatedRef.current = '';
    setInterimText('');
    setStatus('connecting');
    LOG(`连接 ${VOICE_WS_URL} ...`);

    const ws = new WebSocket(VOICE_WS_URL);
    wsRef.current = ws;

    // ── onopen：建立连接后立即取麦克风并发音频（与 test.html 一致）──
    ws.onopen = async () => {
      LOG('WS 已连接，开始采集麦克风');
      setStatus('listening');
      if (!navigator.mediaDevices?.getUserMedia) {
        LOG('麦克风获取失败: 浏览器不支持 getUserMedia 或不在安全上下文中');
        setStatus('error');
        closeWs();
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, sampleRate: SAMPLE_RATE },
        });
        streamRef.current = stream;

        const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
        ctxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        sourceRef.current = source;

        const processor = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1);
        processorRef.current = processor;

        let frame = 0;
        processor.onaudioprocess = (e) => {
          const float32 = e.inputBuffer.getChannelData(0);
          const pcm16 = new Int16Array(float32.length);
          for (let i = 0; i < float32.length; i++) {
            const s = Math.max(-1, Math.min(1, float32[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(pcm16.buffer);
            frame++;
            if (frame % 50 === 0) LOG(`已发送 ${frame} 帧音频`);
          }
        };

        // 连接采集链：source → processor → silentGain(0) → destination
        // silentGain=0 防止外放回声，同时保证 processor 参与渲染才会触发 onaudioprocess
        source.connect(processor);
        const gain = ctx.createGain();
        gain.gain.value = 0;
        processor.connect(gain);
        gain.connect(ctx.destination);
        gainRef.current = gain;

        LOG('音频采集就绪');
      } catch (err) {
        LOG('麦克风获取失败:', err);
        setStatus('error');
        closeWs();
      }
    };

    // ── onmessage：累加增量文本，is_final/complete 为最终结果 ──
    ws.onmessage = (e) => {
      let data: { text?: string; is_final?: boolean; complete?: boolean };
      try {
        data = JSON.parse(e.data);
      } catch {
        LOG('非 JSON 消息，忽略:', e.data);
        return;
      }

      const isFinal = data.is_final || data.complete;

      if (isFinal) {
        // ⚠️ 实测该服务端 is_final 消息的 text 字段可能只是末尾片段（如最后一个字），
        // 不能直接覆盖流式累加的完整文本。优先用 accumulatedRef：
        //   - 若 data.text 更长（2pass 纠正后的完整句），采用 data.text
        //   - 否则采用 accumulatedRef（流式累加结果），data.text 仅在 accumulated 为空时兜底
        const acc = accumulatedRef.current;
        const finalText =
          data.text && data.text.length >= acc.length
            ? data.text
            : acc || data.text || '';
        accumulatedRef.current = finalText;
        LOG(`最终结果: "${finalText}" (accumulated="${acc}", is_final.text="${data.text ?? ''}")`);
        setInterimText(finalText);
        onResultRef.current?.(finalText, true);

        // 已拿到最终结果，直接收尾
        releaseAudio();
        setTimeout(() => {
          closeWs();
          setStatus('idle');
        }, 200);
      } else if (data.text) {
        // 兼容两种文本协议：
        //   - delta：每次 text 是新识别的增量 → 累加
        //   - cumulative：每次 text 是已识别的完整文本（包含历史）→ 替换
        if (data.text.startsWith(accumulatedRef.current)) {
          accumulatedRef.current = data.text;
        } else {
          accumulatedRef.current += data.text;
        }
        setInterimText(accumulatedRef.current);
        onResultRef.current?.(accumulatedRef.current, false);
      }
    };

    ws.onerror = () => {
      LOG('WS 连接出错');
      setStatus('error');
      releaseAudio();
      closeWs();
    };

    ws.onclose = (e) => {
      LOG(`WS 关闭 (code=${e.code})`);
      releaseAudio();
      setStatus((prev) => (prev === 'error' ? 'error' : 'idle'));
    };
  }, [closeWs, releaseAudio]);

  /** 停止录音：立即停麦克风并发 end，等最终结果后关连接 */
  const stop = useCallback(() => {
    LOG('停止录音');
    releaseAudio();
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'end' }));
      // 等待服务端返回最终结果，再关闭连接
      setTimeout(() => {
        closeWs();
        setStatus('idle');
      }, STOP_WAIT);
    } else {
      closeWs();
      setStatus('idle');
    }
  }, [closeWs, releaseAudio]);

  // 组件卸载时释放资源
  useEffect(() => {
    return () => {
      releaseAudio();
      closeWs();
    };
  }, [releaseAudio, closeWs]);

  return { status, interimText, start, stop };
}
