// Debug Page JavaScript

const debugEventsContainer = document.getElementById('debug-events-container');
const debugEventsEl = document.getElementById('debug-events');
const debugRefreshBtn = document.getElementById('debug-refresh-btn');
const debugClearBtn = document.getElementById('debug-clear-btn');
const debugMemoryBtn = document.getElementById('debug-memory-btn');
const autoScrollBtn = document.getElementById('auto-scroll-btn');
const userBadge = document.getElementById('user-badge');
const statusBadge = document.getElementById('status-badge');

// Stats elements
const statTotal = document.getElementById('stat-total');
const statOpenAICalls = document.getElementById('stat-openai-calls');
const statOpenAIResponses = document.getElementById('stat-openai-responses');
const statTools = document.getElementById('stat-tools');
const statHelpers = document.getElementById('stat-helpers');
const statMainIters = document.getElementById('stat-main-iters');

let autoScroll = true;
let currentUsername = null;
let lastScrollPosition = 0;
let isUserScrolling = false;

// Check if user is at bottom of scroll
const isAtBottom = () => {
  if (!debugEventsContainer) return true;
  const threshold = 100; // pixels from bottom
  const scrollTop = debugEventsContainer.scrollTop;
  const scrollHeight = debugEventsContainer.scrollHeight;
  const clientHeight = debugEventsContainer.clientHeight;
  return scrollHeight - scrollTop - clientHeight < threshold;
};

// Track user scrolling
if (debugEventsContainer) {
  debugEventsContainer.addEventListener('scroll', () => {
    const currentScrollTop = debugEventsContainer.scrollTop;

    // User scrolled up
    if (currentScrollTop < lastScrollPosition) {
      isUserScrolling = true;

      // If they scroll back to near bottom, re-enable auto-scroll
      if (isAtBottom()) {
        isUserScrolling = false;
      }
    }

    lastScrollPosition = currentScrollTop;
  });
}

const renderDebugEvents = (events) => {
  if (!debugEventsEl) return;

  const wasAtBottom = isAtBottom();

  debugEventsEl.innerHTML = '';

  // Update stats
  const stats = {
    total: events.length,
    openaiCalls: 0,
    openaiResponses: 0,
    tools: 0,
    helpers: 0,
    mainIters: 0
  };

  events.forEach(event => {
    // Count stats
    if (event.type === 'openai-call') stats.openaiCalls++;
    else if (event.type === 'openai-response') stats.openaiResponses++;
    else if (event.type === 'tool-execution') stats.tools++;
    else if (event.type === 'helper-spawn') stats.helpers++;
    else if (event.type === 'main-iteration') stats.mainIters++;

    const eventEl = document.createElement('div');
    eventEl.className = `debug-event ${event.type}`;

    const header = document.createElement('div');
    header.className = 'debug-event-header';

    const typeEl = document.createElement('span');
    typeEl.className = 'debug-event-type';
    typeEl.textContent = event.type.replace(/-/g, ' ');

    const timeEl = document.createElement('span');
    timeEl.className = 'debug-event-time';
    const time = new Date(event.timestamp);
    timeEl.textContent = time.toLocaleTimeString();

    header.appendChild(typeEl);
    header.appendChild(timeEl);

    const body = document.createElement('div');
    body.className = 'debug-event-body';

    // Format the event data nicely
    const displayData = { ...event };
    delete displayData.id; // Remove internal ID
    delete displayData.timestamp; // Already shown in header

    body.textContent = JSON.stringify(displayData, null, 2);

    eventEl.appendChild(header);
    eventEl.appendChild(body);

    debugEventsEl.appendChild(eventEl);
  });

  // Update stats display
  if (statTotal) statTotal.textContent = stats.total;
  if (statOpenAICalls) statOpenAICalls.textContent = stats.openaiCalls;
  if (statOpenAIResponses) statOpenAIResponses.textContent = stats.openaiResponses;
  if (statTools) statTools.textContent = stats.tools;
  if (statHelpers) statHelpers.textContent = stats.helpers;
  if (statMainIters) statMainIters.textContent = stats.mainIters;

  // Only auto-scroll if:
  // 1. Auto-scroll is enabled
  // 2. User was at bottom before update OR user hasn't manually scrolled up
  if (autoScroll && (wasAtBottom || !isUserScrolling)) {
    requestAnimationFrame(() => {
      if (debugEventsContainer) {
        debugEventsContainer.scrollTop = debugEventsContainer.scrollHeight;
      }
    });
  }
};

