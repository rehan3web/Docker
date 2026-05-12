export const NVIDIA_MODELS = [
  { value: "openai/gpt-oss-120b",                                   label: "ChatGPT OSS 120B",         provider: "OpenAI",       thinking: true  },
  { value: "deepseek-ai/deepseek-v4-pro",                           label: "DeepSeek V4 Pro",          provider: "DeepSeek",     thinking: true  },
  { value: "moonshotai/kimi-k2-thinking",                           label: "Kimi K2 Thinking",         provider: "Moonshot AI",  thinking: true  },
  { value: "qwen/qwen3-next-80b-a3b-thinking",                      label: "Qwen3 80B Thinking",       provider: "Alibaba",      thinking: true  },
  { value: "qwen/qwen3.5-397b-a17b",                                label: "Qwen 3.5 397B",            provider: "Alibaba",      thinking: true  },
  { value: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",         label: "Nemotron 3 Nano 30B",      provider: "NVIDIA",       thinking: true  },
  { value: "google/gemma-3-27b-it",                                 label: "Gemma 3 27B",              provider: "Google",       thinking: false },
  { value: "google/gemma-3-12b-it",                                 label: "Gemma 3 12B",              provider: "Google",       thinking: false },
  { value: "meta/llama-3.1-8b-instruct",                            label: "Llama 3.1 8B",             provider: "Meta",         thinking: false },
  { value: "meta/llama-3.3-70b-instruct",                           label: "Llama 3.3 70B",            provider: "Meta",         thinking: false },
  { value: "mistralai/mistral-large-3-675b-instruct-2512",          label: "Mistral Large 3 675B",     provider: "Mistral AI",   thinking: false },
  { value: "stepfun-ai/step-3.5-flash",                             label: "Step 3.5 Flash",           provider: "Stepfun AI",   thinking: false },
] as const;

export type NvidiaModel = typeof NVIDIA_MODELS[number];
