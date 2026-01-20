import React, { useState, useEffect } from 'react';
import { SettingsContext, type AIProvider, type SettingsState } from './settingsStore';

const defaultSettings: SettingsState = {
  aiProvider: 'proxy',
  proxyToken: '',
  proxyEndpoint: 'https://api.vectorengine.ai',
  model: 'gemini-2.0-flash-exp',

  imageModel: 'gemini-2.5-flash-image',
  
  isManualModel: false,
  language: 'Chinese',
  tone: 'Professional',
  wordCount: 1200,
  perspective: 'Second Person (You)',
  intent: 'Informational',
  enableThinking: false,
  enableImages: false,
  imageAspectRatio: '16:9',
  
  // GitHub defaults
  githubBranch: 'main',
  githubPath: 'content/posts'
};

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<SettingsState>(() => {
    // Lazy initialization from localStorage
    const loadedSettings: Partial<SettingsState> = {};
    const safeGet = (key: string) => localStorage.getItem(key);

    if (safeGet('seo_ai_provider')) loadedSettings.aiProvider = safeGet('seo_ai_provider') as AIProvider;
    if (safeGet('seo_proxy_token')) loadedSettings.proxyToken = safeGet('seo_proxy_token')!;
    if (safeGet('seo_proxy_endpoint')) loadedSettings.proxyEndpoint = safeGet('seo_proxy_endpoint')!;
    if (safeGet('seo_model')) loadedSettings.model = safeGet('seo_model')!;

    if (safeGet('seo_image_model')) loadedSettings.imageModel = safeGet('seo_image_model')!;

    if (safeGet('seo_language')) loadedSettings.language = safeGet('seo_language')!;
    if (safeGet('seo_tone')) loadedSettings.tone = safeGet('seo_tone')!;
    if (safeGet('seo_word_count')) loadedSettings.wordCount = Number(safeGet('seo_word_count'));
    if (safeGet('seo_perspective')) loadedSettings.perspective = safeGet('seo_perspective')!;
    if (safeGet('seo_intent')) loadedSettings.intent = safeGet('seo_intent')!;
    if (safeGet('seo_enable_thinking')) loadedSettings.enableThinking = safeGet('seo_enable_thinking') === 'true';
    if (safeGet('seo_enable_images')) loadedSettings.enableImages = safeGet('seo_enable_images') === 'true';
    if (safeGet('seo_image_aspect_ratio')) loadedSettings.imageAspectRatio = safeGet('seo_image_aspect_ratio')!;
    
    // Load GitHub settings
    if (safeGet('seo_github_token')) loadedSettings.githubToken = safeGet('seo_github_token')!;
    if (safeGet('seo_github_repo')) loadedSettings.githubRepo = safeGet('seo_github_repo')!;
    if (safeGet('seo_github_branch')) loadedSettings.githubBranch = safeGet('seo_github_branch')!;
    if (safeGet('seo_github_path')) loadedSettings.githubPath = safeGet('seo_github_path')!;

    return { ...defaultSettings, ...loadedSettings };
  });

  // Save to localStorage on change
  useEffect(() => {
    localStorage.setItem('seo_ai_provider', settings.aiProvider);
    localStorage.setItem('seo_proxy_token', settings.proxyToken);
    localStorage.setItem('seo_proxy_endpoint', settings.proxyEndpoint);
    localStorage.setItem('seo_model', settings.model);

    localStorage.setItem('seo_image_model', settings.imageModel);

    localStorage.setItem('seo_language', settings.language);
    localStorage.setItem('seo_tone', settings.tone);
    localStorage.setItem('seo_word_count', String(settings.wordCount));
    localStorage.setItem('seo_perspective', settings.perspective);
    localStorage.setItem('seo_intent', settings.intent);
    localStorage.setItem('seo_enable_thinking', String(settings.enableThinking));
    localStorage.setItem('seo_enable_images', String(settings.enableImages));
    localStorage.setItem('seo_image_aspect_ratio', settings.imageAspectRatio);
    
    // Save GitHub settings
    if (settings.githubToken) localStorage.setItem('seo_github_token', settings.githubToken);
    if (settings.githubRepo) localStorage.setItem('seo_github_repo', settings.githubRepo);
    if (settings.githubBranch) localStorage.setItem('seo_github_branch', settings.githubBranch);
    if (settings.githubPath) localStorage.setItem('seo_github_path', settings.githubPath);
  }, [settings]);

  const updateSettings = (updates: Partial<SettingsState>) => {
    setSettings(prev => ({ ...prev, ...updates }));
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};