const fetchDebugEvents = async () => {
  try {
    const res = await fetch('/api/debug/events');
    if (!res.ok) {
      if (res.status === 401) {
        userBadge.textContent = 'Not Logged In';
        statusBadge.textContent = 'Not Authenticated';
        statusBadge.classList.add('disconnected');
        return;
      }
      throw new Error('Failed to fetch debug events');
    }

    const data = await res.json();

    // Update user badge
    if (data.username) {
      currentUsername = data.username;
      userBadge.textContent = data.username;
      statusBadge.textContent = 'Connected';
      statusBadge.classList.remove('disconnected');
    }

    renderDebugEvents(data.events || []);
  } catch (error) {
    console.error('Debug events error:', error);
    statusBadge.textContent = 'Error';
    statusBadge.classList.add('disconnected');
  }
};

const clearDebugEvents = async () => {
  if (!confirm('Clear all debug events for this session?')) return;

  try {
    await fetch('/api/debug/clear', { method: 'POST' });
    renderDebugEvents([]);
  } catch (error) {
    console.error('Debug clear error:', error);
    alert('Failed to clear events: ' + error.message);
  }
};

const showMemory = async () => {
  try {
    const res = await fetch('/api/debug/memory');
    if (!res.ok) throw new Error('Failed to fetch memory');
    const data = await res.json();

    // Show in a modal overlay
    const memoryContent = JSON.stringify(data, null, 2);
    const memoryDiv = document.createElement('div');
    memoryDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(20,20,30,0.98);padding:2rem;border-radius:1rem;max-width:90%;max-height:90%;overflow:auto;z-index:1000;border:2px solid rgba(255,255,255,0.2);';

    const header = document.createElement('h2');
    header.textContent = 'MCP Knowledge Graph Memory';
    header.style.cssText = 'margin:0 0 1rem 0;font-size:1.25rem;';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.className = 'ghost';
    closeBtn.style.cssText = 'position:absolute;top:1rem;right:1rem;';
    closeBtn.onclick = () => {
      document.body.removeChild(memoryDiv);
      document.body.removeChild(overlay);
    };

    const pre = document.createElement('pre');
    pre.className = 'debug-memory';
    pre.textContent = memoryContent;
    pre.style.cssText = 'margin:0;font-size:0.75rem;line-height:1.6;';

    memoryDiv.appendChild(closeBtn);
    memoryDiv.appendChild(header);
    memoryDiv.appendChild(pre);

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);z-index:999;';
    overlay.onclick = () => {
      document.body.removeChild(memoryDiv);
      document.body.removeChild(overlay);
    };

    document.body.appendChild(overlay);
    document.body.appendChild(memoryDiv);
  } catch (error) {
    console.error('Memory fetch error:', error);
    alert('Failed to fetch memory: ' + error.message);
  }
};

const toggleAutoScroll = () => {
  autoScroll = !autoScroll;
  isUserScrolling = !autoScroll; // Reset user scrolling flag

  if (autoScrollBtn) {
    autoScrollBtn.textContent = `Auto-scroll: ${autoScroll ? 'ON' : 'OFF'}`;
  }

  // If enabling auto-scroll, scroll to bottom immediately
  if (autoScroll && debugEventsContainer) {
    debugEventsContainer.scrollTop = debugEventsContainer.scrollHeight;
  }
};

// Event listeners
if (debugRefreshBtn) {
  debugRefreshBtn.addEventListener('click', fetchDebugEvents);
}

if (debugClearBtn) {
  debugClearBtn.addEventListener('click', clearDebugEvents);
}

if (debugMemoryBtn) {
  debugMemoryBtn.addEventListener('click', showMemory);
}

if (autoScrollBtn) {
  autoScrollBtn.addEventListener('click', toggleAutoScroll);
}

// Check session on load
const checkSession = async () => {
  try {
    const res = await fetch('/api/session');
    const data = await res.json();

    if (data.authenticated) {
      currentUsername = data.username;
      userBadge.textContent = data.username;
      statusBadge.textContent = 'Connected';
      statusBadge.classList.remove('disconnected');
    } else {
      userBadge.textContent = 'Not Logged In';
      statusBadge.textContent = 'Please log in to main page';
      statusBadge.classList.add('disconnected');
    }
  } catch (error) {
    console.error('Session check error:', error);
    statusBadge.textContent = 'Connection Error';
    statusBadge.classList.add('disconnected');
  }
};

// Initial load
checkSession().then(() => {
  fetchDebugEvents();
});

// Auto-refresh every 2 seconds
setInterval(() => {
  if (currentUsername) {
    fetchDebugEvents();
  }
}, 2000);
