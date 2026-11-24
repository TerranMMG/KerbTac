import { en, zh, type MessageKey } from './strings'

export type Language = 'en' | 'zh'
export type { MessageKey }

const STORAGE_KEY = 'kerbtac.language'
const TABLES: Record<Language, Record<MessageKey, string>> = { en, zh }

function readStoredLanguage(): Language | null {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY)
    return value === 'en' || value === 'zh' ? value : null
  } catch {
    return null
  }
}

function detectLanguage(): Language {
  const stored = readStoredLanguage()
  if (stored) return stored
  const preferred = typeof navigator !== 'undefined' ? navigator.language : 'en'
  return preferred.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export type TranslateVars = Record<string, string | number>

/** Small synchronous i18n service with change notification and persistence. */
export class I18n {
  private language: Language
  private readonly listeners = new Set<() => void>()

  constructor(initial?: Language) {
    this.language = initial ?? detectLanguage()
  }

  get current(): Language {
    return this.language
  }

  set(language: Language): void {
    if (language === this.language) return
    this.language = language
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, language)
    } catch {
      // Storage can be unavailable under file:// in some browsers; persistence is optional.
    }
    for (const listener of this.listeners) listener()
  }

  toggle(): void {
    this.set(this.language === 'en' ? 'zh' : 'en')
  }

  t(key: MessageKey, vars?: TranslateVars): string {
    const table = TABLES[this.language]
    let text = table[key] ?? en[key] ?? key
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.split(`{${name}}`).join(String(value))
      }
    }
    return text
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export const i18n = new I18n()
