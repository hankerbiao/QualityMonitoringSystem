import { useState, useRef, useEffect } from 'react';
import { Bot, X, Send, Loader2, Sparkles, Brain } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSettings } from '../context/SettingsContext';
import { aiApi } from '../api/aiApi';
import type { RTYData } from '../types';

const QUICK_QUESTIONS = [
  '本周 RTY 达标率如何？',
  '哪些产品达标率最低？',
  'RTY 趋势分析',
  '产能与质量相关性',
];

function extractThinking(content: string) {
  const match = content.match(/<think>([\s\S]*?)<\/think>/);
  if (match) {
    return { thinking: match[1].trim(), body: content.replace(match[0], '').trim() };
  }
  return { thinking: null, body: content };
}

export function AIChatButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-sm text-xs font-medium transition-colors flex items-center shadow-sm"
    >
      <Bot className="w-3.5 h-3.5 mr-1.5 text-violet-500" />
      AI 分析
    </button>
  );
}

export function AIChatPanel({ rtyData, onClose }: { rtyData: RTYData[]; onClose: () => void }) {
  const { ai: aiConfig } = useSettings();
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSend = async (text: string) => {
    if (!text.trim() || isTyping) return;
    const userMsg = text.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsTyping(true);
    try {
      const res = await aiApi.chat(aiConfig, [{ role: 'user', content: userMsg }], rtyData);
      setMessages(prev => [...prev, { role: 'assistant', content: res }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '抱歉，AI 分析失败，请稍后重试。' }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="fixed right-0 top-0 h-full w-[420px] bg-white shadow-[-8px_0_32px_rgba(0,0,0,0.1)] z-50 flex flex-col animate-in slide-in-from-right-4 duration-300">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-gradient-to-r from-violet-50 to-slate-50">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center shadow-sm">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800 leading-none">AI 质量助手</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">基于当前 RTY 数据</p>
          </div>
        </div>
        <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-3">
            {aiConfig.apiUrl && aiConfig.hasApiKey ? (
              <>
                <p className="text-xs text-slate-400 text-center mt-4">选择问题或直接输入：</p>
                <div className="grid grid-cols-1 gap-2">
                  {QUICK_QUESTIONS.map((q) => (
                    <button key={q} onClick={() => handleSend(q)} disabled={isTyping}
                      className="text-left text-xs p-3 rounded-xl border border-slate-200 bg-slate-50/60 hover:bg-violet-50 hover:border-violet-200 hover:text-violet-700 transition-all disabled:opacity-50">
                      {q}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-48 text-center gap-3">
                <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700">AI 助手暂未配置</p>
                  <p className="text-xs text-slate-400 mt-1">请在系统设置中配置 AI API</p>
                </div>
              </div>
            )}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'user' ? (
              <div className="max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-br-md text-xs leading-relaxed whitespace-pre-wrap bg-violet-600 text-white">
                {msg.content}
              </div>
            ) : (() => {
                const { thinking, body } = extractThinking(msg.content);
                return (
                  <div className="max-w-[85%] rounded-2xl rounded-bl-md px-4 py-3 bg-slate-100 text-slate-700 space-y-2">
                    {thinking && (
                      <details className="group rounded-lg border border-violet-200 bg-violet-50/60 overflow-hidden">
                        <summary className="flex items-center gap-1.5 px-3 py-1.5 cursor-pointer select-none text-[11px] text-violet-600 hover:text-violet-700 font-medium">
                          <Brain className="w-3 h-3 flex-shrink-0" /><span>AI 思考过程</span>
                          <span className="ml-auto text-[10px] text-violet-400 group-open:hidden">点击展开</span>
                          <span className="ml-auto text-[10px] text-violet-400 hidden group-open:block">点击收起</span>
                        </summary>
                        <div className="px-3 pb-2 text-[10px] text-slate-500 leading-relaxed whitespace-pre-wrap">{thinking}</div>
                      </details>
                    )}
                    {body && <div className="prose-xs prose-slate max-w-none"><ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown></div>}
                  </div>
                );
              })()}
          </div>
        ))}

        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-slate-100 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" /><span className="text-xs text-slate-400">正在分析...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-slate-200">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(input); } }}
            placeholder={aiConfig.apiUrl && aiConfig.hasApiKey ? '输入问题，Enter 发送...' : '请先配置 AI API...'}
            rows={2}
            className="flex-1 resize-none text-xs px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100 transition-all placeholder:text-slate-300"
          />
          <button onClick={() => handleSend(input)} disabled={!input.trim() || isTyping || !aiConfig.apiUrl || !aiConfig.hasApiKey}
            className="w-9 h-9 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white flex items-center justify-center transition-colors flex-shrink-0">
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default AIChatPanel;