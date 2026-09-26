/**
 * CampusPulse - EXACT Interaction & Animation Engine
 * Implements precise easing, RAF ease-out count-ups, sliding nav indicator,
 * snappy modals, row scale-pulses, dark mode theme engine, and tactile feedback.
 */

// 0. Instant Theme Engine Initialization
(function initThemeEngine() {
  const THEME_KEY = 'campuspulse-theme';

  function getSystemPrefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function applyTheme(theme) {
    const isDark = theme === 'dark' || (theme === 'system' && getSystemPrefersDark());
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    // Update active state on any theme buttons in DOM
    document.querySelectorAll('[data-theme-btn]').forEach(btn => {
      const btnTheme = btn.getAttribute('data-theme-btn');
      if (btnTheme === theme) {
        btn.classList.add('theme-active');
        btn.setAttribute('aria-pressed', 'true');
      } else {
        btn.classList.remove('theme-active');
        btn.setAttribute('aria-pressed', 'false');
      }
    });
  }

  // Initial load
  const savedTheme = localStorage.getItem(THEME_KEY) || 'system';
  applyTheme(savedTheme);

  // System OS theme change listener
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      const current = localStorage.getItem(THEME_KEY) || 'system';
      if (current === 'system') {
        applyTheme('system');
      }
    });
  }

  // Global toggle function accessible from HTML onclick
  window.setCampusPulseTheme = function(theme) {
    if (!['light', 'dark', 'system'].includes(theme)) return;
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  // Sync buttons on DOM ready
  const currentTheme = localStorage.getItem('campuspulse-theme') || 'system';
  window.setCampusPulseTheme(currentTheme);

  // 1. Automatic Stagger Indexing for Page Load Fade-Up
  initStaggeredEntrance();

  // 2. Exact RAF Ease-Out Number Counting Up (800-1000ms)
  initNumericCountUps();

  // 3. Sliding Sidebar Navigation Indicator (300ms smooth slide)
  initSlidingNavIndicator();

  // 4. Modal Open/Close Scale & Fade Transitions
  initModalInteractions();

  // 5. Attendance Table Row Scale-Pulse & Smooth Status Transition
  initAttendanceTableInteractions();

  // 6. Interactive Quiz Option Selection & Bouncing Checkmark
  initQuizOptionSelection();

  // 7. Form Shake & Input Glow
  initFormInteractions();

  // 8. Toast Auto-Dismissal (4s timer, 300ms slide-up fade)
  initToastDismissals();

  // 9. Chatbot Smooth Origin-Bottom-Right Scale & Message Slide-In
  initChatbot();

  // 10. Mobile Sidebar Drawer Toggle
  initMobileDrawer();

  // 11. Landing Page Scroll Reveal Animations
  initScrollReveal();
});

/**
 * 1. Automatic Stagger Indexing for Cards and Page Sections
 */
function initStaggeredEntrance() {
  const elements = document.querySelectorAll('.card, .bento-card, .page-section-stagger, .stagger-card');
  elements.forEach((el, index) => {
    if (!el.style.getPropertyValue('--i')) {
      el.style.setProperty('--i', (index % 12) + 1);
    }
  });
}

/**
 * 2. Exact RAF Ease-Out Number Counting Up
 * Fast start, slow finish over 900ms
 */
function initNumericCountUps() {
  // Find all elements displaying numeric stats
  const statElements = document.querySelectorAll('.metric-number, .stat-hero-number, [data-stat-counter]');

  statElements.forEach(el => {
    const rawText = el.textContent.trim();
    // Match numeric portion and optional suffix (e.g. "85%", "1,250", "42")
    const match = rawText.match(/^([^\d]*)([\d,.]+)([^\d]*)$/);
    if (!match) return;

    const prefix = match[1] || '';
    const numStr = match[2].replace(/,/g, '');
    const suffix = match[3] || '';
    const targetValue = parseFloat(numStr);

    if (isNaN(targetValue)) return;

    const isDecimal = numStr.includes('.');
    const decimalPlaces = isDecimal ? numStr.split('.')[1].length : 0;
    const duration = 900; // ms (within 800-1000ms spec)
    let startTime = null;

    // Ease-out cubic: fast start, slow finish
    const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

    el.textContent = `${prefix}0${suffix}`;

    function animateCount(timestamp) {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easeOutCubic(progress);

      const currentValue = targetValue * easedProgress;

      if (isDecimal) {
        el.textContent = `${prefix}${currentValue.toFixed(decimalPlaces)}${suffix}`;
      } else {
        el.textContent = `${prefix}${Math.round(currentValue).toLocaleString()}${suffix}`;
      }

      if (progress < 1) {
        requestAnimationFrame(animateCount);
      } else {
        el.textContent = isDecimal
          ? `${prefix}${targetValue.toFixed(decimalPlaces)}${suffix}`
          : `${prefix}${targetValue.toLocaleString()}${suffix}`;
      }
    }

    requestAnimationFrame(animateCount);
  });
}

