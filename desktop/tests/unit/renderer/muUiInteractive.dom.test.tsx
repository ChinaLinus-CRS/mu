import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The fallback path highlights the raw JSON as code; the mock records that instead of pulling in highlight.js.
vi.mock('react-syntax-highlighter', () => {
  const Highlighter = ({ children }: { children: string }) => <div data-testid='highlighted'>{children}</div>;
  return { default: Object.assign(Highlighter, { supportedLanguages: ['typescript', 'json', 'plaintext'] }) };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@arco-design/web-react', () => ({
  Message: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/renderer/utils/ui/clipboard', () => ({
  copyText: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@icon-park/react', () => ({
  Copy: () => <span />,
}));

// MuUiInteractive's send lane: the conversation the card belongs to, the conversation on screen, and the prefill
// fallback. Mutable holders so each test can stage its own scenario.
const conversationState = vi.hoisted(() => ({
  conversation: { conversation_id: 'c1', type: 'acp' } as { conversation_id: string; type: string } | null,
  active: 'c1' as string | null,
}));

vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => conversationState.conversation,
}));

vi.mock('@/renderer/pages/conversation/explorer/currentConversationStore', () => ({
  useCurrentConversation: () => conversationState.active,
}));

vi.mock('@/renderer/hooks/chat/useSendBoxDraft', () => ({
  requestConversationSendBoxPrefill: vi.fn(),
}));

vi.mock('echarts', () => ({ init: vi.fn() }));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({ openPreview: vi.fn() }),
}));

import CodeBlock from '@/renderer/components/Markdown/CodeBlock';
import { buildMuUiMessage } from '@/renderer/components/Markdown/MuUi/MuUiInteractive';
import { requestConversationSendBoxPrefill } from '@/renderer/hooks/chat/useSendBoxDraft';
import { emitter } from '@/renderer/utils/emitter';

const fence = (spec: unknown) => `${JSON.stringify(spec, null, 2)}\n`;

const renderFence = (spec: unknown) => render(<CodeBlock className='language-mu-ui'>{fence(spec)}</CodeBlock>);

/** Registers a stand-in send box: records what a card injected and lets the test play the outcome back. */
type Captured = { command: string; target: string; heard: (state: 'waiting' | 'sent' | 'dropped') => void };
const mountSendBox = (): Captured[] => {
  const captured: Captured[] = [];
  const listener = (command: string, target: string, heard?: (state: 'waiting' | 'sent' | 'dropped') => void) => {
    captured.push({ command, target, heard: heard ?? (() => {}) });
  };
  emitter.on('sendbox.command', listener);
  return captured;
};

const activeConversation = () => {
  conversationState.conversation = { conversation_id: 'c1', type: 'acp' };
  conversationState.active = 'c1';
};

beforeEach(() => {
  conversationState.conversation = { conversation_id: 'c1', type: 'acp' };
  conversationState.active = 'c1';
  emitter.removeAllListeners();
  vi.clearAllMocks();
});

