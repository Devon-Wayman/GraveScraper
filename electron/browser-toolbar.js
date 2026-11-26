for (const action of ['back', 'forward', 'refresh', 'original']) {
  document.getElementById(action).addEventListener('click', () => window.graveBrowser.navigate(action));
}
window.graveBrowser.onState(state => {
  document.getElementById('back').disabled = !state.back;
  document.getElementById('forward').disabled = !state.forward;
  document.getElementById('address').value = state.url;
  document.getElementById('address').title = state.url;
  document.getElementById('status').textContent = state.error || (state.loading ? 'Loading…' : '');
});
