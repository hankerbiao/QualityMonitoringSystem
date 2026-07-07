# 实时语音识别后端接入方案

## 1. 目标

为当前前端提供一个可稳定接入的实时语音识别后端，兼容现有前端协议：

- 前端通过 WebSocket 实时发送 PCM16 音频流
- 服务端返回增量文本和最终文本
- 结果格式与当前前端 hook 兼容

当前前端已实现的约定：

- 采样率：16kHz
- 声道：单声道
- 音频格式：PCM16LE
- WebSocket 消息：
  - 二进制：音频帧
  - 文本：`{"type":"end"}` 表示结束本次识别

### 前端最小 Demo

下面这段是最小可运行的前端实现，逻辑和当前项目里的语音识别 Hook 基本一致：

```html
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <title>语音识别最小 Demo</title>
</head>
<body>
  <button id="start">开始识别</button>
  <button id="stop">停止</button>
  <div id="result"></div>

  <script>
    const WS_URL = 'ws://127.0.0.1:8000/ws/asr/stream';
    let ws;
    let audioCtx;
    let stream;
    let processor;

    async function startRecognition() {
      ws = new WebSocket(WS_URL);

      ws.onopen = async () => {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000 } });
        audioCtx = new AudioContext({ sampleRate: 16000 });
        const source = audioCtx.createMediaStreamSource(stream);
        processor = audioCtx.createScriptProcessor(4096, 1, 1);

        processor.onaudioprocess = (e) => {
          const input = e.inputBuffer.getChannelData(0);
          const pcm16 = new Int16Array(input.length);
          for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(pcm16.buffer);
          }
        };

        source.connect(processor);
        const gain = audioCtx.createGain();
        gain.gain.value = 0;
        processor.connect(gain);
        gain.connect(audioCtx.destination);
      };

      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        document.getElementById('result').textContent = data.text || '';
      };
    }

    function stopRecognition() {
      if (processor) processor.disconnect();
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (audioCtx) audioCtx.close();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'end' }));
      }
    }

    document.getElementById('start').onclick = startRecognition;
    document.getElementById('stop').onclick = stopRecognition;
  </script>
</body>
</html>
```

这个最小 Demo 重点展示了三件事：

1. 通过 `getUserMedia()` 采集麦克风
2. 把音频转换为 PCM16 并通过 WebSocket 实时发送
3. 收到服务端返回的 `text` 后直接展示结果

---

## 2. 推荐方案

建议使用 Python 后端 + FastAPI/WebSocket + FunASR（Paraformer）实现。

### 方案理由

- 与现有前端协议匹配度高
- 流式识别能力较好
- 部署简单，适合中小型内部系统
- 可扩展为带 VAD、标点、语义后处理的完整语音服务

---

## 3. 架构设计

```text
前端浏览器
  └─ WebSocket 发送 PCM16 音频流
        ↓
ASR 服务（Python）
  ├─ WebSocket 接收音频
  ├─ 音频缓冲 / 分帧
  ├─ 流式 ASR 推理（FunASR / Paraformer）
  ├─ 文本增量输出
  └─ 最终结果输出
        ↓
前端显示实时文本 / 最终结果
```

### 核心组件

1. WebSocket 网关
   - 负责连接管理、消息收发、会话生命周期
   - 接收二进制音频帧，收到 `end` 时结束识别

2. 流式识别引擎
   - 使用 Paraformer 或其他流式 ASR 模型
   - 每接收到一段音频，输出增量文本

3. 结果封装层
   - 将引擎输出转成前端可识别 JSON：

```json
{"text":"今天天气","is_final":false}
{"text":"今天天气不错","is_final":true}
```

---

## 4. 协议设计

### 前端发送

- 二进制消息：PCM16 音频数据
- 文本消息：

```json
{"type":"end"}
```

### 服务端返回

- 实时增量结果：

```json
{"text":"今天天气","is_final":false}
```

- 最终结果：

```json
{"text":"今天天气不错","is_final":true}
```

- 识别结束：

```json
{"text":"今天天气不错","complete":true}
```

这与当前前端里的 `useVoiceRecognition.ts` 兼容。

---

## 5. 推荐技术栈

### 后端

- Python 3.10+
- FastAPI
- Uvicorn
- numpy
- torch
- funasr
- websocket-client / websockets

### 可选增强

- VAD：判断是否有人说话，减少空音频处理
- Punctuation：自动加标点
- Token 鉴权：保护接口
- Redis / Kafka：做异步转发和多实例扩展

---

## 6. 服务端实现思路

### 6.1 WebSocket 接口

建议暴露接口：

```text
/ws/asr/stream
```

### 6.2 会话处理流程

1. 建立 WebSocket 连接
2. 读取客户端二进制音频帧
3. 将音频帧拼接为流
4. 每 N 帧或每隔一段时间调用识别引擎
5. 将结果推回前端
6. 收到 `end` 后结束当前会话并返回最终结果

### 6.3 关键注意点

- 音频需要按 16kHz 单声道处理
- 前端发送的是 PCM16，服务端需要把它转换成模型可接受的张量
- 流式识别要尽量减少延迟，建议使用小块音频上送
- 要处理断连、超时、空音频、异常输入

---

## 7. 与当前项目的接入方式

当前仓库中前端已经有语音识别 hook，接入后端时只需要调整两处：

1. 修改语音 WebSocket 地址
   - 目前是：

```ts
const VOICE_WS_URL = 'ws://10.17.150.235:10095';
```

   - 改为你部署后的地址，例如：

```ts
const VOICE_WS_URL = 'wss://your-domain.com/ws/asr/stream';
```

2. 保持现有协议不变
   - 前端已经发送 PCM 和 `end`
   - 前端已经消费 `text` + `is_final` / `complete`

因此后端只要按这个协议返回即可，无需改动前端逻辑。

---

## 8. 部署建议

### 方案 A：单机部署

适合开发环境或小规模使用：

- 1 台带 GPU 的服务器
- 直接部署 ASR 服务
- 通过 Nginx/反向代理暴露 `wss://`

### 方案 B：服务拆分

适合正式环境：

- WebSocket 网关层：负责连接、鉴权、限流
- 推理层：专门跑 ASR 模型
- 可选消息队列：做异步转发与扩展

---

## 9. 生产化建议

- 增加身份认证，避免开放接口被滥用
- 加入限流，防止大量连接打爆服务
- 增加日志和追踪，记录每次识别的耗时和错误
- 使用 `wss` 提供 HTTPS/WSS 安全传输
- 支持多用户并发，必要时做负载均衡

---

## 10. 推荐落地步骤

1. 先部署一个最小可用版本：
   - `/ws/asr/stream`
   - 只支持单连接、单用户
   - 返回实时文本和最终文本

2. 再接入当前前端：
   - 修改 WebSocket URL
   - 验证麦克风采集和识别结果显示正常

3. 最后做增强：
   - VAD
   - 标点
   - 鉴权
   - 负载均衡

---

## 11. 最终建议

如果你要快速上线，最合适的落地路径是：

- 后端：Python + FastAPI + FunASR
- 协议：WebSocket
- 输入：PCM16 16kHz 单声道
- 输出：`text` + `is_final` / `complete`

这条路径和你当前项目的前端实现最契合，改造成本低，且容易继续扩展。