/**
 * 3. Sliding Sidebar Navigation Indicator (300ms smooth slide)
 */
function initSlidingNavIndicator() {
  const navContainer = document.querySelector('.sidebar-nav-container');
  if (!navContainer) return;

  const links = navContainer.querySelectorAll('.sidebar-link');
  const activeLink = navContainer.querySelector('.sidebar-link.active');
  const indicator = document.getElementById('nav-active-indicator');

  if (!indicator || !activeLink) return;

  // Read previous offset from session storage to animate from previous position across page loads
  const prevNavTop = sessionStorage.getItem('campus_nav_indicator_top');
  const targetTop = activeLink.offsetTop;
  const targetHeight = activeLink.offsetHeight;

  if (prevNavTop !== null && prevNavTop !== `${targetTop}`) {
    // Start at previous link's position
    indicator.style.transition = 'none';
    indicator.style.transform = `translateY(${prevNavTop}px)`;
    indicator.style.height = `${targetHeight}px`;
    indicator.style.opacity = '1';

    // Slide to target position on next tick
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        indicator.style.transition = 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1), height 300ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease';
        indicator.style.transform = `translateY(${targetTop}px)`;
        sessionStorage.setItem('campus_nav_indicator_top', targetTop);
      });
    });
  } else {
    // Direct placement
    indicator.style.transition = 'none';
    indicator.style.transform = `translateY(${targetTop}px)`;
    indicator.style.height = `${targetHeight}px`;
    indicator.style.opacity = '1';
    sessionStorage.setItem('campus_nav_indicator_top', targetTop);

    // Restore transition after render
    setTimeout(() => {
      indicator.style.transition = 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1), height 300ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease';
    }, 50);
  }

  // When clicking any sidebar link, record its offset and slide immediately
  links.forEach(link => {
    link.addEventListener('click', () => {
      sessionStorage.setItem('campus_nav_indicator_top', link.offsetTop);
      indicator.style.transform = `translateY(${link.offsetTop}px)`;
      indicator.style.height = `${link.offsetHeight}px`;
    });
  });
}

/**
 * 4. Modal / Dialog Interactions with Scale & Fade
 */
function initModalInteractions() {
  window.openModal = function(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove('hidden');
    // Force reflow
    void modal.offsetWidth;
    modal.classList.add('active');
    modal.classList.remove('closing');
  };

  window.closeModal = function(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.add('closing');
    setTimeout(() => {
      modal.classList.remove('active', 'closing');
      modal.classList.add('hidden');
    }, 150); // Exact 150ms closing duration
  };

  // Close when clicking outside modal panel
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        closeModal(backdrop.id);
      }
    });
  });
}

/**
 * 5. Attendance Table Row Scale-Pulse & Smooth Status Transition
 */
function initAttendanceTableInteractions() {
  const rows = document.querySelectorAll('.attendance-row');
  
  function applyRowState(row, animate = false) {
    const checkedRadio = row.querySelector('input[type="radio"]:checked');
    if (!checkedRadio) return;

    if (checkedRadio.value === 'Present') {
      row.classList.add('row-present');
      row.classList.remove('row-absent');
    } else if (checkedRadio.value === 'Absent') {
      row.classList.add('row-absent');
      row.classList.remove('row-present');
    }

    if (animate) {
      // Very brief scale-pulse (scale(1.01) for 200ms)
      row.classList.remove('row-scale-pulse');
      void row.offsetWidth; // re-trigger reflow
      row.classList.add('row-scale-pulse');
      setTimeout(() => row.classList.remove('row-scale-pulse'), 200);
    }
  }

  rows.forEach(row => {
    applyRowState(row, false);
    const radios = row.querySelectorAll('input[type="radio"]');
    radios.forEach(radio => {
      radio.addEventListener('change', () => applyRowState(row, true));
    });
  });

  // Staggered cascade for "All Present" and "All Absent" buttons
  const markAllPresentBtn = document.getElementById('mark-all-present');
  const markAllAbsentBtn = document.getElementById('mark-all-absent');

  if (markAllPresentBtn) {
    markAllPresentBtn.addEventListener('click', (e) => {
      e.preventDefault();
      rows.forEach((row, idx) => {
        setTimeout(() => {
          const radio = row.querySelector('input[type="radio"][value="Present"]');
          if (radio) {
            radio.checked = true;
            applyRowState(row, true);
          }
        }, idx * 35);
      });
    });
  }

  if (markAllAbsentBtn) {
    markAllAbsentBtn.addEventListener('click', (e) => {
      e.preventDefault();
      rows.forEach((row, idx) => {
        setTimeout(() => {
          const radio = row.querySelector('input[type="radio"][value="Absent"]');
          if (radio) {
            radio.checked = true;
            applyRowState(row, true);
          }
        }, idx * 35);
      });
    });
  }
}

