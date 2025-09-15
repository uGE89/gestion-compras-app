const TYPE_COLORS = {
  success: 'bg-emerald-500',
  error: 'bg-red-500',
  info: 'bg-sky-600',
  warning: 'bg-amber-500'
};

export function showToast(message, type = 'success') {
  if (!message) return;

  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'fixed bottom-4 right-4 z-50';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  const colorClass = TYPE_COLORS[type] || TYPE_COLORS.success;
  toast.className = `toast ${colorClass} text-white font-bold py-3 px-5 rounded-lg shadow-xl transform translate-y-4 opacity-0 mb-2`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.remove('translate-y-4', 'opacity-0');
  }, 10);

  const removeToast = () => toast.remove();
  setTimeout(() => {
    toast.classList.add('translate-y-4', 'opacity-0');
    toast.addEventListener('transitionend', removeToast, { once: true });
  }, 3200);
}