describe('interactive nodes in a mu-ui fence', () => {
  it('renders tabs and switches panes locally', () => {
    renderFence({
      items: [
        {
          type: 'tabs',
          tabs: [
            { label: '概览', items: [{ type: 'text', content: 'pane one' }] },
            { label: '详情', items: [{ type: 'text', content: 'pane two' }] },
          ],
        },
      ],
    });
    expect(screen.getByText('pane one')).toBeInTheDocument();
    expect(screen.queryByText('pane two')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '详情' }));
    expect(screen.getByText('pane two')).toBeInTheDocument();
    expect(screen.queryByText('pane one')).not.toBeInTheDocument();
  });

  it('renders accordion sections that expand and collapse', () => {
    renderFence({
      items: [{ type: 'accordion', items: [{ title: '第一章', items: [{ type: 'text', content: 'section body' }] }] }],
    });
    expect(screen.queryByText('section body')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mu-ui-accordion-toggle'));
    expect(screen.getByText('section body')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mu-ui-accordion-toggle'));
    expect(screen.queryByText('section body')).not.toBeInTheDocument();
  });

  it('grades a quiz locally: wrong pick locks, reveals, explains, and retries', () => {
    renderFence({
      items: [
        {
          type: 'quiz',
          question: 'mu 的底座是？',
          options: [
            { label: 'pi', correct: true },
            { label: '别的', feedback: '再想想超集关系' },
          ],
          explanation: 'mu 是 pi 的超集发行版',
        },
      ],
    });
    fireEvent.click(screen.getAllByTestId('mu-ui-quiz-option')[1]);
    const verdict = screen.getByTestId('mu-ui-quiz-verdict');
    expect(verdict).toHaveTextContent('✗');
    expect(screen.getByText('再想想超集关系')).toBeInTheDocument();
    expect(screen.getByText('mu 是 pi 的超集发行版')).toBeInTheDocument();
    // Locked: the correct option is revealed, options are disabled, retry resets.
    expect(screen.getAllByTestId('mu-ui-quiz-option')[0]).toHaveTextContent('✓');
    expect(screen.getAllByTestId('mu-ui-quiz-option')[1]).toBeDisabled();
    fireEvent.click(screen.getByTestId('mu-ui-quiz-retry'));
    expect(screen.queryByTestId('mu-ui-quiz-verdict')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId('mu-ui-quiz-option')[0]);
    expect(screen.getByTestId('mu-ui-quiz-verdict')).toHaveTextContent('✓');
    expect(screen.queryByTestId('mu-ui-quiz-retry')).not.toBeInTheDocument();
  });

  it('keeps an ungraded quiz as a free choice with no verdict', () => {
    renderFence({
      items: [{ type: 'quiz', question: '喜欢哪个？', options: [{ label: 'A' }, { label: 'B' }] }],
    });
    fireEvent.click(screen.getAllByTestId('mu-ui-quiz-option')[0]);
    expect(screen.queryByTestId('mu-ui-quiz-verdict')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId('mu-ui-quiz-option')[1]);
    expect(screen.getAllByTestId('mu-ui-quiz-option')[1]).not.toBeDisabled();
  });

  it('falls back to code for interactive specs that cannot render', () => {
    const cases = [
      { items: [{ type: 'tabs', tabs: [] }] },
      { items: [{ type: 'accordion', items: [] }] },
      { items: [{ type: 'quiz', question: 'q', options: [{ label: 'only' }] }] },
      { items: [{ type: 'select', label: 's', options: [] }] },
      { items: [{ type: 'button', label: 42 }] },
    ];
    for (const spec of cases) {
      const { unmount } = render(<CodeBlock className='language-mu-ui'>{fence(spec)}</CodeBlock>);
      expect(screen.getByTestId('highlighted'), JSON.stringify(spec)).toBeInTheDocument();
      unmount();
    }
  });

  it('cuts an over-long button label at 200 characters and flags the card truncated', () => {
    renderFence({ items: [{ type: 'button', label: 'x'.repeat(250), action: 'refresh' }] });
    expect(screen.getByTestId('mu-ui-button')).toHaveTextContent(/^x{200}$/);
    expect(screen.getByText('messages.muUiTruncated')).toBeInTheDocument();
  });
});

describe('the injected message', () => {
  it('formats button and submit messages exactly as the vocabulary promises', () => {
    expect(buildMuUiMessage('refresh', '重新生成')).toBe('[mu-ui] action="refresh" label="重新生成"');
    expect(buildMuUiMessage('submit', '提交', { name: '张三', q1: '选项B' })).toBe(
      '[mu-ui] action="submit" label="提交" fields={"name":"张三","q1":"选项B"}'
    );
  });

  it('escapes quotes and newlines so model text cannot break the framing', () => {
    const message = buildMuUiMessage('a"ction', 'la"bel\nsecond line', { id: 'va"lue' });
    expect(message).toBe('[mu-ui] action="a\\"ction" label="la\\"bel\\nsecond line" fields={"id":"va\\"lue"}');
    // The message stays one line of plain text.
    expect(message.split('\n')).toHaveLength(1);
  });
});

