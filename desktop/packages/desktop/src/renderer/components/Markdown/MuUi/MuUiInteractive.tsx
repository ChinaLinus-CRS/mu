/**
 * The interactive half of a `mu-ui` fence: tabs, accordion, quiz, button, input, textarea, select and submit.
 * `MuUiBlock` parses and validates those nodes (its walk is the trust boundary); this file renders them and owns
 * the behaviour the passive card types do not have — local state (tab pane, open sections, quiz verdicts, field
 * values) and the one thing that leaves the card: a click on `button`/`submit` injects one user message into the
 * conversation the card belongs to.
 *
 * That injection deliberately rides the existing `sendbox.command` emitter event (the same lane the board switch
 * and the command palette use): the conversation's own send box sends it, so busy-waiting, queueing and error
 * handling are the send box's, not a new IPC channel. When no send box is mounted the text is prefilled into the
 * conversation's input (manual send), and a card that is not in the conversation being viewed only shows a local
 * hint — a reply of the past must never type into a conversation the person is not looking at.
 *
 * Like the rest of the card, everything here is custom-drawn with inline styles plus a few classes in ShadowView's
 * base sheet: the card renders inside a Shadow DOM that cannot see Arco's style sheets, so Arco components would
 * come out unstyled (their popups portal to the document and work, their triggers do not). Real button/input
 * elements are used for keyboard access, the one place raw interactive HTML appears in the app.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { useCurrentConversation } from '@/renderer/pages/conversation/explorer/currentConversationStore';
import { requestConversationSendBoxPrefill } from '@/renderer/hooks/chat/useSendBoxDraft';
import { emitter } from '@/renderer/utils/emitter';
import type { MuUiNode } from './MuUiBlock';

export type MuUiTabPane = { label: string; items: MuUiNode[] };
export type MuUiAccordionSection = { title: string; items: MuUiNode[] };
export type MuUiQuizOption = { label: string; correct: boolean; feedback?: string };
export type MuUiButtonTone = 'primary' | 'danger' | 'success' | 'ghost';

export type MuUiInteractiveNode =
  | { type: 'tabs'; tabs: MuUiTabPane[] }
  | { type: 'accordion'; items: MuUiAccordionSection[] }
  | { type: 'quiz'; question: string; options: MuUiQuizOption[]; explanation?: string; id?: string }
  | {
      type: 'button';
      label: string;
      tone: MuUiButtonTone;
      action?: string;
      small?: boolean;
      full?: boolean;
      icon?: string;
    }
  | { type: 'input' | 'textarea'; label: string; placeholder?: string; id?: string; rows?: number }
  | { type: 'select'; label: string; options: string[]; selected?: number; id?: string }
  | { type: 'submit'; label?: string; groups?: string[]; fields?: string[] };

/**
 * Builds the one line of user text a `button`/`submit` click injects: `[mu-ui] action="refresh" label="重新生成"`.
 * Every dynamic value goes through `JSON.stringify`, so quotes, angle brackets and newlines in model-chosen text
 * cannot break out of the attribute framing — the message stays plain text the agent reads as data.
 */
export const buildMuUiMessage = (action: string, label: string, fields?: Record<string, string>): string => {
  const attributes = [`action=${JSON.stringify(action)}`, `label=${JSON.stringify(label)}`];
  if (fields !== undefined) attributes.push(`fields=${JSON.stringify(fields)}`);
  return `[mu-ui] ${attributes.join(' ')}`;
};

/** What became of an injected message, from the button's point of view: first `triggered`, then the real outcome. */
export type MuUiNotifyState = 'triggered' | 'waiting' | 'sent' | 'dropped' | 'prefilled' | 'inactive';

/** The i18n key of each outcome, spelled out so the checker can see every key this file uses. */
const NOTIFY_KEY: Record<MuUiNotifyState, string> = {
  triggered: 'messages.muUiNotify_triggered',
  waiting: 'messages.muUiNotify_waiting',
  sent: 'messages.muUiNotify_sent',
  dropped: 'messages.muUiNotify_dropped',
  prefilled: 'messages.muUiNotify_prefilled',
  inactive: 'messages.muUiNotify_inactive',
};

type MuUiCardScopeValue = {
  /** Every id'd field value in this card (input/textarea text, select and quiz choices), in use order. */
  values: Readonly<Record<string, string>>;
  setValue: (id: string, value: string) => void;
  /** Injects `message` into the card's conversation when that is the one being viewed; reports the outcome. */
  notify: (message: string, onState: (state: MuUiNotifyState) => void) => void;
};

