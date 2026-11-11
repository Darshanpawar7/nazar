/* Applies the saved theme before the first paint. Dark ("instrument panel") unless the visitor chose light. */
(function () {
  try {
    if (localStorage.getItem('nazar-theme') === 'light') document.documentElement.setAttribute('data-theme', 'light');
  } catch (error) {
    /* storage unavailable: keep the default */
  }
})();
