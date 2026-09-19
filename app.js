import { parseScheduleText, parseScheduleTextAsync, parseScheduleWithGemma, isEventOutdated, findMatchingSchedule } from './parser.js';
import { buildICS, downloadICS, openCalendarEvent, isNativeApp, getSafeICSFilename } from './ics.js';

const STORAGE_KEY = 'calgen_schedules_v1';
const AUTO_DOWNLOAD_KEY = 'calgen_auto_download';
const USE_AI_KEY = 'calgen_use_ai';
const CF_ACCOUNT_KEY = 'calgen_cf_account_id';
const CF_TOKEN_KEY = 'calgen_cf_api_token';

// State
let schedules = [];
let autoDownloadEnabled = true;
let useAiEnabled = true;
let cfAccountId = '';
let cfApiToken = '';
let lastDownloadedText = '';
let debounceTimer = null;
let autoDownloadTimer = null;
let aiPreviewAbortController = null;
let latestParsedText = '';
let latestAiEvent = null;
let currentAiPromise = null;

// DOM Elements
const scheduleInput = document.getElementById('scheduleInput');
const autoDownloadToggle = document.getElementById('autoDownloadToggle');
const aiToggle = document.getElementById('aiToggle');
const aiConfigBtn = document.getElementById('aiConfigBtn');
const previewCard = document.getElementById('previewCard');
const previewEngineBadge = document.getElementById('previewEngineBadge');
const previewTitle = document.getElementById('previewTitle');
const previewTime = document.getElementById('previewTime');
const previewLoc = document.getElementById('previewLoc');
const previewLocItem = document.getElementById('previewLocItem');
const previewUrl = document.getElementById('previewUrl');
const previewUrlItem = document.getElementById('previewUrlItem');
const previewStatus = document.getElementById('previewStatus');
const generateBtn = document.getElementById('generateBtn');
const clearInputBtn = document.getElementById('clearInputBtn');
const schedulesList = document.getElementById('schedulesList');
const emptyState = document.getElementById('emptyState');
const scheduleCount = document.getElementById('scheduleCount');
const cleanupBtn = document.getElementById('cleanupBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const toastContainer = document.getElementById('toastContainer');

// Modal Elements
const aiConfigModal = document.getElementById('aiConfigModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const saveConfigBtn = document.getElementById('saveConfigBtn');
const clearConfigBtn = document.getElementById('clearConfigBtn');
const cfAccountIdInput = document.getElementById('cfAccountId');
const cfApiTokenInput = document.getElementById('cfApiToken');

/**
 * Show a toast notification
 * @param {string} message
 * @param {'info'|'success'|'danger'} type
 */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'all 0.2s ease';
    setTimeout(() => toast.remove(), 250);
  }, 3000);
}

/**
 * Format a Date for display
 */
function formatDisplayDateTime(startDateStr, endDateStr, allDay = false) {
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);

  const pad = (n) => String(n).padStart(2, '0');
  const year = start.getFullYear();
  const month = pad(start.getMonth() + 1);
  const date = pad(start.getDate());
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const weekday = weekdays[start.getDay()];

  if (allDay) {
    return `${year}年${month}月${date}日 (${weekday}) 全天`;
  }

  const sHours = pad(start.getHours());
  const sMinutes = pad(start.getMinutes());
  const eHours = pad(end.getHours());
  const eMinutes = pad(end.getMinutes());

  const durationMs = end.getTime() - start.getTime();
  const durationHours = (durationMs / (1000 * 60 * 60)).toFixed(1).replace(/\.0$/, '');

  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) {
    return `${year}年${month}月${date}日 (${weekday}) ${sHours}:${sMinutes} - ${eHours}:${eMinutes} (${durationHours}小时)`;
  }

  const eMonth = pad(end.getMonth() + 1);
  const eDate = pad(end.getDate());
  return `${month}/${date} ${sHours}:${sMinutes} 至 ${eMonth}/${eDate} ${eHours}:${eMinutes}`;
}

/**
 * Get tag info for relative date badge
 */