describe('a button submits into its conversation', () => {
  it('sends through the send box lane and reports waiting then sent', async () => {
    activeConversation();
    const captured = mountSendBox();
    renderFence({ items: [{ type: 'button', label: '重新生成', action: 'refresh' }] });
    fireEvent.click(screen.getByTestId('mu-ui-button'));
    expect(captured).toHaveLength(1);
    expect(captured[0].target).toBe('c1');
    expect(captured[0].command).toBe('[mu-ui] action="refresh" label="重新生成"');
    captured[0].heard('waiting');
    await waitFor(() =>
      expect(screen.getByTestId('mu-ui-notify-feedback')).toHaveTextContent('messages.muUiNotify_waiting')
    );
    captured[0].heard('sent');
    await waitFor(() =>
      expect(screen.getByTestId('mu-ui-notify-feedback')).toHaveTextContent('messages.muUiNotify_sent')
    );
  });

  it('renders a button without an action disabled, and clicking it sends nothing', () => {
    const captured = mountSendBox();
    renderFence({ items: [{ type: 'button', label: '无动作' }] });
    const button = screen.getByTestId('mu-ui-button');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(captured).toHaveLength(0);
  });

  it('only shows a local hint when the card is not in the conversation being viewed', () => {
    const captured = mountSendBox();
    conversationState.active = 'c2'; // the person is looking at another conversation
    renderFence({ items: [{ type: 'button', label: '重新生成', action: 'refresh' }] });
    fireEvent.click(screen.getByTestId('mu-ui-button'));
    expect(captured).toHaveLength(0);
    expect(requestConversationSendBoxPrefill).not.toHaveBeenCalled();
    expect(screen.getByTestId('mu-ui-notify-feedback')).toHaveTextContent('messages.muUiNotify_inactive');
  });

  it('falls back to prefilling the input when no send box takes commands', () => {
    // No 'sendbox.command' listener registered: listenerCount is zero.
    renderFence({ items: [{ type: 'button', label: '重新生成', action: 'refresh' }] });
    fireEvent.click(screen.getByTestId('mu-ui-button'));
    expect(requestConversationSendBoxPrefill).toHaveBeenCalledWith('c1', '[mu-ui] action="refresh" label="重新生成"');
    expect(screen.getByTestId('mu-ui-notify-feedback')).toHaveTextContent('messages.muUiNotify_prefilled');
  });
});

describe('a submit collects the card fields', () => {
  const cardSpec = {
    title: '表单',
    items: [
      { type: 'input', label: '姓名', placeholder: '输入', id: 'name' },
      { type: 'select', label: '方案', options: ['选项A', '选项B'], id: 'q1' },
      { type: 'textarea', label: '备注', id: 'note' },
      { type: 'quiz', question: '哪个？', id: 'q2', options: [{ label: '甲' }, { label: '乙' }] },
      { type: 'submit', label: '提交' },
    ],
  };

  const fillAndSend = async () => {
    const captured = mountSendBox();
    renderFence(cardSpec);
    fireEvent.change(screen.getByTestId('mu-ui-input').querySelector('input'), { target: { value: '张三' } });
    fireEvent.click(screen.getByTestId('mu-ui-select-trigger'));
    fireEvent.click(screen.getAllByTestId('mu-ui-select-option')[1]);
    fireEvent.change(screen.getByTestId('mu-ui-textarea').querySelector('textarea'), { target: { value: '备注一行' } });
    fireEvent.click(screen.getAllByTestId('mu-ui-quiz-option')[0]);
    fireEvent.click(screen.getByTestId('mu-ui-submit'));
    return captured;
  };

  it('aggregates inputs, select, textarea and quiz choices into one message', async () => {
    activeConversation();
    const captured = await fillAndSend();
    expect(captured).toHaveLength(1);
    expect(captured[0].command).toBe(
      '[mu-ui] action="submit" label="提交" fields={"name":"张三","q1":"选项B","note":"备注一行","q2":"甲"}'
    );
  });

  it('gates on groups until every named id holds a value', () => {
    const captured = mountSendBox();
    renderFence({
      items: [
        { type: 'quiz', question: '哪个？', id: 'q1', options: [{ label: '甲' }, { label: '乙' }] },
        { type: 'submit', label: '交卷', groups: ['q1'] },
      ],
    });
    const submit = screen.getByTestId('mu-ui-submit');
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getAllByTestId('mu-ui-quiz-option')[0]);
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    expect(captured[0].command).toBe('[mu-ui] action="submit" label="交卷" fields={"q1":"甲"}');
  });

  it('limits collection to the fields list when one is given', () => {
    const captured = mountSendBox();
    renderFence({
      items: [
        { type: 'input', label: '姓名', id: 'name' },
        { type: 'input', label: '无关', id: 'other' },
        { type: 'submit', label: '提交', fields: ['name'] },
      ],
    });
    const inputs = screen.getAllByTestId('mu-ui-input');
    fireEvent.change(inputs[0].querySelector('input'), { target: { value: '张三' } });
    fireEvent.change(inputs[1].querySelector('input'), { target: { value: '不该出现' } });
    fireEvent.click(screen.getByTestId('mu-ui-submit'));
    expect(captured[0].command).toBe('[mu-ui] action="submit" label="提交" fields={"name":"张三"}');
  });

  it('labels itself with the default key when the spec carries no label', () => {
    mountSendBox();
    renderFence({ items: [{ type: 'input', label: '姓名', id: 'name' }, { type: 'submit' }] });
    expect(screen.getByTestId('mu-ui-submit')).toHaveTextContent('messages.muUiSubmitDefault');
  });
});
