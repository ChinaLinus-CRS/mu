/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 生成 HTML 标记元素模式的注入脚本
 * Generate HTML element-marking mode injection script
 *
 * Mirrors htmlInspectScript: hover highlights an element, but a click does not
 * copy HTML — it pins a numbered badge on the element instead, so the person
 * can refer to "标记的 1 号元素" in chat. The panel persists the collected
 * descriptors next to the file (a `<file>.marks.json` sidecar) where the agent
 * reads them.
 *
 * @param markMode - 是否启用标记模式 / Whether mark mode is enabled
 * @returns 注入脚本字符串 / Injected script string
 */
export function generateMarkScript(markMode: boolean): string {
  return `
    (function() {
      const STYLE_ID = 'mark-mode-style';
      const OVERLAY_ID = 'mark-mode-overlay';
      const LAYER_ID = 'mark-badges-layer';

      // 清理上一次注入 / Clean up the previous injection
      const oldStyle = document.getElementById(STYLE_ID);
      if (oldStyle) oldStyle.remove();
      const oldOverlay = document.getElementById(OVERLAY_ID);
      if (oldOverlay) oldOverlay.remove();

      const oldListeners = window.__markModeListeners || {};
      if (oldListeners.mousemove) document.removeEventListener('mousemove', oldListeners.mousemove);
      if (oldListeners.click) document.removeEventListener('click', oldListeners.click);
      if (oldListeners.reposition) {
        document.removeEventListener('scroll', oldListeners.reposition, true);
        window.removeEventListener('resize', oldListeners.reposition);
      }

      // 徽章层 / Badge layer — kept after mark mode exits so numbers stay readable
      let layer = document.getElementById(LAYER_ID);
      if (!layer) {
        layer = document.createElement('div');
        layer.id = LAYER_ID;
        layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:999998;';
        document.body.appendChild(layer);
      }

      window.__elementMarks = window.__elementMarks || [];
      const marks = window.__elementMarks;

      const removeBadge = (mark) => {
        if (mark.outline && mark.outline.parentNode) mark.outline.parentNode.removeChild(mark.outline);
        if (mark.badge && mark.badge.parentNode) mark.badge.parentNode.removeChild(mark.badge);
      };

      const drawMark = (mark) => {
        const rect = mark.element.getBoundingClientRect();
        if (!mark.outline) {
          mark.outline = document.createElement('div');
          mark.outline.style.cssText =
            'position:fixed;pointer-events:none;border:2px dashed #f77234;border-radius:2px;z-index:999998;';
          layer.appendChild(mark.outline);
        }
        mark.outline.style.left = rect.left + 'px';
        mark.outline.style.top = rect.top + 'px';
        mark.outline.style.width = rect.width + 'px';
        mark.outline.style.height = rect.height + 'px';
        if (!mark.badge) {
          mark.badge = document.createElement('div');
          mark.badge.textContent = String(mark.index);
          mark.badge.style.cssText =
            'position:fixed;pointer-events:none;background:#f77234;color:#fff;' +
            'font:600 11px/16px system-ui;width:16px;height:16px;border-radius:50%;' +
            'text-align:center;z-index:999999;box-shadow:0 1px 3px rgba(0,0,0,.35);';
          layer.appendChild(mark.badge);
        }
        mark.badge.style.left = (rect.left - 8) + 'px';
        mark.badge.style.top = (rect.top - 8) + 'px';
      };

      const reposition = () => marks.forEach(drawMark);

      const describe = (element) => {
        const snippet = (element.outerHTML || '').replace(/\\s+/g, ' ').slice(0, 300);
        const text = (element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id || undefined,
          className:
            typeof element.className === 'string' && element.className.trim() ? element.className.trim() : undefined,
          text: text || undefined,
          html: snippet,
        };
      };

      const send = (payload) => {
        console.log('__MARK_ELEMENT__' + JSON.stringify(payload));
      };

      if (!${markMode}) {
        // 关闭标记模式：去掉悬停覆盖层和监听器，徽章保留 / Off: drop the hover
        // overlay and listeners, keep the pinned badges visible.
        document.body.style.cursor = '';
        window.__markModeListeners = null;
        return;
      }

      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = '';
      document.head.appendChild(style);

      const overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.style.cssText =
        'position:fixed;pointer-events:none;background:rgba(247,114,52,0.08);' +
        'border:2px solid #f77234;z-index:999997;transition:all .1s ease;display:none;';
      document.body.appendChild(overlay);

      const handleMouseMove = (e) => {
        const element = document.elementFromPoint(e.clientX, e.clientY);
        if (!element || element === overlay || element.parentNode === layer) {
          overlay.style.display = 'none';
          return;
        }
        const rect = element.getBoundingClientRect();
        overlay.style.display = 'block';
        overlay.style.left = rect.left + 'px';
        overlay.style.top = rect.top + 'px';
        overlay.style.width = rect.width + 'px';
        overlay.style.height = rect.height + 'px';
      };

      const handleClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const element = document.elementFromPoint(e.clientX, e.clientY);
        if (!element || element === overlay || element.parentNode === layer) return;

        const existing = marks.find((mark) => mark.element === element);
        if (existing) {
          // 再点一次取消标记 / Clicking a marked element clears its mark
          removeBadge(existing);
          marks.splice(marks.indexOf(existing), 1);
          send({ action: 'remove', index: existing.index });
          return;
        }
        const index = marks.reduce((max, mark) => Math.max(max, mark.index), 0) + 1;
        const mark = Object.assign({ element: element, index: index }, describe(element));
        marks.push(mark);
        drawMark(mark);
        // 不回传 DOM 引用，只传描述 / Never serialize the DOM reference back
        send(Object.assign({ action: 'add', index: index }, describe(element)));
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('click', handleClick);
      document.addEventListener('scroll', reposition, true);
      window.addEventListener('resize', reposition);
      window.__markModeListeners = { mousemove: handleMouseMove, click: handleClick, reposition: reposition };
      document.body.style.cursor = 'crosshair';
    })();
  `;
}

/** webview 里一次标记事件的载荷 / Payload of one mark event from the webview */
export type MarkedElement = {
  action: 'add' | 'remove';
  index: number;
  tag: string;
  id?: string;
  className?: string;
  text?: string;
  html: string;
};
