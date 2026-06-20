import { useState, useEffect, useCallback, useRef } from 'react';

export interface IntegrityData {
  tab_switches: number;
  paste_attempts: number;
  extension_detected: boolean;
  programmatic_inputs: number;
  suspicion_level: 'clean' | 'low' | 'medium' | 'high';
}

// Globals expostos quando o script roda com @grant (Violentmonkey, Tampermonkey, Greasemonkey)
const EXTENSION_GLOBALS = [
  'GM', 'GM_info', 'GM_getValue', 'GM_setValue', 'GM_deleteValue',
  'GM_listValues', 'GM_xmlhttpRequest', 'GM_openInTab', 'GM_notification',
  'GM_setClipboard', 'GM_getResourceText', 'GM_addStyle',
  'unsafeWindow', 'cloneInto', 'exportFunction',
  // Tampermonkey
  'TM_info', '__ViolentMonkeyNativeRequest__',
  // Indicadores de userscript manager ativo no contexto da página
  '_TM_', '_GM_', 'tampermonkey', 'violentmonkey',
];

// Verifica se algum global de extensão vazou para window (scripts com @grant)
function detectExtensionGlobals(): boolean {
  return EXTENSION_GLOBALS.some(g => {
    try { return g in window; } catch { return false; }
  });
}

// Verifica se APIs nativas foram substituídas por wrappers de extensão.
// Scripts com @grant none rodam no contexto da página e podem envolver funções.
function detectWrappedAPIs(): boolean {
  try {
    // fetch envolvido: toString() de função nativa contém "[native code]"
    const fetchStr = window.fetch?.toString() ?? '';
    if (fetchStr && !fetchStr.includes('[native code]')) return true;

    // XMLHttpRequest.open envolvido (usado para capturar/enviar respostas)
    const xhrStr = XMLHttpRequest.prototype.open?.toString() ?? '';
    if (xhrStr && !xhrStr.includes('[native code]')) return true;
  } catch { /* silencioso */ }
  return false;
}

function detectExtension(): boolean {
  return detectExtensionGlobals() || detectWrappedAPIs();
}

