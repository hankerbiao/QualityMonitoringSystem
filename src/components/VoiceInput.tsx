import React, { useCallback, useRef, useEffect } from 'react';
import { Mic, MicOff, Loader2, Send } from 'lucide-react';
import type { VoiceStatus } from '../hooks/useVoiceRecognition';

/** 输入框最大高度 (px)，超出后显示滚动条 */
const TEXTAREA_MAX_HEIGHT = 120;

export interface VoiceInputProps {
  status: VoiceStatus;
  interimText: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onToggleVoice: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  voiceEnabled?: boolean;
}

/** 状态 → 提示文案 */
const STATUS_LABEL: Record<VoiceStatus, string> = {
  idle: '',
  connecting: '连接中...',
  listening: '正在识别，请说话...',
  error: '识别出错，请重试',
};

/**
 * VoiceInput - 输入区：文本框（自动扩大）+ 麦克风按钮 + 发送按钮 + 语音状态条
 */
export const VoiceInput: React.FC<VoiceInputProps> = React.memo(
  ({ status, interimText, inputValue, onInputChange, onSend, onToggleVoice, onKeyDown, voiceEnabled = true }) => {
    const isRecording = status === 'connecting' || status === 'listening';
    const label = STATUS_LABEL[status];

    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // 输入内容变化时自动调整高度（语音识别实时回显、手动输入都生效）
    useEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      // 先缩回 auto 让 scrollHeight 反映实际内容高度
      el.style.height = 'auto';
      const clamped = Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT);
      el.style.height = `${clamped}px`;
    }, [inputValue]);

    const handleMicClick = useCallback(() => {
      onToggleVoice();
    }, [onToggleVoice]);

    const hasText = inputValue.trim().length > 0;

    return (
      <div className="p-3 border-t border-slate-200 bg-white flex-shrink-0">
        {/* 语音状态条 */}
        {label && (
          <div
            className={`flex items-center gap-2 mb-2 px-2 py-1 rounded-md text-xs ${
              status === 'error'
                ? 'bg-red-50 text-red-600'
                : 'bg-blue-50 text-blue-600'
            }`}
          >
            {isRecording ? (
              status === 'connecting' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
              )
            ) : null}
            <span className="truncate">
              {label}
              {interimText && status === 'listening' && (
                <span className="ml-1 text-blue-400 italic">“{interimText}”</span>
              )}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
          {/* 文本输入（自动扩展高度，不超过 TEXTAREA_MAX_HEIGHT） */}
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="输入问题..."
            rows={1}
            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm resize-none
                       focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                       overflow-y-auto"
            disabled={isRecording}
          />

          {voiceEnabled && (
            <button
              onClick={handleMicClick}
              className={`p-2 rounded-lg transition-colors flex-shrink-0 ${
                isRecording
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
              }`}
              title={isRecording ? '停止录音' : '语音输入'}
              aria-label={isRecording ? '停止录音' : '语音输入'}
            >
              {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          )}

          {/* 发送按钮 */}
          <button
            onClick={onSend}
            disabled={!hasText}
            className="p-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300
                       disabled:cursor-not-allowed text-white rounded-lg transition-colors flex-shrink-0"
            aria-label="发送"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  },
);

VoiceInput.displayName = 'VoiceInput';
