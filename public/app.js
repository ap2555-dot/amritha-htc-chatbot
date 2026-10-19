(function () {
  'use strict';

  var MAX_CHARS = 2000;
  var HISTORY_LIMIT = 12; // messages sent as context
  var REQUEST_TIMEOUT_MS = 30000;

  var log = document.getElementById('log');
  var empty = document.getElementById('empty');
  var form = document.getElementById('composer');
  var input = document.getElementById('composer-input');
  var sendBtn = document.getElementById('send');
  var count = document.getElementById('count');
  var newChatBtn = document.getElementById('new-chat');
  var themeBtn = document.getElementById('theme-toggle');

  var history = []; // {role, content}
  var busy = false;
  var epoch = 0; // bumped by New chat so stale replies are dropped
  var inflight = null;
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Theme ----------
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    var light = t === 'light';
    themeBtn.setAttribute('aria-pressed', String(light));
    themeBtn.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
  }
  applyTheme(document.documentElement.getAttribute('data-theme') || 'dark');
  themeBtn.addEventListener('click', function () {
    var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try { localStorage.setItem('orbit-theme', next); } catch (e) {}
  });

  // ---------- Rendering ----------
  // Safe renderer: text, ``` code blocks, `inline code`. Everything via textContent.
  function renderContent(el, text) {
    var parts = text.split(/```/);
    parts.forEach(function (part, i) {
      if (i % 2 === 1) {
        var code = part.replace(/^[^\n]*\n/, function (m) { return /^[\w+#.-]*\s*\n$/.test(m) ? '' : m; });
        var pre = document.createElement('pre');
        var c = document.createElement('code');
        c.textContent = code.replace(/\n$/, '');
        pre.appendChild(c);
        el.appendChild(pre);
      } else if (part.trim()) {
        if (i > 0) part = part.replace(/^\n+/, '');
        if (i < parts.length - 1) part = part.replace(/\n+$/, '');
        var span = document.createElement('span');
        span.className = 't';
        part.split(/(`[^`\n]+`)/).forEach(function (seg) {
          if (seg.length > 2 && seg[0] === '`' && seg[seg.length - 1] === '`') {
            var ic = document.createElement('code');
            ic.className = 'inline';
            ic.textContent = seg.slice(1, -1);
            span.appendChild(ic);
          } else {
            span.appendChild(document.createTextNode(seg));
          }
        });
        el.appendChild(span);
      }
    });
  }

  function scrollToEnd() {
    log.scrollTo({ top: log.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  function addMessage(role, text, opts) {
    var wrap = document.createElement('div');
    wrap.className = 'msg ' + role;
    var who = document.createElement('span');
    who.className = 'label who';
    who.textContent = role === 'user' ? 'you' : role === 'error' ? 'error' : 'orbit';
    var body = document.createElement('div');
    body.className = 'body';
    if (role === 'assistant' || role === 'user') renderContent(body, text);
    else body.textContent = text;
    wrap.appendChild(who);
    wrap.appendChild(body);
    if (opts && opts.retry) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn retry';
      b.textContent = 'Try again';
      b.addEventListener('click', function () {
        wrap.remove();
        requestReply();
      });
      body.appendChild(document.createElement('br'));
      body.appendChild(b);
    }
    log.appendChild(wrap);
    scrollToEnd();
    return wrap;
  }

  function showTyping() {
    var wrap = document.createElement('div');
    wrap.className = 'msg assistant typing';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-label', 'Orbit is thinking');
    wrap.innerHTML = '<span class="label who">orbit is thinking</span><div class="body" aria-hidden="true"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';
    log.appendChild(wrap);
    scrollToEnd();
    return wrap;
  }

  // ---------- State ----------
  function setBusy(v) {
    busy = v;
    input.setAttribute('aria-busy', String(v));
    updateSend();
  }
  function updateSend() {
    sendBtn.disabled = busy || input.value.trim().length === 0;
  }
  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight + 4, 160) + 'px';
  }
  function updateCount() {
    var n = input.value.length;
    count.textContent = n + '/' + MAX_CHARS;
    count.classList.toggle('near', n > MAX_CHARS * 0.9);
  }

  // ---------- Network ----------
  function requestReply() {
    setBusy(true);
    var typing = showTyping();
    var controller = new AbortController();
    var myEpoch = epoch;
    inflight = controller;
    var timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ messages: history.slice(-HISTORY_LIMIT) })
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok || !data.reply) throw new Error(data.error || 'Something went wrong (' + res.status + ').');
          return data.reply;
        });
      })
      .then(function (reply) {
        if (myEpoch !== epoch) return;
        typing.remove();
        history.push({ role: 'assistant', content: reply });
        addMessage('assistant', reply);
      })
      .catch(function (err) {
        if (myEpoch !== epoch) return;
        typing.remove();
        var msg = err && err.name === 'AbortError'
          ? 'The request took too long. Please try again.'
          : (err && err.message) || 'Could not reach Orbit. Check your connection and try again.';
        if (err instanceof TypeError) msg = 'Could not reach Orbit. Check your connection and try again.';
        addMessage('error', msg, { retry: true });
      })
      .then(function () {
        clearTimeout(timer);
        if (myEpoch !== epoch) return;
        setBusy(false);
        input.focus();
      });
  }

  function send(text) {
    text = text.trim().slice(0, MAX_CHARS);
    if (!text || busy) return;
    if (empty && empty.parentNode) empty.remove();
    history.push({ role: 'user', content: text });
    addMessage('user', text);
    input.value = '';
    autosize();
    updateCount();
    requestReply();
  }

  // ---------- Events ----------
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    send(input.value);
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!sendBtn.disabled) form.requestSubmit();
    }
  });
  input.addEventListener('input', function () { autosize(); updateCount(); updateSend(); });

  document.getElementById('chips').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (chip) send(chip.textContent);
  });

  newChatBtn.addEventListener('click', function () {
    epoch++;
    if (inflight) inflight.abort();
    history = [];
    Array.prototype.slice.call(log.querySelectorAll('.msg')).forEach(function (n) { n.remove(); });
    if (!log.contains(empty)) log.appendChild(empty);
    setBusy(false);
    input.value = '';
    autosize(); updateCount(); updateSend();
    input.focus();
  });
  updateCount();
  updateSend();
})();
