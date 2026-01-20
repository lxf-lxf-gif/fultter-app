import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Brain, Plus, Trash2, Edit2, Check, X } from 'lucide-react';
// import { type AIProvider } from '../context/settingsStore';
import { useSettings } from '../context/useSettings';
import { useMemory } from '../context/useMemory';
import GlassCard from '../components/ui/GlassCard';
import { Input, Select } from '../components/ui/Input';
import Button from '../components/ui/Button';

const Settings: React.FC = () => {
  const { settings, updateSettings } = useSettings();
  const { memories, addMemory, removeMemory, toggleMemory, updateMemory } = useMemory();
  const [newMemory, setNewMemory] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  const handleAddMemory = () => {
    if (newMemory.trim()) {
      addMemory(newMemory);
      setNewMemory('');
    }
  };

  const startEdit = (id: string, content: string) => {
    setEditingId(id);
    setEditContent(content);
  };

  const saveEdit = (id: string) => {
    if (editContent.trim()) {
      updateMemory(id, editContent);
      setEditingId(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
      style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px', margin: '0 auto', width: '100%' }}
    >
      <header style={{ marginBottom: '8px' }}>
        <h1 className="text-gradient" style={{ fontSize: '2.4rem', margin: 0 }}>
          System Config
        </h1>
      </header>

      <GlassCard variant="panel" noPadding className="settings-card">
        <div className="settings-card-inner">
        <h3 style={{ marginTop: 0, marginBottom: '24px', color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.2rem' }}>
          <Sparkles size={20} /> AI 模型配置 (API Settings)
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          
          {/* --- 文本生成配置区域 --- */}
          <div className="section-text" style={{ padding: '24px', background: 'rgba(255,255,255,0.02)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <h4 style={{ margin: '0 0 20px 0', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.1rem' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--accent-cyan)', boxShadow: '0 0 10px var(--accent-cyan)' }}></span>
                核心模型配置 (Core Settings)
            </h4>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px', marginBottom: '24px' }}>
                <div className="config-group">
                  <Input
                    label="API Key (Bearer Token)" 
                    type="password"
                    value={settings.proxyToken}
                    onChange={(e) => updateSettings({ proxyToken: e.target.value })}
                    placeholder="sk-..."
                    fullWidth
                  />
                </div>
            </div>

            <div className="config-group" style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span className="config-label">默认模型 (Default Model)</span>
              </div>
                <Select
                  value={settings.model}
                  onChange={(e) => updateSettings({ model: e.target.value })}
                  options={[
                    {
                      label: "文本输出模型 (Text Output)",
                      options: [
                        { label: "Gemini 3 Flash (最新 GA版)", value: "gemini-3-flash" },
                        { label: "Gemini 2.5 Flash (稳定版)", value: "gemini-2.5-flash" },
                        { label: "Gemini 2.5 Flash Lite (轻量极速)", value: "gemini-2.5-flash-lite" },
                      ]
                    },
                    {
                      label: "Gemma 3 开源系列 (Gemma 3 Open Models)",
                      options: [
                        { label: "Gemma 3 27B (高性能)", value: "gemma-3-27b" },
                        { label: "Gemma 3 12B (平衡型)", value: "gemma-3-12b" },
                        { label: "Gemma 3 4B (端侧设备)", value: "gemma-3-4b" },
                        { label: "Gemma 3 1B (超轻量)", value: "gemma-3-1b" },
                      ]
                    },
                    {
                      label: "多模态/音频 (Multimodal & Audio)",
                      options: [
                        { label: "Gemini 2.5 Flash TTS (语音生成)", value: "gemini-2.5-flash-tts" },
                        { label: "Gemini 2.5 Live (实时对话)", value: "gemini-2.5-flash-native-audio-dialog" },
                      ]
                    },
                    {
                      label: "OpenAI Models (Proxy Only)",
                      options: [
                        { label: "GPT-4.1 (Preview)", value: "gpt-4.1" },
                        { label: "GPT-4o (Omni)", value: "gpt-4o" },
                      ]
                    },
                    {
                      label: "专用模型 (Specialized)",
                      options: [
                        { label: "Gemini Embedding 1.0 (向量嵌入)", value: "gemini-embedding-1.0" },
                        { label: "Robotics ER 1.5 Preview (机器人)", value: "gemini-robotics-er-1.5-preview" },
                      ]
                    }
                  ]}
                  fullWidth
                />
            </div>
          </div>

          {/* --- 图片生成配置区域 --- */}
          <div className="section-image" style={{ padding: '24px', background: 'rgba(255,255,255,0.02)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <h4 style={{ margin: '0 0 20px 0', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.1rem' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--accent-purple)', boxShadow: '0 0 10px var(--accent-purple)' }}></span>
                图片生成配置 (Image Generation)
            </h4>

            <div className="config-group" style={{ marginBottom: '20px' }}>
               <Select
                  label="Gemini 绘图模型 (Image Model)"
                  value={settings.imageModel}
                  onChange={(e) => updateSettings({ imageModel: e.target.value })}
                  options={[
                      { label: "Gemini 2.5 Flash Image (默认)", value: "gemini-2.5-flash-image" },
                      { label: "Gemini 2.5 Flash Image Preview", value: "gemini-2.5-flash-image-preview" },
                  ]}
                  fullWidth
               />
            </div>

            <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', borderLeft: '3px solid var(--accent-purple)' }}>
                 ℹ️ 图片生成服务将复用上方“核心模型配置”中的 API Endpoint 和 Token。
            </div>
          </div>
        </div>
        </div>
      </GlassCard>

      <GlassCard variant="panel" noPadding className="settings-card">
        <div className="settings-card-inner">
        <h3 style={{ marginTop: 0, marginBottom: '24px', color: 'var(--accent-purple)', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.2rem' }}>
          <Brain size={20} /> AI 记忆库 (Memory Bank)
        </h3>
        
        <div style={{ marginBottom: '24px', fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
          在这里记录您的品牌偏好、写作禁忌或特定事实。启用的记忆将被自动注入到 AI 上下文中，确保生成内容的一致性。
        </div>

        {/* Add Memory Input */}
        <div className="settings-add-memory">
          <Input
            value={newMemory}
            onChange={(e) => setNewMemory(e.target.value)}
            placeholder="例如：永远使用第一人称叙述，或者：禁止提及竞品X..."
            fullWidth
            onKeyDown={(e) => e.key === 'Enter' && handleAddMemory()}
          />
          <Button 
            variant="primary" 
            onClick={handleAddMemory}
            disabled={!newMemory.trim()}
            icon={<Plus size={18} />}
            style={{ height: 'auto', padding: '0 20px' }}
          >
            添加
          </Button>
        </div>

        {/* Memory List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {memories.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', color: 'var(--text-dim)' }}>
              暂无记忆条目
            </div>
          ) : (
            memories.map(memory => (
              <div 
                key={memory.id} 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '12px', 
                  padding: '12px 16px', 
                  background: memory.enabled ? 'rgba(56, 189, 248, 0.05)' : 'rgba(0,0,0,0.1)',
                  borderRadius: '12px',
                  border: '1px solid',
                  borderColor: memory.enabled ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.05)',
                  opacity: memory.enabled ? 1 : 0.6,
                  transition: 'all 0.2s'
                }}
              >
                <div 
                  onClick={() => toggleMemory(memory.id)}
                  style={{ 
                    cursor: 'pointer',
                    width: '20px', 
                    height: '20px', 
                    borderRadius: '50%', 
                    border: '2px solid',
                    borderColor: memory.enabled ? 'var(--accent-cyan)' : 'var(--text-dim)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                >
                  {memory.enabled && <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--accent-cyan)' }} />}
                </div>

                <div style={{ flex: 1, fontSize: '0.95rem' }}>
                  {editingId === memory.id ? (
                    <div className="settings-memory-edit-row">
                      <Input 
                        value={editContent} 
                        onChange={(e) => setEditContent(e.target.value)} 
                        autoFocus 
                        fullWidth
                        style={{ padding: '8px', fontSize: '0.9rem' }}
                        onKeyDown={(e) => e.key === 'Enter' && saveEdit(memory.id)}
                      />
                      <button onClick={() => saveEdit(memory.id)} style={{ background: 'none', border: 'none', color: '#10b981', cursor: 'pointer' }}><Check size={18} /></button>
                      <button onClick={() => setEditingId(null)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}><X size={18} /></button>
                    </div>
                  ) : (
                    <span style={{ color: memory.enabled ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                      {memory.content}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button 
                    onClick={() => startEdit(memory.id, memory.content)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', opacity: 0.7 }}
                    title="编辑"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button 
                    onClick={() => removeMemory(memory.id)}
                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', opacity: 0.7 }}
                    title="删除"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        </div>
      </GlassCard>

      <GlassCard variant="panel" noPadding className="settings-card">
        <div className="settings-card-inner settings-about">
        <h3 style={{ marginTop: 0, marginBottom: '16px', fontSize: '1.1rem' }}>关于 SEO Writer</h3>
        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.8', maxWidth: '600px', margin: '0 auto' }}>
          专为专业内容创作者设计的 SEO 优化写作工具。<br />
          集成了 Gemini Pro 1.5/3.0 的强大推理能力，支持智能锚文本植入及多语言 SEO 优化。
        </div>
        <div style={{ marginTop: '24px', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
          Version 2.0.0 (Pro) &bull; Built with React & Google Gemini
        </div>
        </div>
      </GlassCard>
    </motion.div>
  );
};

export default Settings;
