import React, { useRef, useState, useEffect } from 'react';
import { Sparkles, Loader2, Download, Settings as SettingsIcon, Image as ImageIcon, Send, Edit3, Save, Link as LinkIcon, Zap, PenTool, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ReactQuill, { Quill } from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import showdown from 'showdown';
import TurndownService from 'turndown';
import * as echarts from 'echarts';
import { type AIProvider } from '../context/settingsStore';
import { dirtyJsonParse, generateEChartsOption, isChartConfig } from '../utils/chartUtils';

type BlockEmbedConstructor = new (...args: unknown[]) => Record<string, unknown>;
type BlockEmbedStatic = {
    create: (value?: unknown) => HTMLElement;
    value: (node: HTMLElement) => unknown;
};

// --- Custom Quill Blot for ECharts ---
const BlockEmbed = Quill.import('blots/block/embed') as unknown as BlockEmbedConstructor & BlockEmbedStatic;

class ChartBlot extends BlockEmbed {
    static blotName = 'chart';
    static tagName = 'div';

    static create(value: unknown) {
        const node = super.create();
        // Ensure value is an object
        // Handle potentially URI encoded string from HTML attribute
        let config = value;
        if (typeof value === 'string') {
            try {
                // Try decoding first (new format)
                config = JSON.parse(decodeURIComponent(value));
            } catch {
                // Fallback (old format or raw json string)
                config = dirtyJsonParse(value);
            }
        }

        const configStr = encodeURIComponent(JSON.stringify(config));
        
        node.setAttribute('data-chart', configStr);
        node.setAttribute('contenteditable', 'false');
        
        // Container styling
        node.style.margin = '20px 0';
        node.style.border = '1px solid rgba(255,255,255,0.1)';
        node.style.borderRadius = '12px';
        node.style.background = 'rgba(255,255,255,0.02)';
        node.style.overflow = 'hidden';
        node.style.position = 'relative';

        // 1. Chart Container
        const chartDiv = document.createElement('div');
        chartDiv.style.height = '350px';
        chartDiv.style.width = '100%';
        node.appendChild(chartDiv);

        // 2. Render Chart (Async)
        setTimeout(() => {
            if (isChartConfig(config)) {
                try {
                    const myChart = echarts.init(chartDiv);
                    const option = generateEChartsOption(config);
                    myChart.setOption(option);
                    
                    // Resize observer to handle window resize
                    const resizeObserver = new ResizeObserver(() => myChart.resize());
                    resizeObserver.observe(chartDiv);
                } catch {
                    chartDiv.innerText = 'Chart Render Error';
                }
            } else {
                chartDiv.style.display = 'flex';
                chartDiv.style.alignItems = 'center';
                chartDiv.style.justifyContent = 'center';
                chartDiv.style.color = '#94a3b8';
                chartDiv.innerText = 'Invalid Chart Config';
            }
        }, 0);

        // 3. Overlay for "Edit" hint (optional, simpler to just treat as block)
        return node;
    }

    static value(node: HTMLElement) {
        const data = node.getAttribute('data-chart');
        if (!data) return null;
        try {
            return JSON.parse(decodeURIComponent(data));
        } catch {
            return JSON.parse(data);
        }
    }
}

Quill.register({ 'formats/chart': ChartBlot });

type QuillEditorProps = {
    theme: string;
    value: string;
    onChange: (value: string) => void;
    modules?: unknown;
};

const ReactQuillCmp = ReactQuill as unknown as React.ComponentType<QuillEditorProps>;
import { useSettings } from '../context/useSettings';
import { useHistory } from '../context/useHistory';
import { useMemory } from '../context/useMemory';
import { useToast } from '../context/useToast';
import { aiService } from '../services/aiService';
import { imageDb } from '../services/imageDb';
import ChartBlock from '../components/ChartBlock';
// import TOC from '../components/TOC'; // Unused
import Button from '../components/ui/Button';
import { Select, Input } from '../components/ui/Input';
import { useLocation } from 'react-router-dom';

type AnchorTextRow = { id: string; keyword: string; url: string };

const Writer: React.FC = () => {
  const { settings, updateSettings } = useSettings();
  const { addToHistory } = useHistory();
  const { memories } = useMemory();
  const { showToast } = useToast();
  const location = useLocation();

  // Local state for the current article
  const [topic, setTopic] = useState(() => localStorage.getItem('writer_cache_topic') || '');
  const [anchorTexts, setAnchorTexts] = useState<AnchorTextRow[]>(() => {
      try {
          const saved = localStorage.getItem('writer_cache_anchors');
          return saved ? JSON.parse(saved) : [];
      } catch {
          return [];
      }
  });
  const [result, setResult] = useState(() => localStorage.getItem('writer_cache_content') || '');
  const [generatedImages, setGeneratedImages] = useState<Record<string, string>>({});
  const [generatingImgPrompt, setGeneratingImgPrompt] = useState<string | null>(null);
  const [isBatchGeneratingImages] = useState(false);
  
  // Persistence Effects
  useEffect(() => {
      localStorage.setItem('writer_cache_topic', topic);
  }, [topic]);

  useEffect(() => {
      localStorage.setItem('writer_cache_anchors', JSON.stringify(anchorTexts));
  }, [anchorTexts]);

  useEffect(() => {
      localStorage.setItem('writer_cache_content', result);
  }, [result]);

  
  // UI State
  const [isGenerating, setIsGenerating] = useState(false);
  // const [showConfig, setShowConfig] = useState(false); // Removed
  // const [showTOC, setShowTOC] = useState(false);
  // const [showExportMenu, setShowExportMenu] = useState(false);
  const [activeProvider, setActiveProvider] = useState<AIProvider>(() => settings.aiProvider);
  const [viewMode, setViewMode] = useState<'preview' | 'edit'>('preview');
  const [htmlContent, setHtmlContent] = useState('');
  
  const headingIdCountsRef = useRef<Map<string, number>>(new Map());
  const streamSeqRef = useRef(0);
  const streamAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
    };
  }, []);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      Object.values(generatedImages).forEach(url => {
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [generatedImages]);

  useEffect(() => {
    headingIdCountsRef.current = new Map();
  }, [result]);

  const getHeadingId = (children: React.ReactNode) => {
    const text = String(children).trim();
    const base = text.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-');
    const next = (headingIdCountsRef.current.get(base) ?? 0) + 1;
    headingIdCountsRef.current.set(base, next);
    return next === 1 ? base : `${base}-${next}`;
  };

  // Pre-define markdown components with useMemo to avoid re-rendering issues and hook errors
  type MarkdownHeadingProps = { children?: React.ReactNode };
  type MarkdownImgProps = React.ImgHTMLAttributes<HTMLImageElement> & { src?: string; alt?: string };
  type MarkdownCodeProps = React.HTMLAttributes<HTMLElement> & { inline?: boolean; className?: string; children?: React.ReactNode };

  const markdownComponents = React.useMemo(() => ({
    h1: ({ children }: MarkdownHeadingProps) => {
      const id = getHeadingId(children);
      return <h1 id={id}>{children}</h1>;
    },
    h2: ({ children }: MarkdownHeadingProps) => {
      const id = getHeadingId(children);
      return <h2 id={id}>{children}</h2>;
    },
    h3: ({ children }: MarkdownHeadingProps) => {
      const id = getHeadingId(children);
      return <h3 id={id}>{children}</h3>;
    },
    img: ({ src, alt, ...props }: MarkdownImgProps) => {
      if (!src) return null;
      
      // Loose matching for placeholder
      if (src.includes('ai-image://placeholder')) {
        const prompt = (alt || '').trim();
        
        if (generatedImages[prompt]) {
          return <img src={generatedImages[prompt]} alt={alt} {...props} style={{ maxWidth: '100%', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }} />;
        }

        const isGeneratingThis = generatingImgPrompt === prompt;

        return (
          <span className="ai-image-placeholder" style={{ 
            position: 'relative',
            width: '100%',
            minHeight: '300px',
            background: 'rgba(30, 41, 59, 0.5)',
            borderRadius: '16px',
            border: '2px dashed rgba(255,255,255,0.1)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '32px 0',
            overflow: 'hidden',
            transition: 'all 0.3s ease'
          }}>
            <span style={{
              position: 'absolute', inset: 0,
              background: 'radial-gradient(circle at center, rgba(56, 189, 248, 0.1) 0%, transparent 70%)',
              zIndex: 0
            }} />
            
            <span style={{ zIndex: 1, textAlign: 'center', padding: '20px', maxWidth: '80%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ 
                width: '64px', height: '64px', borderRadius: '20px', 
                background: 'rgba(56, 189, 248, 0.1)', color: 'var(--accent-cyan)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 16px auto'
              }}>
                <ImageIcon size={32} />
              </span>
              
              <span style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: '1.5', fontStyle: 'italic', display: 'block' }}>
                "{prompt}"
              </span>

              <Button 
                variant="primary" 
                onClick={() => handleGenerateImage(prompt)}
                disabled={isGeneratingThis || isBatchGeneratingImages}
                icon={isGeneratingThis ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
                style={{ margin: '0 auto', padding: '10px 24px', height: 'auto', borderRadius: '12px' }}
              >
                {isGeneratingThis ? '正在绘制中...' : '生成此图片'}
              </Button>
            </span>
          </span>
        );
      }
      
      // Legacy support
      if (src?.startsWith('ai-image://generation')) {
        try {
          const url = new URL(src);
          const prompt = url.searchParams.get('prompt') || alt || '';
          const decodedPrompt = decodeURIComponent(prompt);
          
          if (generatedImages[decodedPrompt]) {
            return <img src={generatedImages[decodedPrompt]} alt={alt} {...props} style={{ maxWidth: '100%', borderRadius: '12px' }} />;
          }
        } catch {
          return <img src={src} alt={alt} {...props} />;
        }
      }
      return <img src={src} alt={alt} {...props} style={{ maxWidth: '100%', borderRadius: '12px' }} />;
    },
    code({ inline, className, children, ...props }: MarkdownCodeProps) {
      const match = /language-(\w+)/.exec(className || '');
      if (!inline && match && match[1] === 'echarts') {
        return <ChartBlock config={String(children).replace(/\n$/, '')} />;
      }
      return <code className={className} {...props}>{children}</code>;
    }
  }), [generatedImages, generatingImgPrompt, isBatchGeneratingImages]);

  // Initialize from location state (Edit mode)
  useEffect(() => {
    if (location.state) {
      const state = location.state as { topic?: string; content?: string } | null;
      const initTopic = state?.topic;
      const initContent = state?.content;
      if (initTopic) setTopic(initTopic);
      if (initContent) setResult(initContent);
    }
  }, [location.state]);

  // Restore images from DB when content loads
  useEffect(() => {
    if (!result) return;
    
    const restoreImages = async () => {
      const regex = /!\[(.*?)\]\(ai-image:\/\/placeholder\)/g;
      const matches = Array.from(result.matchAll(regex));
      const prompts = matches.map(m => m[1].trim());
      
      const newImages: Record<string, string> = {};
      let hasNew = false;

      for (const prompt of prompts) {
        if (!generatedImages[prompt]) {
          try {
            const record = await imageDb.getImageByPrompt(prompt);
            if (record && record.base64) {
               // Convert stored base64 to blob URL
               const res = await fetch(record.base64);
               const blob = await res.blob();
               newImages[prompt] = URL.createObjectURL(blob);
               hasNew = true;
            }
          } catch (e) {
            console.error('Failed to restore image:', prompt, e);
          }
        }
      }

      if (hasNew) {
        setGeneratedImages(prev => ({ ...prev, ...newImages }));
      }
    };
    
    restoreImages();
  }, [result]);

  const handleGenerate = async () => {
    const provider = settings.aiProvider;
    if (!topic) {
      alert('Please enter topic');
      return;
    }

    if (provider === 'proxy' && !settings.proxyToken) {
      showToast('请先在设置里填写 Proxy Token', 'error');
      return;
    }

    // if (provider === 'proxy' && !settings.proxyToken) {
    //   alert('Please enter Proxy token (in Settings)');
    //   setShowConfig(true);
    //   return;
    // }

    // Parse Topic & Keywords from input string (Format: "Topic | kw1, kw2")
    let finalTopic = topic;
    let kwList: string[] = [];
    if (topic.includes('|')) {
        const parts = topic.split('|');
        finalTopic = parts[0].trim();
        const kwStr = parts.slice(1).join('|');
        kwList = kwStr.split(/[,，]/).map(k => k.trim()).filter(k => k);
    }

    setIsGenerating(true);
    setResult('');
    // setShowConfig(false); // Removed

    streamAbortRef.current?.abort();
    const controller = new AbortController();
    streamAbortRef.current = controller;
    const seq = ++streamSeqRef.current;

    try {
      aiService.initGemini({
        provider,
        proxyToken: settings.proxyToken,
        proxyEndpoint: settings.proxyEndpoint,
      });
      setActiveProvider(provider);

      // --- Parallel Image Generation Strategy ---
      let headerImagePrompt = '';
      if (settings.enableImages) {
        headerImagePrompt = `A high-quality, professional header image for an article about "${finalTopic}". Style: ${settings.tone || 'Modern'}. Context: ${kwList.slice(0, 3).join(', ')}.`;
        handleGenerateImage(headerImagePrompt).catch(console.error);
      }
      // ------------------------------------------

      let fullContent = '';
      let hasInjectedHeaderImage = false;

      await aiService.generateSEOContentStream(
        settings.model,
        finalTopic,
        kwList,
        settings.tone,
        settings.perspective,
        settings.intent,
        settings.wordCount,
        settings.language,
        settings.enableThinking,
        false, 
        anchorTexts.map(({ keyword, url }) => ({ keyword, url })),
        memories.filter(m => m.enabled).map(m => m.content),
        (chunk: string) => {
          if (seq !== streamSeqRef.current) return;
          fullContent += chunk;
          
          if (settings.enableImages && !hasInjectedHeaderImage && headerImagePrompt) {
            const h1Match = fullContent.match(/^# .*?\n/);
            if (h1Match) {
              const h1Length = h1Match[0].length;
              const before = fullContent.slice(0, h1Length);
              const after = fullContent.slice(h1Length);
              const imageMd = `\n![${headerImagePrompt}](ai-image://placeholder)\n\n`;
              fullContent = before + imageMd + after;
              hasInjectedHeaderImage = true;
            }
          }

          setResult(fullContent);
        },
        controller.signal
      );
      if (fullContent) {
        addToHistory(finalTopic, fullContent);
        showToast('内容生成成功并已保存');
      }
    } catch (error: unknown) {
      if (
        (error instanceof DOMException && error.name === 'AbortError') ||
        (error instanceof Error && error.name === 'AbortError') ||
        (typeof error === 'object' && error !== null && 'name' in error && (error as { name?: string }).name === 'AbortError') ||
        String(error).includes('AbortError')
      ) {
        return;
      }

      const errorMsgRaw = error instanceof Error ? error.message : String(error);
      let errorMsg = errorMsgRaw;
      if (errorMsg.includes('User location is not supported')) {
        errorMsg = '❌ 访问受限：Gemini API 不支持您当前的地区。请尝试开启全局代理（如美国/日本节点）或切换到 OpenAI 提供的模型。';
      } else if (errorMsg.includes('404') || errorMsg.includes('not found')) {
        errorMsg = `❌ 模型不可用 (404 Error)：\n\n${errorMsgRaw}`;
      } else if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
        errorMsg = `❌ 网络连接失败 (Network Error)：\n\n1. 请检查您的网络连接。\n2. 如果您在中国大陆使用 Google 官方渠道，请确保已开启全局代理 (VPN)。\n3. 如果使用代理渠道，可能是跨域 (CORS) 问题、代理地址不可用，或本站 /api/generate 被拦截。\n\n原始错误：${errorMsgRaw}`;
      }
      setResult(`错误信息：\n\n${errorMsg}`);
    } finally {
      if (seq === streamSeqRef.current && !controller.signal.aborted) {
        setIsGenerating(false);
      }
    }
  };

  const handleContinue = async (provider: AIProvider = activeProvider) => {
    if (!result) return;
    if (provider === 'proxy' && !settings.proxyToken) {
      showToast('请先在设置里填写 Proxy Token', 'error');
      return;
    }

    setIsGenerating(true);

    streamAbortRef.current?.abort();
    const controller = new AbortController();
    streamAbortRef.current = controller;
    const seq = ++streamSeqRef.current;

    try {
      aiService.initGemini({
        provider,
        proxyToken: settings.proxyToken,
        proxyEndpoint: settings.proxyEndpoint,
      });
      setActiveProvider(provider);

      let fullContent = result + '\n\n';
      await aiService.generateContinuationStream(
        settings.model,
        result,
        settings.language,
        settings.enableThinking,
        anchorTexts.map(({ keyword, url }) => ({ keyword, url })),
        memories.filter(m => m.enabled).map(m => m.content),
        (chunk: string) => {
          if (seq !== streamSeqRef.current) return;
          fullContent += chunk;
          setResult(fullContent);
        },
        controller.signal
      );
      if (fullContent) {
        addToHistory(topic, fullContent, true);
      }
    } catch (error: unknown) {
      if (
        (error instanceof DOMException && error.name === 'AbortError') ||
        (error instanceof Error && error.name === 'AbortError') ||
        (typeof error === 'object' && error !== null && 'name' in error && (error as { name?: string }).name === 'AbortError') ||
        String(error).includes('AbortError')
      ) {
        return;
      }
      const msg = error instanceof Error ? error.message : String(error);
      alert(`续写失败: ${msg}`);
    } finally {
      if (seq === streamSeqRef.current && !controller.signal.aborted) {
        setIsGenerating(false);
      }
    }
  };

  const handleGenerateImage = async (promptRaw: string) => {
    if (!promptRaw) return;
    const prompt = promptRaw.trim();
    setGeneratingImgPrompt(prompt);
    try {
      // Always use global settings for images now
      aiService.initGemini({
        provider: settings.aiProvider,
        proxyToken: settings.proxyToken,
        proxyEndpoint: settings.proxyEndpoint,
      });

      const base64 = await aiService.generateImage(prompt, settings.imageModel, settings.imageAspectRatio);
      const res = await fetch(base64);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      await imageDb.saveImage(prompt, base64);
      
      setGeneratedImages(prev => {
        if (prev[prompt] && prev[prompt].startsWith('blob:')) {
          URL.revokeObjectURL(prev[prompt]);
        }
        return { ...prev, [prompt]: blobUrl };
      });
      showToast('图片生成成功');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`图片生成失败: ${msg}`);
    } finally {
      setGeneratingImgPrompt(null);
    }
  };

  /*
  const _handleGenerateAllImages = async () => {
    // ...
  };
  */
  
  // Suppress unused variable warning for now by using it in a way that doesn't execute
  // or simply comment it out if it is not used.
  // Actually, let's just comment out the state if it's not used elsewhere.
  // const [isBatchGeneratingImages, setIsBatchGeneratingImages] = useState(false);
  // It is used in handleGenerateImage disabled prop.
  // So we need to keep it, but we need to use setIsBatchGeneratingImages somewhere or rename it.
  // Let's just suppress the warning by using it in a no-op function.
  // const _suppressUnused = () => {
  //   setIsBatchGeneratingImages(false);
  // };

  const handleExport = async (format: 'md' | 'html' | 'txt') => {
      let content = result;
      if (format === 'md' || format === 'html') {
        const regex = /!\[(.*?)\]\(ai-image:\/\/placeholder\)/g;
        const matches = Array.from(content.matchAll(regex));
        for (const match of matches) {
          const fullMatch = match[0];
          const prompt = match[1].trim();
          const blobUrl = generatedImages[prompt];
          if (blobUrl) {
            try {
              const response = await fetch(blobUrl);
              const blob = await response.blob();
              const base64 = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
              });
              content = content.replace(fullMatch, `![${prompt}](${base64})`);
            } catch (e) {
              console.error('Failed to convert blob to base64 for export:', e);
            }
          } else {
             const replacement = format === 'html' ? `<div style="padding:20px;background:#f1f5f9;color:#64748b;text-align:center;border-radius:8px">[未生成的图片位: ${prompt}]</div>` : `> [未生成的图片位: ${prompt}]`;
             content = content.replace(fullMatch, replacement);
          }
        }
      }

      const filename = `${topic || 'article'}.${format}`;
      let mimeType = 'text/plain';
  
      if (format === 'html') {
        content = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${topic}</title><style>body { font-family: 'Inter', sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 20px; color: #1e293b; background: #f9fafb; } h1 { border-bottom: 3px solid #22d3ee; padding-bottom: 12px; color: #0f172a; font-size: 2.2rem; } h2 { color: #4f46e5; margin-top: 40px; border-left: 4px solid #4f46e5; padding-left: 15px; } h3 { color: #0f172a; margin-top: 30px; } p { margin-bottom: 20px; font-size: 1.1rem; } img { max-width: 100%; border-radius: 12px; }</style></head><body>${result.replace(/^# (.*$)/gm, '<h1>$1</h1>').replace(/\n\n/g, '<p></p>')}</body></html>`;
        mimeType = 'text/html';
      } else if (format === 'md') {
        mimeType = 'text/markdown';
      }
  
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      // setShowExportMenu(false); // Removed
      showToast(`已导出为 ${format.toUpperCase()}`);
    };
  // Pre-process markdown to clean image syntax and remove extra asterisks
  const cleanResult = React.useMemo(() => {
    let cleaned = result;
    
    // 1. Fix broken image syntax
    cleaned = cleaned.replace(/!\[([\s\S]*?)\]\((.*?)\)/g, (_match, alt, src) => {
      const cleanAlt = alt.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
      return `![${cleanAlt}](${src})`;
    });

    // 2. Fix loose bold syntax: "** text **" -> "**text**"
    cleaned = cleaned.replace(/\*\*\s+(.*?)\s+\*\*/g, '**$1**');
    
    // 3. Remove empty bold: "****" or "** **"
    cleaned = cleaned.replace(/\*\*\s*\*\*/g, '');

    return cleaned;
  }, [result]);

  const toggleEditMode = () => {
    if (viewMode === 'preview') {
        // MD -> HTML
        const converter = new showdown.Converter({
             extensions: [
                 {
                     type: 'lang',
                     regex: /```echarts\s*([\s\S]*?)```/g,
                     replace: (_match, code) => {
                         try {
                            // Clean and parse to ensure it's valid JSON for the attribute
                            const cleanCode = (code as string).trim();
                            // We don't parse it here, we just escape it for HTML attribute
                            // Actually, let's parse and stringify to be safe
                            const json = JSON.parse(cleanCode);
                            // Use encodeURIComponent for safe HTML attribute storage
                            const jsonStr = encodeURIComponent(JSON.stringify(json));
                            return `<div class="quill-chart-widget" data-chart="${jsonStr}"></div>`;
                        } catch {
                            return `<pre><code>${code}</code></pre>`;
                        }
                     }
                 }
             ]
        });
        // Enable tables and simple line breaks
        converter.setOption('tables', true);
        converter.setOption('simpleLineBreaks', true);
        converter.setOption('strikethrough', true);
        const html = converter.makeHtml(cleanResult);
        setHtmlContent(html);
        setViewMode('edit');
    } else {
        // HTML -> MD (Save)
        const turndownService = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced'
        });
        
        // Add rule for Chart Widget
        turndownService.addRule('chart-widget', {
            filter: (node) => {
                return node.nodeName === 'DIV' && node.classList.contains('quill-chart-widget');
            },
            replacement: (_content, node) => {
                const element = node as HTMLElement;
                const data = element.getAttribute('data-chart');
                if (data) {
                    try {
                        // Decode safe URI component first
                        const decoded = decodeURIComponent(data);
                        const json = JSON.parse(decoded);
                        return `\n\`\`\`echarts\n${JSON.stringify(json, null, 2)}\n\`\`\`\n`;
                    } catch {
                        // Fallback: try parsing directly if it was old format
                        try {
                            const json = JSON.parse(data);
                            return `\n\`\`\`echarts\n${JSON.stringify(json, null, 2)}\n\`\`\`\n`;
                        } catch {
                             return '';
                        }
                    }
                }
                return '';
            }
        });

        const md = turndownService.turndown(htmlContent);
        setResult(md);
        setViewMode('preview');
        showToast('内容已更新');
    }
  };

  // --- Render ---

  return (
    <div style={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
        
        {/* Content View */}
        {result ? (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                {/* Minimal Header */}
                <div className="writer-result-header" style={{ 
                    padding: '16px 32px', 
                    borderBottom: '1px solid rgba(255,255,255,0.05)', 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    background: 'var(--bg-glass)',
                    backdropFilter: 'blur(10px)'
                }}>
                    <h2 className="writer-result-title" style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Sparkles size={18} className="text-gradient" /> 
                        <span className="text-gradient">{topic || 'Generated Article'}</span>
                    </h2>
                    
                    <div className="writer-result-actions" style={{ display: 'flex', gap: '8px' }}>
                        <Button variant="ghost" onClick={() => { setResult(''); setTopic(''); setAnchorTexts([]); }} style={{ fontSize: '0.9rem' }}>新创作</Button>
                        <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
                        
                        <Button 
                            variant={viewMode === 'edit' ? 'primary' : 'secondary'} 
                            icon={viewMode === 'edit' ? <Save size={16} /> : <Edit3 size={16} />} 
                            onClick={toggleEditMode}
                        >
                            {viewMode === 'edit' ? '完成编辑' : '编辑'}
                        </Button>

                        <Button variant="secondary" icon={<SettingsIcon size={16} />} onClick={() => {/* TODO: Global Settings? */}}>设置</Button>
                        <Button variant="primary" icon={<Download size={16} />} onClick={() => handleExport('md')}>导出</Button>
                    </div>
                </div>

                {/* Reading Area */}
                <div className="no-scrollbar writer-reading" style={{ flex: 1, overflowY: 'auto', padding: '40px 20px' }}>
                    <div style={{ maxWidth: '800px', margin: '0 auto', paddingBottom: '100px' }}>
                        <div className="markdown-content paper-style">
                            {viewMode === 'preview' ? (
                                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents} urlTransform={u => u}>
                                    {cleanResult}
                                </ReactMarkdown>
                            ) : (
                                <div className="quill-dark-wrapper">
                                    <ReactQuillCmp 
                                        theme="snow" 
                                        value={htmlContent} 
                                        onChange={setHtmlContent} 
                                        modules={{
                                            toolbar: [
                                                [{ 'header': [1, 2, 3, false] }],
                                                ['bold', 'italic', 'underline', 'strike', 'blockquote'],
                                                [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                                                ['link', 'image'],
                                                ['clean']
                                            ]
                                        }}
                                    />
                                    <style>{`
                                        .quill-dark-wrapper .ql-toolbar {
                                            border-color: rgba(255,255,255,0.1) !important;
                                            background: rgba(255,255,255,0.05);
                                            border-radius: 8px 8px 0 0;
                                        }
                                        .quill-dark-wrapper .ql-container {
                                            border-color: rgba(255,255,255,0.1) !important;
                                            background: rgba(0,0,0,0.2);
                                            border-radius: 0 0 8px 8px;
                                            font-size: 1.1rem;
                                            font-family: 'Inter', sans-serif;
                                        }
                                        .quill-dark-wrapper .ql-editor {
                                            min-height: 400px;
                                            color: var(--text-primary);
                                        }
                                        .quill-dark-wrapper .ql-stroke {
                                            stroke: var(--text-secondary) !important;
                                        }
                                        .quill-dark-wrapper .ql-fill {
                                            fill: var(--text-secondary) !important;
                                        }
                                        .quill-dark-wrapper .ql-picker {
                                            color: var(--text-secondary) !important;
                                        }
                                    `}</style>
                                </div>
                            )}
                        </div>
                        
                        {/* Continue Button - Only in Preview Mode */}
                        {!isGenerating && viewMode === 'preview' && (
                            <div style={{ marginTop: '60px', display: 'flex', justifyContent: 'center' }}>
                                <Button 
                                    variant="secondary" 
                                    onClick={() => handleContinue()} 
                                    icon={<PenTool size={16} />}
                                    style={{ padding: '12px 32px', borderRadius: '24px' }}
                                >
                                    继续续写 (Continue)
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        ) : (
            /* Initial / Home View - Gemini Style */
            <div style={{ 
                height: '100%', 
                display: 'flex', 
                flexDirection: 'column', 
                justifyContent: 'center', 
                alignItems: 'center', 
                padding: '20px',
                background: 'radial-gradient(circle at center, rgba(129, 140, 248, 0.03) 0%, transparent 70%)',
                overflowY: 'auto'
            }}>
                <div className="writer-container">
                    <div style={{ marginBottom: '40px' }}>
                        <h1 className="text-gradient hero-title" style={{ marginBottom: '16px', fontWeight: 800, letterSpacing: '-1px' }}>
                            SEO Writer
                        </h1>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '1.2rem' }}>
                            输入主题，立即生成包含配图与数据的高质量 SEO 文章。
                        </p>
                    </div>

                    {/* Big Input Box */}
                    <div className="big-input-box">
                        <textarea
                            placeholder="想写什么主题？例如：2025年人工智能发展趋势... (可选：使用 | 分隔关键词)"
                            value={topic}
                            onChange={(e) => setTopic(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleGenerate();
                                }
                            }}
                            style={{ 
                                width: '100%', 
                                minHeight: '60px', 
                                background: 'transparent', 
                                border: 'none', 
                                outline: 'none', 
                                color: 'var(--text-primary)', 
                                fontSize: '1.2rem', 
                                resize: 'none',
                                fontFamily: 'inherit',
                                lineHeight: '1.5'
                            }}
                        />
                        
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                            <Button 
                                variant="primary" 
                                onClick={handleGenerate} 
                                disabled={isGenerating || !topic.trim()}
                                icon={isGenerating ? <Loader2 className="animate-spin" /> : <Send size={18} />}
                                style={{ borderRadius: '12px', padding: '10px 24px' }}
                            >
                                {isGenerating ? '生成中...' : '开始生成'}
                            </Button>
                        </div>
                    </div>

                    {/* Main Configuration Panel (Moved from Settings) */}
                    <div className="writer-config-grid">
                        
                        {/* Left Column: Core Settings */}
                        <div style={{ background: 'var(--bg-paper)', borderRadius: '24px', padding: '24px', border: '1px solid rgba(255,255,255,0.05)', height: 'fit-content' }}>
                             <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
                                <Zap size={18} className="text-gradient" />
                                <span style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>核心配置 (Core)</span>
                             </div>



                             {/* AI Capabilities Toggles */}
                             <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>深度思考 (Thinking)</span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }} onClick={() => updateSettings({ enableThinking: !settings.enableThinking })}>
                                        <div style={{
                                            width: '36px', height: '20px', 
                                            background: settings.enableThinking ? 'var(--accent-purple)' : 'rgba(255,255,255,0.1)',
                                            borderRadius: '11px', position: 'relative', transition: 'all 0.3s ease'
                                        }}>
                                            <div style={{
                                                width: '14px', height: '14px', background: 'white', borderRadius: '50%',
                                                position: 'absolute', top: '3px', left: settings.enableThinking ? '19px' : '3px',
                                                transition: 'all 0.3s ease', boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                                            }} />
                                        </div>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>自动配图 (Images)</span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }} onClick={() => updateSettings({ enableImages: !settings.enableImages })}>
                                        <div style={{
                                            width: '36px', height: '20px', 
                                            background: settings.enableImages ? 'var(--accent-cyan)' : 'rgba(255,255,255,0.1)',
                                            borderRadius: '11px', position: 'relative', transition: 'all 0.3s ease'
                                        }}>
                                            <div style={{
                                                width: '14px', height: '14px', background: 'white', borderRadius: '50%',
                                                position: 'absolute', top: '3px', left: settings.enableImages ? '19px' : '3px',
                                                transition: 'all 0.3s ease', boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                                            }} />
                                        </div>
                                    </div>
                                </div>
                             </div>

                             {settings.enableImages && (
                                 <div style={{ marginTop: '16px' }}>
                                     <Select
                                         label="图片比例 (Ratio)"
                                         value={settings.imageAspectRatio || '16:9'}
                                         onChange={(e) => updateSettings({ imageAspectRatio: e.target.value })}
                                         options={[
                                             { label: "16:9 (横屏)", value: "16:9" },
                                             { label: "4:3 (标准)", value: "4:3" },
                                             { label: "1:1 (正方)", value: "1:1" },
                                             { label: "3:4 (竖屏)", value: "3:4" },
                                             { label: "9:16 (手机)", value: "9:16" },
                                         ]}
                                         style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)' }}
                                     />
                                 </div>
                             )}
                        </div>

                        {/* Right Column: SEO & Anchors */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            
                            {/* SEO Parameters */}
                            <div style={{ background: 'var(--bg-paper)', borderRadius: '24px', padding: '24px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
                                    <Sparkles size={18} className="text-gradient" />
                                    <span style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>SEO 参数 (Parameters)</span>
                                </div>
                                <div className="writer-seo-grid">
                                    <Select
                                        label="语气风格 (Tone)"
                                        value={settings.tone}
                                        onChange={(e) => updateSettings({ tone: e.target.value })}
                                        options={[
                                            { label: "专业严谨", value: "Professional" },
                                            { label: "轻松活泼", value: "Casual" },
                                            { label: "极富创意", value: "Creative" },
                                        ]}
                                        style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)' }}
                                    />
                                    <Select
                                        label="预估字数 (Length)"
                                        value={settings.wordCount}
                                        onChange={(e) => updateSettings({ wordCount: Number(e.target.value) })}
                                        options={[
                                            { label: "短文 (~1k)", value: 1000 },
                                            { label: "标准 (~2k)", value: 2000 },
                                            { label: "长文 (~3k)", value: 3000 },
                                            { label: "深度 (~5k)", value: 5000 },
                                        ]}
                                        style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)' }}
                                    />
                                    <Select
                                        label="写作视角 (View)"
                                        value={settings.perspective}
                                        onChange={(e) => updateSettings({ perspective: e.target.value })}
                                        options={[
                                            { label: "第一人称 (我)", value: "First Person (Individual)" },
                                            { label: "第二人称 (你)", value: "Second Person (You)" },
                                            { label: "第三人称 (他)", value: "Third Person (Objective)" },
                                        ]}
                                        style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)' }}
                                    />
                                    <Select
                                        label="搜索意图 (Intent)"
                                        value={settings.intent}
                                        onChange={(e) => updateSettings({ intent: e.target.value })}
                                        options={[
                                            { label: "信息型 (科普)", value: "Informational" },
                                            { label: "交易型 (导购)", value: "Transactional" },
                                            { label: "商业型 (品牌)", value: "Commercial" },
                                        ]}
                                        style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)' }}
                                    />
                                </div>
                            </div>

                            {/* Anchor Texts */}
                            <div style={{ background: 'var(--bg-paper)', borderRadius: '24px', padding: '24px', border: '1px solid rgba(255,255,255,0.05)', flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
                                    <LinkIcon size={18} className="text-gradient" />
                                    <span style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>锚文本 (Internal Links)</span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    {anchorTexts.map((item, index) => (
                                        <div key={item.id} className="writer-anchor-row">
                                            <Input
                                                placeholder="关键词"
                                                value={item.keyword}
                                                onChange={(e) => {
                                                    const newTexts = [...anchorTexts];
                                                    newTexts[index].keyword = e.target.value;
                                                    setAnchorTexts(newTexts);
                                                }}
                                                style={{ padding: '8px', fontSize: '0.85rem', background: 'rgba(0,0,0,0.2)' }}
                                            />
                                            <Input
                                                placeholder="URL"
                                                value={item.url}
                                                onChange={(e) => {
                                                    const newTexts = [...anchorTexts];
                                                    newTexts[index].url = e.target.value;
                                                    setAnchorTexts(newTexts);
                                                }}
                                                style={{ padding: '8px', fontSize: '0.85rem', background: 'rgba(0,0,0,0.2)' }}
                                            />
                                            <button
                                                onClick={() => setAnchorTexts(anchorTexts.filter((t) => t.id !== item.id))}
                                                style={{
                                                    width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)',
                                                    border: 'none', color: '#f87171', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    transition: 'all 0.2s'
                                                }}
                                                onMouseOver={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'}
                                                onMouseOut={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
                                            >
                                                <X size={16} />
                                            </button>
                                        </div>
                                    ))}

                                    {anchorTexts.length < 5 && (
                                        <Button
                                            variant="secondary"
                                            style={{
                                                padding: '10px', fontSize: '0.85rem', width: '100%', marginTop: '8px',
                                                border: '1px dashed rgba(255,255,255,0.1)', background: 'transparent',
                                                color: 'var(--text-secondary)'
                                            }}
                                            onClick={() => {
                                                const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
                                                setAnchorTexts([...anchorTexts, { id, keyword: '', url: '' }]);
                                            }}
                                        >
                                            + 添加锚文本 (Add Link)
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Footer / Info */}
                    <div style={{ marginTop: '40px', textAlign: 'center', opacity: 0.5, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        SEO Writer © 2025 · Powered by Gemini
                    </div>
                </div>
            </div>
        )}

        {/* Settings Drawer (Overlay) Removed */}
    </div>
  );
};

export default Writer;