function getRelativeDateTag(startDateStr) {
  const start = new Date(startDateStr);
  const now = new Date();

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const diffDays = Math.round((targetDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return { text: '今天', className: 'today' };
  } else if (diffDays === 1) {
    return { text: '明天', className: 'tomorrow' };
  } else if (diffDays === 2) {
    return { text: '后天', className: 'tomorrow' };
  } else if (diffDays > 2) {
    return { text: `${diffDays}天后`, className: 'future' };
  } else if (diffDays === -1) {
    return { text: '昨天', className: 'future' };
  } else {
    return { text: `${Math.abs(diffDays)}天前`, className: 'future' };
  }
}

/**
 * Load preferences and schedules from localStorage
 */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    schedules = raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Failed to load schedules from localStorage', err);
    schedules = [];
  }

  const autoDlPref = localStorage.getItem(AUTO_DOWNLOAD_KEY);
  if (autoDlPref !== null) {
    autoDownloadEnabled = autoDlPref === 'true';
    autoDownloadToggle.checked = autoDownloadEnabled;
  }

  const useAiPref = localStorage.getItem(USE_AI_KEY);
  if (useAiPref !== null) {
    useAiEnabled = useAiPref === 'true';
    if (aiToggle) aiToggle.checked = useAiEnabled;
  }

  cfAccountId = localStorage.getItem(CF_ACCOUNT_KEY) || '';
  cfApiToken = localStorage.getItem(CF_TOKEN_KEY) || '';
  if (cfAccountIdInput) cfAccountIdInput.value = cfAccountId;
  if (cfApiTokenInput) cfApiTokenInput.value = cfApiToken;
}

/**
 * Save schedules to localStorage
 */
function saveSchedules() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(schedules));
  } catch (err) {
    console.error('Failed to save schedules', err);
  }
}

/**
 * Clean outdated schedules (ended before current time)
 * @param {boolean} [notify] - whether to show toast notice
 */
function cleanOutdatedSchedules(notify = false) {
  const now = new Date();
  const initialLength = schedules.length;
  schedules = schedules.filter(item => !isEventOutdated(item, now));
  const removedCount = initialLength - schedules.length;

  if (removedCount > 0) {
    saveSchedules();
    renderSchedulesList();
    if (notify) {
      showToast(`已自动清理 ${removedCount} 个过期日程`, 'info');
    }
  } else if (notify) {
    showToast('暂无过期日程需清理', 'info');
  }
}

/**
 * Render schedules list in DOM
 */