/**
 * 6. Interactive Quiz Option Selection & Bouncing Checkmark Icon
 */
function initQuizOptionSelection() {
  const optionCards = document.querySelectorAll('.quiz-option-card');
  optionCards.forEach(card => {
    const radio = card.querySelector('input[type="radio"]');
    if (!radio) return;

    if (radio.checked) card.classList.add('selected');

    card.addEventListener('click', (e) => {
      // If clicked on card rather than directly on radio, toggle radio
      if (e.target !== radio) {
        radio.checked = true;
      }
      const groupName = radio.name;
      document.querySelectorAll(`input[name="${groupName}"]`).forEach(siblingRadio => {
        const siblingCard = siblingRadio.closest('.quiz-option-card');
        if (siblingCard) siblingCard.classList.remove('selected');
      });
      card.classList.add('selected');
    });
  });
}

/**
 * 7. Form Interactions: Input Glow & Invalid Submit Horizontal Shake
 */
function initFormInteractions() {
  // If error banner is present on page, shake the card
  const errorAlert = document.querySelector('.flash-alert-error, .toast-error');
  if (errorAlert) {
    const card = errorAlert.closest('.card, .content-panel, form') || errorAlert;
    card.classList.add('animate-shake');
    setTimeout(() => card.classList.remove('animate-shake'), 450);
  }

  // Handle form submissions: tactile button loading feedback
  const forms = document.querySelectorAll('form:not(#chatbot-form)');
  forms.forEach(form => {
    form.addEventListener('submit', function(e) {
      if (!this.checkValidity()) {
        e.preventDefault();
        this.classList.add('animate-shake');
        setTimeout(() => this.classList.remove('animate-shake'), 450);
        return;
      }
      const submitBtn = this.querySelector('button[type="submit"]');
      if (submitBtn && !submitBtn.classList.contains('no-spin')) {
        submitBtn.classList.add('btn-loading');
        setTimeout(() => {
          submitBtn.disabled = true;
        }, 15);
      }
    });
  });
}

/**
 * 8. Toast Auto-Dismissal (4s visible, 300ms slide-up fade out)
 */
function initToastDismissals() {
  const toasts = document.querySelectorAll('.toast-notification, .flash-alert');
  toasts.forEach(toast => {
    setTimeout(() => {
      toast.classList.add('dismissing');
      setTimeout(() => toast.remove(), 300);
    }, 4000); // 4 seconds visible
  });
}

/**
 * 9. Chatbot Smooth Origin-Bottom-Right Scale & Message Slide-In
 */
