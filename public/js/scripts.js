// =========================================================================
// Utility Functions - Reusable logic for various parts of the application
// =========================================================================

/**
 * Toggles the mobile navigation menu.
 */
function toggleMobileMenu() {
  const nav = document.getElementById('nav');
  const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');

  if (nav && mobileMenuToggle) {
    // We'll use the .nav-active and .open classes to match our CSS
    nav.classList.toggle('nav-active');
    mobileMenuToggle.classList.toggle('open');
  }
}

/**
 * A simple debounce function to limit how often a function is called.
 * @param {Function} func - The function to debounce.
 * @param {number} wait - The number of milliseconds to wait.
 * @returns {Function} - The debounced function.
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Displays a temporary notification on the screen.
 * @param {string} message - The message to display.
 * @param {string} [type='info'] - The type of notification ('success', 'error', 'warning', 'info').
 */
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;

  // Dynamic styling for the notification box
  const styles = {
    position: 'fixed',
    top: '20px',
    right: '20px',
    padding: '1rem 1.5rem',
    borderRadius: '8px',
    color: 'white',
    fontWeight: '500',
    zIndex: '1000',
    animation: 'slideIn 0.3s ease-out'
  };

  switch (type) {
    case 'success':
      styles.backgroundColor = '#16a34a';
      break;
    case 'error':
      styles.backgroundColor = '#dc2626';
      break;
    case 'warning':
      styles.backgroundColor = '#d97706';
      break;
    default:
      styles.backgroundColor = '#2563eb';
  }

  Object.assign(notification.style, styles);

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-in';
    setTimeout(() => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    }, 300);
  }, 3000);
}

/**
 * Shows a confirmation dialog and executes a callback if confirmed.
 * @param {string} message - The confirmation message.
 * @param {Function} callback - The function to execute on confirmation.
 */
function confirmAction(message, callback) {
  if (window.confirm(message)) {
    callback();
  }
}

/**
 * Sets a loading state on an element, typically a button.
 * @param {HTMLElement} element - The element to modify.
 * @param {boolean} isLoading - True to set loading state, false to remove.
 */
function setLoading(element, isLoading) {
  if (element) {
    element.classList.toggle('loading', isLoading);
    element.disabled = isLoading;
  }
}

// =========================================================================
// Form & Input Specific Functions
// =========================================================================

/**
 * Validates a form's required fields.
 * @param {HTMLFormElement} form - The form element to validate.
 * @returns {boolean} - True if the form is valid, otherwise false.
 */
function validateForm(form) {
  if (!form) return false;

  const inputs = form.querySelectorAll('input[required], select[required], textarea[required]');
  let isValid = true;

  inputs.forEach(input => {
    if (!input.value.trim()) {
      input.classList.add('error');
      input.style.borderColor = '#dc2626';
      isValid = false;
    } else {
      input.classList.remove('error');
      input.style.borderColor = ''; // Reset border color
    }
  });

  if (!isValid) {
    showNotification('Please fill in all required fields', 'error');
  }

  return isValid;
}

/**
 * Validates a mobile number against a 10-digit regex.
 * @param {string} mobile - The mobile number string.
 * @returns {boolean} - True if valid, false otherwise.
 */
function validateMobile(mobile) {
  const mobileRegex = /^\d{10}$/;
  return mobileRegex.test(mobile);
}

/**
 * Validates an email address.
 * @param {string} email - The email string.
 * @returns {boolean} - True if valid, false otherwise.
 */
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Provides a password strength score (0-5).
 * @param {string} password - The password string.
 * @returns {number} - The strength score.
 */
function checkPasswordStrength(password) {
  let strength = 0;
  if (password.length >= 8) strength++;
  if (/[a-z]/.test(password)) strength++;
  if (/[A-Z]/.test(password)) strength++;
  if (/[0-9]/.test(password)) strength++;
  if (/[^a-zA-Z0-9]/.test(password)) strength++;
  return strength;
}

/**
 * Previews images selected in a file input.
 * @param {HTMLInputElement} input - The file input element.
 */
function previewImages(input) {
  const preview = document.getElementById('image-preview');
  if (!preview) return;

  preview.innerHTML = '';

  if (input.files) {
    Array.from(input.files).forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = function(e) {
          const img = document.createElement('img');
          img.src = e.target.result;
          img.style.cssText = 'max-width:100px; max-height:100px; margin:5px; border-radius:4px;';
          preview.appendChild(img);
        };
        reader.readAsDataURL(file);
      }
    });
  }
}

