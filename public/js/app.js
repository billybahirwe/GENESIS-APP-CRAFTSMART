// Mobile Menu Toggle
function toggleMobileMenu() {
  const nav = document.getElementById('nav');
  nav.classList.toggle('mobile-open');
}

// Form Validation
function validateForm(formId) {
  const form = document.getElementById(formId);
  const inputs = form.querySelectorAll('input[required], select[required], textarea[required]');
  let isValid = true;
  
  inputs.forEach(input => {
    if (!input.value.trim()) {
      input.classList.add('error');
      isValid = false;
    } else {
      input.classList.remove('error');
    }
  });
  
  return isValid;
}

// Mobile Number Validation
function validateMobile(mobile) {
  const mobileRegex = /^[0-9]{10}$/;
  return mobileRegex.test(mobile);
}

// Email Validation
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Password Strength Indicator
function checkPasswordStrength(password) {
  let strength = 0;
  
  if (password.length >= 8) strength++;
  if (/[a-z]/.test(password)) strength++;
  if (/[A-Z]/.test(password)) strength++;
  if (/[0-9]/.test(password)) strength++;
  if (/[^a-zA-Z0-9]/.test(password)) strength++;
  
  return strength;
}

// File Upload Preview
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
          img.style.maxWidth = '100px';
          img.style.maxHeight = '100px';
          img.style.margin = '5px';
          img.style.borderRadius = '4px';
          preview.appendChild(img);
        };
        reader.readAsDataURL(file);
      }
    });
  }
}

// Search and Filter Functions
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

// Notification System
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 1rem 1.5rem;
    border-radius: 8px;
    color: white;
    font-weight: 500;
    z-index: 1000;
    animation: slideIn 0.3s ease-out;
  `;
  
  switch (type) {
    case 'success':
      notification.style.backgroundColor = '#16a34a';
      break;
    case 'error':
      notification.style.backgroundColor = '#dc2626';
      break;
    case 'warning':
      notification.style.backgroundColor = '#d97706';
      break;
    default:
      notification.style.backgroundColor = '#2563eb';
  }
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-in';
    setTimeout(() => {
      document.body.removeChild(notification);
    }, 300);
  }, 3000);
}

// Auto-save for forms
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
  
  // Load saved data
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

// Real-time Search
function initializeSearch(searchInputId, targetClass) {
  const searchInput = document.getElementById(searchInputId);
  if (!searchInput) return;
  
  searchInput.addEventListener('input', debounce((e) => {
    const searchTerm = e.target.value.toLowerCase();
    const items = document.querySelectorAll(`.${targetClass}`);
    
    items.forEach(item => {
      const text = item.textContent.toLowerCase();
      item.style.display = text.includes(searchTerm) ? 'block' : 'none';
    });
  }, 300));
}

// Loading States
function setLoading(element, isLoading) {
  if (isLoading) {
    element.classList.add('loading');
    element.disabled = true;
  } else {
    element.classList.remove('loading');
    element.disabled = false;
  }
}

// Confirmation Dialogs
function confirmAction(message, callback) {
  if (confirm(message)) {
    callback();
  }
}

// Dynamic Content Loading
async function loadContent(url, targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;
  
  try {
    setLoading(target, true);
    const response = await fetch(url);
    const html = await response.text();
    target.innerHTML = html;
  } catch (error) {
    showNotification('Error loading content', 'error');
  } finally {
    setLoading(target, false);
  }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  // Add fade-in animation to main content
  const main = document.querySelector('.main');
  if (main) {
    main.classList.add('fade-in');
  }
  
  // Initialize search functionality if present
  initializeSearch('search-input', 'searchable-item');
  
  // Enable auto-save for profile forms
  enableAutoSave('profile-form');
  
  // Add smooth scrolling for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        target.scrollIntoView({
          behavior: 'smooth'
        });
      }
    });
  });
  
  // Form validation on submit
  document.querySelectorAll('form').forEach(form => {
    form.addEventListener('submit', function(e) {
      const requiredInputs = form.querySelectorAll('input[required], select[required], textarea[required]');
      let isValid = true;
      
      requiredInputs.forEach(input => {
        if (!input.value.trim()) {
          input.style.borderColor = '#dc2626';
          isValid = false;
        } else {
          input.style.borderColor = '#e5e7eb';
        }
      });
      
      if (!isValid) {
        e.preventDefault();
        showNotification('Please fill in all required fields', 'error');
      }
    });
  });
  
  // Add image preview for file inputs
  document.querySelectorAll('input[type="file"]').forEach(input => {
    if (input.accept && input.accept.includes('image')) {
      input.addEventListener('change', function() {
        previewImages(this);
      });
    }
  });
  
  // Initialize tooltips and popovers if needed
  initializeTooltips();
});

// Tooltip initialization
function initializeTooltips() {
  const tooltips = document.querySelectorAll('[data-tooltip]');
  tooltips.forEach(element => {
    element.addEventListener('mouseenter', showTooltip);
    element.addEventListener('mouseleave', hideTooltip);
  });
}

function showTooltip(e) {
  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.textContent = e.target.dataset.tooltip;
  tooltip.style.cssText = `
    position: absolute;
    background: #1f2937;
    color: white;
    padding: 0.5rem;
    border-radius: 4px;
    font-size: 0.875rem;
    z-index: 1000;
    pointer-events: none;
  `;
  
  document.body.appendChild(tooltip);
  
  const rect = e.target.getBoundingClientRect();
  tooltip.style.left = rect.left + rect.width / 2 - tooltip.offsetWidth / 2 + 'px';
  tooltip.style.top = rect.top - tooltip.offsetHeight - 10 + 'px';
  
  e.target.tooltipElement = tooltip;
}

function hideTooltip(e) {
  if (e.target.tooltipElement) {
    document.body.removeChild(e.target.tooltipElement);
    e.target.tooltipElement = null;
  }
}

// Export functions for use in other scripts
window.CraftSmartApp = {
  showNotification,
  validateForm,
  validateMobile,
  validateEmail,
  confirmAction,
  setLoading,
  loadContent,
  enableAutoSave
};