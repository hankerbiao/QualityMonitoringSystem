import React, { useState, useCallback, useRef } from 'react';
import { X, Bot } from 'lucide-react';
import { useVoiceRecognition } from '../hooks/useVoiceRecognition';
import { VoiceInput } from './VoiceInput';
import { useSettings } from '../context/SettingsContext';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// ──── 模拟 AI 响应 ────
function getAIResponse(question: string): string {
  const q = question.toLowerCase();
  if (q.includes('趋势') || q.includes('分析')) {
    return '根据当前数据，本月 RTY 整体呈下降趋势。建议重点关注 6210 C21 机型的直通率波动，该机型本周下降了约 0.3%。';
  }
  if (q.includes('达成率') || q.includes('最低')) {
    return '目前达成率最低的机型是 6210 C31，直通率为 97.2%，低于目标 99%。建议检查该机型的焊接工序和老化测试环节。';
  }
  if (q.includes('故障') && (q.includes('基地') || q.includes('最多'))) {
    return '故障数量最多的基地是天津基地，本月累计故障 156 件，占全量的 38%。建议对该基地的来料检验和装配工艺进行专项审查。';
  }
  if (q.includes('提升') || q.includes('改善')) {
    return '提升 RTY 的关键措施：1) 加强来料检验，降低不良品流入；2) 优化焊接工艺参数；3) 增加老化测试时间；4) 建立质量问题快速反馈机制。';
  }
  return '抱歉，我暂时无法回答这个问题。建议您使用页面上的过滤条件或周期统计功能获取更精准的数据分析。';
}

const SUGGESTED_QUESTIONS = [
  '帮我分析本月直通率趋势',
  '哪些机型达成率最低？',
  '故障数量最多的基地是哪个？',
  '如何提升整机直通率？',
];

const INITIAL_MESSAGE: Message = {
  role: 'assistant',
  content: '您好！我是数质看板的 AI 助手，可以帮您分析 RTY 质量数据。有什么想了解的吗？',
};

export default function AIAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const { settings } = useSettings();

  // ──── 消息发送 ────
  const sendMessage = useCallback((content: string) => {
    const userMessage: Message = { role: 'user', content };
    setMessages((prev) => [...prev, userMessage]);

    setTimeout(() => {
      setMessages((prev) => [...prev, { role: 'assistant', content: getAIResponse(content) }]);
    }, 800);
  }, []);

  // ──── 语音识别 ────
  // 录音开始时输入框已有内容，识别结果追加在其后（不清空之前输入）
  const inputBaseRef = useRef('');
  const handleVoiceResult = useCallback((text: string, _isFinal: boolean) => {
    setInput(inputBaseRef.current + text);
  }, []);

  const {
    status: voiceStatus,
    interimText,
    start: startVoice,
    stop: stopVoice,
  } = useVoiceRecognition({
    onResult: handleVoiceResult,
  });

  const isVoiceActive = voiceStatus === 'connecting' || voiceStatus === 'listening';

  const handleToggleVoice = useCallback(() => {
    if (isVoiceActive) {
      stopVoice();
    } else {
      // 记录录音前已有内容作为累加基准，识别结果会追加在其后
      inputBaseRef.current = input;
      startVoice();
    }
  }, [isVoiceActive, startVoice, stopVoice, input]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    sendMessage(trimmed);
    setInput('');
  }, [input, sendMessage]);

  const handleSuggestedQuestion = useCallback((question: string) => {
    sendMessage(question);
  }, [sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleInputChange = useCallback((value: string) => {
    // 语音激活时输入框由识别结果驱动，禁止手动修改
    if (!isVoiceActive) {
      setInput(value);
    }
  }, [isVoiceActive]);

  // ──── 隐藏态：仅显示悬浮球 ────
  if (!isVisible) {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <button
          onClick={() => setIsVisible(true)}
          className="w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full
                     shadow-lg shadow-blue-500/30 flex items-center justify-center
                     hover:scale-105 transition-transform"
          title="打开 AI 助手"
        >
          <Bot className="w-7 h-7 text-white" />
        </button>
      </div>
    );
  }

  return (
    <>
      {/* 悬浮球 */}
      {!isOpen ? (
        <div className="fixed bottom-6 right-6 z-50 group">
          <button
            onClick={() => setIsVisible(false)}
            className="absolute -top-2 -right-2 w-5 h-5 bg-slate-600 hover:bg-slate-700
                       rounded-full shadow flex items-center justify-center z-10
                       opacity-0 group-hover:opacity-100 transition-opacity"
            title="关闭 AI 助手"
          >
            <X className="w-3 h-3 text-white" />
          </button>
          <button
            onClick={() => setIsOpen(true)}
            className="relative w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-600
                       rounded-full shadow-lg shadow-blue-500/30 flex items-center
                       justify-center hover:scale-105 transition-transform"
            title="打开 AI 助手"
          >
            <Bot className="w-7 h-7 text-white" />
          </button>
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-400 rounded-full border-2 border-white" />
        </div>
      ) : (
        /* 对话面板 */
        <div className="fixed bottom-6 right-6 z-50 w-96 h-[520px] bg-white rounded-xl
                        shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r
                          from-blue-500 to-blue-600 text-white flex-shrink-0">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5" />
              <span className="font-semibold text-sm">数质看板 AI 助手</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1.5 hover:bg-blue-400/50 rounded transition-colors"
              title="关闭"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* 消息列表 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mr-2">
                    <Bot className="w-4 h-4 text-blue-600" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] px-3 py-2 rounded-xl text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white rounded-tr-sm'
                      : 'bg-white border border-slate-200 text-slate-700 rounded-tl-sm shadow-sm'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
          </div>

          {/* 快捷问题 */}
          {messages.length <= 1 && (
            <div className="px-4 pb-2 bg-slate-50/50">
              <p className="text-[10px] text-slate-400 mb-2 font-medium">快捷问题:</p>
              <div className="flex flex-wrap gap-1.5 pb-2">
                {SUGGESTED_QUESTIONS.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => handleSuggestedQuestion(q)}
                    className="px-2 py-1 text-[10px] bg-white border border-slate-200
                               rounded-full text-slate-600 hover:bg-blue-50 hover:border-blue-200
                               hover:text-blue-600 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 输入区域 — 语音识别文字实时回显 */}
          <VoiceInput
            status={voiceStatus}
            interimText={interimText}
            inputValue={input}
            onInputChange={handleInputChange}
            onSend={handleSend}
            onToggleVoice={handleToggleVoice}
            onKeyDown={handleKeyDown}
            voiceEnabled={settings.voiceInputEnabled}
          />
        </div>
      )}
    </>
  );
}