function initChatbot() {
  const toggleBtn = document.getElementById('chatbot-toggle-btn');
  const chatWindow = document.getElementById('chatbot-window');
  const closeBtn = document.getElementById('close-chatbot-btn');
  const chatForm = document.getElementById('chatbot-form');
  const chatInput = document.getElementById('chatbot-input');
  const messagesContainer = document.getElementById('chatbot-messages');

  if (!toggleBtn || !chatWindow) return;

  toggleBtn.addEventListener('click', () => {
    const isHidden = chatWindow.classList.contains('hidden');
    if (isHidden) {
      chatWindow.classList.remove('hidden');
      if (chatInput) chatInput.focus();
    } else {
      chatWindow.classList.add('hidden');
    }
  });

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      chatWindow.classList.add('hidden');
    });
  }

  // Quick Chips
  const chips = document.querySelectorAll('.faq-chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const text = chip.getAttribute('data-question') || chip.textContent.trim();
      handleUserMessage(text);
    });
  });

  if (chatForm && chatInput) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const message = chatInput.value.trim();
      if (!message) return;
      chatInput.value = '';
      handleUserMessage(message);
    });
  }

  function handleUserMessage(text) {
    appendMessage(text, 'user');
    const typingId = showTypingIndicator();

    setTimeout(() => {
      removeTypingIndicator(typingId);
      const botResponse = matchFaqRule(text);
      appendMessage(botResponse, 'bot');
    }, 350);
  }

  function appendMessage(text, sender) {
    if (!messagesContainer) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = `flex ${sender === 'user' ? 'justify-end' : 'justify-start'} mb-3 chat-message-in`;

    if (sender === 'user') {
      msgDiv.innerHTML = `
        <div class="bg-[var(--accent-primary)] text-white text-xs sm:text-sm rounded-[12px] rounded-tr-none px-4 py-2.5 max-w-[85%] shadow-md">
          ${escapeHtml(text)}
        </div>
      `;
    } else {
      msgDiv.innerHTML = `
        <div class="flex items-start gap-2.5 max-w-[85%]">
          <div class="w-7 h-7 rounded-full bg-[rgba(108,92,231,0.2)] text-[var(--accent-primary)] flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 border border-[var(--border-subtle)]">
            AI
          </div>
          <div class="bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-xs sm:text-sm rounded-[12px] rounded-tl-none px-4 py-2.5 shadow-sm leading-relaxed">
            ${escapeHtml(text)}
          </div>
        </div>
      `;
    }

    messagesContainer.appendChild(msgDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function showTypingIndicator() {
    if (!messagesContainer) return null;
    const id = 'typing-' + Date.now();
    const typingDiv = document.createElement('div');
    typingDiv.id = id;
    typingDiv.className = 'flex items-start gap-2 max-w-[85%] mb-3 chat-message-in';
    typingDiv.innerHTML = `
      <div class="w-7 h-7 rounded-full bg-[rgba(108,92,231,0.2)] text-[var(--accent-primary)] flex items-center justify-center text-xs font-bold shrink-0">
        AI
      </div>
      <div class="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-[12px] rounded-tl-none px-4 py-2.5 flex gap-1.5 items-center">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    `;
    messagesContainer.appendChild(typingDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return id;
  }

  function removeTypingIndicator(id) {
    if (!id) return;
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  function matchFaqRule(input) {
    const q = input.toLowerCase();
    if (q.includes('attendance') || q.includes('absent') || q.includes('present') || q.includes('75')) {
      return "You can view your detailed lecture & lab attendance under 'My Attendance' (/student/attendance). A minimum of 75% is mandatory for semester exams.";
    }
    if (q.includes('result') || q.includes('mark') || q.includes('grade') || q.includes('score')) {
      return "Check semester exam scorecards and subject-wise grades under 'My Results' (/student/results).";
    }
    if (q.includes('library') || q.includes('book') || q.includes('borrow')) {
      return "Visit the campus central library to borrow books with your Roll Number. Track due dates and loans in the 'Library' section (/student/library).";
    }
    if (q.includes('quiz') || q.includes('test') || q.includes('exam')) {
      return "Active multiple-choice assessments are available in 'Quiz & Tests' (/student/quiz). Instant automated grading is provided upon submission.";
    }
    if (q.includes('admin') || q.includes('contact') || q.includes('office') || q.includes('email')) {
      return "Reach out to the Academic Office in Room 102, Academic Block (9:00 AM - 4:30 PM) or email admin@college.edu.";
    }
    return "Hello! I am your Campus Assistant. You can ask about attendance criteria, semester results, library loans, quizzes, or administrator contact details.";
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }
}

/**
 * 10. Mobile Sidebar Drawer Toggle
 */
function initMobileDrawer() {
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.getElementById('app-sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  const closeSidebarBtn = document.getElementById('close-sidebar-btn');

  function openSidebar() {
    if (sidebar) {
      sidebar.classList.remove('-translate-x-full');
      sidebar.classList.add('sidebar-open');
    }
    if (sidebarOverlay) sidebarOverlay.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
  }

  function closeSidebar() {
    if (sidebar) {
      sidebar.classList.add('-translate-x-full');
      sidebar.classList.remove('sidebar-open');
    }
    if (sidebarOverlay) sidebarOverlay.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
  }

  if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', openSidebar);
  if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', closeSidebar);
  if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebar);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar && sidebar.classList.contains('sidebar-open')) {
      closeSidebar();
    }
  });
}

/**
 * 11. Intersection Observer for Landing Page Scroll Reveal
 */
function initScrollReveal() {
  const revealElements = document.querySelectorAll('.scroll-reveal');
  if (!revealElements.length) return;

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        obs.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.12,
    rootMargin: '0px 0px -40px 0px'
  });

  revealElements.forEach(el => observer.observe(el));
}