const MuUiCardContext = React.createContext<MuUiCardScopeValue | null>(null);

/** Reads the card scope; interactive nodes outside a card (should not happen) render inert. */
const useMuUiCardScope = (): MuUiCardScopeValue | null => React.useContext(MuUiCardContext);

/**
 * Holds the per-card interactive state one level above the card body: field values (so `submit` can collect them
 * wherever in the tree the fields sit) and the injection pipeline. State is plain React state — a reload resets
 * it, which the interactive vocabulary accepts.
 */
export function MuUiCardScope({ children }: { children: React.ReactNode }) {
  const [values, setValues] = React.useState<Record<string, string>>({});
  const conversation = useConversationContextSafe();
  const activeConversationId = useCurrentConversation();

  const setValue = React.useCallback((id: string, value: string) => {
    setValues((previous) => (previous[id] === value ? previous : { ...previous, [id]: value }));
  }, []);

  const notify = React.useCallback(
    (message: string, onState: (state: MuUiNotifyState) => void) => {
      // Only the conversation on screen may be typed into: a card in another conversation (an inactive team
      // column, a previewed past reply) keeps its feedback local instead of sending anywhere.
      if (!conversation || activeConversationId !== conversation.conversation_id) {
        onState('inactive');
        return;
      }
      // A send box mounted nowhere (no chat route, or a platform whose box does not take commands): put the text
      // in the input for a manual send rather than dropping it silently.
      if (emitter.listenerCount('sendbox.command') === 0) {
        requestConversationSendBoxPrefill(conversation.conversation_id, message);
        onState('prefilled');
        return;
      }
      // The send box that owns this conversation sends it — at once when idle, queued while busy — and reports
      // back. (A platform whose box never answers leaves the button at `triggered`; see the file header.)
      emitter.emit('sendbox.command', message, conversation.conversation_id, (state) => onState(state));
    },
    [conversation, activeConversationId]
  );

  const scope = React.useMemo<MuUiCardScopeValue>(() => ({ values, setValue, notify }), [values, setValue, notify]);
  return <MuUiCardContext.Provider value={scope}>{children}</MuUiCardContext.Provider>;
}

const CELL_BORDER = '1px solid var(--border-base)';

/** A translucent wash of a theme color, in place of hardcoded tints (MuUiBlock's, copied to avoid an import cycle). */
const tint = (color: string, percent: number): string => `color-mix(in srgb, ${color} ${percent}%, transparent)`;