/**
 * Enables auto-saving of form data to local storage.
 * @param {string} formId - The ID of the form.
 */
function enableAutoSave(formId) {
  const form = document.getElementById(formId);
  if (!form) return;

  const inputs = form.querySelectorAll('input, select, textarea');

  inputs.forEach(input => {
    input.addEventListener('input', debounce(() => {
      const formData = new FormData(form);
      const data = Object.fromEntries(formData);
      localStorage.setItem(`autosave_${formId}`, JSON.stringify(data));
    }, 1000));
  });

  const savedData = localStorage.getItem(`autosave_${formId}`);
  if (savedData) {
    const data = JSON.parse(savedData);
    Object.keys(data).forEach(key => {
      const input = form.querySelector(`[name="${key}"]`);
      if (input) {
        input.value = data[key];
      }
    });
  }
}

// =========================================================================
// Socket.IO & Real-Time Messaging
// =========================================================================

/**
 * Initializes the Socket.IO connection and handles real-time events.
 */
function initializeSocketIO() {
  const userId = document.body.getAttribute('data-user-id');

  if (!userId) {
    console.log('No user ID found, skipping Socket.IO initialization.');
    return;
  }

  // Use the correct port for the server
  const socket = io('http://localhost:3001');

  socket.on('connect', () => {
    console.log(`Connected to Socket.IO. Joining room for user: ${userId}`);
    socket.emit('join', userId);
  });

  socket.on('newMessage', (messageData) => {
    console.log('Received new message:', messageData);
    // showNotification(`New message from ${messageData.senderId}`, 'info');
    updateUnreadMessageCount();
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from Socket.IO.');
  });
}

/**
 * Fetches the unread message count from the server and updates the badge.
 */
async function updateUnreadMessageCount() {
  const notificationBadge = document.getElementById('notification-badge'); // Changed this ID
  if (!notificationBadge) return;

  try {
    const response = await fetch('/messages/unread-count');
    if (!response.ok) {
      throw new Error('Failed to fetch unread message count.');
    }
    const data = await response.json();

    if (data.count > 0) {
      notificationBadge.textContent = data.count;
      notificationBadge.style.display = 'block';
    } else {
      notificationBadge.textContent = '0';
      notificationBadge.style.display = 'none';
    }
  } catch (error) {
    console.error('Error fetching unread count:', error);
  }
}

// =========================================================================
// Main App Initialization
// =========================================================================

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Socket.IO for real-time features
  initializeSocketIO();

  // Call the function on page load to set the initial count
  updateUnreadMessageCount();

  // Add fade-in animation to main content
  const main = document.querySelector('.main');
  if (main) {
    main.classList.add('fade-in');
  }

  // Handle mobile menu clicks
  document.querySelector('.mobile-menu-toggle')?.addEventListener('click', () => {
    const nav = document.getElementById('nav');
    const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
    nav.classList.toggle('nav-active');
    mobileMenuToggle.classList.toggle('open');
  });

  // Optional: Close menu when a link is clicked
  const navLinks = document.querySelectorAll('.nav a');
  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      const nav = document.getElementById('nav');
      const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
      nav.classList.remove('nav-active');
      mobileMenuToggle.classList.remove('open');
    });
  });

  // Initialize search functionality if a search input is present
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    const searchFunction = debounce((e) => {
      const searchTerm = e.target.value.toLowerCase();
      document.querySelectorAll('.searchable-item').forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(searchTerm) ? 'block' : 'none';
      });
    }, 300);
    searchInput.addEventListener('input', searchFunction);
  }

  // Form validation on submit
  document.querySelectorAll('form').forEach(form => {
    form.addEventListener('submit', function(e) {
      if (!validateForm(this)) {
        e.preventDefault();
      }
    });
  });

  // Add image preview for file inputs
  document.querySelectorAll('input[type="file"]').forEach(input => {
    if (input.accept && input.accept.includes('image')) {
      input.addEventListener('change', () => previewImages(input));
    }
  });

  // Enable auto-save for profile forms
  enableAutoSave('profile-form');

  // Add smooth scrolling for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
});