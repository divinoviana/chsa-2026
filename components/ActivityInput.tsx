import React, { useState, useEffect } from 'react';

interface Props {
  questionId: string;
  questionText: string;
  value: string;
  onChange: (val: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onInput?: (e: React.FormEvent<HTMLTextAreaElement>) => void;
  onPasteBlocked?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  textareaRef?: (el: HTMLTextAreaElement | null) => void;
}

export const ActivityInput: React.FC<Props> = ({ questionId, questionText, value, onChange, onKeyDown, onInput, onPasteBlocked, textareaRef }) => {
  const [warning, setWarning] = useState<string | null>(null);

  // Limpa o aviso automaticamente após 3 segundos
  useEffect(() => {
    if (warning) {
      const timer = setTimeout(() => setWarning(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [warning]);
  
  const handleBlockAction = (e: React.SyntheticEvent) => {
    e.preventDefault();
    setWarning("A função de colar foi desativada para incentivar sua escrita autoral.");
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    
    // Calcula a diferença de tamanho entre o texto novo e o antigo
    // Se value for undefined, trata como string vazia
    const currentValue = value || "";
    const diff = newValue.length - currentValue.length;
    
    // Se inseriu mais de 30 caracteres de uma vez (ex: swipe longo ou paste disfarçado)
    // bloqueia. Humanos digitam caractere por caractere ou palavras curtas.
    if (diff > 30) {
      setWarning("Não é permitido colar textos longos. Por favor, digite sua resposta.");
      return;
    }

    // Se passou na verificação, limpa aviso se existir e atualiza
    if (warning) setWarning(null);
    onChange(newValue);
  };

  return (
    <div className="mb-8 relative">
      <label className="block text-slate-700 font-semibold mb-2 text-sm leading-relaxed">
        {questionText}
      </label>
      <div className="relative group">
        <textarea
          className={`w-full p-3 border rounded-lg focus:ring-2 transition-all shadow-sm select-none ${
            warning 
              ? 'border-red-400 focus:border-red-400 focus:ring-red-200 bg-red-50 text-red-900' 
              : 'border-slate-300 focus:border-tocantins-blue focus:ring-tocantins-blue bg-white text-slate-700'
          }`}
          ref={textareaRef}
          rows={4}
          placeholder="Digite sua resposta aqui..."
          value={value}
          onChange={handleChange}
          onKeyDown={onKeyDown}
          onInput={onInput}
          onPaste={(e) => { handleBlockAction(e); onPasteBlocked?.(e); }}
          onCopy={handleBlockAction}
          onCut={handleBlockAction}
          onDragStart={handleBlockAction}
          onDrop={handleBlockAction}
          onContextMenu={handleBlockAction}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="sentences"
          spellCheck={true}
        />
        
        {/* Aviso flutuante abaixo do campo */}
        {warning && (
          <div className="absolute top-full left-0 right-0 z-10 pt-1">
             <div className="bg-red-100 text-red-700 text-xs font-bold py-2 px-3 rounded-lg border border-red-200 shadow-md flex items-center gap-2 animate-pulse">
                <span>⚠️</span> {warning}
             </div>
          </div>
        )}
      </div>
    </div>
  );
};
