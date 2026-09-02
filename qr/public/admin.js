/* Admin niceties: confirm destructive actions, show timestamps in local time. */
(function () {
  'use strict';

  document.querySelectorAll('[data-confirm]').forEach(function (button) {
    button.addEventListener('click', function (event) {
      if (!window.confirm(button.dataset.confirm)) event.preventDefault();
    });
  });

  var fmt;
  try {
    fmt = new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch (e) {
    return;
  }

  document.querySelectorAll('time[datetime]').forEach(function (node) {
    var date = new Date(node.getAttribute('datetime'));
    if (isNaN(date.getTime())) return;
    node.title = 'UTC: ' + node.textContent.trim();
    node.textContent = fmt.format(date);
  });
})();
