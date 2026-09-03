/**
 * QuilrAI FDE Assessment: Main Web Application Router & Coordinator
 * Implements smooth tab auto-sliding, directional panel animations, and module navigation.
 */

import { renderOverview } from './modules/overview.js';
import { renderTask1 } from './modules/task1-mcp.js';
import { renderTask2 } from './modules/task2-gateway.js';
import { renderTask3 } from './modules/task3-stream.js';
import { renderTask4 } from './modules/task4-router.js';
import { renderTask5 } from './modules/task5-triage.js';

// Global toast notification helper
window.showToast = function(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let icon = '&#9432;';
  if (type === 'success') icon = '&#10003;';
  else if (type === 'error') icon = '&times;';
  else if (type === 'warn') icon = '&#9888;';

  toast.innerHTML = `<span style="font-weight: bold; font-size: 1rem;">${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(12px)';
    toast.style.transition = 'all 200ms ease';
    setTimeout(() => toast.remove(), 220);
  }, 3500);
};

// Module Registry
const panels = {
  'panel-overview': { render: renderOverview, initialized: false, index: 0, title: 'Architecture & Tests' },
  'panel-task1': { render: renderTask1, initialized: false, index: 1, title: 'Task 1: MCP Server' },
  'panel-task2': { render: renderTask2, initialized: false, index: 2, title: 'Task 2: Security Gateway' },
  'panel-task3': { render: renderTask3, initialized: false, index: 3, title: 'Task 3: Streaming Guardrail' },
  'panel-task4': { render: renderTask4, initialized: false, index: 4, title: 'Task 4: Resilient Router' },
  'panel-task5': { render: renderTask5, initialized: false, index: 5, title: 'Task 5: Network Debugging' },
};

const moduleList = [
  { id: 'panel-overview', tabId: 'tab-overview', title: 'Architecture & Tests' },
  { id: 'panel-task1', tabId: 'tab-task1', title: 'Task 1: MCP Server' },
  { id: 'panel-task2', tabId: 'tab-task2', title: 'Task 2: Security Gateway' },
  { id: 'panel-task3', tabId: 'tab-task3', title: 'Task 3: Streaming Guardrail' },
  { id: 'panel-task4', tabId: 'tab-task4', title: 'Task 4: Resilient Router' },
  { id: 'panel-task5', tabId: 'tab-task5', title: 'Task 5: Network Debugging' },
];

let currentIndex = 0;

function updateSliderIndicator(activeTab) {
  const indicator = document.getElementById('nav-slider-indicator');
  if (!indicator || !activeTab) return;
  indicator.style.left = `${activeTab.offsetLeft}px`;
  indicator.style.width = `${activeTab.offsetWidth}px`;
}

function appendPaginationBar(panelEl, panelId) {
  if (panelEl.querySelector('.module-pagination-bar')) return;

  const idx = moduleList.findIndex(m => m.id === panelId);
  if (idx === -1) return;

  const bar = document.createElement('div');
  bar.className = 'module-pagination-bar';

  const prev = idx > 0 ? moduleList[idx - 1] : null;
  const next = idx < moduleList.length - 1 ? moduleList[idx + 1] : null;

  let leftHtml = prev
    ? `<button class="pagination-btn" id="pag-prev-${idx}">
        &larr; Previous: ${prev.title}
       </button>`
    : '<div></div>';

  let rightHtml = next
    ? `<button class="pagination-btn" id="pag-next-${idx}">
        Next: ${next.title} &rarr;
       </button>`
    : '<div></div>';

  bar.innerHTML = `${leftHtml}${rightHtml}`;
  panelEl.appendChild(bar);

  if (prev) {
    document.getElementById(`pag-prev-${idx}`)?.addEventListener('click', () => {
      document.getElementById(prev.tabId)?.click();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  if (next) {
    document.getElementById(`pag-next-${idx}`)?.addEventListener('click', () => {
      document.getElementById(next.tabId)?.click();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
}

function initNavigation() {
  const tabs = document.querySelectorAll('.nav-tab');
  const navContainer = document.getElementById('nav-tabs-container');
  const btnScrollLeft = document.getElementById('btn-scroll-left');
  const btnScrollRight = document.getElementById('btn-scroll-right');

  // Horizontal scroll button controls
  btnScrollLeft?.addEventListener('click', () => {
    navContainer?.scrollBy({ left: -240, behavior: 'smooth' });
  });

  btnScrollRight?.addEventListener('click', () => {
    navContainer?.scrollBy({ left: 240, behavior: 'smooth' });
  });

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-target');
      if (!targetId) return;

      const newIndex = parseInt(tab.getAttribute('data-index') || '0', 10);
      const isForward = newIndex >= currentIndex;

      // Update active tab styling
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Auto-slide tab into view within the horizontal navigation bar
      tab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      updateSliderIndicator(tab);

      // Directional slide animation for panel
      const directionClass = isForward ? 'slide-right' : 'slide-left';

      document.querySelectorAll('.tab-panel').forEach(p => {
        p.classList.remove('active', 'slide-right', 'slide-left');
      });

      const activePanel = document.getElementById(targetId);
      if (activePanel) {
        activePanel.classList.add('active', directionClass);

        // Render module if not yet rendered
        if (panels[targetId] && !panels[targetId].initialized) {
          panels[targetId].render(activePanel);
          panels[targetId].initialized = true;
        }

        // Attach bottom pagination controls
        appendPaginationBar(activePanel, targetId);
      }

      currentIndex = newIndex;

      // Update URL hash without scrolling
      const hash = targetId.replace('panel-', '');
      history.replaceState(null, '', `#${hash}`);
    });
  });

  // Handle window resize to re-align indicator
  window.addEventListener('resize', () => {
    const activeTab = document.querySelector('.nav-tab.active');
    if (activeTab) updateSliderIndicator(activeTab);
  });

  // Handle URL hash on initial page load
  const currentHash = window.location.hash.replace('#', '');
  if (currentHash && panels[`panel-${currentHash}`]) {
    const targetTab = document.querySelector(`[data-target="panel-${currentHash}"]`);
    if (targetTab) {
      targetTab.click();
      return;
    }
  }

  // Default: Render overview panel
  const overviewPanel = document.getElementById('panel-overview');
  if (overviewPanel && panels['panel-overview']) {
    panels['panel-overview'].render(overviewPanel);
    panels['panel-overview'].initialized = true;
    appendPaginationBar(overviewPanel, 'panel-overview');
    const initialTab = document.getElementById('tab-overview');
    if (initialTab) {
      setTimeout(() => updateSliderIndicator(initialTab), 50);
    }
  }
}

// Global bootstrap on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
});