function renderSchedulesList() {
  schedulesList.innerHTML = '';
  scheduleCount.textContent = schedules.length;

  if (schedules.length === 0) {
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';

  // Sort upcoming schedules: earliest start time first
  const sorted = [...schedules].sort((a, b) => {
    return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
  });

  sorted.forEach(item => {
    const card = document.createElement('div');
    card.className = 'schedule-card';

    const relTag = getRelativeDateTag(item.startTime);
    const formattedTime = formatDisplayDateTime(item.startTime, item.endTime, item.allDay);
    const isAi = item.parserType === 'gemma-4-26b-a4b-it';

    card.innerHTML = `
      <div class="schedule-card-top">
        <div class="card-title-group">
          <div class="card-title">
            <span class="time-tag ${relTag.className}">${relTag.text}</span>
            ${item.isModified ? '<span class="time-tag modified">已更新</span>' : ''}
            <span>${escapeHtml(item.title)}</span>
            <span class="engine-badge ${isAi ? 'ai' : 'local'}" style="font-size: 0.7rem; padding: 1px 6px;">
              ${isAi ? '🤖 Gemma 4' : '⚡ 本地'}
            </span>
          </div>
        </div>
      </div>

      <div class="schedule-details">
        <div class="detail-item">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <span>${formattedTime}</span>
        </div>

        ${item.location ? `
          <div class="detail-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
              <circle cx="12" cy="10" r="3"></circle>
            </svg>
            <span>${escapeHtml(item.location)}</span>
          </div>
        ` : ''}

        ${item.url ? `
          <div class="detail-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
            </svg>
            <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">打开会议/链接</a>
          </div>
        ` : ''}
      </div>

      ${item.description && item.description !== item.title ? `
        <div class="card-raw-text">${escapeHtml(item.description)}</div>
      ` : ''}

      <div class="card-actions">
        <button type="button" class="btn btn-secondary btn-sm copy-btn" data-id="${item.id}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          复制
        </button>
        <button type="button" class="btn btn-primary btn-sm redownload-btn" data-id="${item.id}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          ${isNativeApp() ? '加入日历' : '下载 .ics'}
        </button>
        ${isNativeApp() ? `
          <button type="button" class="btn btn-secondary btn-sm export-ics-btn" data-id="${item.id}" title="导出为标准 .ics 文件">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            导出 .ics
          </button>
        ` : ''}
        <button type="button" class="btn btn-danger-outline btn-sm delete-btn" data-id="${item.id}" title="删除日程">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    `;

    schedulesList.appendChild(card);
  });
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render parsed event in the preview card
 */
function displayInPreview(event, isAi = false, isPending = false) {
  if (!event) {
    previewCard.classList.remove('show');
    return;
  }

  previewTitle.textContent = event.title;
  previewTime.textContent = formatDisplayDateTime(event.startTime, event.endTime, event.allDay);

  const previewModBanner = document.getElementById('previewModBanner');
  if (previewModBanner) {
    if (event.isModification && event.targetCriteria) {
      const matched = findMatchingSchedule(event.targetCriteria, schedules);
      if (matched) {
        previewModBanner.className = 'preview-mod-banner';
        const locDisplay = (event.keepExistingLocation || !event.location)
          ? `保持原地点 (${escapeHtml(matched.location || '未设地点')})`
          : escapeHtml(event.location);

        previewModBanner.innerHTML = `
          <div class="preview-mod-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="1 4 1 10 7 10"></polyline>
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
            </svg>
            检测到修改计划意图：将更新已有日程
          </div>
          <div class="preview-mod-body">
            目标日程：<strong>${escapeHtml(matched.title)}</strong><br>
            原时间：${formatDisplayDateTime(matched.startTime, matched.endTime, matched.allDay)}<br>
            新时间：<span class="highlight">${formatDisplayDateTime(event.startTime, event.endTime, event.allDay)}</span>
            <br>地点：${locDisplay}
          </div>
        `;
        previewModBanner.style.display = 'flex';
      } else {
        previewModBanner.className = 'preview-mod-banner info';
        previewModBanner.innerHTML = `
          <div class="preview-mod-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            检测到修改计划意图
          </div>
          <div class="preview-mod-body">
            当前列表中未找到原计划，生成时将作为新日程添加。
          </div>
        `;
        previewModBanner.style.display = 'flex';
      }
    } else {
      previewModBanner.style.display = 'none';
    }
  }

  if (event.location) {
    previewLoc.textContent = event.location;
    previewLocItem.style.display = 'inline-flex';
  } else {
    previewLocItem.style.display = 'none';
  }

  if (event.url) {
    previewUrl.href = event.url;
    previewUrlItem.style.display = 'inline-flex';
  } else {
    previewUrlItem.style.display = 'none';
  }

  if (previewEngineBadge) {
    previewEngineBadge.textContent = isAi ? '🤖 Gemma 4 26B' : '⚡ 本地解析';
    previewEngineBadge.className = `engine-badge ${isAi ? 'ai' : 'local'}`;
  }

  if (previewStatus) {
    if (isPending) {
      previewStatus.innerHTML = '<span class="spinner"></span> 深度解析中...';
    } else {
      previewStatus.textContent = isAi ? 'AI 解析完成' : '准备就绪';
    }
  }

  previewCard.classList.add('show');
}

/**
 * Handle real-time preview of parsed text
 * First instant local preview, then async Gemma AI refinement
 */
function updatePreview() {
  const text = scheduleInput.value.trim();
  if (!text) {
    previewCard.classList.remove('show');
    return null;
  }

  // 1. Instant local preview
  const localParsed = parseScheduleText(text);
  if (localParsed) {
    displayInPreview(localParsed, false, useAiEnabled);
  }

  // 2. If AI enabled, trigger background Gemma 4 parse
  if (useAiEnabled && text.length >= 4) {
    if (aiPreviewAbortController) {
      aiPreviewAbortController.abort();
    }
    aiPreviewAbortController = new AbortController();

    const promise = parseScheduleWithGemma(text, {
      accountId: cfAccountId,
      apiToken: cfApiToken,
      signal: aiPreviewAbortController.signal
    }).then((aiEvent) => {
      // Check if current text hasn't changed
      if (scheduleInput.value.trim() === text) {
        latestParsedText = text;
        latestAiEvent = aiEvent;
        displayInPreview(aiEvent, true, false);
      }
      return aiEvent;
    }).catch((err) => {
      if (scheduleInput.value.trim() === text && previewStatus) {
        previewStatus.textContent = '本地解析就绪';
      }
      return null;
    });

    currentAiPromise = promise;
  }

  return localParsed;
}

/**
 * Process schedule text: parse (AI or local), save to list, and trigger ICS download
 * @param {string} text
 * @param {boolean} triggerDownload
 * @param {boolean} force - whether to bypass duplicate check (e.g. manual click)
 */
async function processAndGenerate(text, triggerDownload = true, force = false) {
  if (!text || !text.trim()) {
    showToast('请输入日程文本', 'info');
    return null;
  }

  const targetText = text.trim();

  // Clear any pending timers immediately to prevent duplicate runs
  clearTimeout(debounceTimer);
  clearTimeout(autoDownloadTimer);

  // If automatic trigger and text was already downloaded, prevent duplicate download
  if (!force && triggerDownload && targetText === lastDownloadedText) {
    return null;
  }

  if (triggerDownload) {
    lastDownloadedText = targetText;
  }

  generateBtn.disabled = true;
  generateBtn.innerHTML = '<span class="spinner"></span> 正在解析...';

  let event = null;
  try {
    if (useAiEnabled) {
      // 1. If we already have resolved AI event for this text, reuse it
      if (latestParsedText === targetText && latestAiEvent) {
        event = latestAiEvent;
      } else if (currentAiPromise && scheduleInput.value.trim() === targetText) {
        // 2. If AI request is currently in-flight, await it
        event = await currentAiPromise;
        if (!event) {
          event = parseScheduleText(targetText);
        }
      } else {
        event = await parseScheduleTextAsync(targetText, {
          accountId: cfAccountId,
          apiToken: cfApiToken,
          useAi: true
        });
      }
    } else {
      event = parseScheduleText(targetText);
    }
  } catch (err) {
    console.error('Parsing failed:', err);
    event = parseScheduleText(targetText);
  } finally {
    generateBtn.disabled = false;
    const btnText = isNativeApp() ? '生成并加入日历' : '生成并下载 .ics';
    generateBtn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      ${btnText}
    `;
  }

  if (!event) {
    showToast('未能识别有效的时间或日程内容', 'danger');
    return null;
  }

  let isUpdatedExisting = false;
  let updatedScheduleTitle = '';

  if (event.isModification && event.targetCriteria) {
    const matched = findMatchingSchedule(event.targetCriteria, schedules);
    if (matched) {
      const idx = schedules.findIndex(s => s.id === matched.id);
      if (idx !== -1) {
        const finalLocation = (event.keepExistingLocation || !event.location)
          ? (matched.location || event.location || '')
          : event.location;

        const finalUrl = event.url || matched.url || '';
        const finalTitle = (matched.title && matched.title.includes(event.title))
          ? matched.title
          : (event.title || matched.title);

        const updatedEvent = {
          ...matched,
          title: finalTitle,
          startTime: event.startTime,
          endTime: event.endTime,
          allDay: event.allDay,
          location: finalLocation,
          url: finalUrl,
          description: `${event.description}\n[已于 ${new Date().toLocaleTimeString()} 调整时间]`,
          isModified: true,
          updatedAt: new Date().toISOString(),
          parserType: event.parserType
        };

        schedules[idx] = updatedEvent;
        event = updatedEvent;
        isUpdatedExisting = true;
        updatedScheduleTitle = finalTitle;
      }
    }
  }

  if (!isUpdatedExisting) {
    // Check if identical event already exists to avoid redundant duplicates
    const existingIdx = schedules.findIndex(s =>
      s.title === event.title && s.startTime === event.startTime && s.endTime === event.endTime
    );

    if (existingIdx !== -1) {
      schedules[existingIdx] = event;
    } else {
      schedules.unshift(event);
    }
  }

  saveSchedules();
  renderSchedulesList();
  displayInPreview(event, event.parserType === 'gemma-4-26b-a4b-it', false);

  if (triggerDownload) {
    await openCalendarEvent(event);
    const engineName = event.parserType === 'gemma-4-26b-a4b-it' ? ' (Gemma 4 AI)' : '';
    if (isUpdatedExisting) {
      const successMsg = isNativeApp()
        ? `已更新系统日历: ${updatedScheduleTitle}${engineName}`
        : `已更新已有日程并下载 .ics: ${updatedScheduleTitle}${engineName}`;
      showToast(successMsg, 'success');
    } else {
      const successMsg = isNativeApp()
        ? `已唤起系统日历: ${event.title}${engineName}`
        : `已下载 .ics 文件: ${event.title}${engineName}`;
      showToast(successMsg, 'success');
    }
  }

  return event;
}

/**
 * Setup event listeners
 */
function setupListeners() {
  // Input changes
  scheduleInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    clearTimeout(autoDownloadTimer);

    debounceTimer = setTimeout(() => {
      const parsed = updatePreview();
      const currentText = scheduleInput.value.trim();

      // If auto-download enabled and text has changed significantly
      if (autoDownloadEnabled && parsed && currentText.length >= 4 && currentText !== lastDownloadedText) {
        autoDownloadTimer = setTimeout(() => {
          processAndGenerate(currentText, true, false);
        }, 1600);
      }
    }, 300);
  });

  // Paste event - fast auto-download trigger
  scheduleInput.addEventListener('paste', () => {
    clearTimeout(debounceTimer);
    clearTimeout(autoDownloadTimer);

    setTimeout(() => {
      clearTimeout(debounceTimer);
      clearTimeout(autoDownloadTimer);
      const parsed = updatePreview();
      const text = scheduleInput.value.trim();
      if (autoDownloadEnabled && parsed && text !== lastDownloadedText) {
        processAndGenerate(text, true, false);
      }
    }, 100);
  });

  // Auto download toggle
  autoDownloadToggle.addEventListener('change', (e) => {
    autoDownloadEnabled = e.target.checked;
    localStorage.setItem(AUTO_DOWNLOAD_KEY, String(autoDownloadEnabled));
    showToast(autoDownloadEnabled ? '已开启自动下载 .ics' : '已关闭自动下载，可通过按钮手动下载', 'info');
  });

  // AI Toggle
  if (aiToggle) {
    aiToggle.addEventListener('change', (e) => {
      useAiEnabled = e.target.checked;
      localStorage.setItem(USE_AI_KEY, String(useAiEnabled));
      showToast(useAiEnabled ? '已启用 Gemma 4 AI 深度解析' : '已切换为本地轻量规则解析', 'info');
      updatePreview();
    });
  }

  // Modal open & close
  if (aiConfigBtn) {
    aiConfigBtn.addEventListener('click', () => {
      cfAccountIdInput.value = cfAccountId;
      cfApiTokenInput.value = cfApiToken;
      aiConfigModal.style.display = 'flex';
    });
  }

  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', () => {
      aiConfigModal.style.display = 'none';
    });
  }

  if (aiConfigModal) {
    aiConfigModal.addEventListener('click', (e) => {
      if (e.target === aiConfigModal) {
        aiConfigModal.style.display = 'none';
      }
    });
  }

  if (saveConfigBtn) {
    saveConfigBtn.addEventListener('click', () => {
      cfAccountId = cfAccountIdInput.value.trim();
      cfApiToken = cfApiTokenInput.value.trim();
      localStorage.setItem(CF_ACCOUNT_KEY, cfAccountId);
      localStorage.setItem(CF_TOKEN_KEY, cfApiToken);
      aiConfigModal.style.display = 'none';
      showToast('Cloudflare 配置已更新并保存到本地', 'success');
      updatePreview();
    });
  }

  if (clearConfigBtn) {
    clearConfigBtn.addEventListener('click', () => {
      cfAccountId = '';
      cfApiToken = '';
      cfAccountIdInput.value = '';
      cfApiTokenInput.value = '';
      localStorage.removeItem(CF_ACCOUNT_KEY);
      localStorage.removeItem(CF_TOKEN_KEY);
      aiConfigModal.style.display = 'none';
      showToast('已清除本地配置的 Cloudflare 凭证', 'info');
      updatePreview();
    });
  }

  // Generate button
  generateBtn.addEventListener('click', () => {
    const text = scheduleInput.value.trim();
    if (!text) {
      showToast('请输入日程文本后再生成', 'info');
      scheduleInput.focus();
      return;
    }
    processAndGenerate(text, true, true);
  });

  // Clear button
  clearInputBtn.addEventListener('click', () => {
    scheduleInput.value = '';
    previewCard.classList.remove('show');
    lastDownloadedText = '';
    latestParsedText = '';
    latestAiEvent = null;
    currentAiPromise = null;
    clearTimeout(debounceTimer);
    clearTimeout(autoDownloadTimer);
    if (aiPreviewAbortController) {
      aiPreviewAbortController.abort();
    }
    scheduleInput.focus();
  });

  // Preset chips
  document.querySelectorAll('.preset-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const sampleText = btn.getAttribute('data-text');
      scheduleInput.value = sampleText;
      updatePreview();
      processAndGenerate(sampleText, true, true);
    });
  });

  // Schedule list actions (delegation)
  schedulesList.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.copy-btn');
    if (copyBtn) {
      const id = copyBtn.getAttribute('data-id');
      const item = schedules.find(s => s.id === id);
      if (item) {
        const timeStr = formatDisplayDateTime(item.startTime, item.endTime, item.allDay);
        const textToCopy = `【${item.title}】\n时间：${timeStr}${item.location ? `\n地点：${item.location}` : ''}${item.url ? `\n链接：${item.url}` : ''}`;
        navigator.clipboard.writeText(textToCopy).then(() => {
          showToast('日程信息已复制到剪贴板', 'success');
        }).catch(() => {
          showToast('复制失败，请手动选取', 'danger');
        });
      }
      return;
    }

    const redownloadBtn = e.target.closest('.redownload-btn');
    if (redownloadBtn) {
      const id = redownloadBtn.getAttribute('data-id');
      const item = schedules.find(s => s.id === id);
      if (item) {
        openCalendarEvent(item).then(() => {
          showToast(isNativeApp() ? `已唤起系统日历: ${item.title}` : `已下载 .ics 文件: ${item.title}`, 'success');
        });
      }
      return;
    }

    const exportIcsBtn = e.target.closest('.export-ics-btn');
    if (exportIcsBtn) {
      const id = exportIcsBtn.getAttribute('data-id');
      const item = schedules.find(s => s.id === id);
      if (item) {
        const icsData = buildICS(item);
        const filename = getSafeICSFilename(item.title);
        downloadICS(icsData, filename);
        showToast(`已导出 .ics 文件: ${filename}`, 'success');
      }
      return;
    }

    const deleteBtn = e.target.closest('.delete-btn');
    if (deleteBtn) {
      const id = deleteBtn.getAttribute('data-id');
      schedules = schedules.filter(s => s.id !== id);
      saveSchedules();
      renderSchedulesList();
      showToast('已删除该日程', 'info');
      return;
    }
  });

  // Cleanup outdated schedules
  cleanupBtn.addEventListener('click', () => {
    cleanOutdatedSchedules(true);
  });

  // Clear all schedules
  clearAllBtn.addEventListener('click', () => {
    if (schedules.length === 0) {
      showToast('列表中暂无日程', 'info');
      return;
    }
    if (window.confirm('确定要清空所有日程记录吗？')) {
      schedules = [];
      saveSchedules();
      renderSchedulesList();
      showToast('已清空全部日程', 'info');
    }
  });

  // Periodic cleanup check when tab is visible
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      cleanOutdatedSchedules(false);
    }
  });
  setInterval(() => {
    cleanOutdatedSchedules(false);
  }, 60000);
}

/**
 * Handle incoming shared text from Web Share Target API or URL query params
 */
function handleIncomingShare() {
  const params = new URLSearchParams(window.location.search);
  const sharedTitle = params.get('title') || '';
  const sharedText = params.get('text') || '';
  const sharedUrl = params.get('url') || '';

  const combined = [sharedTitle, sharedText, sharedUrl].filter(Boolean).join(' ').trim();
  if (combined) {
    scheduleInput.value = combined;
    updatePreview();
    showToast('已接收分享文本，正在解析日程...', 'info');
    // Process and auto-download
    setTimeout(() => {
      processAndGenerate(combined, true, true);
    }, 200);

    // Clean URL query parameters
    try {
      const cleanUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
    } catch (e) {
      // Ignore if in restricted environment
    }
  }
}

/**
 * PWA installation setup
 */
function setupPWA() {
  // Register Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        console.log('ServiceWorker registered with scope:', reg.scope);
      }).catch((err) => {
        console.log('ServiceWorker registration failed:', err);
      });
    });
  }

  window.addEventListener('appinstalled', () => {
    showToast('日程生成器已成功安装至桌面/主屏幕', 'success');
  });
}

/**
 * Platform adjustments when running inside native Capacitor environment
 */
function setupNativePlatform() {
  if (isNativeApp()) {
    // Hide download APK button in native app
    const downloadApkBtn = document.getElementById('downloadApkBtn');
    if (downloadApkBtn) downloadApkBtn.style.display = 'none';

    // Update main action button text
    if (generateBtn) {
      generateBtn.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        生成并加入日历
      `;
    }

    function applyIncomingSharedData(payload) {
      if (!payload) return;
      let text = '';
      let source = 'text';
      let fileName = '';

      if (typeof payload === 'string') {
        text = payload.trim();
      } else if (typeof payload === 'object') {
        text = (payload.text || '').trim();
        source = payload.source || 'text';
        fileName = payload.fileName || '';
      }

      if (!text) return;

      scheduleInput.value = text;
      updatePreview();

      if (source === 'zip') {
        showToast(`已从压缩包 [${fileName || 'ZIP'}] 中提取文本，正在解析日程...`, 'info');
      } else if (source === 'file') {
        showToast(`已从文件 [${fileName || '文件'}] 中读取文本，正在解析日程...`, 'info');
      } else {
        showToast('已接收系统分享文本，正在解析日程...', 'info');
      }

      processAndGenerate(text, true, true);
    }

    // Native text/file/zip share intent listener
    window.addEventListener('calgen:sharedText', (e) => {
      applyIncomingSharedData(e.detail);
    });

    if (window.__CALGEN_SHARED_PAYLOAD__) {
      const payload = window.__CALGEN_SHARED_PAYLOAD__;
      window.__CALGEN_SHARED_PAYLOAD__ = null;
      window.__CALGEN_SHARED_TEXT__ = null;
      applyIncomingSharedData(payload);
    } else if (window.__CALGEN_SHARED_TEXT__) {
      const text = window.__CALGEN_SHARED_TEXT__;
      window.__CALGEN_SHARED_TEXT__ = null;
      applyIncomingSharedData(text);
    }
  }
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  loadState();
  cleanOutdatedSchedules(false);
  renderSchedulesList();
  setupListeners();
  handleIncomingShare();
  setupPWA();
  setupNativePlatform();
});


