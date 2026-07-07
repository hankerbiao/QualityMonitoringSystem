import React, { useState, useCallback, useRef } from 'react';
import { X, Bot, Loader2 } from 'lucide-react';
import { useVoiceRecognition } from '../hooks/useVoiceRecognition';
import { VoiceInput } from './VoiceInput';
import { useSettings } from '../context/SettingsContext';
import { aiApi, type AIMessage } from '../api/aiApi';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTED_QUESTIONS = [
  '帮我分析本月直通率趋势',
  '哪些机型达成率最低？',
  '故障数量最多的基地是哪个？',
  '如何提升整机直通率？',
];

const INITIAL_MESSAGE: Message = {
  role: 'assistant',
  content: '您好！我是 QualiBoard 品质看板的 AI 助手，可以帮您分析 RTY 质量数据。有什么想了解的吗？',
};

export default function AIAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { settings } = useSettings();

  const inputBaseRef = useRef('');

  const sendMessage = useCallback(async (content: string) => {
    const userMessage: Message = { role: 'user', content };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    if (!settings.ai.enabled || !settings.ai.apiUrl || !settings.ai.modelId || !settings.ai.apiKey) {
      setTimeout(() => {
        setIsLoading(false);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: 'AI 助手尚未配置，请在"系统配置管理 → AI 配置"中完成模型服务配置。' },
        ]);
      }, 300);
      return;
    }

    try {
      const history: AIMessage[] = messages.slice(1).map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      const answer = await aiApi.chat(
        {
          apiUrl: settings.ai.apiUrl,
          modelId: settings.ai.modelId,
          apiKey: settings.ai.apiKey,
          maxTokens: settings.ai.maxTokens || 4096,
        },
        [...history, { role: 'user', content }],
        []
      );
      setMessages((prev) => [...prev, { role: 'assistant', content: answer }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI 服务响应失败，请检查配置或稍后重试。';
      setMessages((prev) => [...prev, { role: 'assistant', content: `抱歉，发生错误：${msg}` }]);
    } finally {
      setIsLoading(false);
    }
  }, [messages, settings.ai]);

  const handleVoiceResult = useCallback((text: string, _isFinal: boolean) => {
    setInput(inputBaseRef.current + text);
  }, []);

  const {
    status: voiceStatus,
    interimText,
    start: startVoice,
    stop: stopVoice,
  } = useVoiceRecognition({ onResult: handleVoiceResult });

  const isVoiceActive = voiceStatus === 'connecting' || voiceStatus === 'listening';

  const handleToggleVoice = useCallback(() => {
    if (isVoiceActive) {
      stopVoice();
    } else {
      inputBaseRef.current = input;
      startVoice();
    }
  }, [isVoiceActive, startVoice, stopVoice, input]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    sendMessage(trimmed);
    setInput('');
  }, [input, sendMessage, isLoading]);

  const handleSuggestedQuestion = useCallback((question: string) => {
    if (isLoading) return;
    sendMessage(question);
  }, [sendMessage, isLoading]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleInputChange = useCallback((value: string) => {
    if (!isVoiceActive) {
      setInput(value);
    }
  }, [isVoiceActive]);

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
        <div className="fixed bottom-6 right-6 z-50 w-96 h-[520px] bg-white rounded-xl
                        shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r
                          from-blue-500 to-blue-600 text-white flex-shrink-0">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5" />
              <span className="font-semibold text-sm">QualiBoard AI 助手</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1.5 hover:bg-blue-400/50 rounded transition-colors"
              title="关闭"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mr-2">
                    <Bot className="w-4 h-4 text-blue-600" />
                  </div>
                )}
                <div className={`max-w-[80%] px-3 py-2 rounded-xl text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white rounded-tr-sm'
                    : 'bg-white border border-slate-200 text-slate-700 rounded-tl-sm shadow-sm'
                }`}>
                  {msg.content}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mr-2">
                  <Bot className="w-4 h-4 text-blue-600" />
                </div>
                <div className="px-3 py-2 rounded-xl rounded-tl-sm bg-white border border-slate-200 shadow-sm flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                  <span className="text-sm text-slate-500">AI 思考中...</span>
                </div>
              </div>
            )}
          </div>

          {messages.length <= 1 && (
            <div className="px-4 pb-2 bg-slate-50/50">
              <p className="text-[10px] text-slate-400 mb-2 font-medium">快捷问题:</p>
              <div className="flex flex-wrap gap-1.5 pb-2">
                {SUGGESTED_QUESTIONS.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => handleSuggestedQuestion(q)}
                    disabled={isLoading}
                    className="px-2 py-1 text-[10px] bg-white border border-slate-200
                               rounded-full text-slate-600 hover:bg-blue-50 hover:border-blue-200
                               hover:text-blue-600 transition-colors disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

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