import { useState, useRef, useCallback, useEffect } from 'react';
import { VOICE_WS_URL, SAMPLE_RATE, BUFFER_SIZE, VOICE_STOP_WAIT } from '../constants';

export type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'error';

export interface UseVoiceRecognitionOptions {
  onResult?: (text: string, isFinal: boolean) => void;
}

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
      ctxRef.current.close().catch(() => { /* noop */ });
      ctxRef.current = null;
    }
  }, []);

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

  const start = useCallback(async () => {
    closeWs();
    releaseAudio();

    accumulatedRef.current = '';
    setInterimText('');
    setStatus('connecting');

    const ws = new WebSocket(VOICE_WS_URL);
    wsRef.current = ws;

    ws.onopen = async () => {
      setStatus('listening');
      if (!navigator.mediaDevices?.getUserMedia) {
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

        processor.onaudioprocess = (e) => {
          const float32 = e.inputBuffer.getChannelData(0);
          const pcm16 = new Int16Array(float32.length);
          for (let i = 0; i < float32.length; i++) {
            const s = Math.max(-1, Math.min(1, float32[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(pcm16.buffer);
          }
        };

        source.connect(processor);
        const gain = ctx.createGain();
        gain.gain.value = 0;
        processor.connect(gain);
        gain.connect(ctx.destination);
        gainRef.current = gain;
      } catch {
        setStatus('error');
        closeWs();
      }
    };

    ws.onmessage = (e) => {
      let data: { text?: string; is_final?: boolean; complete?: boolean };
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }

      const isFinal = data.is_final || data.complete;

      if (isFinal) {
        const acc = accumulatedRef.current;
        const finalText = data.text && data.text.length >= acc.length
          ? data.text
          : acc || data.text || '';
        accumulatedRef.current = finalText;
        setInterimText(finalText);
        onResultRef.current?.(finalText, true);

        releaseAudio();
        setTimeout(() => {
          closeWs();
          setStatus('idle');
        }, 200);
      } else if (data.text) {
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
      setStatus('error');
      releaseAudio();
      closeWs();
    };

    ws.onclose = () => {
      releaseAudio();
      setStatus((prev) => (prev === 'error' ? 'error' : 'idle'));
    };
  }, [closeWs, releaseAudio]);

  const stop = useCallback(() => {
    releaseAudio();
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'end' }));
      setTimeout(() => {
        closeWs();
        setStatus('idle');
      }, VOICE_STOP_WAIT);
    } else {
      closeWs();
      setStatus('idle');
    }
  }, [closeWs, releaseAudio]);

  useEffect(() => {
    return () => {
      releaseAudio();
      closeWs();
    };
  }, [releaseAudio, closeWs]);

  return { status, interimText, start, stop };
}