const LABEL_STYLE: React.CSSProperties = { fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' };

/** The outcome line under a button/submit: coloured by how the injection went. */
function NotifyFeedback({ state }: { state: MuUiNotifyState }) {
  const { t } = useTranslation();
  const color =
    state === 'sent'
      ? 'var(--success)'
      : state === 'dropped' || state === 'prefilled' || state === 'inactive'
        ? 'var(--warning)'
        : 'var(--text-secondary)';
  return (
    <span data-testid='mu-ui-notify-feedback' style={{ fontSize: '12px', color, marginLeft: '8px' }}>
      {t(NOTIFY_KEY[state])}
    </span>
  );
}

function TabsView({
  node,
  renderItems,
}: {
  node: Extract<MuUiInteractiveNode, { type: 'tabs' }>;
  renderItems: RenderItems;
}) {
  const [active, setActive] = React.useState(0);
  const activeIndex = Math.min(active, node.tabs.length - 1);
  const pane = node.tabs[activeIndex];
  return (
    <div style={{ minWidth: 0 }} data-testid='mu-ui-tabs'>
      <div role='tablist' style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', borderBottom: CELL_BORDER }}>
        {node.tabs.map((tab, index) => {
          const isActive = index === activeIndex;
          return (
            <button
              key={index}
              type='button'
              role='tab'
              aria-selected={isActive}
              data-testid='mu-ui-tab'
              className='markdown-mu-ui-btn'
              onClick={() => setActive(index)}
              style={{
                padding: '6px 12px',
                fontSize: '13px',
                font: 'inherit',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--primary)' : '2px solid transparent',
                background: isActive ? tint('var(--primary)', 8) : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: isActive ? 600 : 400,
                cursor: 'pointer',
                borderRadius: '6px 6px 0 0',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div role='tabpanel' style={{ paddingTop: '10px' }}>
        {renderItems(pane.items)}
      </div>
    </div>
  );
}

function AccordionView({
  node,
  renderItems,
}: {
  node: Extract<MuUiInteractiveNode, { type: 'accordion' }>;
  renderItems: RenderItems;
}) {
  const [open, setOpen] = React.useState<Record<number, boolean>>({});
  return (
    <div style={{ minWidth: 0 }} data-testid='mu-ui-accordion'>
      {node.items.map((section, index) => {
        const isOpen = open[index] === true;
        return (
          <div key={index} style={{ borderBottom: index === node.items.length - 1 ? undefined : CELL_BORDER }}>
            <button
              type='button'
              aria-expanded={isOpen}
              data-testid='mu-ui-accordion-toggle'
              className='markdown-mu-ui-btn'
              onClick={() => setOpen((previous) => ({ ...previous, [index]: !isOpen }))}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 4px',
                font: 'inherit',
                fontSize: '14px',
                fontWeight: 600,
                border: 'none',
                background: 'transparent',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  transition: 'transform 0.15s ease',
                  transform: isOpen ? 'rotate(90deg)' : 'none',
                }}
              >
                ▸
              </span>
              {section.title}
            </button>
            {isOpen && (
              <div data-testid='mu-ui-accordion-body' style={{ padding: '2px 4px 10px 18px' }}>
                {renderItems(section.items)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function QuizView({ node }: { node: Extract<MuUiInteractiveNode, { type: 'quiz' }> }) {
  const { t } = useTranslation();
  const scope = useMuUiCardScope();
  const graded = node.options.some((option) => option.correct);
  const [chosen, setChosen] = React.useState<number | null>(null);
  const [locked, setLocked] = React.useState(false);

  // A re-generated card with a new question id starts fresh (genui v2.7's reset rule).
  React.useEffect(() => {
    setChosen(null);
    setLocked(false);
  }, [node.id]);

  const choose = (index: number) => {
    if (locked) return;
    setChosen(index);
    if (node.id !== undefined) scope?.setValue(node.id, node.options[index].label);
    if (graded) setLocked(true);
  };

  const retry = () => {
    setChosen(null);
    setLocked(false);
    if (node.id !== undefined) scope?.setValue(node.id, '');
  };

  const correctChoice = chosen !== null && node.options[chosen].correct;
  return (
    <div
      style={{ border: CELL_BORDER, borderRadius: '8px', padding: '10px 12px', background: 'var(--bg-base)' }}
      data-testid='mu-ui-quiz'
    >
      <div style={{ fontWeight: 600, marginBottom: '8px' }}>{node.question}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {node.options.map((option, index) => {
          const isChosen = chosen === index;
          const revealCorrect = locked && option.correct;
          const revealWrong = locked && isChosen && !option.correct;
          return (
            <div key={index}>
              <button
                type='button'
                data-testid='mu-ui-quiz-option'
                className='markdown-mu-ui-opt'
                data-disabled={locked ? 'true' : undefined}
                disabled={locked}
                onClick={() => choose(index)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '7px 10px',
                  font: 'inherit',
                  fontSize: '13px',
                  border: `1px solid ${revealCorrect ? 'var(--success)' : revealWrong ? 'var(--danger)' : isChosen ? 'var(--primary)' : 'var(--border-base)'}`,
                  borderRadius: '6px',
                  background: revealCorrect
                    ? tint('var(--success)', 10)
                    : revealWrong
                      ? tint('var(--danger)', 10)
                      : isChosen
                        ? tint('var(--primary)', 8)
                        : 'var(--bg-1)',
                  color: 'var(--text-primary)',
                  cursor: locked ? 'default' : 'pointer',
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    width: '14px',
                    height: '14px',
                    borderRadius: '50%',
                    border: `1.5px solid ${isChosen ? 'var(--primary)' : 'var(--border-base)'}`,
                    background: isChosen ? 'var(--primary)' : 'transparent',
                    boxShadow: 'inset 0 0 0 2.5px var(--bg-1)',
                    boxSizing: 'border-box',
                  }}
                />
                <span style={{ flex: 1 }}>{option.label}</span>
                {revealCorrect && <span style={{ color: 'var(--success)', fontWeight: 700 }}>✓</span>}
                {revealWrong && <span style={{ color: 'var(--danger)', fontWeight: 700 }}>✗</span>}
              </button>
              {locked && isChosen && option.feedback !== undefined && (
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', padding: '4px 10px 0' }}>
                  {option.feedback}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {locked && (
        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div
            data-testid='mu-ui-quiz-verdict'
            style={{ fontSize: '13px', fontWeight: 600, color: correctChoice ? 'var(--success)' : 'var(--danger)' }}
          >
            {correctChoice ? `✓ ${t('messages.muUiQuizCorrect')}` : `✗ ${t('messages.muUiQuizWrong')}`}
          </div>
          {node.explanation !== undefined && (
            <div
              style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                background: 'var(--bg-2)',
                borderRadius: '6px',
                padding: '6px 8px',
              }}
            >
              {node.explanation}
            </div>
          )}
          {!correctChoice && (
            <div>
              <button
                type='button'
                data-testid='mu-ui-quiz-retry'
                className='markdown-mu-ui-btn'
                onClick={retry}
                style={{
                  padding: '4px 12px',
                  font: 'inherit',
                  fontSize: '12px',
                  border: CELL_BORDER,
                  borderRadius: '6px',
                  background: 'var(--bg-1)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                {t('messages.muUiQuizRetry')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const BUTTON_TONE_STYLE: Record<MuUiButtonTone, React.CSSProperties> = {
  primary: { background: 'var(--primary)', borderColor: 'var(--primary)', color: 'var(--text-white)' },
  danger: { background: 'var(--danger)', borderColor: 'var(--danger)', color: 'var(--text-white)' },
  success: { background: 'var(--success)', borderColor: 'var(--success)', color: 'var(--text-white)' },
  ghost: { background: 'transparent', borderColor: 'var(--border-base)', color: 'var(--text-primary)' },
};

function ButtonView({ node }: { node: Extract<MuUiInteractiveNode, { type: 'button' }> }) {
  const { t } = useTranslation();
  const scope = useMuUiCardScope();
  const [state, setState] = React.useState<MuUiNotifyState | null>(null);
  const disabled = node.action === undefined;
  const fire = () => {
    if (disabled || node.action === undefined) return;
    setState('triggered');
    scope?.notify(buildMuUiMessage(node.action, node.label), setState);
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap' }}>
      <button
        type='button'
        data-testid='mu-ui-button'
        className='markdown-mu-ui-btn'
        disabled={disabled}
        title={disabled ? t('messages.muUiButtonActionMissing') : undefined}
        onClick={fire}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: node.small === true ? '2px 10px' : '6px 16px',
          fontSize: node.small === true ? '12px' : '14px',
          font: 'inherit',
          border: `1px solid var(--border-base)`,
          borderRadius: '6px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          width: node.full === true ? '100%' : undefined,
          justifyContent: 'center',
          ...BUTTON_TONE_STYLE[node.tone],
        }}
      >
        {node.icon !== undefined && <span>{node.icon}</span>}
        {node.label}
      </button>
      {state !== null && <NotifyFeedback state={state} />}
    </span>
  );
}

/** Input and textarea: values live in the card only — no send on blur or Enter; an id'd value feeds `submit`. */
function TextFieldView({ node }: { node: Extract<MuUiInteractiveNode, { type: 'input' | 'textarea' }> }) {
  const scope = useMuUiCardScope();
  const [value, setValue] = React.useState('');
  const change = (next: string) => {
    // Parity with the spec's text budget: 2000 characters, like every other text the card accepts.
    const clipped = next.slice(0, 2000);
    setValue(clipped);
    if (node.id !== undefined) scope?.setValue(node.id, clipped);
  };
  const shared = {
    font: 'inherit',
    fontSize: '13px',
    width: '100%',
    boxSizing: 'border-box',
    padding: '6px 10px',
    border: CELL_BORDER,
    borderRadius: '6px',
    background: 'var(--bg-base)',
    color: 'var(--text-primary)',
  } as const;
  return (
    <div style={{ minWidth: 0 }} data-testid={`mu-ui-${node.type}`}>
      <div style={LABEL_STYLE}>{node.label}</div>
      {node.type === 'textarea' ? (
        <textarea
          rows={node.rows ?? 3}
          placeholder={node.placeholder}
          value={value}
          onChange={(event) => change(event.target.value)}
          className='markdown-mu-ui-input'
          style={{ ...shared, resize: 'vertical', fontFamily: 'inherit' }}
        />
      ) : (
        <input
          type='text'
          placeholder={node.placeholder}
          value={value}
          onChange={(event) => change(event.target.value)}
          className='markdown-mu-ui-input'
          style={shared}
        />
      )}
    </div>
  );
}

/** A select drawn by hand: the popup opens in flow (no portal, so nothing escapes the shadow tree). */
function SelectView({ node }: { node: Extract<MuUiInteractiveNode, { type: 'select' }> }) {
  const { t } = useTranslation();
  const scope = useMuUiCardScope();
  const [value, setValue] = React.useState<number | null>(node.selected ?? null);
  const [open, setOpen] = React.useState(false);
  const choose = (index: number) => {
    setValue(index);
    setOpen(false);
    if (node.id !== undefined) scope?.setValue(node.id, node.options[index]);
  };
  return (
    <div style={{ minWidth: 0 }} data-testid='mu-ui-select'>
      <div style={LABEL_STYLE}>{node.label}</div>
      <button
        type='button'
        aria-haspopup='listbox'
        aria-expanded={open}
        data-testid='mu-ui-select-trigger'
        className='markdown-mu-ui-btn'
        onClick={() => setOpen((previous) => !previous)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          width: '100%',
          padding: '6px 10px',
          font: 'inherit',
          fontSize: '13px',
          border: CELL_BORDER,
          borderRadius: '6px',
          background: 'var(--bg-base)',
          color: value === null ? 'var(--text-secondary)' : 'var(--text-primary)',
          cursor: 'pointer',
        }}
      >
        <span>{value === null ? t('messages.muUiSelectPlaceholder') : node.options[value]}</span>
        <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>▾</span>
      </button>
      {open && (
        <div
          role='listbox'
          style={{
            border: CELL_BORDER,
            borderRadius: '6px',
            marginTop: '4px',
            maxHeight: '220px',
            overflowY: 'auto',
            background: 'var(--bg-1)',
          }}
        >
          {node.options.map((option, index) => (
            <button
              key={index}
              type='button'
              role='option'
              aria-selected={value === index}
              data-testid='mu-ui-select-option'
              className='markdown-mu-ui-opt'
              onClick={() => choose(index)}
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 10px',
                font: 'inherit',
                fontSize: '13px',
                border: 'none',
                background: value === index ? tint('var(--primary)', 8) : 'transparent',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SubmitView({ node }: { node: Extract<MuUiInteractiveNode, { type: 'submit' }> }) {
  const { t } = useTranslation();
  const scope = useMuUiCardScope();
  const [state, setState] = React.useState<MuUiNotifyState | null>(null);
  const values = scope?.values ?? {};
  // `groups` names the ids that must hold a value before the submit can go out (genui's exam rule).
  const missing = (node.groups ?? []).filter((id) => (values[id] ?? '') === '');
  const collect = (): Record<string, string> => {
    const allow = node.fields;
    return Object.fromEntries(Object.entries(values).filter(([id]) => allow === undefined || allow.includes(id)));
  };
  const fire = () => {
    if (missing.length > 0) return;
    setState('triggered');
    scope?.notify(buildMuUiMessage('submit', node.label ?? t('messages.muUiSubmitDefault'), collect()), setState);
  };
  const disabled = missing.length > 0;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap' }}>
      <button
        type='button'
        data-testid='mu-ui-submit'
        className='markdown-mu-ui-btn'
        disabled={disabled}
        title={disabled ? t('messages.muUiSubmitIncomplete') : undefined}
        onClick={fire}
        style={{
          padding: '6px 20px',
          fontSize: '14px',
          fontWeight: 600,
          font: 'inherit',
          border: '1px solid var(--primary)',
          borderRadius: '6px',
          background: 'var(--primary)',
          color: 'var(--text-white)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {node.label ?? t('messages.muUiSubmitDefault')}
      </button>
      {state !== null && <NotifyFeedback state={state} />}
    </span>
  );
}

type RenderItems = (items: MuUiNode[]) => React.ReactNode;

/**
 * Renders one interactive node; `MuUiBlock`'s NodeView hands over here for the interactive types and lends the
 * generic item renderer so panes and sections can hold any node (the parser's cycle-free other half).
 */
export function InteractiveNodeView({ node, renderItems }: { node: MuUiInteractiveNode; renderItems: RenderItems }) {
  switch (node.type) {
    case 'tabs':
      return <TabsView node={node} renderItems={renderItems} />;
    case 'accordion':
      return <AccordionView node={node} renderItems={renderItems} />;
    case 'quiz':
      return <QuizView node={node} />;
    case 'button':
      return <ButtonView node={node} />;
    case 'input':
    case 'textarea':
      return <TextFieldView node={node} />;
    case 'select':
      return <SelectView node={node} />;
    case 'submit':
      return <SubmitView node={node} />;
  }
}