export function useIntegrityMonitor(active: boolean) {
  const [tabSwitches, setTabSwitches] = useState(0);
  const [pasteAttempts, setPasteAttempts] = useState(0);
  const [extensionDetected, setExtensionDetected] = useState(false);
  const [programmaticInputs, setProgrammaticInputs] = useState(0);

  const lastKeystrokeRef = useRef<number>(0);
  // Conta teclas reais para calcular velocidade de digitação
  const keystrokeCountRef = useRef<number>(0);
  const windowStartRef = useRef<number>(Date.now());

  // Detecta extensões periodicamente (lazy-load e @grant none não aparecem de imediato)
  useEffect(() => {
    if (!active) return;
    const check = () => { if (detectExtension()) setExtensionDetected(true); };
    check();
    const id = setInterval(check, 1000);
    return () => clearInterval(id);
  }, [active]);

  // Saídas de aba/janela
  useEffect(() => {
    if (!active) return;
    const onVis = () => { if (document.visibilityState === 'hidden') setTabSwitches(n => n + 1); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [active]);

  // Registra digitação real — só conta eventos confiáveis (isTrusted = browser)
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.nativeEvent as KeyboardEvent).isTrusted) {
      lastKeystrokeRef.current = Date.now();
      keystrokeCountRef.current += 1;
    }
  }, []);

  // Bloqueia paste e conta a tentativa (paste não-confiável também conta)
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    setPasteAttempts(n => n + 1);
  }, []);

  // Detecta injeção programática via três sinais:
  //  1. isTrusted = false → evento disparado por script (execCommand, dispatchEvent)
  //  2. Muitos chars de uma vez sem tecla recente (bloco colado via script)
  //  3. Velocidade impossível: >12 chars/s num intervalo de 3 s sem teclas correspondentes
  const handleInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const ev = e.nativeEvent as InputEvent;

    // Sinal 1: evento não confiável — definitivamente gerado por script
    if (!ev.isTrusted) {
      setProgrammaticInputs(n => n + 1);
      return;
    }

    const now = Date.now();
    const msSinceLastKey = now - lastKeystrokeRef.current;
    const charsAdded = ev.data?.length ?? 0;

    // Sinal 2: bloco muito grande sem tecla recente E sem composição IME/voz.
    // Limiar alto (150) para não penalizar ditado por voz ou swipe keyboard,
    // que inserem palavras/frases inteiras via onChange legítimo (isTrusted=true).
    const isCompositionInput = ev.inputType?.startsWith('insert') && (
      ev.inputType === 'insertFromComposition' ||
      ev.inputType === 'insertReplacementText'
    );
    if (charsAdded > 150 && msSinceLastKey > 500 && !isCompositionInput) {
      setProgrammaticInputs(n => n + 1);
      return;
    }

    // Sinal 3: janela deslizante de 3 s — velocidade de digitação impossível para humanos
    const windowMs = now - windowStartRef.current;
    if (windowMs >= 3000) {
      const cps = keystrokeCountRef.current / (windowMs / 1000);
      // >12 chars/s de forma sustentada é improvável para humano comum
      if (cps > 12 && keystrokeCountRef.current < charsAdded * 0.5) {
        setProgrammaticInputs(n => n + 1);
      }
      // Reinicia janela
      windowStartRef.current = now;
      keystrokeCountRef.current = 0;
    }
  }, []);

  // Ref callback: instala proxy no setter `value` do textarea para capturar
  // atribuições diretas (script faz: textarea.value = "resposta")
  // Isso pega scripts que NÃO disparam eventos (bypass completo de eventos).
  const attachTextareaMonitor = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el || !active) return;
    // Evita instalar duas vezes no mesmo elemento
    if ((el as any).__integrityMonitored) return;
    (el as any).__integrityMonitored = true;

    const proto = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (!proto?.get || !proto?.set) return;
    const originalSet = proto.set;
    const originalGet = proto.get;
    const lastKeyRef = lastKeystrokeRef; // captura ref no closure

    Object.defineProperty(el, 'value', {
      get() { return originalGet.call(this); },
      set(newVal: string) {
        const prev = originalGet.call(this) as string;
        const added = (newVal?.length ?? 0) - (prev?.length ?? 0);
        // Limiar alto (100) para não confundir ditado por voz ou swipe keyboard
        // com injeção programática. Scripts reais costumam inserir respostas
        // completas (centenas de chars) de uma só vez.
        if (added > 100 && Date.now() - lastKeyRef.current > 500) {
          setProgrammaticInputs(n => n + 1);
        }
        originalSet.call(this, newVal);
      },
      configurable: true,
    });
  }, [active]);

  const suspicionLevel = (): 'clean' | 'low' | 'medium' | 'high' => {
    let score = 0;
    if (extensionDetected) score += 5;
    if (programmaticInputs >= 3) score += 5;
    else if (programmaticInputs === 2) score += 4;
    else if (programmaticInputs === 1) score += 3;
    if (pasteAttempts >= 3) score += 2;
    else if (pasteAttempts > 0) score += 1;
    if (tabSwitches >= 4) score += 2;
    else if (tabSwitches > 0) score += 1;
    if (score >= 7) return 'high';
    if (score >= 4) return 'medium';
    if (score >= 1) return 'low';
    return 'clean';
  };

  const getIntegrityData = (): IntegrityData => ({
    tab_switches: tabSwitches,
    paste_attempts: pasteAttempts,
    extension_detected: extensionDetected,
    programmatic_inputs: programmaticInputs,
    suspicion_level: suspicionLevel(),
  });

  return {
    tabSwitches,
    pasteAttempts,
    extensionDetected,
    programmaticInputs,
    suspicionLevel: suspicionLevel(),
    handleKeyDown,
    handlePaste,
    handleInput,
    attachTextareaMonitor,
    getIntegrityData,
  };
}

export function SuspicionBadge({ level }: { level: IntegrityData['suspicion_level'] }) {
  if (level === 'clean') return null;
  const cfg = {
    low:    { color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',  label: '⚠️ Atividade suspeita (baixa)' },
    medium: { color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300', label: '🚨 Atividade suspeita (média)' },
    high:   { color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',         label: '🔴 Alta suspeita de uso de IA / extensão' },
  }[level];
  return (
    <span className={`inline-flex items-center gap-1 ${cfg.color} px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest`}>
      {cfg.label}
    </span>
  );
}
